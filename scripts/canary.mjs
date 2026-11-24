// The canary (docs/testing.md, tier 3): records real answers for a few readers into
// test/cassettes/, inside a request budget, obeying robots.txt, one request per host at a time
// (runCanary in lib/canary.js). Run only by .github/workflows/canary.yml (daily rotation, or by
// hand); never by a test or a push.
//
//   node scripts/canary.mjs                      today's rotation (each unit has a fixed weekday)
//   node scripts/canary.mjs --all                every unit (the first recording)
//   node scripts/canary.mjs --only schedule:reclub,markets,events:
//   node scripts/canary.mjs --list               the units and their weekdays, no requests
//
// Writes canary-report.md and canary-report.json.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { loadEnv, repoPath } from '../lib/paths.js';
import { CANT_RECORD, canaryUnits } from '../lib/canary-units.js';
import { RUN_BUDGET, UNIT_BUDGET, failureReports, pickUnits, report, rotation, runCanary } from '../lib/canary.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const { units, skipped } = canaryUnits();

if (args.includes('--list')) {
  const days = rotation(units);
  for (const u of units) console.log(`${days.get(u.id)}  ${u.id}`);
  for (const s of skipped) console.log(`-  ${s.id} (${s.why})`);
  process.exit(0);
}

const now = new Date();
const day = now.getUTCDay();
const only = (opt('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const all = args.includes('--all');
const picked = pickUnits(units, { day, only, all });
const { outcomes, budget, refused } = await runCanary(picked, {
  now,
  budget: { max: Number(process.env.CANARY_RUN_BUDGET) || RUN_BUDGET, used: 0 },
  unitMax: Number(process.env.CANARY_UNIT_BUDGET) || UNIT_BUDGET,
  log: console.log,
  failedDir: repoPath('canary-failed'),
});

const md = report(outcomes, { budget, day: only.length || all ? null : day, refused });
writeFileSync(repoPath('canary-report.md'), md);
writeFileSync(repoPath('canary-report.json'), `${JSON.stringify({ at: now.toISOString(), budget, outcomes, refused, skipped }, null, 1)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
// One file per unit this run tried, for the workflow's issue step (empty: it recorded).
const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
mkdirSync(repoPath('canary-failures'), { recursive: true });
for (const [file, text] of Object.entries(failureReports(outcomes, { known: CANT_RECORD, runUrl: run ? `${server}/${repo}/actions/runs/${run}` : '' }))) writeFileSync(repoPath(`canary-failures/${file}`), text);
console.log(`\n${budget.used} requests of ${budget.max}`);
