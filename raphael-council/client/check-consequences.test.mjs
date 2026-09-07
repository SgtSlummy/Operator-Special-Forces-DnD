import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewedSaveRequest, createSaveDraft, savedDamageLines } from './check-consequences.mjs';

const reviewedDraft = overrides => ({
  ...createSaveDraft(), actorId: 'actor-1', label: ' Flame trap ',
  proficiencyReason: ' Reviewed approved saving throw proficiency ',
  mitigationReason: ' Reviewed character defenses for fire; none apply ', reviewed: true, ...overrides,
});
const build = (overrides = {}) => buildReviewedSaveRequest(reviewedDraft(overrides), 14, 'save-intent-1', ['actor-1']);

test('builds the exact host-reviewed single-target save request without client character numbers', () => {
  const result = build({ abilityModifier: 99, proficiencyBonus: 99, targetHp: 999, dc: '15', proficient: true, advantage: ' High ground\n\n Reviewed blessing ', adjustmentSource: ' Reviewed effect ', adjustmentValue: '-2' });
  assert.deepEqual(result, {
    id: 'save-intent-1', reviewed: true, expectedRevision: 14, actorId: 'actor-1', label: 'Flame trap', kind: 'save', ability: 'dexterity',
    proficiencyMultiplier: 1, proficiencyReason: 'Reviewed approved saving throw proficiency',
    advantage: ['High ground', 'Reviewed blessing'], disadvantage: [], adjustments: [{ source: 'Reviewed effect', value: -2 }], dc: 15, cost: 'none',
    consequence: {
      type: 'single_target_damage', dice: { count: 2, sides: 6, bonus: 0 }, damageType: 'fire', onSuccess: 'half',
      mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: 'Reviewed character defenses for fire; none apply' },
    },
  });
});

test('defenses and proficiency default to an unreviewed decision, with no inferred defenses', () => {
  const draft = createSaveDraft();
  assert.equal(draft.reviewed, false);
  assert.equal(draft.proficient, false);
  assert.equal(draft.resistance, false);
  assert.equal(draft.vulnerability, false);
  assert.equal(draft.immunity, false);
  assert.throws(() => build({ reviewed: false }), /Review the save/);
  assert.throws(() => build({ proficiencyReason: ' ' }), /Proficiency decision reason/);
  assert.throws(() => build({ mitigationReason: '' }), /Reviewed defenses reason/);
});

test('requires a current player actor and a valid game revision and intent ID', () => {
  assert.throws(() => build({ actorId: 'not-in-current-party' }), /current player character/);
  assert.throws(() => buildReviewedSaveRequest(reviewedDraft(), -1, 'save-1', ['actor-1']), /Refresh the game/);
  assert.throws(() => buildReviewedSaveRequest(reviewedDraft(), 1.2, 'save-1', ['actor-1']), /Refresh the game/);
  assert.throws(() => buildReviewedSaveRequest(reviewedDraft(), 14, 'bad/id', ['actor-1']), /valid request ID/);
});

test('bounds all numeric inputs and rejects blank, fractional, and exponent notation', () => {
  for (const [field, value] of [
    ['dc', '-1'], ['dc', '101'], ['dc', ''], ['dc', '1e1'], ['dc', '1.5'],
    ['diceCount', '-1'], ['diceCount', '21'], ['dieSides', '3'],
    ['bonus', '-101'], ['bonus', '101'], ['reduction', '-1'], ['reduction', '101'],
    ['adjustmentValue', '-21'], ['adjustmentValue', '21'],
  ]) assert.throws(() => build({ [field]: value }), Error, `${field}=${value}`);
  const result = build({ dc: '100', diceCount: '0', bonus: '-100', reduction: '100', adjustmentValue: '20', adjustmentSource: 'Reviewed adjustment' });
  assert.equal(result.dc, 100);
  assert.equal(result.consequence.dice.count, 0);
  assert.equal(result.consequence.dice.bonus, -100);
});

test('requires a reason for nonzero save adjustments and limits reviewed reasons', () => {
  assert.throws(() => build({ adjustmentValue: '1' }), /Adjustment reason/);
  assert.throws(() => build({ advantage: Array(9).fill('Reviewed reason').join('\n') }), /eight reasons/);
  assert.throws(() => build({ disadvantage: 'x'.repeat(161) }), /160 characters/);
  assert.throws(() => build({ proficiencyReason: 'x'.repeat(301) }), /300 characters/);
  assert.throws(() => build({ mitigationReason: 'x'.repeat(301) }), /300 characters/);
  assert.throws(() => build({ label: 'x'.repeat(161) }), /160 characters/);
});

test('allows reviewed simultaneous resistance and vulnerability and immunity without inferring outcomes', () => {
  const result = build({ resistance: true, vulnerability: true, immunity: true, reduction: '3', onSuccess: 'none' });
  assert.deepEqual(result.consequence.mitigation, { reduction: 3, resistance: true, vulnerability: true, immunity: true, reason: 'Reviewed character defenses for fire; none apply' });
  assert.equal(result.consequence.onSuccess, 'none');
  assert.throws(() => build({ onSuccess: 'quarter' }), /successful save/);
  assert.throws(() => build({ damageType: 'unknown' }), /damage type/);
  assert.throws(() => build({ ability: 'luck' }), /saving throw ability/);
});

test('same intent and reviewed snapshot produce the identical retry payload', () => {
  const draft = reviewedDraft();
  const snapshot = structuredClone(draft);
  const first = buildReviewedSaveRequest(draft, 14, 'stable-intent', ['actor-1']);
  assert.deepEqual(buildReviewedSaveRequest(draft, 14, 'stable-intent', ['actor-1']), first);
  assert.deepEqual(draft, snapshot);
  assert.equal(buildReviewedSaveRequest(draft, 15, 'new-reviewed-intent', ['actor-1']).expectedRevision, 15);
});

test('formats persisted damage values without recomputing totals, mitigation, or HP loss', () => {
  const persisted = {
    type: 'single_target_damage', damageType: 'fire', dice: [1, 2], dieSides: 6, bonus: -4,
    rolledTotal: 19, afterSave: 8, mitigation: { reduction: 3, resistance: true, vulnerability: false, immunity: false },
    appliedDamage: 12, hpBefore: 5, hpAfter: 0,
    dc: 999, reason: 'secret adjudication',
  };
  const lines = savedDamageLines(persisted);
  assert.deepEqual(lines, [
    { label: 'Damage type', value: 'fire' }, { label: 'Saved damage dice', value: 'd6: [1, 2]' },
    { label: 'Saved damage bonus', value: '-4' }, { label: 'Rolled damage total', value: '19' },
    { label: 'Damage after save', value: '8' },
    { label: 'Reviewed mitigation', value: 'Flat reduction 3; resistance yes; vulnerability no; immunity no' },
    { label: 'Applied damage (before HP limit)', value: '12' }, { label: 'HP before', value: '5' }, { label: 'HP after', value: '0' },
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /secret adjudication|999|actual HP loss/);
});

test('formats zero-dice and zero-damage receipts as persisted', () => {
  const lines = savedDamageLines({
    type: 'single_target_damage', damageType: 'cold', dice: [], dieSides: 4, bonus: 0,
    rolledTotal: 0, afterSave: 0, mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: true },
    appliedDamage: 0, hpBefore: 20, hpAfter: 20,
  });
  assert.equal(lines.find(line => line.label === 'Saved damage dice').value, 'd4: []');
  assert.equal(lines.find(line => line.label === 'Saved damage bonus').value, '+0');
  assert.equal(lines.find(line => line.label === 'HP after').value, '20');
});
