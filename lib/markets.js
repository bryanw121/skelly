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

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
/** Named marketplaces with opening hours within `radiusKm` of `center`. */
export const marketQuery = ([lat, lng], radiusKm) => `[out:json][timeout:60];nwr["amenity"="marketplace"]["name"]["opening_hours"](around:${Math.round(radiusKm * 1000)},${lat},${lng});out tags center;`;

const UA = 'Skelly/1.0 (events and schedules; +https://github.com/bryanw121/skelly)';
/**
 * Every region's weekly markets: { id: 'weekly-markets', ok, error, events }. One query per region,
 * sent as Overpass asks (POST, a named user agent, a long wait: a plain GET got 406 and the
 * mirrors timed out at 30 s on the first run); the next mirror when one fails.
 */
export async function readMarkets(regions, { today, fetch: f = globalThis.fetch, endpoints = OVERPASS, timeoutMs = 120000 }) {
  const events = [], errors = [];
  for (const region of regions) {
    if (!region.center || !region.radiusKm) continue;
    let done = false;
    for (const url of endpoints) {
      try {
        const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*', 'user-agent': UA }, body: new URLSearchParams({ data: marketQuery(region.center, region.radiusKm) }).toString(), signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        events.push(...marketEvents(JSON.parse(await res.text()).elements, { region: { ...region, city: region.name?.split(',')[0] }, today }));
        done = true; break;
      } catch (e) { errors.push(`${region.id}: ${new URL(url).hostname} ${e.message}`); }
    }
    if (!done) return { id: 'weekly-markets', ok: false, error: errors.join('; '), events: [] };
  }
  return { id: 'weekly-markets', ok: true, error: null, events };
}
