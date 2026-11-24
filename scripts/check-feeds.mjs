// Before a scrape publishes (scrape.yml), check the feeds it wrote can be read (lib/feed-check.js).
// Prints the problems and exits 1, so the data branch keeps the last good copy; also writes
// scrape-failures/feeds.md for the workflow's issue step (empty when the feeds are fine).
//
//   node scripts/check-feeds.mjs [data dir]     (default public/data)
import { mkdirSync, writeFileSync } from 'node:fs';
import { repoPath } from '../lib/paths.js';
import { checkFeeds } from '../lib/feed-check.js';

const dir = process.argv[2] ?? repoPath('public/data');
const errors = checkFeeds(dir);
mkdirSync(repoPath('scrape-failures'), { recursive: true });
writeFileSync(repoPath('scrape-failures/feeds.md'), errors.length
  ? `This refresh wrote feeds the site couldn't read, so they weren't published (the last good copy is still live):\n\n${errors.map((e) => `- ${e}`).join('\n')}\n`
  : '');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Feeds check out.');
