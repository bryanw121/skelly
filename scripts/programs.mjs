#!/usr/bin/env node
// Build public/data/programs.json: leagues and tournaments open for sign-up (runProgramsJob in
// lib/programs-job.js, over lib/programs/feed.js).
//
//   node scripts/programs.mjs            build now
//   node scripts/programs.mjs --if-due   build only if the last build is 11+ hours old (the
//                                        scrape workflow runs this every tick; it builds twice a day)
//   node scripts/programs.mjs --dry      print a summary, write nothing
//   node scripts/programs.mjs --now      build now (the same as no flag)
import { runProgramsJob } from '../lib/programs-job.js';

const args = new Set(process.argv.slice(2));
await runProgramsJob({ ifDue: args.has('--if-due'), dry: args.has('--dry') });
