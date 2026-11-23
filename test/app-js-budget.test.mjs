// web/app.js only shrinks. The site is moving from app.js (state, data loading, URL, taps and a few
// hand-built pieces of HTML) into Preact components in web/components, a piece at a time: any change
// that touches a part of app.js moves that part (see CLAUDE.md). This fails when app.js grows past
// web/app-js-budget.json, and when it has shrunk but the budget wasn't lowered to match, so the
// budget always records how far the move has come.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const budget = JSON.parse(readFileSync(new URL('../web/app-js-budget.json', import.meta.url), 'utf8'));
export const measure = (text) => ({
  lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
  innerHTML: (text.match(/\.innerHTML\s*=/g) ?? []).length,
  addEventListener: (text.match(/addEventListener\(/g) ?? []).length,
  functions: (text.match(/^(async )?function /gm) ?? []).length,
});

test('web/app.js does not grow: new UI and logic go in web/components (see CLAUDE.md)', () => {
  const now = measure(src);
  for (const k of ['lines', 'innerHTML', 'addEventListener', 'functions']) {
    assert.ok(now[k] <= budget[k], `web/app.js has ${now[k]} ${k}, over its budget of ${budget[k]}. Put new code in a component (web/components) instead, and move what you touched out of app.js.`);
  }
});

test('web/app-js-budget.json is lowered when app.js shrinks, so it records the progress', () => {
  const now = measure(src);
  for (const k of ['lines', 'innerHTML', 'addEventListener', 'functions']) {
    assert.equal(budget[k], now[k], `web/app.js now has ${now[k]} ${k}: set "${k}" to ${now[k]} in web/app-js-budget.json.`);
  }
});
