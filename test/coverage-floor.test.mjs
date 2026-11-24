import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../scripts/coverage-floor.mjs';

test('coverage floor: a drop fails, a big rise asks for the floor to be raised, small moves pass', () => {
  const floor = { lines: 86, branches: 82, functions: 89 };
  assert.deepEqual(judge({ lines: 86.2, branches: 82, functions: 89.4 }, floor).problems, []);
  assert.match(judge({ lines: 85.9, branches: 82, functions: 89 }, floor).problems[0], /lines coverage fell to 85.9%/);
  assert.match(judge({ lines: 87, branches: 82, functions: 89 }, floor).problems[0], /set "lines" to 87/);
});
