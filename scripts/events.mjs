#!/usr/bin/env node
// Build the Events tab's listing-site events into public/data/events.json (runEventsJob in
// lib/events-job.js), merged with whatever else the feed carries. Coordinates for venues without
// them come after, from scripts/geocode-events.mjs.
//
//   node scripts/events.mjs            build now
//   node scripts/events.mjs --if-due   build only if the last build is 5+ hours old (the scrape
//                                      workflow runs this every tick)
//   node scripts/events.mjs --dry      print what it found, write nothing
//   node scripts/events.mjs --now      build now (the same as no flag; the workflow passes it on a code push)
import { runEventsJob } from '../lib/events-job.js';

const args = new Set(process.argv.slice(2));
await runEventsJob({ ifDue: args.has('--if-due'), dry: args.has('--dry') });
