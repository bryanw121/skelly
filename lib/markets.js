// Weekly markets (farmers, makers, flea) for the Events feed, from OpenStreetMap: places tagged
// amenity=marketplace with a name and simple weekly opening hours ("Su 10:00-14:00"). Listing
// sites only carry one-off events, so a market that runs every Sunday (Texas Farmers' Market at
// Mueller) never showed. Each market becomes one event, its next market day within a week, so the
// feed shows it once and moves it along as the days pass. Their own kind, Every week (`kind: 'weekly'`). Pure apart from `readMarkets`'s fetch.
import { createHash } from 'node:crypto';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // Date#getUTCDay order
const NAMES = { Su: 'Sunday', Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday' };
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const RULE = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)\\s+(\\d{2}:\\d{2})-(\\d{2}:\\d{2})$`);
/** A market, by name: not a grocery store, bank or insurance office that happens to say "market". */
const MARKET = /\b(market|markets|mercado|bazaar|flea|swap meet)\b/i;
const NOT_MARKET = /super ?market|sprouts|grocer|insurance|\bbank\b|h-e-b|whole foods|food mart|meat market|fish market|mini ?mart/i;

/**
 * Simple weekly opening hours as { Sa: { start, end }, … }, or null for anything else (months,
 * dates, "sunrise", daily or near-daily hours: a place open four or more days a week is a shop,
 * not a market day). "PH off" (closed on public holidays) is allowed and ignored.
 */
export function weeklyHours(oh) {
  const out = {};
  for (const part of String(oh ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    if (/^PH\s+(off|closed)$/i.test(part)) continue;
    const m = part.match(RULE);
    if (!m || m[2] >= m[3]) return null;
    for (const span of m[1].split(',')) {
      const [a, b = a] = span.split('-');
      const i = WEEK.indexOf(a), j = WEEK.indexOf(b);
      if (j < i) return null;
      for (const d of WEEK.slice(i, j + 1)) out[d] = { start: m[2], end: m[3] };
    }
  }
  const n = Object.keys(out).length;
  return n && n <= 3 ? out : null;
}

const clock = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const kmBetween = ([a, b], [c, d]) => { const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

/** "Every Sunday, 10am–2pm." / "Every Saturday and Sunday, 8am–noon." (one line, for the card). */
export function weeklyLine(hours) {
  const days = WEEK.filter((d) => hours[d]);
  const times = [...new Set(days.map((d) => `${clock(hours[d].start)}–${clock(hours[d].end)}`))];
  const list = days.map((d) => NAMES[d]);
  const named = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `Every ${named}${times.length === 1 ? `, ${times[0].replace('12pm', 'noon')}` : ''}.`;
}

/** Overpass JSON elements → feed events: each market's next market day from `today` (within a week). */
export function marketEvents(elements, { region, today }) {
  const out = [];
  for (const el of elements ?? []) {
    const t = el.tags ?? {};
    const name = String(t.name ?? '').trim();
    if (!name || !MARKET.test(name) || NOT_MARKET.test(name) || t.shop) continue;
    const hours = weeklyHours(t.opening_hours);
    if (!hours) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (region?.center && region?.radiusKm && kmBetween(region.center, [lat, lng]) > region.radiusKm) continue;
    let date = null;
    for (let i = 0; i < 7 && !date; i++) { const d = addDays(today, i); if (hours[DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]]) date = d; }
    const day = hours[DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]];
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const osm = `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const site = /^https:\/\//.test(t.website ?? '') ? t.website : /^https:\/\//.test(t['contact:website'] ?? '') ? t['contact:website'] : null;
    out.push({
      id: `mkt-${createHash('sha256').update(`${el.type}/${el.id}|${date}`).digest('hex').slice(0, 16)}`,
      category: 'popup', kind: 'weekly', tags: [], // category: for older readers, which know three
      title: name,
      venue: street ? `${name}, ${street}` : name,
      city: t['addr:city'] || region?.city || null,
      startDate: date, startTime: day.start, endTime: day.end,
      sourceUrl: site ?? osm, source: 'Weekly markets',
      description: weeklyLine(hours),
      weekly: true,
      region: region?.id ?? 'austin',
      lat: +lat.toFixed(5), lng: +lng.toFixed(5), located: 'source',
    });
  }
  return out;
}

/** Named like a market people visit weekly (farmers, makers, flea), for the ones without hours. */
const WEEKLY_NAME = /farmers?'?s?\b|farm stand|flea|makers|artisan|craft|swap meet|mercado/i;
/**
 * Markets whose hours OpenStreetMap doesn't have: { id, name, city, region, lat, lng, url? } for
 * the site's "Hours not listed" list, which links each to its own site or a map search.
 */
export function unlistedMarkets(elements, { region }) {
  const out = [];
  for (const el of elements ?? []) {
    const t = el.tags ?? {};
    const name = String(t.name ?? '').trim();
    if (!name || !MARKET.test(name) || !WEEKLY_NAME.test(name) || NOT_MARKET.test(name) || t.shop || weeklyHours(t.opening_hours)) continue;
    if (t.opening_hours && /^(Mo-Su|24\/7)/.test(t.opening_hours)) continue; // open every day: not a market day
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (region?.center && region?.radiusKm && kmBetween(region.center, [lat, lng]) > region.radiusKm) continue;
    const site = [t.website, t['contact:website']].find((u) => /^https:\/\//.test(u ?? ''));
    if (out.some((m) => m.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ id: `${el.type}/${el.id}`, name, city: t['addr:city'] || region?.city || null, region: region?.id ?? 'austin', lat: +lat.toFixed(5), lng: +lng.toFixed(5), ...(site ? { url: site } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
/** Named marketplaces within `radiusKm` of `center` (with or without hours). */
export const marketQuery = ([lat, lng], radiusKm) => `[out:json][timeout:60];nwr["amenity"="marketplace"]["name"](around:${Math.round(radiusKm * 1000)},${lat},${lng});out tags center;`;

const UA = 'Skelly/1.0 (events and schedules; +https://github.com/bryanw121/skelly)';
const DAY_MS = 864e5;
/** How often a region's markets are asked for again (they change rarely), and how long its last good answer stands in when Overpass is down. */
export const MARKETS_REFRESH_MS = DAY_MS, MARKETS_KEEP_MS = 14 * DAY_MS, MARKETS_ALERT_MS = 3 * DAY_MS;

/** One region's marketplaces from Overpass, trying each mirror (POST, a named user agent, a long wait), within the read's deadline. */
async function queryRegion(region, { fetch: f, endpoints, timeoutMs, deadline = Infinity, clock = Date.now }) {
  const errors = [];
  for (const url of endpoints) {
    const left = deadline - clock();
    if (left < 5000) { errors.push(`${new URL(url).hostname} skipped: out of time`); continue; }
    try {
      const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*', 'user-agent': UA }, body: new URLSearchParams({ data: marketQuery(region.center, region.radiusKm) }).toString(), signal: AbortSignal.timeout(Math.min(timeoutMs, left)) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const elements = JSON.parse(await res.text()).elements;
      if (!Array.isArray(elements)) throw new Error('no elements in the answer');
      return { elements };
    } catch (e) { errors.push(`${new URL(url).hostname} ${e.message}`); }
  }
  return { error: errors.join('; ') };
}

/**
 * Every region's weekly markets: { id: 'weekly-markets', ok, error, events, markets, cache }.
 * Markets rarely change, so each region's Overpass answer is kept in `cache` ({ [region]: { at, elements } },
 * public/data/markets-osm.json) and asked for again at most once a day. Each run turns the kept answer into
 * this week's dates, so a slow or down Overpass changes nothing for up to 14 days, and a region that fails
 * never stops the others. It's reported (ok: false) only once a region has had no good answer for 3 days.
 */
export const MARKETS_BUDGET_MS = 120000;
export async function readMarkets(regions, { today, now = Date.now(), cache = {}, fetch: f = globalThis.fetch, endpoints = OVERPASS, timeoutMs = 45000, budgetMs = MARKETS_BUDGET_MS, clock = Date.now }) {
  // The whole read gets budgetMs (the events step has 5 minutes): when Overpass hangs, regions past the
  // budget keep their last good answer, as for any failed region.
  const deadline = clock() + budgetMs;
  const events = [], markets = [], errors = [], next = { ...cache };
  for (const region of regions) {
    if (!region.center || !region.radiusKm) continue;
    const kept = cache[region.id], age = kept ? now - Date.parse(kept.at) : Infinity;
    let elements = age < MARKETS_REFRESH_MS ? kept.elements : null;
    if (!elements) {
      const r = await queryRegion(region, { fetch: f, endpoints, timeoutMs, deadline, clock });
      if (r.elements) { elements = r.elements; next[region.id] = { at: new Date(now).toISOString(), elements }; }
      else {
        if (age < MARKETS_KEEP_MS) elements = kept.elements;
        if (age >= MARKETS_ALERT_MS) errors.push(`${region.id}: ${r.error}${kept ? ` (last good answer ${Math.floor(age / DAY_MS)} days ago)` : ''}`);
      }
    }
    if (!elements) continue;
    const reg = { ...region, city: region.name?.split(',')[0] };
    events.push(...marketEvents(elements, { region: reg, today }));
    markets.push(...unlistedMarkets(elements, { region: reg }));
  }
  return { id: 'weekly-markets', ok: !errors.length, error: errors.join('; ') || null, events, markets, cache: next };
}
