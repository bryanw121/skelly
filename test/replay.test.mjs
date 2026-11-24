// Tier 1 of docs/testing.md: every reader, replayed against the canary's latest recording of the
// real source (test/cassettes/<kind>/<source>/), with the clock set to when it was recorded.
// The reader must make only requests that were recorded, and find what it found live.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { canaryUnits } from '../lib/canary-units.js';
import { cassetteName, resultCount } from '../lib/canary.js';
import { CASSETTES, replay } from './support/cassette.mjs';

const { units } = canaryUnits();
const recorded = units.filter((u) => existsSync(join(CASSETTES, cassetteName(u.id), 'cassette.json')));

for (const unit of recorded) {
  test(`replay ${unit.id}`, async () => {
    const fetch = replay(cassetteName(unit.id));
    const now = new Date(fetch.meta.now);
    mock.timers.enable({ apis: ['Date'], now });
    try {
      const result = await unit.run({ fetch, now });
      assert.equal(resultCount(result), fetch.meta.count, `${unit.id} found ${resultCount(result)}, live it found ${fetch.meta.count}`);
    } finally {
      mock.timers.reset();
    }
  });
}

// Sources the canary can't record today, and why. Keep this short: each is a source that's down.
const CANT_RECORD = {
  'schedule:georgetown-pickleball': "the city's certificate doesn't match its host from GitHub's runners (#53)",
  // The cleaned copy of these pages loses about two thirds of their events; being looked into.
  'events:allevents-austin': 'cleaning loses events', 'events:allevents-dallas': 'cleaning loses events', 'events:allevents-houston': 'cleaning loses events',
};

test('every reader has a recording', () => {
  const missing = units.filter((u) => !recorded.includes(u) && !CANT_RECORD[u.id]).map((u) => u.id);
  assert.deepEqual(missing, [], `No recording yet for ${missing.join(', ')}: run the Canary workflow with only=${missing.join(',')}`);
});
