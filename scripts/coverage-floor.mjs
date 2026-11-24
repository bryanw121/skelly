#!/usr/bin/env node
// After `c8 node --test` (npm run coverage): compares the totals in coverage/coverage-summary.json
// with test/coverage-floor.json. Fails when a number drops below its floor, and when it rises more
// than RAISE points above it, asking for the floor to be raised, so the file records the progress
// and coverage can only go up. Prints a table for the run summary.
import { readFileSync, appendFileSync } from 'node:fs';
import { repoPath } from '../lib/paths.js';

export const RAISE = 0.5;
export function judge(totals, floor, raise = RAISE) {
  const rows = [], problems = [];
  for (const k of ['lines', 'branches', 'functions']) {
    const now = totals[k], min = floor[k];
    rows.push({ k, now, min });
    if (now < min) problems.push(`${k} coverage fell to ${now}% (floor ${min}%). Add tests for what changed.`);
    else if (now > min + raise) problems.push(`${k} coverage rose to ${now}%: set "${k}" to ${now} in test/coverage-floor.json.`);
  }
  return { rows, problems };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('coverage-floor.mjs')) {
  const summary = JSON.parse(readFileSync(repoPath('coverage/coverage-summary.json'), 'utf8')).total;
  const floor = JSON.parse(readFileSync(repoPath('test/coverage-floor.json'), 'utf8'));
  const { rows, problems } = judge({ lines: summary.lines.pct, branches: summary.branches.pct, functions: summary.functions.pct }, floor);
  const table = ['| Coverage | Now | Floor |', '| --- | --- | --- |', ...rows.map((r) => `| ${r.k} | ${r.now}% | ${r.min}% |`)].join('\n');
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Coverage (lib, api, scripts)\n\n${table}\n`);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
}
