// The programs and geocode-events jobs' other paths (the full-day test covers a full run on recordings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runProgramsJob } from '../lib/programs-job.js';
import { runGeocodeEvents } from '../lib/geocode-events-job.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'jobs-'));
const quiet = () => {};

test('programs job: not due skips, a failed source is reported, a dry run writes nothing', async () => {
  const dir = tmp(), dataDir = join(dir, 'data'), failuresDir = join(dir, 'f');
  mkdirSync(dataDir, { recursive: true });
  const now = Date.parse('2026-11-24T12:00:00Z');
  writeFileSync(join(dataDir, 'programs.json'), JSON.stringify({ feedVersion: 1, generatedAt: new Date(now - 3600e3).toISOString(), sources: [], programs: [] }));
  assert.equal((await runProgramsJob({ now, dataDir, failuresDir, ifDue: true, log: quiet, get: async () => { throw new Error('no reads'); } })).skipped, 'not due');
  const config = { sources: [{ id: 'nope', reader: 'missing' }] };
  const lines = [];
  const r = await runProgramsJob({ now, dataDir, failuresDir, config, regions: [], log: (l) => lines.push(l) });
  assert.match(readFileSync(join(failuresDir, 'programs.md'), 'utf8'), /\*\*nope\*\*: no reader "missing"/);
  assert.ok(lines.some((l) => /FAIL nope/.test(l)));
  const dry = await runProgramsJob({ now, dataDir: join(dir, 'dry'), failuresDir, config, regions: [], dry: true, log: quiet });
  assert.equal(dry.skipped, 'dry run');
  assert.ok(!existsSync(join(dir, 'dry', 'programs.json')));
  assert.equal(r.skipped, null);
});

test('geocode events: cache first, then the geocoder; misses remembered; placed ones taught to the cache', async () => {
  const dataDir = tmp();
  const events = [
    { id: 'a', venue: 'Placed Park', lat: 30.3, lng: -97.7 },
    { id: 'b', venue: 'Cached Hall', city: 'Austin' },
    { id: 'c', venue: 'Zilker Park, 2100 Barton Springs Rd', city: 'Austin' },
    { id: 'd', venue: 'Nowhere Lounge', city: 'Austin' },
  ];
  writeFileSync(join(dataDir, 'events.json'), JSON.stringify({ events }));
  writeFileSync(join(dataDir, 'event-venues.json'), JSON.stringify({ 'cached hall': { lat: 30.27, lng: -97.74, located: 'manual' } }));
  const asked = [];
  const get = async (url) => { asked.push(url); return { ok: true, status: 200, text: JSON.stringify({ result: { addressMatches: [{ matchedAddress: '2100 BARTON SPRINGS RD, AUSTIN, TX', coordinates: { x: -97.77, y: 30.26 } }] } }) }; };
  const regions = [{ id: 'austin', center: [30.27, -97.74], radiusKm: 60 }];
  const r = await runGeocodeEvents({ dataDir, regions, get, pauseMs: 0, log: quiet, now: () => new Date('2026-11-24T00:00:00Z') });
  assert.deepEqual(r, { placed: 2, kept: 1, missed: 1 });
  assert.equal(asked.length, 1, 'one geocoder request: only the street address the cache lacked');
  const feed = JSON.parse(readFileSync(join(dataDir, 'events.json'), 'utf8'));
  assert.deepEqual([feed.events[1].lat, feed.events[2].lat], [30.27, 30.26]);
  const cache = JSON.parse(readFileSync(join(dataDir, 'event-venues.json'), 'utf8'));
  assert.equal(cache['placed park'].lat, 30.3);
  assert.deepEqual(cache['nowhere lounge'], { unresolved: true, lastTried: '2026-11-24T00:00:00.000Z' });
  // Again: nothing to ask, nothing new.
  const again = await runGeocodeEvents({ dataDir, regions, get, pauseMs: 0, log: quiet, dry: true });
  assert.deepEqual(again, { placed: 0, kept: 3, missed: 1 });
  assert.equal(asked.length, 1);
});

test('check-feeds and canary --list run as scripts', () => {
  const run = (args) => spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const list = run(['scripts/canary.mjs', '--list']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /schedule:reclub/);
  assert.match(list.stdout, /- {2}schedule:atxbeach \(needs a browser\)/);
  const dir = tmp();
  const bad = run(['scripts/check-feeds.mjs', dir]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /index.json: missing/);
});

test('scrape --plan, coverage --print and db-migrate without a database run as scripts, offline', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, DATABASE_URL: '', GITHUB_OUTPUT: '', ...env } });
  const plan = run(['scripts/scrape.mjs', '--plan']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /^due: /m);
  const out = join(tmp(), 'out');
  writeFileSync(out, '');
  assert.equal(run(['scripts/scrape.mjs', '--plan', '--all'], { GITHUB_OUTPUT: out }).status, 0);
  assert.match(readFileSync(out, 'utf8'), /^due=\d+\nbrowser=true\n$/);
  const cov = run(['scripts/coverage.mjs', '--print']);
  assert.equal(cov.status, 0, cov.stderr);
  const db = run(['scripts/db-migrate.mjs']);
  assert.equal(db.status, 0);
  assert.match(db.stdout, /DATABASE_URL is not set/);
});
