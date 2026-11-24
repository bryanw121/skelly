import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFeeds, occurrenceProblems } from '../lib/feed-check.js';

const occ = (over = {}) => ({ id: 'a-2026-11-24', session_id: 'a', source_id: 's', sport: 'volleyball', region: 'austin', title: 'Open play', starts_at: '2026-11-24T18:00:00Z', ends_at: '2026-11-24T20:00:00Z', signup_url: 'https://x.test', ...over });
function feeds({ occurrences = [occ()], programs = [{ id: 'p', kind: 'league', sport: 'volleyball', org: 'O', title: 'T', source_id: 's', url: 'https://o.test' }], events = [{ id: 'e', title: 'Market', kind: 'market', startDate: '2026-11-29', sourceUrl: 'https://e.test' }], skip = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
  const put = (f, v) => { if (skip.includes(f)) return; mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), typeof v === 'string' ? v : JSON.stringify(v)); };
  put('index.json', { regions: [{ id: 'austin' }] });
  put('occurrences.json', { feedVersion: 1, occurrences });
  put('regions/austin/occurrences.json', { feedVersion: 1, occurrences });
  put('regions/austin/schedule.json', { sessions: [] });
  put('programs.json', { feedVersion: 1, programs });
  put('events.json', { feedVersion: 1, events });
  return dir;
}

test('feed check: good feeds pass', () => {
  assert.deepEqual(checkFeeds(feeds()), []);
  assert.deepEqual(checkFeeds(feeds({ occurrences: [], programs: [], events: [] })), [], 'a quiet day is fine');
});

test('feed check: broken occurrences are named', () => {
  const bad = [occ({ id: 'x', title: '' }), occ({ id: 'x' }), occ({ id: 'y', region: 'mars' }), occ({ id: 'z', starts_at: 'soon' }), occ({ id: 'w', ends_at: '2026-11-24T17:00:00Z' }), occ({ id: 'v', signup_url: 'javascript:alert(1)' })];
  const e = occurrenceProblems({ feedVersion: 1, occurrences: bad }, 'occurrences.json', new Set(['austin']));
  assert.deepEqual(e, [
    'occurrences.json #0 (x): no title', 'occurrences.json #1 (x): id appears twice', 'occurrences.json #2 (y): unknown region mars',
    'occurrences.json #3 (z): starts_at soon', 'occurrences.json #4 (w): ends_at 2026-11-24T17:00:00Z before it starts', "occurrences.json #5 (v): signup_url isn't https",
  ]);
  assert.match(occurrenceProblems({ feedVersion: 2, occurrences: [] }, 'f', null)[0], /feedVersion 2, readers expect 1/);
  assert.match(occurrenceProblems({ feedVersion: 1 }, 'f', null)[0], /no occurrences list/);
});

test('feed check: missing or unreadable files, bad programs and events, long lists capped', () => {
  const e = checkFeeds(feeds({ skip: ['regions/austin/schedule.json'], programs: [{ id: 'p' }], events: [{ id: 'e', title: 'M', startDate: 'Dec 1', endDate: '2026-01-01', sourceUrl: 'http://x' }] }));
  assert.ok(e.includes('regions/austin/schedule.json: missing'));
  assert.ok(e.some((x) => /programs.json #0 \(p\): no kind/.test(x)));
  assert.ok(e.includes('events.json #0 (e): startDate Dec 1'));
  assert.ok(e.includes("events.json #0 (e): sourceUrl isn't https"));
  const dir = feeds();
  writeFileSync(join(dir, 'events.json'), '{not json');
  assert.match(checkFeeds(dir).join('\n'), /events.json: not JSON/);
  const many = checkFeeds(feeds({ occurrences: Array.from({ length: 30 }, (_, i) => occ({ id: `o${i}`, title: '' })) }));
  assert.ok(many.includes('… and 20 more'));
  const noRegions = feeds();
  writeFileSync(join(noRegions, 'index.json'), JSON.stringify({ regions: [] }));
  assert.ok(checkFeeds(noRegions).includes('index.json: no regions'));
  assert.deepEqual(checkFeeds(feeds({ programs: null, events: null }).replace(/$/, '')).filter((x) => /list/.test(x)), ['programs.json: no programs list', 'events.json: no events list']);
});
