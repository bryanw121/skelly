// The Leagues and Tournaments tabs (#programs), drawn live by Preact: sections (Closing this week,
// Open, a month, Elsewhere in Texas…) of program cards, and the loading, error and empty states.
// app.js decides what each card says (a ProgramView); the program feed is described in app.js.
import { render } from 'preact';

export type ProgramView = {
  key: string;
  dim: boolean; // closed or full
  kind: string; // "League · Sand · NAGVA"
  badge: string; // "5 days left", or ''
  title: string;
  org: string; // "ACES · Volleyworld · Round Rock"
  whenHtml: string; // escaped HTML, or '' when no dates
  priceHtml: string; // escaped HTML
  deadline: string;
  hot: boolean;
  signup: { url: string; label: string; aria: string } | null;
  detailsHtml: string; // the inside of Details, escaped HTML
};
export type ProgramSection = { title: string; cls: string; cards: ProgramView[] };
export type ProgramsProps =
  | { status: 'loading'; noun: string }
  | { status: 'error'; noun: string; message: string }
  | { status: 'list'; sections: ProgramSection[]; empty: { lead: string; text: string } | null };

function ProgramCard({ p }: { p: ProgramView }) {
  return (
    <article class={`prog${p.dim ? ' dim' : ''}`}>
      <div class="p-top"><span class="p-kind">{p.kind}</span>{p.badge ? <span class="p-badge">{p.badge}</span> : null}</div>
      <h3 class="p-title">{p.title}</h3>
      <p class="p-org">{p.org}</p>
      {p.whenHtml ? <p class="p-when" dangerouslySetInnerHTML={{ __html: p.whenHtml }} /> : null}
      <div class="p-foot"><span class="p-price" dangerouslySetInnerHTML={{ __html: p.priceHtml }} /><span class={`p-dl${p.hot ? ' hot' : ''}`}>{p.deadline}</span></div>
      {p.signup ? <div class="actions"><a class="signup" href={p.signup.url} target="_blank" rel="noopener" aria-label={p.signup.aria}>{p.signup.label} ↗</a></div> : null}
      <details class="more" dangerouslySetInnerHTML={{ __html: `<summary>Details</summary>${p.detailsHtml}` }} />
    </article>
  );
}

export function ProgramsList(p: ProgramsProps) {
  if (p.status === 'loading') return <p class="loading">Loading {p.noun}…</p>;
  if (p.status === 'error') return <div class="error">Couldn't load {p.noun}: {p.message}</div>;
  if (p.empty) return <div class="empty"><b>{p.empty.lead}</b> {p.empty.text}</div>;
  return (
    <>
      {p.sections.filter((s) => s.cards.length).map((s) => (
        <>
          <h2 class={`p-group ${s.cls}`}>{s.title}<span class="n">{s.cards.length}</span></h2>
          {s.cards.map((c) => <ProgramCard key={c.key} p={c} />)}
        </>
      ))}
    </>
  );
}

export const drawPrograms = (el: HTMLElement, p: ProgramsProps) => render(<ProgramsList {...p} />, el);
