// Weekly markets from OpenStreetMap (lib/markets.js): opening hours, the next market day, filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketEvents, readMarkets, weeklyHours, weeklyLine } from '../lib/markets.js';

const AUSTIN = { id: 'austin', name: 'Austin, TX', city: 'Austin', center: [30.27, -97.74], radiusKm: 60 };
const el = (id, tags, lat = 30.2998, lon = -97.7076) => ({ type: 'node', id, lat, lon, tags: { amenity: 'marketplace', ...tags } });

test('weeklyHours: simple weekly hours only; daily or complicated hours are not market days', () => {
  assert.deepEqual(weeklyHours('Su 10:00-14:00'), { Su: { start: '10:00', end: '14:00' } });
  assert.deepEqual(weeklyHours('Sa 09:00-13:00; PH off'), { Sa: { start: '09:00', end: '13:00' } });
  assert.deepEqual(weeklyHours('Sa,Su 08:00-12:00'), { Sa: { start: '08:00', end: '12:00' }, Su: { start: '08:00', end: '12:00' } });
  assert.deepEqual(Object.keys(weeklyHours('Fr-Su 17:00-22:00')), ['Fr', 'Sa', 'Su']);
  assert.equal(weeklyHours('Mo-Su 07:00-22:00'), null, 'open every day: a shop');
  assert.equal(weeklyHours('Mar-Nov Sa 08:00-12:00'), null, 'seasonal months: not read');
  assert.equal(weeklyHours('Sa sunrise-sunset'), null);
  assert.equal(weeklyHours(''), null);
});

test('weeklyLine: one line for the card', () => {
  assert.equal(weeklyLine(weeklyHours('Su 10:00-14:00')), 'Every Sunday, 10am–2pm.');
  assert.equal(weeklyLine(weeklyHours('Sa,Su 08:00-12:00')), 'Every Saturday and Sunday, 8am–noon.');
  assert.equal(weeklyLine(weeklyHours('Sa 09:00-13:00; Su 10:00-14:00')), 'Every Saturday and Sunday.');
});

test('marketEvents: the next market day within a week, with times, pin and the market\'s site', () => {
  const [mueller] = marketEvents([el(1, { name: "Texas Farmers' Market at Mueller", opening_hours: 'Su 10:00-14:00', 'addr:housenumber': '2006', 'addr:street': 'Philomena Street', website: 'https://texasfarmersmarket.org/mueller' })], { region: AUSTIN, today: '2026-11-22' });
  assert.equal(mueller.startDate, '2026-11-22', 'today is a Sunday: today');
  assert.deepEqual([mueller.startTime, mueller.endTime, mueller.venue, mueller.city, mueller.region], ['10:00', '14:00', "Texas Farmers' Market at Mueller, 2006 Philomena Street", 'Austin', 'austin']);
  assert.equal(mueller.sourceUrl, 'https://texasfarmersmarket.org/mueller');
  assert.equal(mueller.description, 'Every Sunday, 10am–2pm.');
  assert.equal(mueller.source, 'Weekly markets');
  const [sfc] = marketEvents([el(2, { name: 'Sustainable Food Center Farmers\' Market', opening_hours: 'Sa 09:00-13:00' })], { region: AUSTIN, today: '2026-11-22' });
  assert.equal(sfc.startDate, '2026-11-28', 'next Saturday');
  assert.equal(sfc.sourceUrl, 'https://www.openstreetmap.org/node/2', 'no website: the map entry');
  // Same market, next week: a different event id, so last week's drops off.
  const [next] = marketEvents([el(1, { name: "Texas Farmers' Market at Mueller", opening_hours: 'Su 10:00-14:00' })], { region: AUSTIN, today: '2026-11-23' });
  assert.equal(next.startDate, '2026-11-29');
  assert.notEqual(next.id, mueller.id);
});

test('marketEvents: skips stores, unnamed places, daily markets and anything outside the region', () => {
  const out = marketEvents([
    el(3, { name: 'Sprouts Farmers Market', opening_hours: 'Su 10:00-14:00' }),
    el(4, { name: 'Drip n Rip Vapes', opening_hours: 'Sa 10:00-14:00' }),
    el(5, { opening_hours: 'Sa 10:00-14:00' }),
    el(6, { name: 'Desi Farmers Market', shop: 'greengrocer', opening_hours: 'Sa 10:00-14:00' }),
    el(7, { name: 'Daily Market', opening_hours: 'Mo-Su 08:00-20:00' }),
    el(8, { name: 'Far Away Farmers Market', opening_hours: 'Sa 08:00-12:00' }, 32.78, -96.8),
    { type: 'way', id: 9, center: { lat: 30.26, lon: -97.75 }, tags: { amenity: 'marketplace', name: 'Way Flea Market', opening_hours: 'Sa 08:00-12:00' } },
  ], { region: AUSTIN, today: '2026-11-22' });
  assert.deepEqual(out.map((e) => e.title), ['Way Flea Market'], 'a way uses its centre');
});

test('readMarkets: one query per region; the next mirror when one fails; a failure keeps the last events', async () => {
  const calls = [];
  const body = JSON.stringify({ elements: [el(1, { name: 'Mueller Farmers Market', opening_hours: 'Su 10:00-14:00' })] });
  const get = async (url) => { calls.push(url.split('?')[0]); return calls.length === 1 ? { ok: false, status: 504 } : { ok: true, text: body }; };
  const r = await readMarkets([AUSTIN], { get, today: '2026-11-22', endpoints: ['https://a/api', 'https://b/api'] });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['https://a/api', 'https://b/api']);
  assert.equal(r.events.length, 1);
  const down = await readMarkets([AUSTIN], { get: async () => ({ ok: false, status: 429 }), today: '2026-11-22', endpoints: ['https://a/api'] });
  assert.deepEqual([down.ok, down.events.length], [false, 0]);
});
