#!/usr/bin/env node
// A read-only look at Skelly's database (Neon), for questions like "is anything storing organizer
// profile pictures?". Runs in one read-only transaction and prints counts, table and column names,
// and which keys events carry; never row contents beyond source names and picture paths.
//   DATABASE_URL=… node scripts/db-report.mjs
import { connect } from '../lib/db.js';

const url = process.env.DATABASE_URL;
if (!url) { console.log('DATABASE_URL is not set; nothing to read.'); process.exit(0); }
const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
void connect; // same driver settings as lib/db.js
const out = [];
const md = (rows) => {
  if (!rows.length) return '_none_\n';
  const keys = Object.keys(rows[0]);
  return `| ${keys.join(' | ')} |\n|${keys.map(() => '---').join('|')}|\n${rows.map((r) => `| ${keys.map((k) => String(r[k] ?? '').replace(/\|/g, '/')).join(' | ')} |`).join('\n')}\n`;
};
try {
  await sql.begin('read only', async (tx) => {
    out.push('## Tables', md(await tx`select table_name as table, (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(table_name), false, true, '')))[1]::text as rows from information_schema.tables where table_schema = 'public' order by 1`));
    out.push('## Columns that could hold pictures', md(await tx`select table_name as table, column_name as column, data_type as type from information_schema.columns where table_schema = 'public' and column_name ~* '(avatar|picture|profile|image|photo|pic)' order by 1, 2`));
    out.push('## Events by source kind', md(await tx`
      select case when source ilike '%instagram%' or source_url ilike '%instagram.com%' then 'Instagram' else coalesce(source, '?') end as source,
             count(*) as events,
             count(*) filter (where data ? 'avatar') as with_avatar_key,
             count(*) filter (where data ? 'account') as with_account_key,
             count(*) filter (where removed_at is null) as live,
             max(updated_at)::text as last_updated
        from events group by 1 order by 2 desc`));
    out.push('## Keys on Instagram events (data jsonb)', md(await tx`
      select k as key, count(*) as events from events, jsonb_object_keys(data) k
       where source ilike '%instagram%' or source_url ilike '%instagram.com%' group by 1 order by 2 desc`));
    out.push('## Keys on Instagram events (attributes jsonb)', md(await tx`
      select k as key, count(*) as events from events, jsonb_object_keys(coalesce(attributes, '{}'::jsonb)) k
       where jsonb_typeof(attributes) = 'object' and (source ilike '%instagram%' or source_url ilike '%instagram.com%') group by 1 order by 2 desc`));
    out.push('## Picture values seen (first 10)', md(await tx`
      select source, coalesce(data->>'avatar', attributes->>'avatar', data->>'image', attributes->>'image') as picture, updated_at::text as updated
        from events where coalesce(data->>'avatar', attributes->>'avatar', data->>'image', attributes->>'image') is not null
       order by updated_at desc limit 10`));
  });
} catch (e) {
  out.push(`Query failed: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]')}`);
}
await sql.end({ timeout: 5 });
const text = out.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Database report\n\n${text}\n`);
