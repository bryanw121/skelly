#!/usr/bin/env node
// Would these Instagram accounts work as event sources? Reads each one once through Business
// Discovery (lib/instagram.js) and prints whether it answered and how many of its recent posts
// became events. Writes nothing. The "Try Instagram accounts" workflow runs it with the token.
//   node scripts/try-instagram.mjs <handle> [<handle> ...]     (at most 40)
import { appendFileSync, readFileSync } from 'node:fs';
import { get } from '../lib/http.js';
import { repoPath } from '../lib/paths.js';
import { today as todayIn } from '../lib/time.js';
import { readInstagram, tryAccountsTable } from '../lib/instagram.js';

const handles = [...new Set(process.argv.slice(2).flatMap((a) => a.split(/[\s,]+/)).map((h) => h.replace(/^@/, '').toLowerCase()).filter(Boolean))].slice(0, 40);
const cfg = JSON.parse(readFileSync(repoPath('config/instagram.json'), 'utf8'));
const r = await readInstagram({ region: cfg.region, city: cfg.city, accounts: handles.map((handle) => ({ handle })) },
  { get, today: todayIn(new Date()), igUserId: process.env.IG_USER_ID || cfg.igUserId, token: process.env.IG_ACCESS_TOKEN });
const md = tryAccountsTable(handles, r);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Instagram accounts tried\n\n${md}\n`);
