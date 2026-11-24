#!/usr/bin/env node
// Give every event in public/data/events.json coordinates, so the map can pin it (runGeocodeEvents
// in lib/geocode-events-job.js: hand-placed cache first, else the US Census geocoder on the
// venue's street address). The cache is public/data/event-venues.json, keyed by the normalized
// venue string; hand-placed entries there are curated by hand and win. Runs after the events job
// (or by hand), one geocoder request a second.
//
//   node scripts/geocode-events.mjs          fill in what's missing and write the files
//   node scripts/geocode-events.mjs --dry    print what it would set, write nothing
import { runGeocodeEvents } from '../lib/geocode-events-job.js';

await runGeocodeEvents({ dry: process.argv.includes('--dry') });
