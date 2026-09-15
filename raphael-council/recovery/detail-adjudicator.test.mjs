import assert from 'node:assert/strict';
import test from 'node:test';
import { adjudicateDetail } from './detail-adjudicator.mjs';

test('ordinary player turns use medium imagery and concise detail', () => {
  const result = adjudicateDetail({ actor: { ability: 14 } });
  assert.deepEqual({ level: result.level, imageSize: result.imageSize }, { level: 'brief', imageSize: 'medium' });
});

test('specific successful urgent inspections receive rich detail and a large image', () => {
  const result = adjudicateDetail({ actor: { ability: 18 }, roll: { total: 18 }, buffs: ['guidance'], storyInitiative: 'urgent', requestedFocus: 'brass seal' });
  assert.equal(result.level, 'rich');
  assert.equal(result.imageSize, 'large');
  assert.ok(result.textBudget > 400);
});

test('failed inspections remain standard instead of inventing extra information', () => {
  const result = adjudicateDetail({ actor: { ability: 18 }, roll: { total: 4 }, requestedFocus: 'wet trail' });
  assert.equal(result.level, 'standard');
  assert.equal(result.imageSize, 'medium');
});
