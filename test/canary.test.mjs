import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceeded, RobotsDisallowed, runCanary, shrinkHtml, cassetteName, pickUnits, politeFetch, report, resultCount, rotation, sanitizeFor } from '../lib/canary.js';
import { canaryUnits } from '../lib/canary-units.js';
import { loadSources } from '../lib/registry.js';
import { readFileSync } from 'node:fs';

const answer = (text, status = 200) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'text/plain' }), text: async () => text });

test('rotation deals the units out over the week, about evenly', () => {
  const units = Array.from({ length: 23 }, (_, i) => ({ id: `u${String(i).padStart(2, '0')}` }));
  const days = rotation(units);
  const per = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days.values()) per[d]++;
  assert.ok(Math.max(...per) - Math.min(...per) <= 1, per.join(','));
  assert.equal(pickUnits(units, { day: 0 }).length, per[0]);
  assert.equal(pickUnits(units, { all: true }).length, 23);
});

test('pickUnits: --only takes ids and "kind:" prefixes', () => {
  const units = [{ id: 'schedule:a' }, { id: 'schedule:b' }, { id: 'programs:a' }, { id: 'markets' }];
  assert.deepEqual(pickUnits(units, { only: ['schedule:', 'markets'] }).map((u) => u.id), ['schedule:a', 'schedule:b', 'markets']);
  assert.deepEqual(pickUnits(units, { only: ['programs:a'] }).map((u) => u.id), ['programs:a']);
  assert.equal(cassetteName('schedule:a'), 'schedule/a');
});

test('politeFetch reads robots.txt once per site and refuses what it disallows', async () => {
  const asked = [];
  const real = async (url) => { asked.push(String(url)); return String(url).endsWith('/robots.txt') ? answer('User-agent: *\nDisallow: /private\n') : answer('ok'); };
  const log = [];
  const f = politeFetch(real, { gapMs: 0, log });
  assert.equal(await (await f('https://a.test/page')).text(), 'ok');
  await f('https://a.test/other?x=1');
  await assert.rejects(f('https://a.test/private/x'), RobotsDisallowed);
  assert.deepEqual(asked, ['https://a.test/robots.txt', 'https://a.test/page', 'https://a.test/other?x=1']);
  assert.deepEqual(log, [{ refused: 'https://a.test/private/x', why: 'robots.txt' }]);
  assert.equal(f.used(), 3);
});

test('politeFetch: no robots.txt (404 or an error) allows everything', async () => {
  const f = politeFetch(async (url) => (String(url).endsWith('robots.txt') ? answer('nope', 404) : answer('ok')), { gapMs: 0 });
  assert.equal((await f('https://b.test/x')).status, 200);
  const g = politeFetch(async (url) => { if (String(url).endsWith('robots.txt')) throw new Error('down'); return answer('ok'); }, { gapMs: 0 });
  assert.equal((await g('https://b.test/x')).status, 200);
});

test('politeFetch stops at the unit budget and at the shared run budget', async () => {
  const real = async () => answer('');
  const unit = politeFetch(real, { gapMs: 0, unitMax: 3 });
  await unit('https://c.test/1'); await unit('https://c.test/2'); // + robots.txt = 3
  await assert.rejects(unit('https://c.test/3'), BudgetExceeded);
  const budget = { max: 4, used: 0 };
  const a = politeFetch(real, { gapMs: 0, budget }), b = politeFetch(real, { gapMs: 0, budget });
  await a('https://d.test/1'); await b('https://e.test/1'); // 2 robots + 2 pages
  await assert.rejects(b('https://e.test/2'), /run: 4/);
});

test('politeFetch: one request at a time per host, with the gap; hosts in parallel', async () => {
  const events = [];
  let open = 0, maxOpen = 0;
  const real = async (url) => { open++; maxOpen = Math.max(maxOpen, open); await new Promise((r) => setTimeout(r, 5)); open--; events.push(new URL(url).host); return answer(''); };
  const sleeps = [];
  const f = politeFetch(real, { gapMs: 50, sleep: async (ms) => { sleeps.push(ms); } });
  await Promise.all([f('https://h.test/1'), f('https://h.test/2'), f('https://h.test/3')]);
  assert.equal(maxOpen, 1);
  assert.ok(sleeps.length >= 3 && sleeps.every((ms) => ms === 50));
  open = 0; maxOpen = 0;
  await Promise.all([f('https://i.test/1'), f('https://j.test/1')]);
  assert.equal(maxOpen, 2);
});

test('sanitizeFor cleans each kind of page the way its fixtures are cleaned', () => {
  const meet = '<script type="application/json" id="__NUXT_DATA__">[{"x":1},"Some Person"]</script>';
  assert.ok(!sanitizeFor('https://reclub.co/m/abc123', meet).includes('Some Person'));
  assert.match(sanitizeFor('https://reclub.co/clubs/@club', '<a href="/m/AbC12">x</a> call 512-555-0100'), /<a href="\/m\/AbC12">AbC12<\/a>/);
  const wp = JSON.stringify([{ id: 1, slug: 's', title: { rendered: 'T' }, content: { rendered: 'mail me@x.com' }, author: 9 }]);
  const cleaned = JSON.parse(sanitizeFor('https://site.test/wp-json/wp/v2/pages?slug=s', wp));
  assert.equal(cleaned[0].content.rendered, 'mail redacted@example.com');
  assert.equal(cleaned[0].author, undefined);
  assert.equal(sanitizeFor('https://other.test/', 'call (512) 555-0100'), 'call 000-000-0000');
  assert.equal(sanitizeFor('not a url', 'a@b.co'), 'redacted@example.com');
  assert.equal(sanitizeFor('https://x.test/wp-json/wp/v2/pages', 'not json a@b.co'), 'not json redacted@example.com');
});

test('resultCount and the report', () => {
  assert.equal(resultCount({ sessions: [1, 2] }), 2);
  assert.equal(resultCount({ programs: [1] }), 1);
  assert.equal(resultCount({ events: [] }), 0);
  assert.equal(resultCount({ count: 7 }), 7);
  assert.equal(resultCount([1, 2, 3]), 3);
  const md = report([{ id: 'a', ok: true, requests: 3, count: 5, replayCount: 5 }, { id: 'b', ok: false, requests: 1, error: 'HTTP 403 | x' }], { budget: { used: 4, max: 150 }, day: 2, refused: [{ refused: 'https://a.test/private' }] });
  assert.match(md, /rotation day 2/);
  assert.match(md, /1 of 2 recorded · 4 requests of 150/);
  assert.match(md, /\| a \| recorded \| 3 \| 5 \| 5 \|/);
  assert.match(md, /\*\*failed\*\*: HTTP 403 \\\| x/);
  assert.match(md, /- https:\/\/a.test\/private/);
});

test('every source and reader is a canary unit, or skipped with a reason', async () => {
  const { units, skipped } = canaryUnits();
  const ids = new Set([...units.map((u) => u.id), ...skipped.map((s) => s.id)]);
  for (const s of loadSources().sources) assert.ok(ids.has(`schedule:${s.id}`), s.id);
  for (const s of JSON.parse(readFileSync(new URL('../config/programs.json', import.meta.url))).sources) assert.ok(ids.has(`programs:${s.id}`), s.id);
  for (const s of JSON.parse(readFileSync(new URL('../config/events.json', import.meta.url))).sources) assert.ok(ids.has(`events:${s.id}`), s.id);
  assert.ok(ids.has('markets'));
  assert.ok(ids.has('watch:austin'), 'the pages behind Austin\'s hand-checked sessions');
  for (const v of (await import('../lib/courts.js')).VENUES) assert.ok(ids.has(`courts:${v.id}`), v.id);
  assert.equal(new Set(units.map((u) => u.id)).size, units.length);
  for (const s of skipped) assert.match(s.why, /paused|browser/);
  assert.equal(resultCount({ count: 2, facilities: [] }), 2);
});

test('runCanary records a unit, checks it replays, and keeps the old recording when it does not', async () => {
  const { mkdtempSync, readFileSync: read, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'canary-test-'));
  const real = async (url) => (String(url).endsWith('robots.txt') ? answer('', 404)
    : { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ items: [1, 2, 3], contact: 'me@x.com' }) });
  const good = { id: 'schedule:demo', run: async ({ fetch }) => ({ sessions: (await (await fetch('https://demo.test/api')).json()).items }) };
  // Reads the email out of the page: the cleaned recording no longer has it, so it doesn't replay the same.
  const leaky = { id: 'schedule:leaky', run: async ({ fetch }) => ({ sessions: [(await (await fetch('https://demo.test/api')).json()).contact].filter((c) => c === 'me@x.com') }) };
  const lines = [];
  const { outcomes, budget } = await runCanary([good, leaky], { fetch: real, dir, gapMs: 0, now: new Date('2026-11-24T10:41:00Z'), log: (l) => lines.push(l) });
  assert.deepEqual(outcomes.map((o) => [o.id, o.ok, o.count]), [['schedule:demo', true, 3], ['schedule:leaky', false, 1]]);
  assert.match(outcomes[1].error, /cleaned recording gives 0, the live read gave 1/);
  const saved = JSON.parse(read(join(dir, 'schedule/demo/cassette.json'), 'utf8'));
  assert.deepEqual(saved.meta, { unit: 'schedule:demo', now: '2026-11-24T10:41:00.000Z', count: 3 });
  assert.ok(!existsSync(join(dir, 'schedule/leaky')));
  assert.equal(budget.used, 4); // each unit: robots.txt, then the page (the replay check is free)
  assert.equal(lines.length, 2);
  // Out of budget: it stops after the unit that spent it.
  const r = await runCanary([good, good], { fetch: real, dir, gapMs: 0, budget: { max: 2, used: 0 } });
  assert.equal(r.outcomes.length, 1);
});

test('sanitizeFor drops people from data it has no cleaner for, keeps what readers need', async () => {
  const { dropPeople, sanitizeNextPage, sanitizeSkedda } = await import('../lib/canary.js');
  assert.deepEqual(dropPeople({ events: [{ id: '1700000000', name: 'Open Play', firstName: 'Al', participants: [{ name: 'B' }], note: 'mail a@b.co' }] }),
    { events: [{ id: '1700000000', name: 'Open Play', note: 'mail redacted@example.com' }] });
  const page = `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify({ event: { id: 'e1', name: 'Open', registrations: [{ user: 'x' }] } })}\nnot json\n`])})</script>`;
  const cleaned = sanitizeNextPage(page);
  const { pageObjects } = await import('../lib/public-page-data.js');
  assert.deepEqual(pageObjects(cleaned), [{ event: { id: 'e1', name: 'Open' } }]);
  assert.equal(sanitizeFor('https://app.getopencourt.com/club/x', page), cleaned);
  assert.equal(sanitizeFor('https://api.test/x', '{"members":[1],"ok":true}'), '{"ok":true}\n');
  // Skedda: a token stub, bookings cut to times and courts, the venue cut to hours and court names.
  assert.match(sanitizeSkedda('/booking', '<input name="__RequestVerificationToken" value="secret">'), /value="recorded"/);
  const list = JSON.parse(sanitizeFor('https://v.skedda.com/bookingslists?start=x', JSON.stringify({ bookings: [{ start: 'a', end: 'b', spaces: [1], title: 'Smith party', createdBy: 9 }] })));
  assert.deepEqual(list, { bookings: [{ start: 'a', end: 'b', spaces: [1] }] });
  const webs = JSON.parse(sanitizeFor('https://v.skedda.com/webs', JSON.stringify({ venue: [{ name: 'V', hoursOfAvailability: { rules: [{ start: 360, end: 1320, daysBitmask: 127, note: 'x' }] } }], spaces: [{ id: 1, name: 'Court 1', venue: 1, nonAdminVisible: true, ownerEmail: 'o@x.com' }], users: [{ name: 'U' }] })));
  assert.deepEqual(webs, { venue: [{ hoursOfAvailability: { rules: [{ start: 360, end: 1320, daysBitmask: 127 }] } }], spaces: [{ id: 1, name: 'Court 1', venue: 1, nonAdminVisible: true }] });
  assert.equal(sanitizeSkedda('/other', 'call 512-555-0100'), 'call 000-000-0000');
});

test('the watcher and court units read the way the scrape does', async () => {
  const { units } = canaryUnits();
  const watch = units.find((u) => u.id === 'watch:austin');
  const asked = [];
  const r = await watch.run({ fetch: async (url, init) => { asked.push([url, init.headers['user-agent']]); return answer('page'); }, now: new Date() });
  assert.ok(r.count >= 1 && r.count === asked.length);
  assert.ok(asked.every(([, ua]) => /schedule checker/.test(ua)));
  await assert.rejects(watch.run({ fetch: async () => answer('', 500), now: new Date() }), /none of \d+ pages answered/);

  const velocity = units.find((u) => u.id === 'courts:velocity');
  const skedda = async (url) => {
    const path = new URL(url).pathname;
    const body = path === '/booking' ? '<input name="__RequestVerificationToken" value="t">'
      : path === '/webs' ? JSON.stringify({ venue: [{ hoursOfAvailability: { rules: [] } }], spaces: [{ id: 1, name: 'Court 1', venue: 1, nonAdminVisible: true }] })
      : JSON.stringify({ bookings: [] });
    return { ok: true, status: 200, url, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) };
  };
  const courts = await velocity.run({ fetch: skedda, now: new Date('2026-11-24T16:00:00Z') });
  assert.equal(typeof courts.count, 'number');
});

test('a unit that spends its budget fails instead of saving part of a source', async () => {
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'canary-budget-'));
  const real = async () => answer('page');
  // Like the readers: a failed page is skipped, the rest carry on.
  const many = { id: 'programs:many', run: async ({ fetch }) => { let n = 0; for (let i = 0; i < 5; i++) { try { await fetch(`https://m.test/${i}`); n++; } catch { /* next */ } } return { count: n }; } };
  const { outcomes } = await runCanary([many], { fetch: real, dir, gapMs: 0, unitMax: 3 });
  assert.equal(outcomes[0].ok, false);
  assert.match(outcomes[0].error, /budget spent after 3 requests/);
  assert.ok(!existsSync(join(dir, 'programs/many')));
});

test('shrinkHtml keeps page data and drops what no reader looks at; HTML is shrunk when recorded', () => {
  const page = '<!doctype html><html><head><style>.a{}</style><link rel="x"><script src="/a.js"></script><script type="application/ld+json">{"@type":"Event"}</script></head>\n\n   <body style="x"><!-- c --><svg><path/></svg><p>Hi   there</p></body></html>';
  const small = shrinkHtml(page);
  assert.equal(small, '<!doctype html><html><head><script type="application/ld+json">{"@type":"Event"}</script></head>\n<body><p>Hi there</p></body></html>');
  assert.equal(sanitizeFor('https://x.test/', page), small);
  assert.equal(sanitizeFor('https://x.test/feed.ics', 'BEGIN:VCALENDAR\n  X'), 'BEGIN:VCALENDAR\n  X');
});

test('recording hands the caller the live headers and final URL (Skedda reads its cookies)', async () => {
  const { record } = await import('./support/cassette.mjs');
  const real = async () => ({ status: 200, url: 'https://final.test/booking', headers: new Headers({ 'content-type': 'text/html', 'set-cookie': 'a=1' }), text: async () => 'ok' });
  const res = await record('x', { fetch: real })('https://start.test/booking');
  assert.equal(res.url, 'https://final.test/booking');
  assert.equal(res.headers.get('set-cookie'), 'a=1');
});

test('published API endpoints skip robots.txt; pages on the same host do not', async () => {
  const asked = [];
  const real = async (url) => { asked.push(String(url)); return String(url).endsWith('/robots.txt') ? answer('User-agent: *\nDisallow: /api/\n') : answer('{}'); };
  const f = politeFetch(real, { gapMs: 0 });
  await f('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=x' });
  assert.deepEqual(asked, ['https://overpass-api.de/api/interpreter']);
  await assert.rejects(f('https://overpass-api.de/api/status'), RobotsDisallowed);
});

test('shrinkHtml leaves inline scripts exactly as they are, even with "<!--" inside', () => {
  const page = '<html><body><script>var a = "<!--";</script><p>one</p><script type="application/ld+json">{"@type":"Event","name":"A"}</script><!-- x --></body></html>';
  assert.equal(shrinkHtml(page), '<html><body><script>var a = "<!--";</script><p>one</p><script type="application/ld+json">{"@type":"Event","name":"A"}</script></body></html>');
});

test('a redirect replays to where it went (Skedda moves to allbooked.com)', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { record, replay } = await import('./support/cassette.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'redirect-'));
  const real = async () => ({ status: 200, url: 'https://x.allbooked.com/booking', headers: new Headers({ 'content-type': 'text/html' }), text: async () => 'ok' });
  const rec = record('r', { fetch: real, dir });
  await rec('https://x.skedda.com/booking');
  rec.save();
  const res = await replay('r', { dir })('https://x.skedda.com/booking');
  assert.equal(res.url, 'https://x.allbooked.com/booking');
  assert.equal(res.redirected, true);
});

test('a mismatch names what the cleaning lost; OpenCourt sources get a bigger budget', async () => {
  const { lostItems } = await import('../lib/canary.js');
  assert.equal(lostItems({ events: [{ title: 'A' }, { title: 'B' }] }, { events: [{ title: 'A' }] }), ' (lost: B)');
  assert.equal(lostItems({ sessions: [1, 2, 3, 4, 5].map((n) => ({ id: n })) }, { sessions: [] }), ' (lost: 1; 2; 3; +2 more)');
  assert.equal(lostItems({ count: 1 }, { count: 0 }), '');
  const { units } = canaryUnits();
  assert.equal(units.find((u) => u.id === 'schedule:austin-picklehaus').maxRequests, 600);
});

test('when shrinking a page costs the reader something, the canary keeps the page whole (still cleaned)', async () => {
  const { mkdtempSync, readFileSync: read, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'canary-whole-'));
  const html = '<!doctype html><html><body><!-- item --><!-- item --><p>mail a@b.co</p></body></html>';
  const real = async (url) => (String(url).endsWith('robots.txt') ? answer('', 404) : { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: async () => html });
  const commentCounter = { id: 'events:comments', run: async ({ fetch }) => ({ count: ((await (await fetch('https://c.test/')).text()).match(/<!-- item -->/g) ?? []).length }) };
  const { outcomes } = await runCanary([commentCounter], { fetch: real, dir, gapMs: 0 });
  assert.deepEqual([outcomes[0].ok, outcomes[0].count, outcomes[0].unshrunk], [true, 2, true]);
  const files = readdirSync(join(dir, 'events/comments')).filter((f) => f.endsWith('.html'));
  assert.equal(files.length, 1, 'the shrunk copy is gone');
  const saved = read(join(dir, 'events/comments', files[0]), 'utf8');
  assert.match(saved, /<!-- item -->/);
  assert.match(saved, /redacted@example.com/);
});

test('shrinkHtml leaves custom elements that start like style or svg', () => {
  const page = '<html><body><style-card>keep</style-card><svg-icon>keep</svg-icon><linked-item>keep</linked-item><style>x</style></body></html>';
  assert.equal(shrinkHtml(page), '<html><body><style-card>keep</style-card><svg-icon>keep</svg-icon><linked-item>keep</linked-item></body></html>');
});

test('a recording that does not replay is kept aside, cleaned, when asked', async () => {
  const { mkdtempSync, readdirSync, readFileSync: read } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'canary-keep-')), failedDir = mkdtempSync(join(tmpdir(), 'canary-failed-'));
  const real = async (url) => (String(url).endsWith('robots.txt') ? answer('', 404) : answer('me@x.com'));
  const leaky = { id: 'events:leaky', run: async ({ fetch }) => ({ count: (await (await fetch('https://l.test/')).text()).includes('me@x.com') ? 1 : 0 }) };
  const { outcomes } = await runCanary([leaky], { fetch: real, dir, gapMs: 0, failedDir });
  assert.equal(outcomes[0].ok, false);
  const body = readdirSync(join(failedDir, 'events/leaky')).find((f) => f !== 'cassette.json');
  assert.equal(read(join(failedDir, 'events/leaky', body), 'utf8'), 'redacted@example.com');
});
