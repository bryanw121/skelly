// The Sports tab's day list (#list): open play and other sessions on the picked day, drawn live by
// Preact. app.js decides what each row says (a SessionView: times, status, chips, sign-up) and keeps
// handling taps through the data-* attributes (data-cal, data-di, data-view). Rows are keyed by
// session, so a redraw keeps an open Details or "ended earlier today".
import { render } from 'preact';

export type Signup =
  | { kind: 'link'; url: string; label: string } // a sign-up page
  | { kind: 'dropin'; label: string; url?: string } // just show up (with a details link when there is one)
  | { kind: 'none' };

export type SessionView = {
  key: string;
  dim: boolean; // expired, unconfirmed or canceled
  unsure: boolean; // its source couldn't be re-read
  past: boolean; // ended earlier today
  start: string; // "7pm"
  end: string; // "to 9pm" or ''
  title: string;
  titleHtml: string; // the title with the search words marked (escaped HTML)
  pill: { cls: string; label: string };
  venue: string;
  where: string; // " · Austin · 2.3 mi"
  surface: { label: string; color: string };
  chips: string[]; // type or surface
  extras: string[]; // rink, level, "· $10"
  capacity: { cls: string; text: string; title: string } | null;
  recheck: { last: string; source: string | null } | null;
  moved: string | null;
  fit: string;
  signup: Signup;
  calKey: string | null;
  calTitle: string;
  detailsHtml: string; // the inside of Details (location, note, source links), escaped HTML
};

export type SessionsListProps =
  | { status: 'error'; message: string }
  | {
    status: 'list';
    headsUp: { to: string; lead: string; text: string } | null;
    earlier: SessionView[];
    earlierOpen: boolean;
    now: string | null; // "Now · 7:05pm" on today, when more is coming
    nothingElse: boolean; // today, everything has ended
    rest: SessionView[];
    empty: { lead: string; hidden: string; hint: string } | null;
    hiddenNote: string; // "2 ended, canceled or unconfirmed sessions hidden."
  };

function SignupLinks({ s }: { s: Signup }) {
  if (s.kind === 'link') return <a class="signup" href={s.url} target="_blank" rel="noopener">{s.label} ↗</a>;
  if (s.kind === 'dropin') return <><span class="dropin">{s.label}</span>{s.url ? <a class="src" href={s.url} target="_blank" rel="noopener">Details ↗</a> : null}</>;
  return null;
}

export function SessionCard({ x }: { x: SessionView }) {
  return (
    <div class={`row ${x.dim ? 'dim' : ''} ${x.unsure ? 'unsure' : ''} ${x.past ? 'past' : ''}`}>
      <div class="time">{x.start}<small>{x.end}</small></div>
      <div class="body">
        <div class="t1"><span class="title" dangerouslySetInnerHTML={{ __html: x.titleHtml }} /><span class={`pill ${x.pill.cls}`}>{x.pill.label}</span></div>
        <div class="venue"><b>{x.venue}</b>{x.where}</div>
        <div class="meta">
          <span class="chip surf" style={`--c:${x.surface.color}`}>{x.surface.label}</span>
          {x.chips.map((c) => <span class="chip">{c}</span>)}
          {x.extras.map((t) => <span>{t}</span>)}
          {x.capacity ? <span class={x.capacity.cls} title={x.capacity.title}>{x.capacity.text}</span> : null}
        </div>
        {x.recheck ? <div class="recheck-note">Its source couldn't be read just now. Last confirmed {x.recheck.last}.{x.recheck.source ? <> <a class="src" href={x.recheck.source} target="_blank" rel="noopener">Check the source ↗</a></> : null}</div> : null}
        {x.moved ? <div class="moved">Moved from {x.moved}</div> : null}
        {x.fit ? <div class="fit">{x.fit}</div> : null}
        <div class="actions">
          <SignupLinks s={x.signup} />
          {x.calKey ? <button type="button" class="cal-add" data-cal={x.calKey} aria-haspopup="dialog" aria-label={`Add ${x.calTitle} to your calendar`}><span aria-hidden="true">＋</span> Calendar</button> : null}
        </div>
        <details class="more" dangerouslySetInnerHTML={{ __html: `<summary>Details</summary>${x.detailsHtml}` }} />
      </div>
    </div>
  );
}

export function SessionsList(p: SessionsListProps) {
  if (p.status === 'error') return <div class="error">Couldn't load schedules: {p.message}</div>;
  if (p.empty) {
    return <>{p.headsUp ? <HeadsUp {...p.headsUp} /> : null}<div class="empty"><b>{p.empty.lead}</b> {p.empty.hidden}{p.empty.hint}</div></>;
  }
  return (
    <>
      {p.headsUp ? <HeadsUp {...p.headsUp} /> : null}
      {p.earlier.length ? (
        <details class="earlier" open={p.earlierOpen}>
          <summary>{p.earlier.length} ended earlier today</summary>
          {p.earlier.map((x) => <SessionCard key={x.key} x={x} />)}
        </details>
      ) : null}
      {p.now ? <div class="now">{p.now}</div> : null}
      {p.nothingElse ? <div class="empty"><b>Nothing else today.</b> <button type="button" class="linkish" data-di="1">See tomorrow</button></div> : null}
      {p.rest.map((x) => <SessionCard key={x.key} x={x} />)}
      {p.hiddenNote ? <div class="empty">{p.hiddenNote}</div> : null}
    </>
  );
}

function HeadsUp({ to, lead, text }: { to: string; lead: string; text: string }) {
  return <button type="button" class="heads-up" data-view={to}><b>{lead}</b> {text}<span aria-hidden="true">›</span></button>;
}

export const drawSessionsList = (el: HTMLElement, p: SessionsListProps) => render(<SessionsList {...p} />, el);
