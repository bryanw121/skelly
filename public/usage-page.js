// The owner's Usage page: unlock with STATS_KEY once (kept on this device as skelly.owner), then
// totals from /api/usage for Today, 7 or 30 days, refreshed every minute while the tab is shown.
// The site's own pages show a Usage button only where skelly.owner is set. This page sends no
// usage events, so the owner's checks don't count as visits.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const OWNER = 'skelly.owner';
const store = { get: () => { try { return localStorage.getItem(OWNER) || ''; } catch { return ''; } }, set: (v) => { try { v ? localStorage.setItem(OWNER, v) : localStorage.removeItem(OWNER); } catch {} } };
let days = 7, timer = null;

async function fetchStats(key) {
  const r = await fetch('/api/usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, days }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

function bars(el, rows, label, value, empty) {
  el.replaceChildren();
  if (!rows?.length) { const p = document.createElement('p'); p.className = 'us-note'; p.textContent = empty; el.append(p); return; }
  const max = Math.max(...rows.map((r) => +r[value])) || 1;
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'us-bar';
    const a = document.createElement('span'); a.textContent = label(r);
    const t = document.createElement('i'); const f = document.createElement('b'); f.style.width = `${Math.max(2, (100 * +r[value]) / max)}%`; t.append(f);
    const n = document.createElement('span'); n.className = 'us-n'; n.textContent = fmt(r[value]);
    row.append(a, t, n); el.append(row);
  }
}

function daily(el, rows) {
  el.replaceChildren();
  const max = Math.max(3, ...rows.map((r) => r.visitors));
  const every = Math.ceil(rows.length / 7);
  rows.forEach((r, i) => {
    const col = document.createElement('div'); col.className = 'us-col';
    const d = new Date(`${r.day}T12:00:00Z`);
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    col.title = `${label}: ${r.visitors} visitors, ${r.visits} visits`;
    col.setAttribute('aria-label', col.title);
    const bar = document.createElement('b'); bar.style.height = `${(100 * r.visitors) / max}%`;
    const n = document.createElement('span'); n.className = 'us-n'; n.textContent = r.visitors ? r.visitors : '';
    const lab = document.createElement('small');
    if (i % every === 0 || i === rows.length - 1) { const [wd, md] = label.split(', '); lab.append(wd, document.createElement('br'), md); }
    col.append(n, bar, lab); el.append(col);
  });
}

function searches(el, rows) {
  el.replaceChildren();
  if (!rows?.length) { const p = document.createElement('p'); p.className = 'us-note'; p.textContent = 'No searches yet.'; el.append(p); return; }
  const t = document.createElement('table'); t.className = 'us-table';
  t.innerHTML = '<thead><tr><th>Search</th><th class="us-num">Times</th><th class="us-num">Results</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr'); if (+r.results === 0) tr.className = 'us-zero';
    for (const [v, c] of [[r.q, ''], [fmt(r.searches), 'us-num'], [r.results == null ? '—' : fmt(r.results), 'us-num']]) { const td = document.createElement('td'); td.textContent = v; if (c) td.className = c; tr.append(td); }
    tb.append(tr);
  }
  t.append(tb); el.append(t);
}

function show(s) {
  const k = s.summary ?? {};
  $('k-online').textContent = fmt(k.online_now);
  $('k-visitors').textContent = fmt(k.visitors);
  $('k-visits').textContent = fmt(k.visits);
  $('k-returning').textContent = `${fmt(k.returning_pct)}%`;
  $('k-busiest').textContent = fmt(k.busiest_minute);
  $('k-busiest-at').textContent = k.busiest_at ? `people at once, ${k.busiest_at}` : 'people at once';
  daily($('daily'), s.daily ?? []);
  bars($('uses'), s.uses, (r) => r.what, 'visitors', 'No page views yet.');
  bars($('cities'), s.cities, (r) => r.place, 'visitors', 'No visitors yet.');
  searches($('searches'), s.searches);
  bars($('outs'), s.outs, (r) => r.link, 'taps', 'Nobody has tapped out yet.');
  bars($('devices'), s.devices, (r) => r.device_type, 'visitors', 'No visitors yet.');
  $('asof').textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · refreshes every minute`;
}

function lock(message = '') {
  clearInterval(timer); timer = null;
  $('stats').hidden = true; $('lock').hidden = false; $('lockMsg').textContent = message;
  $('key').focus();
}

async function load() {
  const key = store.get();
  if (!key) return lock();
  try {
    const { status, body } = await fetchStats(key);
    if (status === 200) { $('lock').hidden = true; $('stats').hidden = false; show(body); timer ??= setInterval(() => { if (!document.hidden) load(); }, 60e3); return; }
    if (status === 401) { store.set(''); return lock("That key didn't work."); }
    if (status === 429) return lock('Too many tries. Wait 15 minutes.');
    if (status === 404) return lock('Usage isn\'t set up yet: add STATS_KEY in Vercel.');
    $('asof').textContent = "Couldn't load the numbers just now.";
  } catch { $('asof').textContent = "Couldn't reach Skelly. Check your connection."; }
}

$('lock').addEventListener('submit', (e) => { e.preventDefault(); store.set($('key').value.trim()); $('key').value = ''; load(); });
$('spans').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]'); if (!b) return;
  days = Number(b.dataset.days);
  for (const x of $('spans').querySelectorAll('[data-days]')) x.setAttribute('aria-pressed', String(x === b));
  load();
});
$('forget').addEventListener('click', () => { store.set(''); lock('Locked. Paste the key to see usage again.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) load(); });
load();
