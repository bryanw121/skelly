// The recording library itself (test/support/cassette.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { record, replay, requestKey, UnrecordedRequest } from './support/cassette.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cassette-'));

test('requestKey: method + URL, query sorted, volatile params dropped', () => {
  assert.equal(requestKey('get', 'https://a.test/x?b=2&a=1'), 'GET https://a.test/x?a=1&b=2');
  assert.equal(requestKey('GET', 'https://a.test/x?start=2026-11-24&id=7', ['start']), 'GET https://a.test/x?id=7');
});

test('record then replay: the same answers, any other request refused with its URL', async () => {
  const dir = tmp();
  const real = async (url) => ({ status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), text: async () => `<p>${url} Call 512-555-0199</p>` });
  const rec = record('demo', { fetch: real, dir, sanitize: (t) => t.replace(/\d{3}-\d{3}-\d{4}/g, '[phone]'), now: () => new Date('2026-11-24T00:00:00Z'), ignoreParams: ['start'] });
  const live = await rec('https://a.test/page?start=2026-11-24&id=1');
  assert.match(await live.text(), /512-555-0199/, 'the caller gets the real answer');
  assert.equal(rec.save(), 1);
  const c = JSON.parse(readFileSync(join(dir, 'demo', 'cassette.json'), 'utf8'));
  assert.equal(c.recordedAt, '2026-11-24T00:00:00.000Z');
  assert.equal(c.requests[0].contentType, 'text/html');
  const f = replay('demo', { dir });
  const r = await f('https://a.test/page?id=1&start=2027-01-01');
  assert.equal(r.ok, true);
  assert.equal(await r.text(), '<p>https://a.test/page?start=2026-11-24&id=1 Call [phone]</p>', 'saved cleaned, replayed whatever the date param');
  await assert.rejects(f('https://a.test/other'), (e) => e instanceof UnrecordedRequest && /a\.test\/other/.test(e.message));
  assert.deepEqual(f.calls.map((x) => x.url), ['https://a.test/page?id=1&start=2027-01-01', 'https://a.test/other']);
});

test('replay: several cassettes together, POST told apart from GET, JSON bodies', async () => {
  const dir = tmp();
  for (const [name, req] of [['one', { method: 'GET', url: 'https://a.test/', status: 200, contentType: 'application/json', body: 'a.json' }], ['two', { method: 'POST', url: 'https://b.test/q', status: 503, contentType: 'text/plain', body: 'b.txt' }]]) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, req.body), req.contentType.includes('json') ? '{"n":1}' : 'busy');
    writeFileSync(join(dir, name, 'cassette.json'), JSON.stringify({ recordedAt: '2026-11-01T00:00:00Z', requests: [req] }));
  }
  const f = replay(['one', 'two'], { dir });
  assert.deepEqual(await (await f('https://a.test/')).json(), { n: 1 });
  const busy = await f('https://b.test/q', { method: 'POST' });
  assert.deepEqual([busy.ok, busy.status, await busy.text()], [false, 503, 'busy']);
  await assert.rejects(f('https://b.test/q'), UnrecordedRequest, 'a GET is not the recorded POST');
});

test('record and replay: POSTs to one URL with different bodies are different requests', async () => {
  const dir = tmp();
  const real = async (url, init) => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ q: init.body }) });
  const rec = record('posts', { fetch: real, dir });
  await rec('https://o.test/api', { method: 'POST', body: 'austin' });
  await rec('https://o.test/api', { method: 'POST', body: 'dallas' });
  rec.save();
  const f = replay('posts', { dir });
  assert.deepEqual(await (await f('https://o.test/api', { method: 'POST', body: 'dallas' })).json(), { q: 'dallas' });
  assert.deepEqual(await (await f('https://o.test/api', { method: 'POST', body: 'austin' })).json(), { q: 'austin' });
  await assert.rejects(f('https://o.test/api', { method: 'POST', body: 'houston' }), UnrecordedRequest);
});
