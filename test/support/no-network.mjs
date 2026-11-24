// Loaded before every unit test (npm test: node --test --import ./test/support/no-network.mjs).
// Tests never reach the internet: a request to any host but this machine throws, naming the URL,
// so a forgotten real fetch can't scrape a source on a PR. Tests replay recorded answers instead
// (test/support/cassette.mjs); only the scheduled canary records new ones (docs/testing.md).
import http from 'node:http';
import https from 'node:https';

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;
export class NetworkBlocked extends Error {
  constructor(url) {
    super(`Tests may not reach ${url}. Replay a recording instead (test/support/cassette.mjs).`);
    this.name = 'NetworkBlocked';
  }
}
const hostOf = (input) => {
  try { return new URL(typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input)); } catch { return null; }
};
const allowed = (u) => !u || u.protocol === 'data:' || u.protocol === 'file:' || LOCAL.test(u.hostname);

const realFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  const u = hostOf(input);
  if (!allowed(u)) return Promise.reject(new NetworkBlocked(u.href));
  return realFetch(input, init);
};
for (const mod of [http, https]) {
  for (const name of ['request', 'get']) {
    const real = mod[name];
    mod[name] = function guarded(...args) {
      const a = args[0];
      const u = typeof a === 'string' || a instanceof URL ? hostOf(a) : a && typeof a === 'object' ? hostOf(`${mod === https ? 'https' : 'http'}://${a.hostname ?? a.host ?? 'localhost'}`) : null;
      if (!allowed(u)) throw new NetworkBlocked(u.href);
      return real.apply(this, args);
    };
  }
}
