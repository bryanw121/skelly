// The site's smaller controls, drawn live by Preact: the Sports day strip, the level or court-type
// options, the mode switch (Open play, Court bookings, Leagues, Tournaments), the sport picker, the
// Level and Time buttons, the host chips over leagues and tournaments, the search's topic chips,
// the count line over the Events list, and the Map / List button. app.js decides what each shows and
// handles every tap through the data-* attributes (data-di, data-tab, data-view, data-sport,
// data-host, data-topic, data-evclear, data-evanyday, data-layout).
import { render, type ComponentChildren } from 'preact';
import { EVENT_ICONS } from '../search.js';

const draw = (el: HTMLElement, node: ComponentChildren) => render(<>{node}</>, el);

export type DayView = { i: number; iso: string; name: string; date: number; label: string; on: boolean; pips: string[] };
export const drawDays = (el: HTMLElement, days: DayView[]) => draw(el, days.map((d) => (
  <button key={d.iso} class="day" aria-pressed={d.on} data-di={d.i} data-iso={d.iso} aria-label={d.label}>
    <span class="dn">{d.name}</span><span class="dd">{d.date}</span>
    <span class="pips">{d.pips.map((c) => <span class="pip" style={`background:${c}`} />)}</span>
  </button>
)));

export type LevelOpt = { id: string; label: string; color: string | null; desc: string | null; n: number; counting: boolean; on: boolean };
export const drawLevelOptions = (el: HTMLElement, opts: LevelOpt[]) => draw(el, opts.map((o) => (
  <button key={o.id} type="button" class="tab opt" aria-pressed={o.on} data-tab={o.id} style={o.color ? `--c:${o.color}` : undefined}>
    {o.color ? <span class="dot" /> : null}
    <span class="lbl">{o.label}{o.desc ? <small>{o.desc}</small> : null}</span>
    <span class="n" aria-hidden="true">{o.n || ''}</span>
    {o.counting ? <span class="vh">, {o.n} session{o.n === 1 ? '' : 's'}</span> : null}
  </button>
)));

/** A pill's label with its ▾ (the Level and Time buttons). */
export const drawPillLabel = (el: HTMLElement, label: string) => draw(el, <>{label} <span class="caret" aria-hidden="true">▾</span></>);

export type Mode = { id: string; label: string; on: boolean };
export const drawModes = (el: HTMLElement, modes: Mode[]) => draw(el, modes.map((m) => (
  <button key={m.id} class="seg-btn" type="button" data-view={m.id} aria-pressed={m.on}>{m.label}</button>
)));

export type SportOpt = { id: string; label: string; menu: string; on: boolean };
export const drawSportOptions = (el: HTMLElement, sports: SportOpt[]) => draw(el, sports.map((s) => (
  <button key={s.id} type="button" class="tab opt sport" aria-pressed={s.on} data-sport={s.id}><span class="lbl">{s.label}<small>{s.menu}</small></span></button>
)));

export type HostChip = { id: string; label: string; n: number; on: boolean };
export const drawHosts = (el: HTMLElement, chips: HostChip[], noun: string) => draw(el, chips.map((c) => (
  <button key={c.id} type="button" class={`pill-btn chip-btn${c.on ? ' on' : ''}`} data-host={c.id} aria-pressed={c.on}>{c.label} <span class="n" aria-hidden="true">{c.n}</span><span class="vh">, {c.n} {noun}</span></button>
)));

export type TopicChip = { id: string; label: string; n: number; on: boolean };
export const drawTopicChips = (el: HTMLElement, chips: TopicChip[]) => draw(el, chips.map((t) => {
  const icon = (EVENT_ICONS as Record<string, string>)[t.id];
  return (
    <button key={t.id} type="button" class={`pill-btn chip-btn${t.on ? ' on' : ''}`} data-topic={t.id} aria-pressed={t.on}>
      {icon ? <span class={`ev-ic ic-${t.id} chip-ic`} style="--s:22px"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: icon }} /></span> : null}
      {t.label} <span class="n">{t.n}</span>
    </button>
  );
}));

export type EventsCount = { shown: number; total: number; q: string; topic: string; when: string; otherDays: number } | null;
/** "3 of 140 events for “matcha” · This weekend · 2 more on other days · Clear filters". */
export const drawEventsCount = (el: HTMLElement, c: EventsCount) => draw(el, c ? (
  <>
    {c.shown} of {c.total} events{c.q ? ` for “${c.q}”` : c.topic ? ` tagged ${c.topic}` : ''}{c.when ? ` · ${c.when}` : ''}
    {c.otherDays > 0 ? <> · <button type="button" class="linkish" data-evanyday>{c.otherDays} more on other days</button></> : null}
    {' · '}<button type="button" class="linkish" data-evclear>Clear filters</button>
  </>
) : null);

/** The floating Map / List button (its icon is the page's own SVG text). */
export const drawLayoutButton = (el: HTMLElement, b: { to: 'map' | 'list'; icon: string } | null) => draw(el, b ? (
  <button class="fab" type="button" data-layout={b.to}><span style="display:contents" dangerouslySetInnerHTML={{ __html: b.icon }} />{b.to === 'map' ? 'Map' : 'List'}</button>
) : null);
