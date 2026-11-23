// One event, the same everywhere it shows: the Events list and the Map's place sheet (both Preact).
// Taps are handled by app.js through the data-* attributes. The pieces (visual, kicker, facts) are
// exported for the map's place rows; eventVisualHtml is for the map pins, which MapLibre draws.
import type { ComponentChildren } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { SkellyEvent } from '../types';
import { eventCta, eventKind, eventPlaceParts, eventSummary, eventTags, eventWhen, isOn, kindLabel, lastChance, tagLabel, avatarPath } from '../events-ui.js';
import { EVENT_ICONS, eventIcon as iconOfJs, eventTopics, highlightParts, searchTagLabel, searchTags } from '../search.js';

const eventIcon = iconOfJs as (ev: unknown, kind?: string | null) => string;

/** What a card needs from the page around it: today's date, the search, distances, formatting. */
export type CardContext = {
  today: string; // YYYY-MM-DD in the region's time zone
  query: string; // the search being shown, for highlighting ('' for none)
  dataBase: string; // where data/ lives (for organizer pictures)
  linkedId: string | null; // the event a shared link opened: highlighted, its Details open
  milesTo: (ev: SkellyEvent) => number | null;
  fmtMiles: (mi: number) => string;
  fmtTime: (hhmm: string) => string;
  fitNote: (start?: string, end?: string) => string; // how it fits the time picked in When, or ''
  calKey: (ev: SkellyEvent) => string; // registers the event for the Calendar sheet; returns its key
};

type Ev = SkellyEvent & { avatar?: string };
const safeUrl = (u?: string) => /^https:\/\//i.test(u ?? '');

/** Text with the search words marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  return <>{(highlightParts(text, query) as [string, boolean][]).map(([t, on]) => (on ? <mark>{t}</mark> : t))}</>;
}

/** The organizer's picture when there is one, otherwise the icon of its topic or kind. */
export function EventVisual({ ev, size, holder = ev, dataBase }: { ev: Ev | null; size: number; holder?: { avatar?: string } | null; dataBase: string }) {
  const pic = avatarPath(holder);
  if (pic) return <img class="av" src={`${dataBase}${pic}`} alt="" width={size} height={size} loading="lazy" decoding="async" />;
  if (!ev) return null;
  const icon = eventIcon(ev, eventKind(ev) as string | null);
  return (
    <span class={`ev-ic ic-${icon}`} style={`--s:${size}px`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: (EVENT_ICONS as Record<string, string>)[icon] ?? EVENT_ICONS.popup }} />
    </span>
  );
}

/** The line above the title: its topics (each a tap to show only that topic), or its kind, then theme tags. */
export function EventKicker({ ev, plain = false }: { ev: Ev; plain?: boolean }) {
  const topics = (eventTopics(ev) as string[]).slice(0, 2);
  const kind = eventKind(ev) as string | null;
  const parts: ComponentChildren[] = topics.length
    ? topics.map((t, i) => plain
      ? <span class={`kick${i ? ' more' : ''}`}>{searchTagLabel(t)}</span>
      : <button type="button" class={`kick${i ? ' more' : ''}`} data-topic={t} aria-label={`Show events tagged ${searchTagLabel(t)}`}>{searchTagLabel(t)}</button>)
    : kind ? [<span class="kick">{kindLabel(kind)}</span>] : [];
  if (topics.length && kind === 'weekly') parts.push(<span class="kick more">Every week</span>);
  for (const g of eventTags(ev) as string[]) parts.push(<span class="kick more">{tagLabel(g)}</span>);
  if (!parts.length) return null;
  return (
    <div class={`ev-kick ic-${eventIcon(ev, kind)}`}>
      {parts.map((p, i) => <>{i ? <span class="kick-dot" aria-hidden="true">·</span> : null}{p}</>)}
    </div>
  );
}

/** Its fact pills: a last chance ("Ends tomorrow"), Free, and the price (`price={false}` leaves it out). */
export function EventFacts({ ev, today, price = true }: { ev: Ev; today: string; price?: boolean }) {
  const last = lastChance(ev, today) as string | null, free = (searchTags(ev) as string[]).includes('free');
  const showPrice = price && ev.price && !(free && /^\s*free\s*$/i.test(ev.price));
  if (!last && !free && !showPrice) return null;
  return <>{last ? <span class="fact last">{last}</span> : null}{free ? <span class="fact free">Free</span> : null}{showPrice ? <span class="fact">{ev.price}</span> : null}</>;
}
export const hasFacts = (ev: Ev, today: string, price = true) => !!(lastChance(ev, today) || (searchTags(ev) as string[]).includes('free') || (price && ev.price));

/** Its hours ("11am", "5pm–10pm"), or '' when the source gave none. */
export const eventHours = (ev: Ev, fmtTime: (t: string) => string) => (ev.startTime ? `${fmtTime(ev.startTime)}${ev.endTime ? `–${fmtTime(ev.endTime)}` : ''}` : '');
/** What to say in their place: where the hours are. */
export const noHours = (ev: Ev) => (safeUrl(ev.sourceUrl) ? `Hours on the ${eventCta(ev) === 'See the post' ? 'post' : 'event page'}` : 'Hours not listed');

/** Directions to the venue, as a free-text destination. */
function Directions({ ev }: { ev: Ev }) {
  const dest = encodeURIComponent(`${ev.venue}${ev.city && !String(ev.venue).toLowerCase().includes(String(ev.city).toLowerCase()) ? `, ${ev.city}` : ''}, TX`);
  return <><a class="src" href={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} target="_blank" rel="noopener">Google Maps ↗</a><a class="src" href={`https://maps.apple.com/directions?destination=${dest}&mode=driving`} target="_blank" rel="noopener">Apple Maps ↗</a></>;
}
export function directionsHtml(ev: Ev) { return renderToString(<Directions ev={ev} />); }

/** The card. */
export function EventCard({ ev, ctx }: { ev: Ev; ctx: CardContext }) {
  const parts = eventPlaceParts(ev) as string[];
  const on = isOn(ev, ctx.today);
  const mi = ctx.milesTo(ev);
  const w = eventWhen(ev, ctx.today) as { top: string; main: string; range?: boolean; dow?: string };
  const times = eventHours(ev, ctx.fmtTime);
  const summary = eventSummary(ev) as string;
  const fit = ctx.fitNote(ev.startTime, ev.endTime);
  const linked = ctx.linkedId != null && ctx.linkedId === ev.id;
  return (
    <article class={`row ev-row${linked ? ' linked' : ''}`} data-ev={ev.id ?? ''}>
      <EventVisual ev={ev} size={56} dataBase={ctx.dataBase} />
      <div class="time">
        {w.range ? <><small class="ev-top">{w.dow}</small>{w.top}<small>{w.main}</small></> : <><small class="ev-top">{w.top}</small>{w.main}</>}
        {times ? <small>{times}</small> : <small class="no-hrs">{noHours(ev)}</small>}
      </div>
      <div class="body">
        <EventKicker ev={ev} />
        <div class="t1"><span class="title"><Highlight text={ev.title} query={ctx.query} /></span>{on ? <span class="pill fresh">Happening now</span> : null}</div>
        {avatarPath(ev) && ev.account ? <div class="ev-by"><span>{ev.sourceId === 'instagram' ? 'by' : 'via'} <b>@{ev.account}</b></span></div> : null}
        {summary ? <div class="ev-what"><Highlight text={summary} query={ctx.query} /></div> : null}
        <div class="venue"><b>{parts[0] ?? ev.venue}</b>{parts.slice(1).map((p) => ` · ${p}`).join('')}{mi != null ? ` · ${ctx.fmtMiles(mi)}` : ''}</div>
        {hasFacts(ev, ctx.today) ? <div class="meta ev-facts"><EventFacts ev={ev} today={ctx.today} /></div> : null}
        {fit ? <div class="fit">{fit}</div> : null}
      </div>
      <div class="ev-foot">
        <div class="actions">
          {safeUrl(ev.sourceUrl) ? <a class="signup ev-go" href={ev.sourceUrl} target="_blank" rel="noopener">{eventCta(ev)} ↗</a> : null}
          <button type="button" class="cal-add" data-cal={ctx.calKey(ev)} aria-haspopup="dialog" aria-label={`Add ${ev.title} to your calendar`}><span aria-hidden="true">＋</span> Calendar</button>
        </div>
        <details class="more" open={linked}>
          <summary>Details</summary>
          {ev.description ? <div class="note">{ev.description}</div> : null}
          <div class="location">{parts.join(', ')}</div>
          <div class="actions"><Directions ev={ev} /></div>
          {ev.source ? <span class="via">Found via {ev.source}</span> : null}
        </details>
      </div>
    </article>
  );
}

/** The picture as HTML, for the map pins. */
export const eventVisualHtml = (ev: Ev | null, size: number, holder: { avatar?: string } | null, dataBase: string) => renderToString(<EventVisual ev={ev} size={size} holder={holder ?? ev} dataBase={dataBase} />);
