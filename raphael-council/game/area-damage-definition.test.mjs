import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { approveAreaDamageTarget, normalizeAreaDamageInput } from './area-damage-definition.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const target = (targetId, actorId) => ({
  targetId, actorId, ability: 'dexterity', dc: 15, proficiencyMultiplier: 1,
  proficiencyReason: 'Approved Dexterity save proficiency.', advantage: ['Reviewed elevation benefit'], disadvantage: [],
  adjustments: [{ source: 'Reviewed ward', value: 1 }], onSuccess: 'half',
  mitigation: { reduction: 2, resistance: true, vulnerability: false, immunity: false, reason: 'Reviewed defenses.' },
});
const input = () => ({
  id: 'shared_fire', reviewed: true, expectedRevision: 7, label: 'Reviewed fire burst', sourceActorId: 'mage', cost: 'action',
  damage: { dice: { count: 3, sides: 6, bonus: 2 }, damageType: 'fire' },
  targets: [target('second', 'scout'), target('first', 'knight')], order: ['second', 'first'],
});
const fixture = (transform = () => {}) => {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 15 }, proficiencyBonus: { value: 3 } } };
  transform(snapshot);
  const saved = { revision: 4, snapshot };
  const actor = { id: 'scout', owner: 'alice', hp: 20, characterVersion: `approved-${saved.revision}-${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)}` };
  const calls = [];
  const characters = { character: scope => { calls.push(scope); return saved; } };
  return { snapshot, saved, actor, characters, calls, scope: { campaign: 'campaign', owner: 'host' } };
};
const approve = (context, reviewed = target('second', 'scout')) => approveAreaDamageTarget(context.characters, context.scope, context.actor, reviewed, fail);
const invalid = operation => assert.throws(operation, { code: 'INVALID' });

test('normalization canonicalizes target storage while preserving the explicit damage order and caller data', () => {
  const original = input(), before = structuredClone(original);
  const normalized = normalizeAreaDamageInput(original, fail);
  assert.deepEqual(original, before);
  assert.deepEqual(normalized.targets.map(row => row.targetId), ['first', 'second']);
  assert.deepEqual(normalized.order, ['second', 'first']);
  const reversed = input(); reversed.targets.reverse();
  assert.deepEqual(normalizeAreaDamageInput(reversed, fail), normalized);
  const differentOrder = input(); differentOrder.order.reverse();
  assert.notDeepEqual(normalizeAreaDamageInput(differentOrder, fail), normalized);
  original.damage.dice.count = 20;
  original.targets[0].advantage.push('Late edit');
  original.targets[0].adjustments[0].value = 20;
  original.targets[0].mitigation.reason = 'Late defense';
  original.order.reverse();
  assert.deepEqual(normalized, normalizeAreaDamageInput(before, fail));
  normalized.targets[0].disadvantage.push('Returned edit');
  normalized.damage.dice.bonus = 100;
  assert.deepEqual(before.targets[1].disadvantage, []);
  assert.equal(before.damage.dice.bonus, 2);
});

test('every input and nested review field is required; unknown identity, numeric stats and rolls are rejected', () => {
  const scopes = [value => value, value => value.damage, value => value.damage.dice,
    value => value.targets[0], value => value.targets[0].adjustments[0], value => value.targets[0].mitigation];
  for (const at of scopes) {
    for (const key of Object.keys(at(input()))) {
      const value = input(); delete at(value)[key];
      invalid(() => normalizeAreaDamageInput(value, fail));
    }
    for (const key of ['owner', 'roll', 'abilityScore', 'characterVersion', 'extra']) {
      const value = input(); at(value)[key] = 99;
      invalid(() => normalizeAreaDamageInput(value, fail));
    }
    const value = input(); at(value)[Symbol('hidden')] = 99;
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  for (const malformed of [undefined, null, false, 0, '', [], new Date()]) invalid(() => normalizeAreaDamageInput(malformed, fail));
});

test('top-level identity, review, revision, label and resource fields reject invalid values', () => {
  const cases = {
    id: ['', 'bad space', 'a'.repeat(97), 1], reviewed: [false, 'true', 1], expectedRevision: [1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
    label: ['', ' ', 'a'.repeat(161), false], sourceActorId: ['', 'bad/id', 4], cost: ['bonus', 'reaction', 0],
  };
  for (const [key, values] of Object.entries(cases)) for (const bad of values) {
    const value = input(); value[key] = bad;
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
});

test('shared damage dice and type enforce the reviewed check bounds including fixed damage', () => {
  for (const [key, values] of Object.entries({ count: [-1, 21, 1.5, '3'], sides: [0, 3, 100, '6'], bonus: [-101, 101, 0.5, '2'] })) {
    for (const bad of values) {
      const value = input(); value.damage.dice[key] = bad;
      invalid(() => normalizeAreaDamageInput(value, fail));
    }
  }
  for (const damageType of ['', 'Fire', 'poison/fire', 1]) {
    const value = input(); value.damage.damageType = damageType;
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  for (const sides of [2, 4, 6, 8, 10, 12, 20]) {
    const value = input(); value.damage.dice = { count: 0, sides, bonus: -100 };
    assert.deepEqual(normalizeAreaDamageInput(value, fail).damage.dice, { count: 0, sides, bonus: -100 });
  }
  const maximum = input(); maximum.damage.dice = { count: 20, sides: 20, bonus: 100 };
  assert.deepEqual(normalizeAreaDamageInput(maximum, fail).damage.dice, maximum.damage.dice);
});

test('target cardinality, distinct actors and exact order permutations are enforced', () => {
  for (const size of [0, 1, 17]) {
    const value = input(); value.targets = Array.from({ length: size }, (_, index) => target(`t${index}`, `a${index}`));
    value.order = value.targets.map(row => row.targetId);
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  const maximum = input(); maximum.targets = Array.from({ length: 16 }, (_, index) => target(`t${index}`, `a${index}`));
  maximum.order = maximum.targets.map(row => row.targetId).reverse();
  assert.equal(normalizeAreaDamageInput(maximum, fail).targets.length, 16);
  for (const key of ['targetId', 'actorId']) {
    const value = input(); value.targets[1][key] = value.targets[0][key];
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  for (const order of [[], ['first'], ['first', 'first'], ['first', 'unknown'], ['first', 'second', 'third'], [null, 'second'], Array(2)]) {
    const value = input(); value.order = order;
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  const sparse = input(); sparse.targets = Array(2);
  invalid(() => normalizeAreaDamageInput(sparse, fail));
});

test('each save and mitigation review has strict bounded values and cannot claim expertise', () => {
  const cases = {
    targetId: ['', 'bad id', 'a'.repeat(97)], actorId: ['', 'a/b'], ability: ['luck', 'Dexterity'], dc: [-1, 101, 1.5, '15'],
    proficiencyMultiplier: [-1, 2, '1'], proficiencyReason: ['', ' ', 'a'.repeat(301)], onSuccess: ['full', null],
    advantage: [null, [''], Array(1), Array(9).fill('source'), ['a'.repeat(161)]],
    disadvantage: [false, [' '], Array(9).fill('source')],
    adjustments: [null, Array(1), [{ source: '', value: 1 }], [{ source: 'source', value: 21 }], [{ source: 'source', value: -21 }], [{ source: 'source', value: 0.5 }], Array(9).fill({ source: 'source', value: 1 })],
  };
  for (const [key, values] of Object.entries(cases)) for (const bad of values) {
    const value = input(); value.targets[0][key] = bad;
    invalid(() => normalizeAreaDamageInput(value, fail));
  }
  for (const [key, values] of Object.entries({ reduction: [-1, 101, 1.5, '2'], resistance: [1, 'true'], vulnerability: [null], immunity: [0], reason: ['', ' ', 'a'.repeat(301)] })) {
    for (const bad of values) {
      const value = input(); value.targets[0].mitigation[key] = bad;
      invalid(() => normalizeAreaDamageInput(value, fail));
    }
  }
});

test('approval derives numeric modifiers from the exact approved 2024 owner snapshot', () => {
  const context = fixture(), reviewed = target('second', 'scout'), result = approve(context, reviewed);
  assert.deepEqual(context.calls, [{ campaign: 'campaign', owner: 'alice' }]);
  assert.deepEqual(result, {
    targetId: 'second', actorId: 'scout', owner: 'alice', characterVersion: context.actor.characterVersion,
    ability: 'dexterity', mode: 'advantage', advantage: ['Reviewed elevation benefit'], disadvantage: [],
    modifiers: [{ source: 'dexterity', value: 2 }, { source: 'proficiency ×1: Approved Dexterity save proficiency.', value: 3 }, { source: 'Reviewed ward', value: 1 }],
    dc: 15, onSuccess: 'half', mitigation: reviewed.mitigation,
  });
  reviewed.advantage.push('Late edit'); reviewed.adjustments[0].value = 20; reviewed.mitigation.reduction = 100;
  assert.deepEqual(result.advantage, ['Reviewed elevation benefit']);
  assert.equal(result.modifiers[2].value, 1);
  assert.equal(result.mitigation.reduction, 2);
  assert.equal(context.actor.hp, 20);
  assert.equal(context.snapshot.fields.dexterity.value, 15);
});

test('advantage and disadvantage cancel regardless of source count and save proficiency can be zero', () => {
  for (const [advantage, disadvantage, mode] of [[[], [], 'normal'], [['one', 'two'], ['one'], 'normal'], [[], ['one'], 'disadvantage'], [['one'], [], 'advantage']]) {
    const reviewed = target('second', 'scout'); Object.assign(reviewed, { advantage, disadvantage, proficiencyMultiplier: 0 });
    const result = approve(fixture(snapshot => { snapshot.fields.dexterity.value = 9; }), reviewed);
    assert.equal(result.mode, mode);
    assert.equal(result.modifiers[0].value, -1);
    assert.equal(result.modifiers[1].value, 0);
  }
});

test('missing or unsupported owner profiles, mismatched actors and stale pins fail safely', () => {
  const unsupported = fixture(); unsupported.actor.owner = null;
  assert.throws(() => approve(unsupported), { code: 'UNSUPPORTED' });
  assert.deepEqual(unsupported.calls, []);
  const wrongActor = fixture(); wrongActor.actor.id = 'someone_else';
  assert.throws(() => approve(wrongActor), { code: 'TARGET' });
  assert.deepEqual(wrongActor.calls, []);
  for (const characters of [null, {}, { character: null }, { character: () => null }, { character: () => ({ revision: 1 }) }, { character: () => ({ snapshot: null }) }]) {
    const context = fixture(); context.characters = characters;
    assert.throws(() => approve(context), { code: 'PROFILE' });
  }
  for (const edition of ['2014', 'custom', undefined]) assert.throws(() => approve(fixture(snapshot => { snapshot.edition = edition; })), { code: 'PROFILE' });
  const revised = fixture(); revised.saved.revision += 1;
  assert.throws(() => approve(revised), { code: 'PROFILE' });
  const changed = fixture(); changed.snapshot.fields.dexterity.value = 20;
  assert.throws(() => approve(changed), { code: 'PROFILE' });
  const unpinned = fixture(); delete unpinned.actor.characterVersion;
  assert.throws(() => approve(unpinned), { code: 'PROFILE' });
});

test('conflicted, uncertain, missing and out-of-range approved statistics require correction', () => {
  for (const fieldName of ['dexterity', 'proficiencyBonus']) {
    const badFields = [undefined, { value: '14' }, { value: 2.5 }, { value: 2, conflict: true }, { value: 2, uncertain: true }, { value: fieldName === 'dexterity' ? 0 : -1 }, { value: fieldName === 'dexterity' ? 31 : 11 }];
    for (const field of badFields) {
      const context = fixture(snapshot => { snapshot.fields[fieldName] = field; });
      assert.throws(() => approve(context), { code: 'PROFILE' });
    }
  }
  assert.throws(() => approve(fixture(snapshot => { delete snapshot.fields; })), { code: 'PROFILE' });
  const corrected = approve(fixture(snapshot => { snapshot.fields.dexterity = { value: 18, uncertain: true, corrected: true }; }));
  assert.equal(corrected.modifiers[0].value, 4);
  const noProficiency = target('second', 'scout'); noProficiency.proficiencyMultiplier = 0;
  assert.throws(() => approve(fixture(snapshot => { delete snapshot.fields.proficiencyBonus; }), noProficiency), { code: 'PROFILE' });
});
