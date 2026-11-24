// A whole day of Skelly, offline (docs/testing.md, tier 1): the three jobs run on the canary's
// recordings of every source, with the clock at the recording, into a temporary data folder:
// the schedule scrape (every recorded source and the manual-page watcher), the leagues and
// tournaments feed, and the events feed (listings and markets). Each must succeed for every
// source that has a recording, publish what the source gave, and write the files the site reads.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canaryUnits } from '../lib/canary-units.js';
import { cassetteName } from '../lib/canary.js';
import { CASSETTES, loadCassette, replay } from './support/cassette.mjs';
import { activeSources, loadSources } from '../lib/registry.js';
import { runScrape, scrapePaths } from '../lib/pipeline.js';
import { buildFeed, runSources } from '../lib/programs/feed.js';
import { runEventsJob } from '../lib/events-job.js';
import { occurrenceProblems } from '../lib/feed-check.js';
import { get } from '../lib/http.js';
import { loadRegions } from '../lib/regions.js';
import { today } from '../lib/time.js';

const { units } = canaryUnits();
const recorded = units.filter((u) => existsSync(join(CASSETTES, cassetteName(u.id), 'cassette.json')));
const of = (kind) => recorded.filter((u) => u.kind === kind);
const names = (list) => list.map((u) => cassetteName(u.id));
const metaOf = (u) => loadCassette(cassetteName(u.id)).meta;
// Recordings are made on different days (the canary's weekly rotation), and a reader asks for
// dates relative to today. So each job is replayed once per Chicago day that has recordings, with
// the clock at that day's latest recording.
const clockOf = (list) => new Date(list.map(metaOf).map((m) => m.now).sort().at(-1));
function byDay(list) {
  const days = new Map();
  for (const u of list) { const d = today(new Date(metaOf(u).now)); days.set(d, [...(days.get(d) ?? []), u]); }
  return [...days.values()];
}
const tmp = () => mkdtempSync(join(tmpdir(), 'full-day-'));
const regions = loadRegions().map((r) => r.info);

const withClock = async (now, fn) => {
  mock.timers.enable({ apis: ['Date'], now });
  try { return await fn(); } finally { mock.timers.reset(); }
};

test('the schedule scrape publishes every recorded source', { skip: !of('schedule').length && 'no schedule recordings yet' }, async () => {
  for (const list of byDay(of('schedule'))) await scheduleDay(list);
});

async function scheduleDay(list) {
  const now = clockOf(list);
  const ids = new Set(list.map((u) => u.id.slice('schedule:'.length)));
  const { manuals } = loadSources();
  const sources = activeSources(loadSources().sources).filter((s) => ids.has(s.id));
  const dir = tmp();
  const paths = scrapePaths({
    out: join(dir, 'schedule.json'), feed: join(dir, 'occurrences.json'), watch: join(dir, 'watch.json'),
    failures: join(dir, 'scrape-failures.md'), health: join(dir, 'health.json'), changes: join(dir, 'changes.md'), changesJson: join(dir, 'changes.json'),
  });
  const fetch = replay([...names(list), ...names(of('watch'))]);
  const result = await withClock(now, () => runScrape({
    sources, manuals, fetch, paths, regions, force: true, now: () => now, log: () => {},
    launchBrowser: async () => { throw new Error('no browser in tests'); },
  }));
  assert.deepEqual(result.failed.map((f) => f.id ?? f), [], 'every recorded source succeeds');
  const out = JSON.parse(readFileSync(paths.out, 'utf8'));
  for (const u of list) {
    const id = u.id.slice('schedule:'.length);
    const r = out.sources.find((x) => x.id === id);
    assert.ok(r?.ok, `${id} published ok`);
    assert.ok(r.count <= metaOf(u).count, `${id}: published ${r.count}, the source gave ${metaOf(u).count}`);
  }
  const feed = JSON.parse(readFileSync(paths.feed, 'utf8'));
  assert.ok(feed.occurrences.length > 0);
  // What it wrote passes the check a real scrape must pass before it publishes (tier 2).
  assert.deepEqual(occurrenceProblems(feed, 'occurrences.json', new Set(regions.map((r) => r.id))), []);
  for (const r of regions) {
    const f = join(dir, 'regions', r.id, 'occurrences.json');
    assert.ok(existsSync(f), `${r.id} folder`);
    assert.deepEqual(occurrenceProblems(JSON.parse(readFileSync(f, 'utf8')), `regions/${r.id}`, new Set([r.id])), []);
  }
  assert.ok(existsSync(join(dir, 'index.json')));
  // The watcher read every page behind Austin's hand-checked sessions from the recording.
  if (of('watch').length) {
    const watch = JSON.parse(readFileSync(paths.watch, 'utf8'));
    assert.ok(Object.values(watch).some((w) => w.hash && !w.error), 'watched pages answered');
  }
}

test('the leagues and tournaments feed has every recorded reader', { skip: !of('programs').length && 'no programs recordings yet' }, async () => {
  for (const list of byDay(of('programs'))) await programsDay(list);
});

async function programsDay(list) {
  const now = clockOf(list);
  const config = JSON.parse(readFileSync(new URL('../config/programs.json', import.meta.url)));
  const ids = new Set(list.map((u) => u.id.slice('programs:'.length)));
  const fetch = replay(names(list));
  const feed = await withClock(now, async () => {
    const results = await runSources({ ...config, sources: config.sources.filter((s) => ids.has(s.id)) }, { get: (u, o = {}) => get(u, { ...o, fetch }), now: now.getTime(), regions });
    return buildFeed({ results, previous: null, now: now.getTime(), config });
  });
  for (const u of list) {
    const s = feed.sources.find((x) => x.id === u.id.slice('programs:'.length));
    assert.ok(s?.ok, `${u.id}: ${s?.error}`);
  }
  assert.ok(feed.programs.length > 0);
}

test('the events feed has every recorded listing source and the markets', { skip: !of('events').length && 'no events recordings yet' }, async () => {
  for (const day of byDay(of('events'))) await eventsDay(day);
});

// The markets recording asks no dates (one Overpass query per region), so it joins every day.
async function eventsDay(day) {
  const list = [...day, ...of('markets')];
  const now = clockOf(day);
  const config = JSON.parse(readFileSync(new URL('../config/events.json', import.meta.url)));
  const ids = new Set(day.map((u) => u.id.slice('events:'.length)));
  const dir = tmp();
  const { feed } = await withClock(now, () => runEventsJob({
    fetch: replay(names(list)), now: now.getTime(), dataDir: join(dir, 'data'), failuresDir: join(dir, 'failures'),
    config: { ...config, sources: config.sources.filter((s) => ids.has(s.id)) }, regions, env: {}, log: () => {},
  }));
  for (const s of feed.sources.filter((x) => x.id !== 'weekly-markets')) assert.ok(s.ok, `${s.id}: ${s.error}`);
  // Overpass often answers only some regions (its mirrors time out): the read finds what the recording had.
  const markets = of('markets')[0];
  if (markets) assert.equal(feed.sources.find((x) => x.id === 'weekly-markets').count, metaOf(markets).count);
  assert.ok(feed.events.length > 0);
}
