# Skelly: notes for anyone changing the code (people and AI agents)

## The site is moving to Preact, a piece at a time (issue #191)
- New UI goes in `web/components/` as Preact components in TypeScript (`.tsx`), typed by `web/types.ts`.
- `web/app.js` is the old code (state, data loading, URL, taps, a few hand-built pieces). **It only shrinks.**
  - Don't add to it. If a change needs new logic there, put it in a component or a hook instead.
  - **If your change touches a part of `app.js` listed in issue #191, move that part out in the same PR** and tick it on the issue.
  - `test/app-js-budget.test.mjs` (CI, every PR) fails if `app.js` grows past `web/app-js-budget.json`, and fails if it shrank and the budget wasn't lowered to match. Lower the numbers in that file; never raise them.
- Before opening a PR: `npm test`, `npm run typecheck`, `npm run test:e2e` (builds the site, then the browser tests).

## Other rules that already apply
- Keep the list view and the map view consistent: a feature on one belongs on the other.
- Mobile first: touch targets 44px+, inputs 16px+, works at 320px wide.
- Public repo: no secrets in files (GitHub Actions or Vercel secrets only).
- Skelly stays independent of vteam: it never writes to vteam and has no credentials for it.
