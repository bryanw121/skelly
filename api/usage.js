// POST /api/usage { key, days } -> the owner's usage totals (lib/usage-stats.js), for public/usage.html.
// The lock is STATS_KEY, a Vercel secret only the owner knows (12+ characters); without it set the
// answer is always 404, so the page simply doesn't exist. A wrong key gets 401 after a short wait,
// and too many wrong keys from one address in 15 minutes get 429. The key travels in the body,
// never the URL, so it stays out of logs. Reads with DATABASE_URL_READONLY.
import { lazyDb, redact } from '../lib/db.js';
import { keyMatches, spanOf, usageStats } from '../lib/usage-stats.js';

const MAX_WRONG = 10, WINDOW = 15 * 60e3;
const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 4000) throw new Error('too long'); }
  return JSON.parse(raw || '{}');
};

export function createHandler({ db, key = process.env.STATS_KEY, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.warn } = {}) {
  const getDb = lazyDb(db);
  let wrong = new Map(); // address -> times of wrong keys (per running instance)
  return async function handler(req, res) {
    const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-robots-tag', 'noindex'); res.end(JSON.stringify(body)); };
    if (!key || key.length < 12) return send(404, { error: 'not-found' });
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(405, { error: 'POST only' }); }
    const t = now(), from = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const recent = (wrong.get(from) ?? []).filter((x) => t - x < WINDOW);
    if (recent.length >= MAX_WRONG) return send(429, { error: 'too-many' });
    let body;
    try { body = await readBody(req); } catch { return send(400, { error: 'bad-request' }); }
    if (!keyMatches(body?.key, key)) {
      recent.push(t); wrong.set(from, recent);
      if (wrong.size > 1000) wrong = new Map([[from, recent]]);
      await wait(400);
      return send(401, { error: 'wrong-key' });
    }
    try {
      const conn = await getDb();
      if (!conn) return send(503, { error: 'no-database' });
      return send(200, await usageStats(conn, spanOf(body.days)));
    } catch (e) {
      log(`api/usage: ${redact(e.message)}`);
      return send(502, { error: 'unavailable' });
    }
  };
}

export default createHandler();
