# Testing Skelly

Design and reasoning: the "Skelly integration tests: design" doc. In short, three tiers, and only the
third ever reaches a source:

| Tier | When | Requests to sources |
| --- | --- | --- |
| 1. Replay | every PR and push (`npm test`, `npm run coverage`, `npm run test:e2e`) | none: a request without a recording fails |
| 2. Production check | after every real scrape (scrape.yml) | none extra: it reads what the scrape published |
| 3. Live canary | weekly, a few sources a day (canary.yml), capped | about one per source page |

## The rules
- **Tests never reach the internet.** `npm test` loads `test/support/no-network.mjs`, which makes any
  request to a host other than this machine throw. Don't work around it.
- **Use recordings for real pages.** `replay('<cassette>')` from `test/support/cassette.mjs` gives a
  `fetch` that answers from `test/cassettes/<cassette>/`. Every job and adapter takes a `fetch` (or
  `get`) option; pass it. A request with no recording fails with the URL to record.
- **Set the clock to the recording's date** (`fetch.recordedAt`) so "next Tuesday" on a page is the
  same day on every run.
- **Recordings are made only by the canary** (`scripts/canary.mjs`, Tier 3), which respects
  robots.txt, queues requests per host, stays inside its weekly budget and removes personal data.
- **Coverage only goes up.** On Linux CI, `npm run coverage` runs the unit tests under c8 (every file
  in `lib/`, `api/` and `scripts/` counts, tested or not) and compares with `test/coverage-floor.json`.

## Cassette format
`test/cassettes/<name>/cassette.json`:
```json
{ "recordedAt": "2026-11-24T01:07:00Z", "meta": { "unit": "schedule:reclub", "now": "…", "count": 41 },
  "requests": [{ "method": "GET", "url": "https://…", "status": 200, "contentType": "text/html", "body": "3f2a….html" },
               { "method": "POST", "url": "https://overpass…", "bodyHash": "…", "status": 200, "contentType": "application/json", "body": "…" }] }
```
Each body is its own file next to it (a page change reads as a diff). A request is matched on
method, URL and (for a POST) a hash of what it sent. `ignoreParams` (optional) are query
parameters left out of the match; replaying with the clock at `meta.now` usually makes them unneeded.

## The canary (Tier 3)
Every reader is a **unit** (`lib/canary-units.js`): `schedule:<source>`, `programs:<source>`,
`events:<source>` and `markets`. The same unit code records (canary) and replays (tests).
- `node scripts/canary.mjs --list` shows each unit's weekday. The units sorted by id are dealt over
  the week, so each is recorded once a week and a day is about six units.
- Per run: at most `CANARY_RUN_BUDGET` requests (150; 600 for `--all`), `CANARY_UNIT_BUDGET` per
  unit (60), robots.txt read once per site and obeyed, 2 s between two requests to one host.
- A recording replaces the old one only if the cleaned copy replays to the same count as the live
  read. Bodies are cleaned by `sanitizeFor` in `lib/canary.js` (Reclub people, Arketa clients,
  Sweatpals accounts, emails and phone numbers).
- `canary.yml` runs daily and by hand (`only`, `all`), runs the tests on the new recordings, then
  opens and merges a pull request with them. Paused sources keep their last recording; browser
  sources (atxbeach) are recorded as HAR files in a later step.
