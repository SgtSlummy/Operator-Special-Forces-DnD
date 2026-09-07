import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatProfileError, validateCombatCapabilities, concentrationSaveDC } from './combat-profile.mjs';

const save = () => ({ abilityScore: 14, proficiencyBonus: 3, proficient: true, adjustments: [], advantage: [], disadvantage: [] });
const capability = constitutionSave => ({ attackKind: 'melee', meleeReachFeet: 5, constitutionSave });
const rejected = input => assert.throws(() => validateCombatCapabilities(input), error => error instanceof CombatProfileError && error.code === 'COMBAT_PROFILE');

test('legacy absence stays unconfigured while malformed configured values fail', () => {
  assert.equal(validateCombatCapabilities(undefined), undefined);
  for (const input of [null, false, 0, '', [], {}, new Date(), { attackKind: undefined }]) rejected(input);
});

test('melee reach is explicit in five-foot units while ranged profiles cannot claim reach', () => {
  for (const meleeReachFeet of [5, 10, 15, 20, 25, 30]) assert.deepEqual(validateCombatCapabilities({ attackKind: 'melee', meleeReachFeet }), { attackKind: 'melee', meleeReachFeet });
  assert.deepEqual(validateCombatCapabilities({ attackKind: 'ranged' }), { attackKind: 'ranged' });
  for (const meleeReachFeet of [undefined, null, 0, 4, 6, 7.5, 31, 35, '5', Infinity, NaN]) rejected({ attackKind: 'melee', meleeReachFeet });
  for (const meleeReachFeet of [undefined, 0, 5]) rejected({ attackKind: 'ranged', meleeReachFeet });
});

test('names, ranges and approval claims cannot supply or bypass the explicit capability contract', () => {
  for (const input of [
    { name: 'Longsword', rangeFeet: 5 },
    { attackKind: 'Melee', meleeReachFeet: 5 },
    { attackKind: 'spell', meleeReachFeet: 5 },
    { attackKind: 'ranged', rangeFeet: 600 },
    { attackKind: 'ranged', reviewed: true },
    { attackKind: 'ranged', reactionAvailable: true },
    { attackKind: 'ranged', concentration: true },
  ]) rejected(input);
});

test('Constitution fields are explicit and may only be omitted as a whole', () => {
  const source = save();
  assert.deepEqual(validateCombatCapabilities(capability(source)).constitutionSave, source);
  for (const field of Object.keys(source)) {
    const missing = { ...source }; delete missing[field]; rejected(capability(missing));
  }
  for (const value of [undefined, null, false, []]) rejected(capability(value));
  const plain = Object.assign(Object.create(null), { attackKind: 'ranged' });
  assert.deepEqual(validateCombatCapabilities(plain), { attackKind: 'ranged' });
});

test('normalized output owns all nested copies without mutating reviewed input', () => {
  const source = capability({ ...save(), adjustments: [{ source: '  Host-reviewed blessing  ', value: 2 }], advantage: ['  Steady focus  '], disadvantage: ['  Distraction  '] });
  const before = structuredClone(source);
  const result = validateCombatCapabilities(source);
  assert.deepEqual(source, before);
  assert.deepEqual(result.constitutionSave, { ...save(), adjustments: [{ source: 'Host-reviewed blessing', value: 2 }], advantage: ['Steady focus'], disadvantage: ['Distraction'] });
  result.constitutionSave.adjustments[0].value = 19;
  result.constitutionSave.advantage.push('Changed result');
  source.constitutionSave.disadvantage[0] = 'Changed source';
  assert.equal(source.constitutionSave.adjustments[0].value, 2);
  assert.equal(source.constitutionSave.advantage.length, 1);
  assert.deepEqual(result.constitutionSave.disadvantage, ['Distraction']);
});

test('Constitution statistics reject coercion and out-of-contract values', () => {
  for (const [field, values] of [
    ['abilityScore', [0, 31, 12.5, '14', NaN, Infinity]],
    ['proficiencyBonus', [-1, 11, 2.5, '3', NaN, Infinity]],
    ['proficient', [undefined, null, 0, 1, 'true']],
  ]) for (const value of values) rejected(capability({ ...save(), [field]: value }));
  for (const abilityScore of [1, 30]) for (const proficiencyBonus of [0, 10]) for (const proficient of [false, true]) {
    const source = { ...save(), abilityScore, proficiencyBonus, proficient };
    assert.deepEqual(validateCombatCapabilities(capability(source)).constitutionSave, source);
  }
});

test('modifier and advantage sources enforce bounded explicit labels and dense lists', () => {
  for (const field of ['adjustments', 'advantage', 'disadvantage']) {
    for (const value of [null, {}, new Array(1), Array.from({ length: 9 }, () => field === 'adjustments' ? { source: 'Source', value: 1 } : 'Source')]) rejected(capability({ ...save(), [field]: value }));
  }
  for (const source of ['', '   ', 'x'.repeat(161), 3, null]) {
    rejected(capability({ ...save(), adjustments: [{ source, value: 1 }] }));
    rejected(capability({ ...save(), advantage: [source] }));
    rejected(capability({ ...save(), disadvantage: [source] }));
  }
  for (const value of [-21, 21, 0.5, '2', NaN, Infinity]) rejected(capability({ ...save(), adjustments: [{ source: 'Source', value }] }));
  const maximum = { ...save(), adjustments: Array.from({ length: 8 }, (_, i) => ({ source: `Source ${i}`, value: i % 2 ? -20 : 20 })), advantage: Array(8).fill('x'.repeat(160)), disadvantage: [] };
  assert.deepEqual(validateCombatCapabilities(capability(maximum)).constitutionSave, maximum);
});

test('unknown nested fields and accessor or inherited profiles fail without reading getters', () => {
  rejected(capability({ ...save(), concentrationOwner: 'hero' }));
  rejected(capability({ ...save(), adjustments: [{ source: 'Source', value: 1, approved: true }] }));
  rejected({ attackKind: 'ranged', [Symbol('hidden')]: true });
  rejected(Object.create({ attackKind: 'melee', meleeReachFeet: 5 }));
  let reads = 0;
  const accessor = Object.defineProperty({}, 'attackKind', { enumerable: true, get() { reads++; return 'ranged'; } });
  rejected(accessor);
  assert.equal(reads, 0);
});

for (const [damage, dc] of [[0, 10], [1, 10], [21, 10], [22, 11], [59, 29], [60, 30], [100, 30], [Number.MAX_SAFE_INTEGER, 30]]) {
  test(`concentration DC for ${damage} damage is ${dc}`, () => assert.equal(concentrationSaveDC(damage), dc));
}
test('concentration DC rejects invalid damage instead of coercing or rounding input', () => {
  for (const damage of [-1, 1.5, '22', null, undefined, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => concentrationSaveDC(damage), CombatProfileError);
});
