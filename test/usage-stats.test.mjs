// The owner's Usage page: the key check, the totals (lib/usage-stats.js) and /api/usage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate, wrapPglite } from '../lib/db.js';
import { insertUsage, usageRows } from '../lib/usage.js';
import { keyMatches, spanOf, usageStats } from '../lib/usage-stats.js';
import { createHandler } from '../api/usage.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const HEAD = { 'user-agent': UA, 'x-vercel-ip-city': 'Houston', 'x-vercel-ip-country-region': 'TX', 'x-vercel-ip-country': 'US' };
const KEY = 'correct-horse-battery';

async function seeded() {
  const db = wrapPglite(new PGlite());
  await migrate(db, { grants: null, log: () => {} });
  await insertUsage(db, usageRows({ d: 'devAAAAAAAAAAAA', s: 'sesAAAAAAAAAAAA', e: [
    { n: 'open', p: { tab: 'events', region: 'houston' } },
    { n: 'view', p: { tab: 'sports', sport: 'ice-skating', region: 'houston' } },
    { n: 'search', p: { q: 'Roller Skating', results: 0, tab: 'events' } },
    { n: 'search', p: { q: 'matcha', results: 4, tab: 'events' } },
    { n: 'out', p: { link: 'instagram', source: 'x', tab: 'events' } },
  ] }, HEAD));
  await insertUsage(db, usageRows({ d: 'devBBBBBBBBBBBB', s: 'sesBBBBBBBBBBBB', e: [{ n: 'open', p: { tab: 'events' } }, { n: 'search', p: { q: 'roller skating', results: 0 } }] }, HEAD));
  await db.query(`insert into usage_events (name, device, session, props, at) values ('open', 'devOLD000000000', 'sesOLD000000000', '{"tab":"events"}', now() - interval '20 days')`);
  return db;
}

test('keyMatches: exact key only; no key set, or a short one, never matches', () => {
  assert.equal(keyMatches(KEY, KEY), true);
  assert.equal(keyMatches('correct-horse-batter', KEY), false);
  assert.equal(keyMatches('', KEY), false);
  assert.equal(keyMatches(undefined, KEY), false);
  assert.equal(keyMatches('short', 'short'), false, 'a key under 12 characters is refused');
  assert.equal(spanOf('30'), 30); assert.equal(spanOf(99), 7);
});

test('usageStats: totals for the span, by tab or sport, city, search and link, nothing per visit', async () => {
  const db = await seeded();
  const s = await usageStats(db, 7);
  assert.equal(s.summary.visitors, 2);
  assert.equal(s.summary.visits, 2);
  assert.equal(s.summary.searches, 3);
  assert.equal(s.summary.online_now, 2);
  assert.equal(s.daily.length, 7);
  assert.deepEqual(s.uses.map((r) => [r.what, r.visitors]), [['Events', 2], ['Ice Skating', 1]]);
  assert.deepEqual(s.cities, [{ place: 'Houston, TX', visitors: 2 }]);
  assert.deepEqual(s.searches.map((r) => [r.q, r.searches, r.results]), [['roller skating', 2, 0], ['matcha', 1, 4]]);
  assert.deepEqual(s.outs, [{ link: 'Instagram', taps: 1 }]);
  assert.deepEqual(s.devices, [{ device_type: 'Phone', visitors: 2 }]);
  assert.ok(!JSON.stringify(s).includes('devAAAA'), 'no device ids leave the server');
  assert.equal((await usageStats(db, 30)).summary.visitors, 3, '30 days reaches the older visit');
});

test('api/usage: 404 without STATS_KEY, 401 for a wrong key, 429 after ten, the totals for the right one', async () => {
  const db = await seeded();
  const call = async (handler, body, method = 'POST') => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
    await handler({ method, headers: { 'x-forwarded-for': '203.0.113.5' }, body }, res);
    return res;
  };
  assert.equal((await call(createHandler({ db, key: undefined }), { key: KEY })).statusCode, 404);
  const h = createHandler({ db, key: KEY, wait: async () => {}, log: () => {} });
  assert.equal((await call(h, { key: KEY }, 'GET')).statusCode, 405);
  const ok = await call(h, { key: KEY, days: 1 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.days, 1);
  assert.equal(ok.body.summary.visitors, 2);
  assert.equal(ok.headers['cache-control'], 'no-store');
  for (let i = 0; i < 10; i++) assert.equal((await call(h, { key: 'wrong-key-attempt' })).statusCode, 401);
  assert.equal((await call(h, { key: KEY })).statusCode, 429, 'locked out for a while, even with the right key');
});
