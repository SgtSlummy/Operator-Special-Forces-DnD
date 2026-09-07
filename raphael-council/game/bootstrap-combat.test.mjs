import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapCampaign } from './bootstrap.mjs';
import { GameStore } from './store.mjs';

function fixture() {
  const values = { name: 'Maren', constitution: 14, dexterity: 16, proficiencyBonus: 2, maxHp: 20, armorClass: 14, speed: 30 };
  const saved = { revision: 7, snapshot: { edition: '2024', fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, conflict: false, uncertain: false, corrected: false }])) },
    runtime: { currentHp: 9, tempHp: 0, conditions: [], spentSlots: {} } };
  const input = { campaign: 'bootstrap-combat-fixture', title: 'Reviewed fixture', reviewedBy: 'fixture-host', mechanicsConfirmed: true,
    members: [{ owner: 'fixture-host', role: 'host' }, { owner: 'fixture-player', role: 'player' }],
    map: { id: 'map', title: 'Fixture scene', width: 12, height: 12, blocked: [], difficult: [] }, npcs: [], effects: [],
    players: [{ id: 'hero', owner: 'fixture-player', team: 'party', x: 1, y: 1, size: 1, vision: 3, initiativeTotal: 15, expectedCharacterRevision: 7,
      weapon: { name: 'Reviewed bow', ability: 'dexterity', proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } }] };
  let commits = 0;
  const game = { createCampaign: seed => { commits++; return seed; } };
  const characters = { character: scope => { assert.deepEqual(scope, { campaign: input.campaign, owner: 'fixture-player' }); return saved; } };
  return { saved, input, player: input.players[0], run: () => bootstrapCampaign(game, characters, input), commits: () => commits };
}
function saveProfile() {
  return { proficient: true, proficiencyReason: 'Host reviewed the approved sheet saving throw proficiency.',
    adjustments: [{ source: 'Reviewed save adjustment', value: 1 }], advantage: ['Reviewed concentration advantage'], disadvantage: [] };
}
function enable(f) { f.player.combatCapabilities = { attackKind: 'ranged', constitutionSave: saveProfile() }; }
function rejected(f) { assert.throws(f.run, error => error.code === 'PROFILE'); assert.equal(f.commits(), 0); }

test('legacy bootstrap leaves capabilities absent and does not require optional Constitution fields', () => {
  const f = fixture(); delete f.saved.snapshot.fields.constitution;
  const actor = f.run().actors[0];
  assert.equal(Object.hasOwn(actor, 'combatCapabilities'), false);
  assert.equal(Object.hasOwn(actor, 'combatReview'), false);
  assert.equal(actor.hp, 9); assert.equal(actor.weapon.abilityScore, 16); assert.equal(actor.weapon.proficiencyBonus, 2);
  assert.match(actor.characterVersion, /^approved-7-[a-f0-9]{16}$/);
});

test('reviewed melee identity and save use approved CON/PB and preserve source arrays without mutating input', () => {
  const f = fixture(); enable(f);
  f.player.weapon.rangeFeet = 10;
  f.player.combatCapabilities.attackKind = 'melee'; f.player.combatCapabilities.meleeReachFeet = 10;
  f.saved.snapshot.fields.constitutionSave = { value: 5, corrected: true };
  const before = structuredClone({ saved: f.saved, input: f.input });
  assert.deepEqual(f.run().actors[0].combatCapabilities, { attackKind: 'melee', meleeReachFeet: 10,
    constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true,
      adjustments: [{ source: 'Reviewed save adjustment', value: 1 }], advantage: ['Reviewed concentration advantage'], disadvantage: [] } });
  assert.deepEqual({ saved: f.saved, input: f.input }, before);
  f.player.combatCapabilities.constitutionSave.proficiencyReason = '  Reviewed proficiency source.  ';
  assert.deepEqual(f.run().actors[0].combatReview, { constitutionProficiencyReason: 'Reviewed proficiency source.' });
});

test('a missing approved save total permits explicit proficiency review but never infers proficiency', () => {
  const f = fixture(); enable(f);
  f.player.combatCapabilities.constitutionSave.proficient = false;
  const save = f.run().actors[0].combatCapabilities.constitutionSave;
  assert.equal(save.proficient, false); assert.equal(save.abilityScore, 14); assert.equal(save.proficiencyBonus, 2);
});

test('an approved save total must reconcile with explicit proficiency and all declared adjustments', () => {
  for (const total of [4, 6, null]) {
    const f = fixture(); enable(f); f.saved.snapshot.fields.constitutionSave = { value: total, corrected: true }; rejected(f);
  }
  const f = fixture(); enable(f); f.saved.snapshot.fields.constitutionSave = { value: 5 };
  f.player.combatCapabilities.constitutionSave.proficient = false;
  rejected(f);
});

test('missing, conflicting and unconfirmed optional save evidence cannot enable the capability', () => {
  for (const field of ['constitution', 'proficiencyBonus', 'constitutionSave']) {
    for (const evidence of [undefined, { value: null }, { value: field === 'constitution' ? 14 : field === 'proficiencyBonus' ? 2 : 5, conflict: true },
      { value: field === 'constitution' ? 14 : field === 'proficiencyBonus' ? 2 : 5, uncertain: true, corrected: false }]) {
      const f = fixture(); enable(f);
      f.saved.snapshot.fields[field] = evidence;
      rejected(f);
    }
  }
});

test('corrected Constitution evidence is usable only at the exact approved character revision', () => {
  const f = fixture(); enable(f);
  f.saved.snapshot.fields.constitution = { value: 14, uncertain: true, corrected: true, conflict: false };
  assert.equal(f.run().actors[0].combatCapabilities.constitutionSave.abilityScore, 14);
  f.saved.revision++;
  assert.throws(f.run, error => error.code === 'PROFILE'); assert.equal(f.commits(), 1);
});

test('host cannot override approved numeric save statistics or add unknown combat fields', () => {
  for (const patch of [{ abilityScore: 30 }, { proficiencyBonus: 20 }, { total: 99 }, { proficiencyMultiplier: 2 }, { dc: 0 }]) {
    const f = fixture(); enable(f); Object.assign(f.player.combatCapabilities.constitutionSave, patch); rejected(f);
  }
  const f = fixture(); enable(f); f.player.combatCapabilities.reactionAvailable = true; rejected(f);
});

test('save proficiency needs explicit boolean review and a bounded nonblank reason', () => {
  for (const reason of [undefined, '', '   ', 'x'.repeat(301), 42]) {
    const f = fixture(); enable(f); f.player.combatCapabilities.constitutionSave.proficiencyReason = reason; rejected(f);
  }
  for (const proficient of [undefined, 1, 'true']) {
    const f = fixture(); enable(f); f.player.combatCapabilities.constitutionSave.proficient = proficient; rejected(f);
  }
});

test('reviewed modifier and advantage sources retain the bounded checks contract', () => {
  const patches = [
    { adjustments: [{ source: '', value: 1 }] }, { adjustments: [{ source: 'Reviewed', value: 21 }] },
    { adjustments: [{ source: 'Reviewed', value: 0.5 }] }, { adjustments: [{ source: 'Reviewed', value: 1, hiddenBonus: 4 }] },
    { advantage: Array(9).fill('Reviewed') }, { disadvantage: [''] }, { advantage: ['x'.repeat(161)] },
    { adjustments: undefined }, { advantage: undefined }, { disadvantage: undefined },
  ];
  for (const patch of patches) { const f = fixture(); enable(f); Object.assign(f.player.combatCapabilities.constitutionSave, patch); rejected(f); }
});

test('melee capabilities require exact matching weapon range and ranged capabilities cannot claim melee reach', () => {
  for (const capabilities of [null, {}, { attackKind: 'melee' }, { attackKind: 'melee', meleeReachFeet: 5 },
    { attackKind: 'melee', meleeReachFeet: 60 }, { attackKind: 'ranged', meleeReachFeet: 5 }]) {
    const f = fixture(); f.player.combatCapabilities = capabilities; rejected(f);
  }
  const f = fixture(); f.player.combatCapabilities = { attackKind: 'ranged' };
  assert.deepEqual(f.run().actors[0].combatCapabilities, { attackKind: 'ranged' });
});

test('combat review cannot bypass existing HP, condition, resource, edition or host approval guards', () => {
  const changes = [
    f => { f.saved.runtime.currentHp = 0; }, f => { f.saved.runtime.tempHp = 1; },
    f => { f.saved.runtime.conditions = ['poisoned']; }, f => { f.saved.runtime.spentSlots = { 1: 1 }; },
    f => { f.saved.snapshot.edition = '2014'; }, f => { f.input.mechanicsConfirmed = false; },
    f => { f.input.reviewedBy = 'fixture-player'; }, f => { f.player.weapon.abilityScore = 30; },
    f => { f.input.npcs = [{ owner: 'fixture-player' }]; },
  ];
  for (const change of changes) { const f = fixture(); enable(f); change(f); rejected(f); }
});

test('real GameStore preserves approved capabilities and proficiency review privately for owner and host', t => {
  const f = fixture(); enable(f);
  f.input.members.push({ owner: 'fixture-observer', role: 'player' });
  f.input.players.push({ ...f.player, id: 'observer', owner: 'fixture-observer', x: 2, combatCapabilities: undefined });
  const game = new GameStore(':memory:', { rollDie: () => { throw new Error('Bootstrap must not roll dice.'); } });
  t.after(() => game.close());
  bootstrapCampaign(game, { character: () => f.saved }, f.input);
  const expected = { constitutionProficiencyReason: f.player.combatCapabilities.constitutionSave.proficiencyReason };
  const persisted = game.load(f.input.campaign).actors.find(actor => actor.id === 'hero');
  assert.deepEqual(persisted.combatReview, expected);
  assert.equal(persisted.combatCapabilities.constitutionSave.abilityScore, 14);
  for (const owner of ['fixture-host', 'fixture-player']) {
    const actor = game.view({ campaign: f.input.campaign, owner }).actors.find(actor => actor.id === 'hero');
    assert.deepEqual(actor.combatReview, expected);
    assert.deepEqual(actor.combatCapabilities, persisted.combatCapabilities);
  }
  const publicActor = game.view({ campaign: f.input.campaign, owner: 'fixture-observer' }).actors.find(actor => actor.id === 'hero');
  assert.ok(publicActor, 'the nearby character remains publicly visible');
  assert.equal(Object.hasOwn(publicActor, 'combatReview'), false);
  assert.equal(Object.hasOwn(publicActor, 'combatCapabilities'), false);
  assert.doesNotMatch(JSON.stringify(publicActor), /proficiency|constitution|Reviewed/);
});
