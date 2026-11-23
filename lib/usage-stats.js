// The owner's Usage page (public/usage.html, api/usage.js): totals from usage_events over the last
// 1, 7 or 30 days. Aggregates only: counts per day, tab or sport, city, search, link and device,
// never single visits or device ids. Days are America/Chicago days. Reads work with the read-only
// login (schelagg_reader has SELECT on usage_events).
import { timingSafeEqual, createHash } from 'node:crypto';

export const STATS_SPANS = [1, 7, 30];
export const spanOf = (v) => (STATS_SPANS.includes(Number(v)) ? Number(v) : 7);

/** True when `given` is the owner key. Compares hashes so neither length nor content leaks by timing. */
export function keyMatches(given, expected) {
  if (typeof given !== 'string' || !given || typeof expected !== 'string' || expected.length < 12) return false;
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

// props were briefly saved as a jsonb string (fixed in #180, rows unwrapped by 0004): read both.
const P = "case when jsonb_typeof(props) = 'string' then (props #>> '{}')::jsonb else props end";
const W = `with w as (select device, session, name, at, ${P} as p from usage_events where at > now() - ($1::text::int * interval '1 day'))`;

const QUERIES = {
  summary: `${W},
    days as (select device, count(distinct (at at time zone 'America/Chicago')::date) n from w group by device),
    m as (select date_trunc('minute', at) mi, count(distinct device) c from w group by 1 order by 2 desc, 1 desc limit 1)
    select (select count(distinct device) from usage_events where at > now() - interval '2 minutes')::int as online_now,
      (select count(distinct device) from w)::int as visitors,
      (select count(distinct session) from w)::int as visits,
      (select coalesce(round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0)), 0) from days)::int as returning_pct,
      coalesce((select c from m), 0)::int as busiest_minute,
      (select to_char(mi at time zone 'America/Chicago', 'Dy FMMM/FMDD FMHH12:MI am') from m) as busiest_at,
      (select count(*) from w where name = 'search')::int as searches`,
  daily: `with d as (select generate_series((now() at time zone 'America/Chicago')::date - ($1::text::int - 1), (now() at time zone 'America/Chicago')::date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day, count(distinct e.device)::int as visitors, count(distinct e.session)::int as visits
    from d left join usage_events e on e.at > now() - (($1::text::int + 1) * interval '1 day') and (e.at at time zone 'America/Chicago')::date = d.day
    group by d.day order by d.day`,
  uses: `${W} select case when p->>'tab' = 'sports' and coalesce(p->>'sport', '') <> '' then initcap(replace(p->>'sport', '-', ' ')) when p->>'tab' is not null then initcap(p->>'tab') else 'Other' end as what,
      count(distinct device)::int as visitors
    from w where name in ('open', 'view') group by 1 order by 2 desc, 1 limit 10`,
  cities: `with w as (select device, city, area, country from usage_events where at > now() - ($1::text::int * interval '1 day'))
    select concat_ws(', ', coalesce(nullif(city, ''), 'Unknown'), nullif(area, ''), case when country is not null and country <> 'US' then country end) as place, count(distinct device)::int as visitors
    from w group by 1 order by 2 desc, 1 limit 10`,
  searches: `${W} select p->>'q' as q, count(*)::int as searches, round(avg((p->>'results')::numeric))::int as results
    from w where name = 'search' and coalesce(p->>'q', '') <> '' group by 1 order by 2 desc, 1 limit 20`,
  outs: `${W} select initcap(coalesce(p->>'link', 'other')) as link, count(*)::int as taps
    from w where name = 'out' group by 1 order by 2 desc, 1 limit 10`,
  devices: `with w as (select device, device_type from usage_events where at > now() - ($1::text::int * interval '1 day'))
    select initcap(coalesce(device_type, 'unknown')) as device_type, count(distinct device)::int as visitors from w group by 1 order by 2 desc, 1`,
};

/** Every section of the page for the last `days` days. */
export async function usageStats(db, days) {
  const span = String(spanOf(days)), out = { days: Number(span) };
  for (const [k, sql] of Object.entries(QUERIES)) out[k] = await db.query(sql, [span]);
  out.summary = out.summary[0] ?? null;
  return out;
}
