// Tier 2 of docs/testing.md: before a scrape publishes, check the feeds it wrote are ones the site
// and vteam can read. No requests: it reads the files. Structural only (parseable, the right
// version, the fields readers use, sane dates and links), so a quiet day never blocks a publish;
// a broken file does, and the site keeps serving the last good copy.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEED_VERSION } from './occurrences.js';
import { FEED_VERSION as PROGRAMS_VERSION, REQUIRED as PROGRAM_FIELDS } from './programs/feed.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isLink = (v) => v == null || (typeof v === 'string' && /^https:\/\//.test(v));

function read(dir, file, errors) {
  const p = join(dir, file);
  if (!existsSync(p)) { errors.push(`${file}: missing`); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { errors.push(`${file}: not JSON (${e.message})`); return null; }
}

/** Problems with one occurrences feed (the combined one or a region's). */
export function occurrenceProblems(feed, file, regionIds) {
  const errors = [];
  if (feed.feedVersion !== FEED_VERSION) errors.push(`${file}: feedVersion ${feed.feedVersion}, readers expect ${FEED_VERSION}`);
  if (!Array.isArray(feed.occurrences)) return [...errors, `${file}: no occurrences list`];
  const seen = new Set();
  feed.occurrences.forEach((o, i) => {
    const at = `${file} #${i} (${o?.id ?? 'no id'})`;
    for (const k of ['id', 'session_id', 'source_id', 'sport', 'region', 'title']) if (typeof o?.[k] !== 'string' || !o[k]) errors.push(`${at}: no ${k}`);
    if (seen.has(o?.id)) errors.push(`${at}: id appears twice`);
    seen.add(o?.id);
    if (regionIds && o?.region && !regionIds.has(o.region)) errors.push(`${at}: unknown region ${o.region}`);
    if (!isTime(o?.starts_at)) errors.push(`${at}: starts_at ${o?.starts_at}`);
    else if (o.ends_at != null && (!isTime(o.ends_at) || Date.parse(o.ends_at) < Date.parse(o.starts_at))) errors.push(`${at}: ends_at ${o.ends_at} before it starts`);
    if (!isLink(o?.signup_url)) errors.push(`${at}: signup_url isn't https`);
  });
  return errors;
}

/**
 * Check the feeds under `dir` (public/data): index.json, occurrences.json and each region's
 * folder, programs.json and events.json. Returns the problems (empty: fine to publish); each
 * file reports at most `limit` so one bad source can't bury the rest.
 */
export function checkFeeds(dir, { limit = 10 } = {}) {
  const errors = [];
  const cap = (list) => (list.length > limit ? [...list.slice(0, limit), `… and ${list.length - limit} more`] : list);

  const index = read(dir, 'index.json', errors);
  const regionIds = new Set((index?.regions ?? []).map((r) => r.id));
  if (index && !regionIds.size) errors.push('index.json: no regions');
  const all = read(dir, 'occurrences.json', errors);
  if (all) errors.push(...cap(occurrenceProblems(all, 'occurrences.json', regionIds)));
  for (const id of regionIds) {
    const f = read(dir, join('regions', id, 'occurrences.json'), errors);
    if (f) errors.push(...cap(occurrenceProblems(f, `regions/${id}/occurrences.json`, new Set([id]))));
    read(dir, join('regions', id, 'schedule.json'), errors);
  }

  const programs = read(dir, 'programs.json', errors);
  if (programs) {
    const p = [];
    if (programs.feedVersion !== PROGRAMS_VERSION) p.push(`programs.json: feedVersion ${programs.feedVersion}, readers expect ${PROGRAMS_VERSION}`);
    if (!Array.isArray(programs.programs)) p.push('programs.json: no programs list');
    else programs.programs.forEach((x, i) => {
      for (const k of PROGRAM_FIELDS) if (x?.[k] == null || x[k] === '') p.push(`programs.json #${i} (${x?.id ?? 'no id'}): no ${k}`);
      if (!isLink(x?.url)) p.push(`programs.json #${i} (${x?.id}): url isn't https`);
    });
    errors.push(...cap(p));
  }

  const events = read(dir, 'events.json', errors);
  if (events) {
    const e = [];
    if (!Array.isArray(events.events)) e.push('events.json: no events list');
    else events.events.forEach((x, i) => {
      for (const k of ['id', 'title']) if (typeof x?.[k] !== 'string' || !x[k]) e.push(`events.json #${i} (${x?.id ?? 'no id'}): no ${k}`);
      if (!DATE.test(x?.startDate ?? '')) e.push(`events.json #${i} (${x?.id}): startDate ${x?.startDate}`);
      if (x?.endDate != null && (!DATE.test(x.endDate) || x.endDate < x.startDate)) e.push(`events.json #${i} (${x?.id}): endDate ${x.endDate}`);
      if (!isLink(x?.sourceUrl)) e.push(`events.json #${i} (${x?.id}): sourceUrl isn't https`);
    });
    errors.push(...cap(e));
  }
  return errors;
}
