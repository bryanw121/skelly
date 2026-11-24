// Recordings ("cassettes") of real source answers, replayed in tests (docs/testing.md).
//
// A cassette is a folder under test/cassettes/<name>/ with a cassette.json:
//   { "recordedAt": "2026-11-24T01:07:00Z", "requests": [
//       { "method": "GET", "url": "https://…", "status": 200, "contentType": "text/html", "body": "page.html" } ] }
// (a POST also has "bodyHash", the hash of what it sent).
// and each response body in its own file, so a change to a page reads as a diff. `body` is a path
// relative to the cassette folder (the first recordings point at the older test/fixtures files).
//
// replay(names) gives a fetch that answers from the recordings and throws UnrecordedRequest for
// anything else, so a test can't quietly depend on the network (the kill switch blocks it anyway).
// record(name, { fetch }) wraps a real fetch and writes what it returns: only the scheduled canary
// uses it (scripts/canary.mjs), never a test.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CASSETTES = join(dirname(fileURLToPath(import.meta.url)), '..', 'cassettes');

export class UnrecordedRequest extends Error {
  constructor(method, url, names) {
    super(`No recording for ${method} ${url} in cassette(s) ${names.join(', ')}. Record it (scripts/canary.mjs --record ${names[0]}) or add it to the cassette.`);
    this.name = 'UnrecordedRequest';
    this.url = url;
  }
}

/** A request body's short hash (POSTs to one URL with different bodies, such as Overpass's per-city queries, are different requests). */
export const bodyHash = (body) => (body == null || body === '' ? '' : createHash('sha256').update(String(body)).digest('hex').slice(0, 16));

/** The request's URL with the listed query parameters dropped (values that change every run, such as today's date), plus its body's hash. */
export function requestKey(method, url, ignoreParams = [], body = null) {
  const u = new URL(url);
  for (const p of ignoreParams) u.searchParams.delete(p);
  u.searchParams.sort();
  const h = bodyHash(body);
  return `${(method || 'GET').toUpperCase()} ${u.href}${h ? ` #${h}` : ''}`;
}

/** A cassette's requests with their bodies read in. */
export function loadCassette(name, { dir = CASSETTES } = {}) {
  const folder = join(dir, name);
  const file = join(folder, 'cassette.json');
  if (!existsSync(file)) throw new Error(`No cassette "${name}" (${relative(process.cwd(), file)})`);
  const c = JSON.parse(readFileSync(file, 'utf8'));
  return {
    name, recordedAt: c.recordedAt, meta: c.meta ?? null, ignoreParams: c.ignoreParams ?? [],
    requests: c.requests.map((r) => ({ ...r, method: (r.method || 'GET').toUpperCase(), text: readFileSync(join(folder, r.body), 'utf8') })),
  };
}

const response = (r) => {
  const headers = new Headers({ 'content-type': r.contentType || 'text/plain' });
  return {
    ok: r.status >= 200 && r.status < 300, status: r.status, statusText: String(r.status), url: r.url, headers, redirected: false,
    text: async () => r.text,
    json: async () => JSON.parse(r.text),
    arrayBuffer: async () => new TextEncoder().encode(r.text).buffer,
    clone() { return response(r); },
  };
};

/**
 * A fetch that answers from the named cassettes. Requests are matched on method and URL (minus
 * each cassette's ignoreParams); a request seen several times gets the same answer. `calls` lists
 * what was asked, so a test can check an adapter made the requests it should.
 */
export function replay(names, { dir = CASSETTES } = {}) {
  const list = (Array.isArray(names) ? names : [names]).map((n) => loadCassette(n, { dir }));
  const byKey = new Map();
  for (const c of list) for (const r of c.requests) byKey.set(requestKey(r.method, r.url, c.ignoreParams) + (r.bodyHash ? ` #${r.bodyHash}` : ''), r);
  const ignore = [...new Set(list.flatMap((c) => c.ignoreParams))];
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = (init.method || input.method || 'GET').toUpperCase();
    calls.push({ method, url });
    const hit = byKey.get(requestKey(method, url, ignore, init.body));
    if (!hit) throw new UnrecordedRequest(method, url, list.map((c) => c.name));
    return response(hit);
  };
  return Object.assign(fetch, { calls, recordedAt: list.map((c) => c.recordedAt).sort().at(-1), meta: list[0].meta });
}

const extOf = (type) => (/json/.test(type) ? 'json' : /html/.test(type) ? 'html' : /calendar/.test(type) ? 'ics' : /xml/.test(type) ? 'xml' : 'txt');

/**
 * A fetch that passes each request to `fetch` and saves the answer into cassette `name` (the canary).
 * `sanitize(text, url)` cleans each body before it's written (personal data out). Call save(meta) at the end;
 * `meta` (what the canary recorded: unit, clock, result count) is kept in cassette.json.
 */
export function record(name, { fetch: real, dir = CASSETTES, sanitize = (t) => t, now = () => new Date(), ignoreParams = [] } = {}) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = (init.method || 'GET').toUpperCase();
    const res = await real(input, init);
    const text = await res.text();
    const contentType = res.headers?.get?.('content-type') || 'text/plain';
    requests.push({ method, url, status: res.status, contentType, text: sanitize(text, url), bodyHash: bodyHash(init.body) });
    // The caller gets the live answer's own headers and final URL (Skedda reads its cookies and
    // where it was redirected); only the body and its type are saved.
    return { ...response({ status: res.status, url: res.url || url, contentType, text }), headers: res.headers ?? new Headers({ 'content-type': contentType }) };
  };
  const save = (meta = null) => {
    const folder = join(dir, name);
    mkdirSync(folder, { recursive: true });
    const out = requests.map((r) => {
      const body = `${createHash('sha256').update(requestKey(r.method, r.url, ignoreParams) + r.bodyHash).digest('hex').slice(0, 12)}.${extOf(r.contentType)}`;
      writeFileSync(join(folder, body), r.text);
      return { method: r.method, url: r.url, ...(r.bodyHash ? { bodyHash: r.bodyHash } : {}), status: r.status, contentType: r.contentType.split(';')[0], body };
    });
    writeFileSync(join(folder, 'cassette.json'), `${JSON.stringify({ recordedAt: now().toISOString(), ...(meta ? { meta } : {}), ...(ignoreParams.length ? { ignoreParams } : {}), requests: out }, null, 1)}\n`);
    return out.length;
  };
  return Object.assign(fetch, { requests, save });
}
