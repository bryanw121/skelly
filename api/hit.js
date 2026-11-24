// POST /api/hit { d, s, e: [{ n, p }] } -> 204. The site's anonymous usage events (lib/usage.js),
// sent in small batches. Bots are dropped; nothing about the sender is kept beyond a random device
// id and the approximate city Vercel gives (no IP address). Needs DATABASE_URL_READONLY, whose
// role may insert into usage_events only (db/grants.sql); without it every batch is a quiet 204.
import { lazyDb, redact } from '../lib/db.js';
import { insertUsage, usageRows } from '../lib/usage.js';

const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('too long'); }
  return JSON.parse(raw || '{}');
};

export function createHandler({ db, log = console.warn } = {}) {
  const getDb = lazyDb(db);
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'POST'); return res.end(); }
    let rows = null;
    try { rows = usageRows(await readBody(req), req.headers); } catch {}
    if (rows?.length) {
      try { const conn = await getDb(); if (conn) await insertUsage(conn, rows); }
      catch (e) { log(`api/hit: ${redact(e.message)}`); }
    }
    res.statusCode = 204;
    res.end();
  };
}

export default createHandler();
