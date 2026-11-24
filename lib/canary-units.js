// Every reader Skelly has, as one "unit" each: what the canary records (scripts/canary.mjs) and
// what the replay tests run against those recordings (test/replay.test.mjs). One definition for
// both, so a recording is always replayed by exactly the code that made it.
//
//   schedule:<id>  a schedule source's adapter (config/regions/*/sources.json), one region's day
//   programs:<id>  a leagues/tournaments reader (config/programs.json)
//   events:<id>    an Events tab source (config/events.json), JSON-LD pages only (hours pages are
//                  a later, capped step of the events job)
//   markets        the OpenStreetMap markets read (Overpass), every region
//   watch:<region> the pages behind a region's hand-checked sessions (manual.json), read the way
//                  the scrape's watcher reads them
//   courts:<venue> a court calendar (Skedda or OpenCourt) for the Book a court view
//
// Each unit's run({ fetch, now }) takes the network as `fetch` and the clock as `now` (a Date)
// and returns the reader's result. Paused sources and ones that need a browser are listed in
// `skipped` with why (browser sources get recorded as HAR files in a later step).
import { readFileSync } from 'node:fs';
import { repoPath } from './paths.js';
import { activeSources, loadSources } from './registry.js';
import { loadRegions } from './regions.js';
import { get } from './http.js';
import { today } from './time.js';
import { runSources } from './programs/feed.js';
import { readEventSources } from './event-sources.js';
import { readMarkets } from './markets.js';
import { VENUES, loadCourtVenue } from './courts.js';
import { COURT_DAYS, WATCH_HEADERS } from './pipeline.js';

const readJson = (p) => JSON.parse(readFileSync(repoPath(p), 'utf8'));
const withFetch = (fetch) => (url, opts = {}) => get(url, { ...opts, fetch });

/** { units: [{ id, kind, run }], skipped: [{ id, why }] } for the repository's config. */
export function canaryUnits() {
  const units = [], skipped = [];
  const regions = loadRegions().map((r) => r.info);

  const { sources, manuals } = loadSources();
  const active = new Set(activeSources(sources).map((s) => s.id));
  for (const s of sources) {
    const id = `schedule:${s.id}`;
    if (!active.has(s.id)) { skipped.push({ id, why: 'paused' }); continue; }
    if (s.adapter.needsBrowser !== false) { skipped.push({ id, why: 'needs a browser' }); continue; }
    units.push({
      id, kind: 'schedule',
      // OpenCourt reads every event page of two weeks of courts (~300 requests at a busy club).
      ...(s.adapter.id === 'opencourt' ? { maxRequests: 600 } : {}),
      run: ({ fetch, now }) => s.adapter.scrape({ browser: null, ref: today(now, s.timezone), options: s.options, timezone: s.timezone, fetch }),
    });
  }

  const programs = readJson('config/programs.json');
  for (const src of programs.sources) {
    units.push({
      id: `programs:${src.id}`, kind: 'programs',
      run: async ({ fetch, now }) => {
        const [r] = await runSources({ ...programs, sources: [src] }, { get: withFetch(fetch), now: now.getTime(), regions });
        if (r.error) throw new Error(r.error);
        return r;
      },
    });
  }

  const events = readJson('config/events.json');
  for (const src of events.sources) {
    units.push({
      id: `events:${src.id}`, kind: 'events',
      run: async ({ fetch, now }) => {
        const [r] = await readEventSources({ ...events, sources: [src] }, { get: withFetch(fetch), today: today(now), regions });
        if (!r.ok) throw new Error(r.error);
        return r;
      },
    });
  }

  units.push({
    id: 'markets', kind: 'markets',
    run: async ({ fetch, now }) => {
      // No cache, so every region asks Overpass (the job keeps a day's cache; the canary wants the answers).
      const r = await readMarkets(regions, { today: today(now), now: now.getTime(), fetch, cache: {} });
      const answered = Object.keys(r.cache);
      if (!answered.length) throw new Error(r.error ?? 'no region answered');
      return { ...r, count: r.events.length, answered };
    },
  });

  for (const m of manuals) {
    const pages = [...new Set((readJson(m.file).sessions ?? []).map((x) => x.source).filter(Boolean))];
    if (!pages.length) continue;
    units.push({
      id: `watch:${m.region}`, kind: 'watch',
      run: async ({ fetch }) => {
        let ok = 0;
        for (const url of pages) {
          const res = await fetch(url, { headers: WATCH_HEADERS, signal: AbortSignal.timeout(20000) }).catch(() => null);
          if (res?.ok) { await res.text(); ok++; }
        }
        if (!ok) throw new Error(`none of ${pages.length} pages answered`);
        return { count: ok };
      },
    });
  }

  for (const v of VENUES) {
    units.push({
      id: `courts:${v.id}`, kind: 'courts',
      run: async ({ fetch, now }) => {
        const r = await loadCourtVenue(v, today(now), COURT_DAYS, { fetchImpl: fetch });
        return { ...r, count: r.facilities.flatMap((f) => f.courts).length };
      },
    });
  }

  return { units, skipped };
}
