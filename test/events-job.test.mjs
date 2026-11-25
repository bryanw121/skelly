import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEventsJob } from '../lib/events-job.js';

const NOW = Date.parse('2026-11-24T16:00:00Z');
const REGIONS = [{ id: 'austin', name: 'Austin, TX', timezone: 'America/Chicago', center: [30.27, -97.74], radiusKm: 60 }];
const CONFIG = { sources: [{ id: 'listing', name: 'Listing', region: 'austin', urls: ['https://list.test/markets', 'https://list.test/broken'] }] };
const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', ...o })}</script>`;
const LISTING = ld({ name: 'Holiday Market', startDate: '2026-12-05', url: 'https://list.test/e/holiday-market', location: { name: 'The Park', address: { streetAddress: '1 Main St', addressLocality: 'Austin' }, geo: { latitude: 30.27, longitude: -97.74 } } });
const EVENT_PAGE = ld({ name: 'Holiday Market', startDate: '2026-12-05T10:00:00-06:00', endDate: '2026-12-05T16:00:00-06:00' });
const OVERPASS = { elements: [{ type: 'node', id: 1, lat: 30.3, lon: -97.7, tags: { amenity: 'marketplace', name: 'Sunday Market', opening_hours: 'Su 10:00-14:00' } }] };

function fakes() {
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (url === 'https://list.test/markets') return { ok: true, status: 200, text: LISTING };
    if (url === 'https://list.test/robots.txt') return { ok: false, status: 404, text: '' };
    if (url === 'https://list.test/e/holiday-market') return { ok: true, status: 200, text: EVENT_PAGE };
    return { ok: false, status: 503, text: '' };
  };
  const fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(OVERPASS) });
  return { asked, get, fetch };
}
const dirs = () => { const d = mkdtempSync(join(tmpdir(), 'events-job-')); return { dataDir: join(d, 'data'), failuresDir: join(d, 'failures') }; };
const quiet = { log: () => {}, regions: REGIONS, config: CONFIG, env: {} };

test('events job: reads the listings, the markets and the hours, and writes the feed and its files', async () => {
  const { dataDir, failuresDir } = dirs();
  const { get, fetch, asked } = fakes();
  const { feed } = await runEventsJob({ ...quiet, get, fetch, now: NOW, dataDir, failuresDir });
  const market = feed.events.find((e) => e.title === 'Holiday Market');
  assert.equal(market.startTime, '10:00', 'hours from the event page');
  assert.ok(feed.events.some((e) => e.sourceId === 'weekly-markets'), 'a weekly market');
  assert.deepEqual(feed.sources.map((s) => [s.id, s.ok]), [['listing', true], ['weekly-markets', true]]);
  assert.ok(asked.includes('https://list.test/robots.txt'));
  const written = JSON.parse(readFileSync(join(dataDir, 'events.json'), 'utf8'));
  assert.equal(written.listingsAt, new Date(NOW).toISOString());
  for (const f of ['event-listings.json', 'event-hours.json', 'markets-osm.json', 'event-accounts.json']) assert.ok(existsSync(join(dataDir, f)), f);
  assert.equal(readFileSync(join(failuresDir, 'events-sources.md'), 'utf8'), '');

  // Within 5 hours, --if-due reads nothing.
  const again = fakes();
  const r = await runEventsJob({ ...quiet, ...again, now: NOW + 3600e3, dataDir, failuresDir, ifDue: true });
  assert.equal(r.skipped, 'not due');
  assert.deepEqual(again.asked, []);

  // Another writer dropped the listing events: --if-due puts them back without reading.
  writeFileSync(join(dataDir, 'events.json'), JSON.stringify({ ...written, events: [] }));
  const back = await runEventsJob({ ...quiet, ...fakes(), now: NOW + 3600e3, dataDir, failuresDir, ifDue: true });
  assert.equal(back.putBack, 2);
  assert.equal(JSON.parse(readFileSync(join(dataDir, 'events.json'), 'utf8')).events.length, 2);
});

test('events job: a source whose every page fails is reported, and a dry run writes nothing', async () => {
  const { dataDir, failuresDir } = dirs();
  const config = { sources: [{ id: 'down', name: 'Down', urls: ['https://list.test/broken'] }] };
  await runEventsJob({ ...quiet, ...fakes(), config, now: NOW, dataDir, failuresDir });
  assert.match(readFileSync(join(failuresDir, 'events-sources.md'), 'utf8'), /\*\*down\*\*: https:\/\/list.test\/broken: 503/);

  const dry = dirs();
  const lines = [];
  const r = await runEventsJob({ ...quiet, ...fakes(), now: NOW, ...dry, dry: true, log: (l) => lines.push(l) });
  assert.equal(r.skipped, 'dry run');
  assert.ok(!existsSync(join(dry.dataDir, 'events.json')));
  assert.ok(lines.some((l) => l.includes('Holiday Market')));
});

test('events job: with the Instagram secrets it reads the accounts too', async () => {
  const { dataDir, failuresDir } = dirs();
  const { get, fetch } = fakes();
  const igGet = async (url, o) => (url.includes('graph.facebook.com') ? { ok: true, status: 200, text: JSON.stringify({ business_discovery: { media: { data: [] } } }) } : get(url, o));
  const { feed } = await runEventsJob({ ...quiet, get: igGet, fetch, now: NOW, dataDir, failuresDir, env: { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' }, igConfig: () => ({ accounts: [{ handle: 'someorg' }] }) });
  assert.ok(feed.sources.some((s) => s.id === 'instagram'));
});

test('events job: given only fetch, it reads everything through it (the replay path), the configured Instagram accounts too', async () => {
  const { dataDir, failuresDir } = dirs();
  const { get } = fakes();
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('overpass')) return { ok: true, status: 200, text: async () => JSON.stringify(OVERPASS) };
    if (String(url).includes('graph.facebook.com')) return { ok: true, status: 200, text: async () => JSON.stringify({ business_discovery: { media: { data: [] } } }) };
    const r = await get(String(url));
    return { ok: r.ok, status: r.status, text: async () => r.text };
  };
  const { feed } = await runEventsJob({ ...quiet, fetch, now: NOW, dataDir, failuresDir, env: { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' } });
  assert.ok(feed.events.some((e) => e.title === 'Holiday Market'));
  assert.ok(urls.includes('https://list.test/markets'));
  assert.ok(urls.some((u) => u.includes('graph.facebook.com')), 'the accounts in config/instagram.json');
});

test('events job: the token is the only secret; the account id comes from config/instagram.json', async () => {
  const { dataDir, failuresDir } = dirs();
  const { get, fetch } = fakes();
  const asked = [];
  const igGet = async (url, o) => { if (url.includes('graph.facebook.com')) { asked.push(url); return { ok: true, status: 200, text: JSON.stringify({ business_discovery: { media: { data: [] } } }) }; } return get(url, o); };
  await runEventsJob({ ...quiet, get: igGet, fetch, now: NOW, dataDir, failuresDir, env: { IG_ACCESS_TOKEN: 't' }, igConfig: () => ({ igUserId: '17841416933094467', accounts: [{ handle: 'someorg' }] }) });
  assert.ok(asked.some((u) => u.startsWith('https://graph.facebook.com/v26.0/17841416933094467?')), asked.join('\n'));
});

test('events job: at most AVATARS_PER_RUN profile pictures are looked up per run', async () => {
  const { AVATARS_PER_RUN } = await import('../lib/events-job.js');
  const { dataDir, failuresDir } = dirs();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dataDir, { recursive: true });
  const handles = Array.from({ length: AVATARS_PER_RUN + 10 }, (_, i) => `org${i}`);
  writeFileSync(join(dataDir, 'events.json'), JSON.stringify({ events: handles.map((h, i) => ({ id: `e${i}`, title: `Event ${i}`, startDate: '2026-12-01', source: `Instagram @${h}` })) }));
  const { get, fetch } = fakes();
  const asked = new Set();
  const igGet = async (url, o) => { if (url.includes('graph.facebook.com')) { const m = decodeURIComponent(url).match(/username\(([^)]+)\)/); asked.add(m[1]); return { ok: true, status: 200, text: JSON.stringify({ business_discovery: {} }) }; } return get(url, o); };
  await runEventsJob({ ...quiet, get: igGet, fetch, now: NOW, dataDir, failuresDir, env: { IG_ACCESS_TOKEN: 't' }, igConfig: () => ({ igUserId: '1', accounts: [] }) });
  assert.equal(asked.size, AVATARS_PER_RUN);
});
