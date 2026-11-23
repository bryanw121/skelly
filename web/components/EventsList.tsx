// The Events tab's list (#events): headings (On now, This week, …) with a few cards each and
// Show more, the "Hours not listed" markets under Every week, and the loading, error, empty and
// not-here-yet states. Drawn live by Preact (app.js calls drawEventsList), so a redraw keeps what
// someone opened, such as an event's Details. Taps are still handled by app.js through the data-*
// attributes (data-evmore, data-evclear, data-go-sports, data-topic, data-cal).
import { render } from 'preact';
import type { Market, SkellyEvent } from '../types';
import { EventCard, EventVisual, type CardContext } from './EventCard';

export type EventGroup = { key: string; label: string; sub: string; events: SkellyEvent[] };

export type EventsListProps =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'away'; regionName: string }
  | {
    status: 'list';
    groups: EventGroup[];
    open: Set<string>; // headings opened with Show more
    shown: number; // cards under a heading before Show more
    markets: Market[] | null; // the "Hours not listed" list, when it shows
    marketMiles: (m: Market) => number | null;
    marketLink: (m: Market) => string;
    ctx: CardContext;
  };

function Group({ g, open, shown, ctx }: { g: EventGroup; open: boolean; shown: number; ctx: CardContext }) {
  const rest = g.events.length - shown;
  return (
    <section class="ev-group" data-group={g.key}>
      <h2 class="ev-day">{g.label}<small>{g.sub}</small></h2>
      {(open ? g.events : g.events.slice(0, shown)).map((ev) => <EventCard key={ev.id} ev={ev} ctx={ctx} />)}
      {rest > 0 && !open ? <button type="button" class="show-more" data-evmore={g.key}>Show {rest} more</button> : null}
    </section>
  );
}

function MarketsUnlisted({ markets, miles, link, dataBase }: { markets: Market[]; miles: (m: Market) => number | null; link: (m: Market) => string; dataBase: string }) {
  const n = markets.length;
  return (
    <section class="ev-group mk-unlisted" data-group="unlisted">
      <h2 class="ev-day">Hours not listed<small>{n} more weekly market{n === 1 ? '' : 's'} · check the day before you go</small></h2>
      <ul class="mk-list">
        {markets.map((m) => {
          const mi = miles(m);
          return (
            <li class="mk-row" key={m.id}>
              <EventVisual ev={{ title: m.name } as SkellyEvent} size={40} dataBase={dataBase} />
              <span class="mk-name">{m.name}<small>{[m.city, mi != null && Number.isFinite(mi) ? `${mi.toFixed(1)} mi` : ''].filter(Boolean).join(' · ')}</small></span>
              <a class="mk-go" href={link(m)} target="_blank" rel="noopener">{m.url ? 'Hours on their site' : 'Hours on Google Maps'} ↗</a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EventsList(p: EventsListProps) {
  if (p.status === 'loading') return <p class="loading">Loading events…</p>;
  if (p.status === 'error') return <div class="error">Couldn't load events: {p.message}</div>;
  if (p.status === 'away') {
    return (
      <div class="ev-away">
        <h2>Events are Austin-only for now</h2>
        <p>Pop-ups and seasonal events come to {p.regionName} next. Open play, leagues and tournaments are already here.</p>
        <button type="button" class="signup" data-go-sports>See open play here →</button>
      </div>
    );
  }
  const markets = p.markets?.length ? <MarketsUnlisted markets={p.markets} miles={p.marketMiles} link={p.marketLink} dataBase={p.ctx.dataBase} /> : null;
  if (!p.groups.length && !markets) return <div class="empty"><b>Nothing matches.</b> <button type="button" class="linkish" data-evclear>Clear filters</button></div>;
  return <>{p.groups.map((g) => <Group key={g.key} g={g} open={p.open.has(g.key)} shown={p.shown} ctx={p.ctx} />)}{markets}</>;
}

/** Draw (or update) the list in `el`. */
export const drawEventsList = (el: HTMLElement, props: EventsListProps) => render(<EventsList {...props} />, el);
