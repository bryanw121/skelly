// The events job (scripts/events.mjs) as a function: reads the listing sites, the weekly markets
// and (with its secrets) Instagram, fills in hours, merges with the previous feed and writes
// public/data/events.json and its side files. The network comes in as `get` / `fetch`, the clock
// as `now`, the files under `dataDir`, so the whole job runs offline on the canary's recordings
// (test/full-day.test.mjs). Returns { feed, results, skipped } (skipped: why nothing was read).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpGet } from './http.js';
import { repoPath } from './paths.js';
import { loadRegions } from './regions.js';
import { today as todayIn } from './time.js';
import { creditAccounts, fillHours, mergeEvents, missingListings, promotedAccounts, readEventSources } from './event-sources.js';
import { robotsAllows } from './robots.js';
import { readMarkets } from './markets.js';
import { accountHomes, handleOf, noteReads, pickAccounts, readInstagram } from './instagram.js';
import { saveAvatars, stampAvatars } from './avatars.js';

export const LISTINGS_DUE_MS = 5 * 3600e3;
/** Profile pictures looked up per run for accounts the feed credits (the rest wait for later runs). */
export const AVATARS_PER_RUN = 15;
/** Discovered accounts read per run beyond the configured ones (each is a request; the API allows about 200 an hour). */
export const IG_ACCOUNTS_PER_RUN = 40;

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

/**
 * Run the events job. `ifDue`: only if the last listing read is 5+ hours old (else put back any
 * listing events another writer dropped). `dry`: print, write nothing.
 */
export async function runEventsJob({
  fetch = globalThis.fetch, get = (url, opts = {}) => httpGet(url, { ...opts, fetch }), now = Date.now(),
  dataDir = repoPath('public/data'), failuresDir = repoPath('scrape-failures'), config = readJson(repoPath('config/events.json')),
  regions = loadRegions().map((r) => r.info), env = process.env, ifDue = false, dry = false, log = console.log,
  igConfig = () => readJson(repoPath('config/instagram.json')),
} = {}) {
  const OUT = join(dataDir, 'events.json');
  const previous = readJson(OUT, null);
  // What the listing readers last found, kept beside the feed: the feed has other writers, and one
  // that rewrites the file must not cost the listing events until the next read (up to 5 hours).
  const CACHE = join(dataDir, 'event-listings.json');
  // Every account the feed has credited, across runs (creditAccounts): an organizer found twice by
  // the daily scout is promoted, and from then on read by rule with the configured accounts.
  const LEDGER = join(dataDir, 'event-accounts.json');
  const today = todayIn(new Date(now));
  const ledgerNow = () => creditAccounts(readJson(LEDGER, {}), previous?.events, today, handleOf);
  const saveLedger = (l) => { mkdirSync(dataDir, { recursive: true }); writeFileSync(LEDGER, `${JSON.stringify(l, null, 1)}\n`); };

  if (ifDue && previous?.listingsAt && now - Date.parse(previous.listingsAt) < LISTINGS_DUE_MS) {
    if (!dry) saveLedger(ledgerNow());
    const back = missingListings(previous.events, readJson(CACHE, { events: [] }).events, today);
    if (back.length && !dry) {
      const events = [...previous.events, ...back].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
      writeFileSync(OUT, `${JSON.stringify({ ...previous, generatedAt: new Date(now).toISOString(), events }, null, 1)}\n`);
      log(`Put back ${back.length} listing event(s) another writer had dropped: ${back.map((e) => e.title).join('; ')}`);
      return { feed: null, results: [], skipped: 'not due; put back dropped listings', putBack: back.length };
    }
    log(`Listing events were read at ${previous.listingsAt}; not due yet.`);
    return { feed: null, results: [], skipped: 'not due' };
  }

  const results = await readEventSources(config, { get, today, regions });
  // Weekly markets (farmers, makers, flea) from OpenStreetMap: each one's next market day (lib/markets.js).
  // Each region's answer is kept and asked for again at most once a day, so a slow Overpass changes nothing.
  const MARKETS = join(dataDir, 'markets-osm.json');
  const marketsRead = await readMarkets(regions, { today, now, fetch, cache: readJson(MARKETS, {}) });
  results.push(marketsRead);
  // Listing pages give a date and no hours: each event's own page has them. Read once, remembered.
  const HOURS = join(dataDir, 'event-hours.json');
  const hours = readJson(HOURS, {});
  const robots = new Map();
  const allowed = async (url) => {
    const u = new URL(url);
    if (!robots.has(u.origin)) robots.set(u.origin, await get(`${u.origin}/robots.txt`).then((r) => (r.ok ? r.text : r.status === 404 ? '' : null)).catch(() => null));
    const text = robots.get(u.origin);
    return text != null && robotsAllows(text, u.pathname + u.search); // no answer about the rules: don't read
  };
  const hoursRead = await fillHours(results.flatMap((r) => r.events), hours, { get, allowed, now });
  log(`Hours: read ${hoursRead} event page(s); ${results.flatMap((r) => r.events).filter((e) => !e.startTime).length} listing event(s) still have none.`);

  // Instagram organizers through Meta's official API, when its two secrets exist (lib/instagram.js).
  // Besides the configured accounts' posts, it looks up the profile picture of any account the feed
  // already credits and has no fresh picture for.
  // The account the API calls are made as is public (config/instagram.json); only the token is secret.
  const { IG_ACCESS_TOKEN } = env;
  const IG_USER_ID = env.IG_USER_ID || (() => { try { return igConfig().igUserId; } catch { return undefined; } })();
  const AVATARS = join(dataDir, 'avatars');
  let profiles = {};
  if (IG_USER_ID && IG_ACCESS_TOKEN) {
    const ig = igConfig();
    // Every account the feed has credited (the daily discovery's finds) is read too, a rotation of
    // IG_ACCOUNTS_PER_RUN a run, longest unread first; each is placed where its events are.
    const READS = join(dataDir, 'instagram-reads.json');
    const reads = readJson(READS, {});
    const homes = accountHomes(previous?.events);
    const credited = promotedAccounts(ledgerNow(), new Set(ig.skip ?? []), 1);
    const { read: extra, waiting } = pickAccounts(ig.accounts, credited, reads, { now, max: IG_ACCOUNTS_PER_RUN });
    ig.accounts = [...ig.accounts, ...extra.map((handle) => ({ handle }))].map((a) => (a.region ? a : { ...homes[a.handle], ...a }));
    if (extra.length) log(`Instagram: reading ${ig.accounts.length} accounts (${extra.length} found by the daily discovery${waiting ? `; ${waiting} more on later runs` : ''}).`);
    const index = readJson(join(AVATARS, 'index.json'), {});
    const stale = (h) => !index[h] || now - Date.parse(index[h].fetchedAt) > 7 * 864e5;
    // Pictures for credited accounts are fetched a few per run (each is a request), the stalest first.
    const reading = new Set(ig.accounts.map((a) => a.handle));
    const pictures = [...new Set((previous?.events ?? []).map((e) => handleOf(e.source)).filter(Boolean))].filter((h) => stale(h) && !reading.has(h))
      .sort((a, b) => (index[a] ? Date.parse(index[a].fetchedAt) : 0) - (index[b] ? Date.parse(index[b].fetchedAt) : 0))
      .slice(0, AVATARS_PER_RUN);
    const r = await readInstagram(ig, { get, today, igUserId: IG_USER_ID, token: IG_ACCESS_TOKEN, extraHandles: pictures });
    // Only accounts that were asked are stamped: after a rate limit the rest stay first in line.
    const asked = new Set([...r.read, ...r.skipped]);
    if (r.ok && !dry) { mkdirSync(dataDir, { recursive: true }); writeFileSync(READS, `${JSON.stringify(noteReads(reads, [...reading].filter((h) => asked.has(h)), r.skipped, now), null, 1)}\n`); }
    results.push({ id: 'instagram', ok: r.ok, error: r.error, events: r.events });
    profiles = Object.fromEntries(Object.entries(r.profiles).filter(([h]) => stale(h)));
    if (r.skipped.length) log(`Instagram: couldn't read ${r.skipped.map((h) => `@${h}`).join(', ')} (personal, private or renamed accounts).`);
  } else log('Instagram: IG_ACCESS_TOKEN not set; skipped.');

  for (const r of results) for (const e of r.events) e.sourceId = r.id;
  const events = mergeEvents(previous, results, today, [...config.sources.map((s) => s.name), 'Weekly markets']);
  for (const r of results) log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: ${r.events.length} events${r.error ? ` (${r.error})` : ''}`);
  log(`${events.length} events in the feed.`);
  if (dry) {
    for (const e of results.flatMap((r) => r.events)) log(`  ${e.startDate}${e.endDate ? `..${e.endDate}` : ''}  ${e.kind.padEnd(8)} ${e.tags.join(',').padEnd(14)} ${e.title} · ${e.venue}${Number.isFinite(e.lat) ? '' : ' (no pin)'}`);
    return { feed: null, results, skipped: 'dry run', events };
  }

  mkdirSync(dataDir, { recursive: true });
  if (Object.keys(profiles).length) log(`Saved ${await saveAvatars(profiles, AVATARS, { now })} profile picture(s).`);
  stampAvatars(events, AVATARS);
  const at = new Date(now).toISOString();
  const feed = { ...(previous ?? {}), feedVersion: 1, generatedAt: at, listingsAt: at, sources: results.map((r) => ({ id: r.id, ok: r.ok, count: r.events.length, ...(r.error ? { error: r.error } : {}) })), events,
    // Weekly markets without listed hours (lib/markets.js); a failed read keeps the last list.
    markets: marketsRead.markets.length ? marketsRead.markets : previous?.markets ?? [] };
  saveLedger(creditAccounts(ledgerNow(), events, today, handleOf));
  // The listing readers' own events as merged into the feed (with their pins), for missingListings above.
  const listingIds = new Set([...config.sources.map((x) => x.id), 'weekly-markets']);
  writeFileSync(CACHE, `${JSON.stringify({ listingsAt: at, events: events.filter((e) => listingIds.has(e.sourceId)) }, null, 1)}\n`);
  writeFileSync(HOURS, `${JSON.stringify(hours, null, 1)}\n`);
  writeFileSync(MARKETS, `${JSON.stringify(marketsRead.cache)}\n`);
  writeFileSync(OUT, `${JSON.stringify(feed, null, 1)}\n`);
  mkdirSync(failuresDir, { recursive: true });
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(failuresDir, 'events-sources.md'), failed.length ? `Events (events.json): ${failed.length} listing source(s) failed; their last events are kept.\n\n${failed.map((r) => `- **${r.id}**: ${r.error}`).join('\n')}\n` : '');
  return { feed, results, skipped: null };
}
