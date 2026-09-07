import test from 'node:test';
import assert from 'node:assert/strict';
import { deliberate, COUNCIL } from './council.mjs';
const branch = id => ({ id, title: id, cost: 'Time', trackIds: [], evidence: ['world:test:3'], priorities: Object.fromEntries(COUNCIL.map(r => [r.id, 1])) });
test('five equal assessments aggregate exactly and rotation applies only to genuine ties', () => {
  const branches = [branch('a'), branch('b')], packet = { tracks: [] };
  const first = deliberate(packet, branches, 1), second = deliberate(packet, branches, 2);
  assert.equal(first.members.length, 5); assert.ok(first.members.every(m => m.weight === 1));
  assert.deepEqual(first.totals.map(t => t.score), [50, 50]);
  assert.equal(first.leadingId, 'a'); assert.equal(second.leadingId, 'b');
  branches[0].priorities.aster = 2;
  const noTie = deliberate(packet, branches, 2);
  assert.deepEqual(noTie.totals.map(t => t.score), [60, 50]); assert.equal(noTie.leadingId, 'a'); assert.equal(noTie.tieBreak, 'none');
});
test('public location pressure affects the matching mandate without changing vote weight', () => {
  const branches = [branch('a'), branch('b')]; branches[0].trackIds = ['crossing'];
  const result = deliberate({ tracks: [{ id: 'crossing', kind: 'location', value: 0 }] }, branches, 1);
  assert.deepEqual(result.totals.map(t => t.score), [55, 50]);
  assert.equal(result.members.find(m => m.id === 'aster').assessments[0].score, 15);
  assert.equal(result.members.find(m => m.id === 'mira').assessments[0].score, 10);
});
