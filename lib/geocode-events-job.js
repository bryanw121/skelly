// The geocode-events job (scripts/geocode-events.mjs) as a function: give every event in
// events.json coordinates (lib/event-venues.js: the hand-placed cache first, else the US Census
// geocoder on the street address), one geocoder request a second. The network comes in as `get`,
// the files as paths, so it runs offline in tests. Returns { placed, kept, missed }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegions } from './regions.js';
import { repoPath } from './paths.js';
import { get as httpGet } from './http.js';
import { eventAddress, normalizeVenue, resolveEventVenue } from './event-venues.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runGeocodeEvents({
  dataDir = repoPath('public/data'), regions = loadRegions().map((r) => r.info), get = httpGet,
  dry = false, pauseMs = 1100, now = () => new Date(), log = console.log,
} = {}) {
  const FEED = join(dataDir, 'events.json');
  const CACHE = join(dataDir, 'event-venues.json');
  const feed = JSON.parse(readFileSync(FEED, 'utf8'));
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  // The guard is the center and radius of each event's own region (its `region` field,
  // default Austin's: the feed's original region, and the UI's default too); an unknown
  // region id falls back to Austin's rather than dropping the guard.
  const byId = new Map(regions.map((r) => [r.id, r]));
  const regionFor = (e) => byId.get(e.region ?? 'austin') ?? byId.get('austin') ?? null;

  let placed = 0, kept = 0, missed = 0;
  let cacheChanged = false, feedChanged = false;
  for (const e of feed.events ?? []) {
    const key = normalizeVenue(e.venue);
    if (Number.isFinite(e.lat) && Number.isFinite(e.lng)) {
      // Already placed: make sure the cache knows it, so a later feed without
      // coordinates still resolves (the discovery merge is by id, new copy wins).
      if (!cache[key]?.lat) {
        cache[key] = { lat: e.lat, lng: e.lng, located: e.located ?? 'manual', matched: cache[key]?.matched ?? null };
        cacheChanged = true;
      }
      kept++;
      continue;
    }
    const before = cache[key];
    // Only a venue the cache can't answer costs a geocoder request (and the pause after it).
    const asks = !(Number.isFinite(before?.lat) && Number.isFinite(before?.lng)) && !before?.unresolved && Boolean(eventAddress(e.venue));
    const hit = await resolveEventVenue(e.venue, e.city, cache, { region: regionFor(e), get });
    if (hit) {
      e.lat = hit.lat; e.lng = hit.lng; e.located = hit.located;
      feedChanged = true; placed++;
      if (cache[key]?.lat !== hit.lat || cache[key]?.lng !== hit.lng) {
        cache[key] = { lat: hit.lat, lng: hit.lng, located: hit.located, matched: hit.matched ?? null };
        cacheChanged = true;
      }
      log(`  ${e.venue}: ${hit.lat}, ${hit.lng} (${hit.located}${hit.matched ? `, ${hit.matched}` : ''})`);
    } else {
      missed++;
      if (!before?.unresolved) {
        cache[key] = { unresolved: true, lastTried: now().toISOString() };
        cacheChanged = true;
      }
      log(`  ${e.venue}: ${eventAddress(e.venue) ? 'no match' : 'no address to geocode'}: add a hand-placed entry to ${CACHE}`);
    }
    if (asks) await pause(pauseMs);
  }

  if (feedChanged && !dry) writeFileSync(FEED, `${JSON.stringify(feed, null, 2)}\n`);
  if (cacheChanged && !dry) writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  log(`${placed} placed, ${kept} already had coordinates, ${missed} left without coordinates${dry ? ' (dry run)' : ''}.`);
  return { placed, kept, missed };
}
