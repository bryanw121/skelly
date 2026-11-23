// The Events tab's controls, drawn live by Preact: the row of pills over the list (#eventCats:
// Sort, Kind & tags, When, Near me) and the two sheets they open (#eventsOpts, #sortOpts).
// app.js still decides what's picked and handles every tap through the data-* attributes.
import { render } from 'preact';

const n1 = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

export type PillsProps = { sortLabel: string; sorted: boolean; filterLabel: string; filtering: boolean; whenLabel: string; near: boolean | null }; // near: null where the browser has no location
export function EventPills({ sortLabel, sorted, filterLabel, filtering, whenLabel, near }: PillsProps) {
  return (
    <>
      <button type="button" class={`pill-btn chip-btn${sorted ? ' on' : ''}`} data-sheet="sortSheet" aria-haspopup="dialog" aria-label={`Sort: ${sortLabel}. Change`}>Sort: {sortLabel} <span class="caret" aria-hidden="true">▾</span></button>
      <button type="button" class={`pill-btn chip-btn${filtering ? ' on' : ''}`} data-sheet="eventsSheet" aria-haspopup="dialog">{filterLabel} <span class="caret" aria-hidden="true">▾</span></button>
      <button type="button" class={`pill-btn chip-btn${whenLabel ? ' on' : ''}`} data-sheet="whenSheet" aria-haspopup="dialog" id="whenBtn">{whenLabel || 'When'} <span class="caret" aria-hidden="true">▾</span></button>
      {near != null ? <button type="button" class={`pill-btn chip-btn${near ? ' on' : ''}`} data-evnear aria-pressed={near}>Near me</button> : null}
    </>
  );
}

type Opt = { id: string; label: string; hint?: string; n: number; on: boolean };
function OptButton({ attr, o }: { attr: 'data-evkind' | 'data-evtag' | 'data-evtopic'; o: Opt }) {
  return (
    <button type="button" class="tab opt" {...{ [attr]: o.id }} aria-pressed={o.on}>
      <span class="lbl">{o.label}{o.hint ? <small>{o.hint}</small> : null}</span><span class="n">{o.n}</span>
    </button>
  );
}

export type KindSheetProps = { kinds: Opt[]; tags: Opt[]; topics: Opt[]; shown: number };
/** Kind (All events, Pop-ups, Every week, …), then tags and topics, each with its count. */
export function KindSheet({ kinds, tags, topics, shown }: KindSheetProps) {
  return (
    <>
      <h3 class="opt-h">Kind</h3>
      {kinds.map((o) => <OptButton key={o.id} attr="data-evkind" o={o} />)}
      <h3 class="opt-h">Tags</h3>
      {tags.map((o) => <OptButton key={o.id} attr="data-evtag" o={o} />)}
      {topics.map((o) => <OptButton key={o.id} attr="data-evtopic" o={o} />)}
      <button type="button" class="go-btn" data-close>Show {n1(shown)}</button>
    </>
  );
}

export type SortSheetProps = { sorts: { id: string; label: string; hint: string; on: boolean }[]; likes: { id: string; label: string; icon: string; on: boolean }[]; advOpen: boolean; shown: number };
/** The orders, then (under Advanced) the topics someone is into, which For you puts first. */
export function SortSheet({ sorts, likes, advOpen, shown }: SortSheetProps) {
  return (
    <>
      {sorts.map((x) => (
        <button key={x.id} type="button" class="tab opt" data-evsort={x.id} aria-pressed={x.on}><span class="lbl">{x.label}<small>{x.hint}</small></span></button>
      ))}
      <details class="adv" id="sortAdv" open={advOpen}>
        <summary>Advanced</summary>
        <h3 class="opt-h" id="likesH">What you’re into</h3>
        <div class="likes" role="group" aria-labelledby="likesH">
          {likes.map((t) => <button key={t.id} type="button" class={`like ic-${t.icon}`} data-evlike={t.id} aria-pressed={t.on}>{t.label}</button>)}
        </div>
        <p class="note">For you puts these first. They stay on this device.</p>
      </details>
      <button type="button" class="go-btn" data-close>Show {n1(shown)}</button>
    </>
  );
}

export const drawEventPills = (el: HTMLElement, p: PillsProps | null) => render(p ? <EventPills {...p} /> : null, el);
export const drawKindSheet = (el: HTMLElement, p: KindSheetProps) => render(<KindSheet {...p} />, el);
export const drawSortSheet = (el: HTMLElement, p: SortSheetProps) => render(<SortSheet {...p} />, el);
