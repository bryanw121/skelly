// What goes with the map, drawn live by Preact: the list of places under it (#mapPanel) and the
// place sheet over it (#placeSheet). For Events: places grouped like the list (On now, This week…)
// and, for a picked place, the same event cards as the list. For Sports: the day's places nearest
// first and, for a picked one, its sessions, a Book button or a free court's directions. app.js
// decides what each says; taps go through data-pin, data-cal, copy-address as before.
import { render } from 'preact';
import type { SkellyEvent } from '../types';
import { EventCard, EventFacts, EventKicker, EventVisual, directionsHtml, hasFacts, type CardContext } from './EventCard';
import { Location, type Place } from './SportsPanels';
import type { Signup } from './SessionsList';

export type EventPlaceRow = { id: string; on: boolean; lead: SkellyEvent | null; holder: { avatar?: string }; title: string; more: number; at: string; status: string; hours: string };
export type SportPlaceRow = { id: string; on: boolean; dim: boolean; name: string; at: string; status: string };
export type SessionItem = { key: string; past: boolean; time: string; what: string; price: string; signup: Signup; calKey: string | null; calTitle: string };

export type MapPanelProps =
  | { kind: 'event-places'; count: number; groups: { key: string; label: string; sub: string; rows: EventPlaceRow[] }[]; today: string; dataBase: string }
  | { kind: 'event-place'; name: string; sub: string; events: SkellyEvent[]; ctx: CardContext }
  | { kind: 'sport-places'; hintHtml: string; rows: SportPlaceRow[] }
  | { kind: 'court'; status: string; park: string; sub: string; note: string; place: Place }
  | { kind: 'venue'; status: string | null; name: string; sub: string; price: { text: string | null; none: string } | null; book: { url: string; name: string } | null; sessions: SessionItem[]; emptyNote: string; place: Place };

function SignupLinks({ s }: { s: Signup }) {
  if (s.kind === 'link') return <a class="signup" href={s.url} target="_blank" rel="noopener">{s.label} ↗</a>;
  if (s.kind === 'dropin') return <><span class="dropin">{s.label}</span>{s.url ? <a class="src" href={s.url} target="_blank" rel="noopener">Details ↗</a> : null}</>;
  return null;
}

export function MapPanel(p: MapPanelProps) {
  switch (p.kind) {
    case 'event-places':
      return (
        <>
          <p class="map-hint"><b>{p.count} place{p.count === 1 ? '' : 's'}</b> with events coming up. Tap one for its events.</p>
          {p.groups.map((g) => (
            <section class="place-group" data-group={g.key} key={g.key}>
              <h3 class="ev-day">{g.label}<small>{g.sub}</small></h3>
              <ul class="place-list">
                {g.rows.map((x) => (
                  <li key={x.id}>
                    <button type="button" class={`place-row${x.on ? ' on' : ''}`} data-pin={x.id} aria-pressed={x.on}>
                      <EventVisual ev={x.lead} size={40} holder={x.holder} dataBase={p.dataBase} />
                      <span class="pr-name">{x.lead ? <EventKicker ev={x.lead} plain /> : null}<span class="pr-title">{x.title}</span>{x.more ? <> <span class="pr-more">+{x.more} more</span></> : null}<small class="pr-at">{x.at}</small></span>
                      <span class="pr-status">{x.status}{x.hours ? ` · ${x.hours}` : ''}{x.lead && hasFacts(x.lead, p.today, false) ? <> <span class="pr-facts"><EventFacts ev={x.lead} today={p.today} price={false} /></span></> : null}</span>
                      <span class="pr-go" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      );
    case 'event-place':
      return (
        <div class="map-place">
          <div class="g-venue"><span class="v-name">{p.name}<small>{p.sub}</small></span></div>
          <div class="ev-group map-cards">{p.events.map((ev) => <EventCard key={ev.id} ev={ev} ctx={p.ctx} />)}</div>
          <div class="location"><div class="actions" dangerouslySetInnerHTML={{ __html: directionsHtml(p.events[0]) }} /></div>
        </div>
      );
    case 'sport-places':
      return (
        <>
          <p class="map-hint" dangerouslySetInnerHTML={{ __html: p.hintHtml }} />
          <ul class="place-list">
            {p.rows.map((x) => (
              <li key={x.id}>
                <button type="button" class={`place-row${x.dim ? ' dim' : ''}${x.on ? ' on' : ''}`} data-pin={x.id} aria-pressed={x.on}>
                  <span class="pr-name">{x.name}<small>{x.at}</small></span><span class="pr-status">{x.status}</span><span class="pr-go" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      );
    case 'court':
      return (
        <div class="map-place">
          <p class="map-status">{p.status}</p>
          <div class="g-venue"><span class="v-name">{p.park}<small>{p.sub}</small></span></div>
          {p.note ? <p class="note">{p.note}</p> : null}
          {p.place ? <Location {...p.place} /> : null}
        </div>
      );
    case 'venue':
      return (
        <div class="map-place">
          {p.status != null ? <p class="map-status">{p.status}</p> : null}
          <div class="g-venue">
            <span class="v-name">{p.name}<small>{p.sub}{p.price ? <> · {p.price.text ? <b class="price">{p.price.text}</b> : <span class="noprice" title="We couldn't find a published court price; check with the venue">{p.price.none}</span>}</> : null}</small></span>
            {p.book ? <a class="signup" href={p.book.url} target="_blank" rel="noopener" aria-label={`Book a court at ${p.book.name}`}>Book ↗</a> : null}
          </div>
          {p.sessions.length ? (
            <div class="g-pop map-sessions">
              {p.sessions.map((x) => (
                <div class={`pop-item${x.past ? ' past' : ''}`} key={x.key}>
                  <span class="pop-t">{x.time}</span>
                  <span class="pop-w">{x.what}{x.price ? <small>{x.price}</small> : null}</span>
                  <span class="pop-a"><SignupLinks s={x.signup} />{x.calKey ? <button type="button" class="cal-add" data-cal={x.calKey} aria-haspopup="dialog" aria-label={`Add ${x.calTitle} to your calendar`}><span aria-hidden="true">＋</span> Calendar</button> : null}</span>
                </div>
              ))}
            </div>
          ) : <p class="note">{p.emptyNote}</p>}
          {p.place ? <Location {...p.place} /> : null}
        </div>
      );
  }
}

export const drawMapPanel = (el: HTMLElement, p: MapPanelProps) => render(<MapPanel {...p} />, el);

/** The place sheet: a handle, ✕ and the picked place (or nothing). */
export const drawPlaceSheet = (el: HTMLElement, s: { id: string; name: string; panel: MapPanelProps } | null) => render(s ? (
  <>
    <div class="ps-grab" aria-hidden="true" />
    <button type="button" class="ps-x" data-pin={s.id} aria-label={`Close ${s.name}`}>✕</button>
    <div class="ps-body"><MapPanel {...s.panel} /></div>
  </>
) : null, el);
