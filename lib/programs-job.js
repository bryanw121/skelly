// The programs job (scripts/programs.mjs) as a function: read every leagues/tournaments source
// (lib/programs/feed.js), build public/data/programs.json and the failure report. The network comes
// in as `get`, the clock as `now`, the files as paths, so it runs offline on the canary's
// recordings. Returns { feed, skipped } (skipped: why nothing was read).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpGet } from './http.js';
import { repoPath } from './paths.js';
import { loadRegions } from './regions.js';
import { buildFeed, isDue, runSources } from './programs/feed.js';

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

export async function runProgramsJob({
  get = httpGet, now = Date.now(), dataDir = repoPath('public/data'), failuresDir = repoPath('scrape-failures'),
  config = readJson(repoPath('config/programs.json')), regions = loadRegions().map((r) => r.info),
  ifDue = false, dry = false, log = console.log,
} = {}) {
  const OUT = join(dataDir, 'programs.json');
  const previous = readJson(OUT, null);
  if (ifDue && !isDue(previous, now)) {
    log(`programs.json was built at ${previous.generatedAt}; not due yet.`);
    return { feed: null, skipped: 'not due' };
  }
  const results = await runSources(config, { get, now, regions });
  const feed = buildFeed({ results, previous, now, config });
  for (const s of feed.sources) log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.id}: ${s.count} programs${s.error ? ` (${s.error})` : ''}`);
  log(`${feed.programs.length} programs in all.`);
  if (dry) {
    for (const p of feed.programs) log(`  ${p.registration_deadline ?? '—'}  ${p.kind.padEnd(10)} ${p.sport.padEnd(10)} ${p.title} · ${p.org}`);
    return { feed, skipped: 'dry run' };
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(feed, null, 1)}\n`);
  // A failed source goes in the region-independent failure report the workflow turns into an issue.
  const failed = feed.sources.filter((s) => !s.ok);
  mkdirSync(failuresDir, { recursive: true });
  writeFileSync(join(failuresDir, 'programs.md'), failed.length
    ? `Leagues and tournaments (programs.json): ${failed.length} source(s) failed; their last good rows are kept.\n\n${failed.map((s) => `- **${s.id}**: ${s.error}`).join('\n')}\n`
    : '');
  return { feed, skipped: null };
}
