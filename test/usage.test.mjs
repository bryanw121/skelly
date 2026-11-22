// Usage metrics: what /api/hit accepts (lib/usage.js), the insert, and the daily rollup and prune.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate, wrapPglite } from '../lib/db.js';
import { deviceType, insertUsage, isBot, pruneUsage, usageRows } from '../lib/usage.js';
import { createHandler } from '../api/hit.js';

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const HEAD = { 'user-agent': PHONE, 'x-vercel-ip-city': 'San%20Antonio', 'x-vercel-ip-country-region': 'TX', 'x-vercel-ip-country': 'US', 'x-forwarded-for': '203.0.113.9' };
const body = (e) => ({ d: 'devABCDEF123456', s: 'sesABCDEF123456', e });

test('usageRows: known events and props only, search words cut and lower-cased, city but never the IP', () => {
  const rows = usageRows(body([
    { n: 'open', p: { tab: 'events', region: 'austin', layout: 'list', secret: 'x' } },
    { n: 'search', p: { q: '  Night   MARKET in south austin near the creek today  ', results: 5, tab: 'events' } },
    { n: 'nonsense', p: { a: 1 } },
    { n: 'out', p: { link: 'book', source: 'app.arketa.co', tab: 'sports' } },
  ]), HEAD);
  assert.equal(rows.length, 3, 'unknown events dropped');
  assert.deepEqual(rows[0], { name: 'open', device: 'devABCDEF123456', session: 'sesABCDEF123456', city: 'San Antonio', area: 'TX', country: 'US', device_type: 'phone', props: { tab: 'events', region: 'austin', layout: 'list' } });
  assert.deepEqual(rows[1].props, { q: 'night market in south austin near the cr', tab: 'events', results: 5 });
  assert.ok(!JSON.stringify(rows).includes('203.0.113.9'), 'the IP address is never kept');
});

test('usageRows: bots, link previews and malformed bodies are dropped', () => {
  assert.equal(usageRows(body([{ n: 'open' }]), { 'user-agent': 'Googlebot/2.1' }), null);
  assert.equal(usageRows(body([{ n: 'open' }]), { 'user-agent': 'facebookexternalhit/1.1' }), null);
  assert.equal(usageRows(body([{ n: 'open' }]), {}), null, 'no user agent');
  assert.equal(usageRows({ d: 'x', s: 'sesABCDEF123456', e: [] }, HEAD), null, 'bad device id');
  assert.equal(usageRows({ d: 'devABCDEF123456', s: 'sesABCDEF123456', e: 'open' }, HEAD), null);
  assert.equal(usageRows(body(Array.from({ length: 100 }, () => ({ n: 'ping' }))), HEAD).length, 40, 'at most 40 a batch');
  assert.equal(isBot(PHONE), false);
  assert.equal(deviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'computer');
  assert.equal(deviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
});

test('insertUsage + pruneUsage on the real schema: rows land, finished days roll up, old rows go', async () => {
  const db = wrapPglite(new PGlite());
  await migrate(db, { grants: null, log: () => {} });
  await insertUsage(db, usageRows(body([{ n: 'open', p: { tab: 'events' } }, { n: 'ping', p: {} }]), HEAD));
  await insertUsage(db, usageRows({ ...body([{ n: 'open', p: { tab: 'sports', sport: 'volleyball' } }]), d: 'devOTHER1234567' }, HEAD));
  await db.query(`update usage_events set at = now() - interval '2 days'`);
  await insertUsage(db, usageRows(body([{ n: 'open', p: {} }]), HEAD));
  await db.query(`insert into usage_events (name, device, at) values ('open', 'devOLD12345678', now() - interval '200 days')`);
  await pruneUsage(db);
  const daily = await db.query(`select name, events, people from usage_daily order by name`);
  assert.deepEqual(daily.map((r) => [r.name, Number(r.events), Number(r.people)]), [['open', 2, 2], ['ping', 1, 1]]);
  assert.equal(Number((await db.query('select count(*) as n from usage_events'))[0].n), 4, '200-day-old row deleted, the rest kept');
  await pruneUsage(db); // runs every scrape: the rollup just refreshes
  assert.equal((await db.query('select * from usage_daily')).length, 2);
});

test('api/hit: 204 always; stores a good batch, ignores a bot and a GET', async () => {
  const db = wrapPglite(new PGlite());
  await migrate(db, { grants: null, log: () => {} });
  const handler = createHandler({ db, log: () => {} });
  const call = async (method, b, headers = HEAD) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() { this.done = true; } };
    await handler({ method, headers, body: b }, res);
    return res.statusCode;
  };
  assert.equal(await call('POST', body([{ n: 'open', p: { tab: 'events' } }])), 204);
  assert.equal(await call('POST', body([{ n: 'open' }]), { 'user-agent': 'curl/8.0' }), 204);
  assert.equal(await call('GET'), 405);
  assert.equal(await call('POST', 'not json{'), 204);
  assert.equal(Number((await db.query('select count(*) as n from usage_events'))[0].n), 1);
  assert.equal(await createHandler({ db: null })({ method: 'POST', headers: HEAD, body: body([{ n: 'open' }]) }, { setHeader() {}, end() {} }), undefined, 'no database: a quiet 204');
});
