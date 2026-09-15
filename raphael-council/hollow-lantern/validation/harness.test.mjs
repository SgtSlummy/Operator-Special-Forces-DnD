import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, expectation } from './harness.mjs';
test('controller calculates one-based observations from its private projection', () => {
  const expected = expectation({ characters: [{ characterId: 'a', position: { x: 3, y: 5 } }], map: { width: 25, height: 25, cells: [{ visibility: 'visible' }] } }, 'a');
  assert.deepEqual(expected, { coordinate: { x: 4, y: 6 }, obscured: true });
});
test('incorrect coordinates, guesses and unparsable answers fail rather than becoming passes', () => {
  const before = { coordinate: { x: 4, y: 4 }, obscured: true }, after = { coordinate: { x: 5, y: 4 }, obscured: true };
  assert.equal(evaluate('not JSON', before, after).passed, false);
  assert.equal(evaluate(JSON.stringify({ before: { x: 4, y: 4 }, after: { x: 5, y: 4 }, moved: true, hasObscuredTerrain: true }), before, after).passed, true);
  assert.equal(evaluate(JSON.stringify({ before: null, after: null, moved: true, hasObscuredTerrain: true }), before, after).passed, false);
  assert.equal(evaluate('\n\n```json\n' + JSON.stringify({ before: { x: 4, y: 4 }, after: { x: 5, y: 4 }, moved: true, hasObscuredTerrain: true }) + '\n```', before, after).passed, true);
});
