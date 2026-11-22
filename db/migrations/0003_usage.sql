-- Usage metrics: anonymous events the site sends to /api/hit (lib/usage.js). No names, no IP
-- addresses: a random device id from the browser, a random session id, the approximate city
-- Vercel gives the request, and flat props (tab, sport, region, search words, link kind…).
-- Raw rows are kept 180 days; usage_daily keeps per-day totals forever (pruneUsage).
create table if not exists usage_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  name text not null,
  device text,
  session text,
  city text,
  area text,
  country text,
  device_type text,
  props jsonb not null default '{}'::jsonb
);
create index if not exists usage_events_at on usage_events (at);
create index if not exists usage_events_name_at on usage_events (name, at);

create table if not exists usage_daily (
  day date not null,
  name text not null,
  events integer not null,
  people integer not null,
  primary key (day, name)
);
