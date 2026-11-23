// The Sports tab's other panels, drawn live by Preact: court booking links (#bookingCalendars),
// venue calendars (#venueCalendars), free public courts (#courts), the sources list
// (#sourceList) and the calendar subscription line (#subscribe). app.js decides what they say;
// taps (copy address, copy calendar link) are handled there through data-* attributes.
import { render } from 'preact';

/** A venue's address with directions and a Copy address button (app.js fills the status). */
export function Location({ name, address, dest }: { name: string; address: string; dest?: string }) {
  const destination = encodeURIComponent(dest ?? `${name}, ${address}`);
  return (
    <div class="location">
      <div>{address}</div>
      <div class="actions">
        <a class="src" href={`https://www.google.com/maps/dir/?api=1&destination=${destination}`} target="_blank" rel="noopener">Google Maps ↗</a>
        <a class="src" href={`https://maps.apple.com/directions?destination=${destination}&mode=driving`} target="_blank" rel="noopener">Apple Maps ↗</a>
        <button class="src copy-address" type="button" data-address={address}>Copy address</button>
        <span class="copy-status" role="status" />
      </div>
    </div>
  );
}
export type Place = { name: string; address: string; dest?: string } | null;

export type BookingRow = { key: string; name: string; city: string; miles: string; price: string | null; noPrice: string; url: string; place: Place; note: string; priceSource: string | null };
export function drawBookingRows(el: HTMLElement, rows: BookingRow[]) {
  render(rows.length ? <>{rows.map((r) => {
    const more = !!(r.place || r.note || r.priceSource);
    return (
      <div class="book-row" key={r.key}>
        <div class="book-name"><b>{r.name}</b><span>{r.city}{r.miles} · {r.price ? <b class="price">{r.price}</b> : <span class="noprice" title="We couldn't find a published court price; check with the venue">{r.noPrice}</span>}</span></div>
        <a class="signup" href={r.url} target="_blank" rel="noopener" aria-label={`Book a court at ${r.name}`}>Book ↗</a>
        {more ? (
          <details class="more">
            <summary>Details</summary>
            {r.place ? <Location {...r.place} /> : null}
            {r.note ? <p class="note">{r.note}</p> : null}
            {r.priceSource ? <div class="actions"><a class="src" href={r.priceSource} target="_blank" rel="noopener">Price source ↗</a></div> : null}
          </details>
        ) : null}
      </div>
    );
  })}</> : <p class="note">No venue booking links for this selection.</p>, el);
}

export type VenueCalendar = { key: string; name: string; city: string; place: Place; note: string; stale: boolean; details: { label: string; text: string; url: string | null }[]; reviewedOn: string; url: string };
export function drawVenueCalendars(el: HTMLElement, list: VenueCalendar[]) {
  render(<>{list.map((v) => (
    <div class="venue-calendar" key={v.key}>
      <b>{v.name}</b> · {v.city}{v.place ? <Location {...v.place} /> : null}
      <p class="note">{v.note}</p>
      {v.details.length ? (v.stale
        ? <p class="note">Hours and general prices need rechecking. See the venue website for current details.</p>
        : <>{v.details.map((d) => <p class="note"><b>{d.label}:</b> {d.text} {d.url ? <a class="src" href={d.url} target="_blank" rel="noopener">Source ↗</a> : null}</p>)}<p class="note">Details checked {v.reviewedOn} · Austin local time</p></>)
        : null}
      <a class="src" href={v.url} target="_blank" rel="noopener">View venue calendar ↗</a>
    </div>
  ))}</>, el);
}

export type Court = { key: string; park: string; closed: string | null; what: string };
export const drawCourts = (el: HTMLElement, courts: Court[]) => render(<>{courts.map((c) => (
  <div class={`court ${c.closed ? 'closed' : ''}`} key={c.key}><span>{c.park}</span><span>{c.closed ?? c.what}</span></div>
))}</>, el);

export type SourceItem = { key: string; ok: boolean; name: string; line: string; warnings: string[] };
export const drawSourceList = (el: HTMLElement, list: SourceItem[]) => render(<>{list.map((s) => (
  <li class={s.ok ? 'ok' : 'bad'} key={s.key}><b>{s.name}</b> <span>{s.line}</span> {s.warnings.map((w) => <div class="note">{w}</div>)}</li>
))}</>, el);

export const drawSubscribe = (el: HTMLElement, s: { webcal: string; https: string; sport: string }) => render(
  <>📅 <a href={s.webcal}>Subscribe in your calendar</a> to see {s.sport} here, updated hourly · <button type="button" class="copy-cal" data-copy={s.https} title="For calendars that add a subscription from a link, such as Google Calendar's 'From URL'">Copy calendar link</button></>, el);
