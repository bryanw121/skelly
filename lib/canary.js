// The canary (docs/testing.md, tier 3): the only code that reads the real sources on purpose
// outside a scrape. It runs a few "units" (one schedule source, one programs source, one events
// source, or the markets read), records every answer into test/cassettes/<unit>/ through
// test/support/cassette.mjs, and checks the recording replays to the same result. The tests then
// replay those recordings forever, with no network.
//
// Polite by construction: one request at a time per host with a gap between them, robots.txt
// read once per host and obeyed (a disallowed page is refused, not fetched), and a hard request
// budget per unit and per run. Pure helpers here; scripts/canary.mjs wires the real network.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { robotsAllows } from './robots.js';
import { USER_AGENT } from './http.js';
import { CASSETTES, record, replay } from '../test/support/cassette.mjs';
import { scrubText, sanitizeArketa, sanitizeReclubMeet, sanitizeReclubClub, sanitizeWpPages, sanitizeSweatpalsHost } from '../scripts/sanitize-fixtures.mjs';

export const DAYS = 7;
export const UNIT_BUDGET = 250;  // requests one unit may make (a reader that needs more fails, rather than record part of a source)
export const RUN_BUDGET = 400;   // requests one day's run may make, robots.txt included
export const HOST_GAP_MS = 2000; // between two requests to one host

export class BudgetExceeded extends Error {
  constructor(scope, max) { super(`request budget spent (${scope}: ${max})`); this.name = 'BudgetExceeded'; }
}
export class RobotsDisallowed extends Error {
  constructor(url) { super(`robots.txt disallows ${url}`); this.name = 'RobotsDisallowed'; this.url = url; }
}

/**
 * Each unit's weekday (0 = Sunday) in the weekly rotation: the units sorted by id, dealt out in
 * turn, so every day gets about the same number (adding a source may move others by a day).
 */
export function rotation(units) {
  const ids = units.map((u) => u.id).sort();
  return new Map(ids.map((id, i) => [id, i % DAYS]));
}

/**
 * Which units this run records: `only` (ids, or prefixes ending in ":" such as "schedule:"), else
 * every unit with `all`, else the ones whose rotation day is `day`. Paused sources are never listed.
 */
export function pickUnits(units, { day, only = [], all = false } = {}) {
  if (only.length) return units.filter((u) => only.some((o) => u.id === o || (o.endsWith(':') && u.id.startsWith(o))));
  if (all) return units;
  const days = rotation(units);
  return units.filter((u) => days.get(u.id) === day);
}

/** A unit id as a cassette folder: "schedule:reclub" -> "schedule/reclub". */
export const cassetteName = (id) => id.replace(':', '/');

const json = (text, fn) => { try { return `${JSON.stringify(fn(JSON.parse(text)), null, 1)}\n`; } catch { return scrubText(text); } };

// Keys that hold people: who booked, who's going, accounts, contact details. Dropped from any
// recorded JSON (and Next.js page data) that has no cleaner of its own.
const PEOPLE = /^(?:(?:first|last|full|display|user)_?name|e?mail|email_?address|phone(?:_?number)?|mobile|avatar(?:_?url)?|photo(?:_?url)?|picture|profile(?:_?image)?|users?|user_?id|members?|players?|participants?|attendees?|registrations?|registrants?|customers?|customer_?id|owner|booker|booked_?by|created_?by|updated_?by|organizer|guests?|waitlist|rsvps?|contacts?)$/i;
/** A copy of `v` without the keys that hold people (deep). */
export function dropPeople(v) {
  if (Array.isArray(v)) return v.map(dropPeople);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !PEOPLE.test(k)).map(([k, x]) => [k, dropPeople(x)]));
  // Emails only: a phone-number pattern would also catch ids and timestamps inside data.
  return typeof v === 'string' ? v.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'redacted@example.com') : v;
}

const FLIGHT = /self\.__next_f\.push\((\[.*?\])\)<\/script>/gs;
/** A Next.js page reduced to its embedded data records, without people (lib/public-page-data.js reads it the same way). */
export function sanitizeNextPage(html) {
  const chunks = [];
  for (const m of String(html).matchAll(FLIGHT)) { try { const v = JSON.parse(m[1]); if (v[0] === 1 && typeof v[1] === 'string') chunks.push(v[1]); } catch { /* skip */ } }
  const lines = [];
  for (const line of chunks.join('').split('\n')) {
    const i = line.indexOf(':');
    try { lines.push(`${line.slice(0, i)}:${JSON.stringify(dropPeople(JSON.parse(line.slice(i + 1))))}`); } catch { /* non-JSON record: not read */ }
  }
  return `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n<script>self.__next_f.push(${JSON.stringify([1, `${lines.join('\n')}\n`])})</script>\n</body></html>\n`;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
/** Skedda's three answers, cut to what lib/skedda.js reads: never who booked. */
export function sanitizeSkedda(path, text) {
  if (path.startsWith('/booking') && !path.startsWith('/bookingslists')) return '<input name="__RequestVerificationToken" type="hidden" value="recorded">\n';
  if (path.startsWith('/bookingslists')) return json(text, (l) => ({ bookings: (l.bookings ?? []).map((b) => pick(b, ['start', 'end', 'recurrenceRule', 'spaces'])) }));
  if (path.startsWith('/webs')) {
    return json(text, (w) => {
      const spaces = [];
      const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') { if (typeof v.name === 'string' && v.id && 'venue' in v && 'nonAdminVisible' in v) spaces.push(pick(v, ['id', 'name', 'venue', 'nonAdminVisible'])); Object.values(v).forEach(walk); }
      };
      walk(w);
      const rules = (w?.venue?.[0]?.hoursOfAvailability?.rules ?? []).map((r) => pick(r, ['start', 'end', 'daysBitmask', 'spaceIds']));
      return { venue: [{ hoursOfAvailability: { rules } }], spaces };
    });
  }
  return scrubText(text);
}

/**
 * Personal data out of a recorded body before it's written to the public repository, chosen by
 * the page it came from (the same cleaners as test/fixtures/sources; Skedda cut to times and
 * courts). Other JSON and Next.js page data lose every key that holds people (dropPeople);
 * anything else has emails and phone numbers scrubbed. The canary checks the cleaned recording
 * still gives the same result.
 */
export function sanitizeFor(url, text) {
  let u;
  try { u = new URL(url); } catch { return scrubText(text); }
  const host = u.hostname, path = u.pathname;
  if (host === 'reclub.co' && path.startsWith('/m/')) return sanitizeReclubMeet(text);
  if (host === 'reclub.co' && path.startsWith('/clubs/')) return sanitizeReclubClub(text);
  if (/widget-api.*\.run\.app$/.test(host)) return json(text, sanitizeArketa);
  if (path.includes('/wp-json/wp/v2/pages')) return json(text, sanitizeWpPages);
  if (host.endsWith('sweatpals.com') && path.startsWith('/host/')) return sanitizeSweatpalsHost(text);
  if (/(^|\.)(skedda|allbooked)\.com$/.test(host)) return sanitizeSkedda(path, text);
  if (text.includes('self.__next_f.push')) return sanitizeNextPage(text);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) { try { return `${JSON.stringify(dropPeople(JSON.parse(t)))}\n`; } catch { /* not JSON */ } }
  return /^<(?:!doctype|html|head|body|div)/i.test(t) ? shrinkHtml(scrubText(text)) : scrubText(text);
}

/**
 * An HTML page without what no reader looks at (comments, styles, inline SVG, external script
 * tags, link tags, style attributes, runs of blank space), so recordings stay small. Inline
 * scripts stay: page data lives there. The replay check confirms nothing a reader needs went.
 */
export const shrinkHtml = (html) => String(html)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
  .replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '')
  .replace(/\sstyle="[^"]*"/gi, '')
  .replace(/[ \t]*\n[ \t\n]*/g, '\n')
  .replace(/[ \t]{2,}/g, ' ');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a real fetch for the canary: requests to one host go one at a time, `gapMs` apart;
 * robots.txt is read once per host (through the same queue, counted, never recorded) and a
 * disallowed URL throws RobotsDisallowed without being fetched; past `budget.max` requests the
 * next throws BudgetExceeded. `budget` is shared ({ max, used }) so one object can cap a run.
 * `log` lists what was refused, for the report.
 */
export function politeFetch(real, { gapMs = HOST_GAP_MS, budget = { max: RUN_BUDGET, used: 0 }, unitMax = UNIT_BUDGET, sleep = pause, log = [] } = {}) {
  const queues = new Map(); // host -> promise of the last turn
  const robots = new Map(); // origin -> promise of robots.txt text ('' when none)
  let unitUsed = 0;
  const spend = () => {
    if (budget.used >= budget.max) throw new BudgetExceeded('run', budget.max);
    if (unitUsed >= unitMax) throw new BudgetExceeded('unit', unitMax);
    budget.used++; unitUsed++;
  };
  const onHost = (host, task) => {
    const prev = queues.get(host) ?? Promise.resolve();
    const turn = prev.then(task);
    queues.set(host, turn.catch(() => {}).then(() => sleep(gapMs)));
    return turn;
  };
  const robotsOf = (u) => {
    if (!robots.has(u.origin)) {
      robots.set(u.origin, onHost(u.hostname, async () => {
        spend();
        try {
          const r = await real(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
          return r.ok ? await r.text() : '';
        } catch { return ''; }
      }));
    }
    return robots.get(u.origin);
  };
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const u = new URL(url);
    if (!robotsAllows(await robotsOf(u), `${u.pathname}${u.search}`)) {
      log.push({ refused: url, why: 'robots.txt' });
      throw new RobotsDisallowed(url);
    }
    return onHost(u.hostname, () => { spend(); return real(input, init); });
  };
  return Object.assign(fetch, { used: () => unitUsed, exhausted: () => unitUsed >= unitMax || budget.used >= budget.max });
}

/** What a unit's result counts: sessions, programs, events or markets. */
export const resultCount = (r) => (Array.isArray(r) ? r.length : r?.sessions?.length ?? r?.programs?.length ?? r?.events?.length ?? r?.count ?? 0);

/** The canary's run report as Markdown (the job summary, and the body of the cassettes PR). */
export function report(outcomes, { budget, day, refused = [] } = {}) {
  const lines = [
    `## Canary${day != null ? ` (rotation day ${day})` : ''}`, '',
    `${outcomes.filter((o) => o.ok).length} of ${outcomes.length} recorded · ${budget?.used ?? 0} requests${budget ? ` of ${budget.max}` : ''}`, '',
    '| Unit | Result | Requests | Count | Replays to |', '| --- | --- | ---: | ---: | ---: |',
    ...outcomes.map((o) => `| ${o.id} | ${o.ok ? 'recorded' : `**failed**: ${String(o.error).replace(/\|/g, '\\|').slice(0, 160)}`} | ${o.requests ?? 0} | ${o.ok ? o.count : ''} | ${o.ok ? (o.replayCount === o.count ? o.replayCount : `**${o.replayCount}**`) : ''} |`),
  ];
  if (refused.length) lines.push('', 'Refused by robots.txt:', ...refused.map((r) => `- ${r.refused}`));
  return `${lines.join('\n')}\n`;
}

/**
 * Record each unit in turn into `dir`/<cassette> through politeFetch(real). A recording replaces
 * the old one only when it replays to the same count as the live read. Stops once the run budget
 * is spent. Returns { outcomes, budget, refused }.
 */
export async function runCanary(units, { fetch: real = globalThis.fetch, now = new Date(), dir = CASSETTES, budget = { max: RUN_BUDGET, used: 0 }, unitMax = UNIT_BUDGET, gapMs = HOST_GAP_MS, log = () => {} } = {}) {
  const refused = [], outcomes = [];
  for (const unit of units) {
    const name = cassetteName(unit.id);
    const tmp = mkdtempSync(join(tmpdir(), 'canary-'));
    const polite = politeFetch(real, { budget, unitMax, gapMs, log: refused });
    const rec = record(name, { fetch: polite, dir: tmp, sanitize: (text, url) => sanitizeFor(url, text), now: () => now });
    const outcome = { id: unit.id };
    try {
      outcome.count = resultCount(await unit.run({ fetch: rec, now }));
      outcome.requests = polite.used();
      // Readers carry on past a failed page, so a spent budget would leave a partial recording.
      if (polite.exhausted()) throw new Error(`request budget spent after ${outcome.requests} requests: the recording would be partial`);
      rec.save({ unit: unit.id, now: now.toISOString(), count: outcome.count });
      outcome.replayCount = resultCount(await unit.run({ fetch: replay(name, { dir: tmp }), now }));
      if (outcome.replayCount !== outcome.count) throw new Error(`the cleaned recording gives ${outcome.replayCount}, the live read gave ${outcome.count}`);
      rmSync(join(dir, name), { recursive: true, force: true });
      cpSync(join(tmp, name), join(dir, name), { recursive: true });
      outcome.ok = true;
    } catch (e) {
      outcome.ok = false;
      outcome.error = e?.message ?? String(e);
      outcome.requests ??= polite.used();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    outcomes.push(outcome);
    log(`${outcome.ok ? 'ok  ' : 'FAIL'}  ${unit.id}: ${outcome.ok ? `${outcome.count} (${outcome.requests} requests)` : outcome.error}`);
    if (budget.used >= budget.max) { log(`run budget spent (${budget.max}); the rest wait for their day`); break; }
  }
  return { outcomes, budget, refused };
}
