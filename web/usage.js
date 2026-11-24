// Anonymous usage events for Skelly's own stats (api/hit.js, lib/usage.js). No names, no cookies:
// a random id in this browser's storage counts a person once, and a session id changes after 30
// minutes away. Events are queued and sent about every 20 seconds, and when the page is hidden.
// Off where /api/hit doesn't exist (GitHub Pages, local files) and in automated browsers (tests)
// unless localStorage 'skelly.usage' is 'on'. The owner's own devices (skelly.owner set by the
// Usage page) aren't counted.
const HOSTS = /(^|\.)skellyevents\.com$|^schelagg\.vercel\.app$/;
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const get = (k) => { try { return store?.getItem(k); } catch { return null; } };
const set = (k, v) => { try { store?.setItem(k, v); } catch {} };
const rid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 24);

const on = get('skelly.usage') === 'on' || (HOSTS.test(location.hostname) && !navigator.webdriver && get('skelly.usage') !== 'off' && !get('skelly.owner'));
let device = get('skelly.device');
if (on && !device) { device = rid(); set('skelly.device', device); }
let session = null;
function sessionId() {
  const now = Date.now(), last = Number(get('skelly.seen')) || 0;
  if (!session) session = (now - last < 30 * 60e3 && get('skelly.session')) || rid();
  else if (now - last >= 30 * 60e3) session = rid();
  set('skelly.session', session); set('skelly.seen', String(now));
  return session;
}

let queue = [];
/** Record one event: `name` from lib/usage.js USAGE_EVENTS, `props` flat strings or numbers. */
export function track(name, props = {}) {
  if (!on) return;
  queue.push({ n: name, p: props });
  if (queue.length >= 30) flush();
}
function flush(useBeacon = false) {
  if (!on || !queue.length) return;
  const body = JSON.stringify({ d: device, s: sessionId(), e: queue.splice(0, 40) });
  try {
    if (useBeacon && navigator.sendBeacon) navigator.sendBeacon('/api/hit', new Blob([body], { type: 'application/json' }));
    else fetch('/api/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {}
}
if (on) {
  setInterval(() => flush(), 20e3);
  if (get('skelly.usage') === 'on') window.__skellyFlush = () => flush(); // tests send the queue at once
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
}
/** "Still here", once a minute while the page is in front: how many people are online now. */
export function startPings(props) {
  if (!on) return;
  setInterval(() => { if (document.visibilityState === 'visible') track('ping', props()); }, 60e3);
}
