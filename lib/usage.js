// Usage metrics (anonymous). The site batches small events (public/usage.js) to /api/hit, which
// checks them here and inserts them into usage_events. Pure apart from the database calls.
//   No names or accounts (Skelly has none), no IP addresses: the city is Vercel's approximate
//   location of the request; a random id per browser counts a person once.

/** Event names the site may send, and the props each may carry (all flat strings or numbers). */
export const USAGE_EVENTS = {
  open: ['tab', 'sport', 'region', 'layout', 'ref'],        // the page opened (ref: the referring site's host)
  view: ['tab', 'sport', 'region', 'layout', 'how'],        // tab, sport, city or list/map changed
  search: ['q', 'tab', 'sport', 'region', 'results'],       // search words (cut to 40 chars) and how many results
  filter: ['tab', 'what', 'value', 'region'],               // a filter chip, sort or day picked
  detail: ['tab', 'sport', 'kind', 'source', 'region'],     // an event or session opened
  out: ['tab', 'link', 'source', 'region'],                 // a tap out: book, event page, instagram, map, calendar
  ping: ['tab', 'region'],                                  // still here (once a minute while visible): online now
};
const MAX_EVENTS = 40, MAX_PROP = 80;
const ID = /^[A-Za-z0-9_-]{8,40}$/;

/** True for crawlers, link previews and headless browsers: their visits aren't counted. */
export function isBot(ua) {
  const s = String(ua ?? '');
  return !s || /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|headless|lighthouse|pagespeed|curl|wget|python|node-fetch|axios|go-http/i.test(s);
}
/** Phone, tablet or computer, from the user agent. */
export function deviceType(ua) {
  const s = String(ua ?? '');
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(s)) return 'phone';
  return 'computer';
}
const header = (h, k) => { const v = h?.[k] ?? h?.get?.(k); try { return v ? decodeURIComponent(String(v)).slice(0, 60) : null; } catch { return String(v).slice(0, 60); } };

/**
 * A request body ({ d: device, s: session, e: [{ n, p }] }) and its headers → rows to insert, or
 * null to drop the whole batch (a bot, a malformed body). Unknown events and props are dropped.
 */
export function usageRows(body, headers) {
  const ua = header(headers, 'user-agent');
  if (isBot(ua)) return null;
  if (!body || !ID.test(body.d ?? '') || !ID.test(body.s ?? '') || !Array.isArray(body.e)) return null;
  const where = { city: header(headers, 'x-vercel-ip-city'), area: header(headers, 'x-vercel-ip-country-region'), country: header(headers, 'x-vercel-ip-country') };
  const rows = [];
  for (const ev of body.e.slice(0, MAX_EVENTS)) {
    const keys = USAGE_EVENTS[ev?.n];
    if (!keys) continue;
    const props = {};
    for (const k of keys) {
      const v = ev.p?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
      else if (typeof v === 'string' && v.trim()) props[k] = (k === 'q' ? v.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40) : v.trim().slice(0, MAX_PROP));
    }
    rows.push({ name: ev.n, device: body.d, session: body.s, ...where, device_type: deviceType(ua), props });
  }
  return rows;
}

/** Insert rows in one statement. props goes as text cast to jsonb (`$n::text::jsonb`, see lib/db.js): with a bare `::jsonb` the `postgres` driver JSON-encodes the string again and stores a jsonb string. */
export async function insertUsage(db, rows) {
  if (!rows.length) return 0;
  const cols = ['name', 'device', 'session', 'city', 'area', 'country', 'device_type', 'props'];
  const params = [], values = rows.map((r, i) => `(${cols.map((c, j) => { params.push(c === 'props' ? JSON.stringify(r.props) : r[c] ?? null); return `$${i * cols.length + j + 1}${c === 'props' ? '::text::jsonb' : ''}`; }).join(', ')})`);
  await db.query(`insert into usage_events (${cols.join(', ')}) values ${values.join(', ')}`, params);
  return rows.length;
}

/**
 * Keep the tables small (run with the owner login, after migrations): per-day totals for every
 * finished day into usage_daily (people = distinct devices that day), then raw rows older than
 * 180 days deleted. Days are America/Chicago days.
 */
export async function pruneUsage(db) {
  await db.query(`insert into usage_daily (day, name, events, people)
    select (at at time zone 'America/Chicago')::date, name, count(*), count(distinct device)
      from usage_events
     where (at at time zone 'America/Chicago')::date < (now() at time zone 'America/Chicago')::date
       and (at at time zone 'America/Chicago')::date >= (now() at time zone 'America/Chicago')::date - 7
     group by 1, 2
    on conflict (day, name) do update set events = excluded.events, people = excluded.people`);
  await db.query(`delete from usage_events where at < now() - interval '180 days'`);
}
