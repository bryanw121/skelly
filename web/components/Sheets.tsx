// The small sheets and lines left, drawn live by Preact: Add to calendar (the visit picker and the
// two calendar links), the city pickers, the Add source sheet's "for" options and buttons, the
// Feedback sheet's buttons, the court-calendar errors and the footer. app.js decides what they say
// and handles taps and inputs (by id and data-*), as before.
import { render } from 'preact';

/** "When are you going?" for something that runs for days: a day and a time. */
export type CalPick = { min: string; max: string; date: string; time: string; note: string } | null;
export const drawCalPick = (el: HTMLElement, p: CalPick) => render(p ? (
  <>
    <h3 class="opt-h">When are you going?</h3>
    <div class="when-range on">
      <label class="when-field"><span>Day</span><input type="date" id="calDay" min={p.min} max={p.max} value={p.date} /></label>
      <label class="when-field"><span>Time</span><input type="time" id="calTime" step={900} value={p.time} /></label>
    </div>
    <p class="note" id="calPickNote" style="margin:0">{p.note}</p>
  </>
) : null, el);

/** Google Calendar (a filled-in link) and Apple Calendar / others (a calendar file). */
export const drawCalOpts = (el: HTMLElement, o: { google: string; file: string; download: string | null }) => render(
  <>
    <a class="tab opt" id="calGoogle" href={o.google} target="_blank" rel="noopener" data-close><span class="lbl">Google Calendar<small>Opens with everything filled in</small></span><span aria-hidden="true">↗</span></a>
    <a class="tab opt" id="calApple" href={o.file} download={o.download ?? undefined} data-close data-ics><span class="lbl">Apple Calendar<small>Also Outlook and others (a calendar file)</small></span><span aria-hidden="true">↓</span></a>
  </>, el);

export type City = { id: string; name: string };
export const drawCityOptions = (el: HTMLElement, cities: City[], selected: string | null) => {
  render(<>{cities.map((r) => <option key={r.id} value={r.id} selected={r.id === selected}>{r.name}</option>)}</>, el);
  if (selected && cities.some((r) => r.id === selected)) (el as HTMLSelectElement).value = selected;
};

export const drawAddFor = (el: HTMLElement, opts: { id: string; label: string }[], picked: string) => render(
  <>{opts.map((o) => <button key={o.id} type="button" class="tab opt" data-addfor={o.id} aria-pressed={o.id === picked}>{o.label}</button>)}</>, el);

/** A sheet's row of buttons: a main one (go-btn) and, sometimes, a second (tab opt). */
export type Act = { kind: 'submit' | 'button' | 'link'; label: string; id?: string; close?: boolean; href?: string; main: boolean; busy?: boolean; disabled?: boolean };
export const drawActs = (el: HTMLElement, acts: Act[]) => render(<>{acts.map((a) => {
  const cls = a.main ? 'go-btn' : 'tab opt';
  if (a.kind === 'link') return <a key={a.label} class={cls} href={a.href} target="_blank" rel="noopener">{a.label}</a>;
  return <button key={a.id ?? a.label} type={a.kind} class={cls} id={a.id} data-close={a.close ? '' : undefined} disabled={a.disabled || a.busy}>{a.busy ? <><span class="spin" aria-hidden="true" /> </> : null}{a.label}</button>;
})}</>, el);

export const drawCalErrors = (el: HTMLElement, errs: { venue: string; calendar: string | null }[] | null) => render(errs ? (
  <div class="error">Couldn't load some court calendars right now{errs.map((e) => (e.calendar ? <> · <a href={e.calendar} target="_blank" rel="noopener">open {e.venue} calendar ↗</a></> : null))}</div>
) : null, el);

export const drawFooter = (el: HTMLElement, text: string) => render(<>{text}</>, el);

/** The Add source sheet's result line (a spinner while it checks). */
export const drawAddResult = (el: HTMLElement, r: { busy: boolean; title: string; detail: string }) => render(
  <><b>{r.busy ? <><span class="spin" aria-hidden="true" /> </> : null}{r.title}</b>{r.detail ? <span>{r.detail}</span> : null}</>, el);
