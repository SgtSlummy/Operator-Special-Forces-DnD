import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterStore } from '../characters/store.mjs';
import { emptyDraft, addEvidence } from '../characters/model.mjs';
import { GameStore } from './store.mjs';
import { bootstrapCampaign } from './bootstrap.mjs';

const owner = '123456789012345678', scope = { campaign: 'bridge', owner };
function setup() {
  const characters = new CharacterStore(':memory:'), game = new GameStore(':memory:');
  const draft = emptyDraft();
  for (const [name, value] of Object.entries({ name: 'Maren', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28, currentHp: 19, proficiencyBonus: 2, speed: 30 })) addEvidence(draft, name, value, { page: 1, method: 'form' });
  const job = characters.createJob(scope, 'fixture'); characters.ready(job.id, scope, draft, 'fixture'); characters.approve(job.id, scope, characters.job(job.id, scope).revision);
  const input = { campaign: 'bridge', title: 'Bridge fixture', reviewedBy: 'host', mechanicsConfirmed: true, members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }], map: { id: 'bridge', title: 'Bridge', width: 12, height: 12, blocked: [], difficult: [] }, players: [{ id: 'maren', owner, team: 'party', x: 1, y: 1, size: 1, vision: 6, initiativeTotal: 18, expectedCharacterRevision: 1, weapon: { name: 'Bow', ability: 'dexterity', proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } }], npcs: [], effects: [] };
  return { characters, game, input, close() { characters.close(); game.close(); } };
}
test('approved sheet values feed the game profile and source HP cannot heal runtime HP', () => {
  const fixture = setup();
  try {
    fixture.characters.db.prepare('UPDATE characters SET runtime=?').run(JSON.stringify({ currentHp: 7, tempHp: 0, spentSlots: {}, conditions: [] }));
    bootstrapCampaign(fixture.game, fixture.characters, fixture.input);
    const actor = fixture.game.view(scope).actors[0];
    assert.equal(actor.hp, 7); assert.equal(actor.ac, 15); assert.equal(actor.weapon.abilityScore, 16); assert.equal(actor.weapon.proficiencyBonus, 2); assert.match(actor.characterVersion, /^approved-1-[a-f0-9]{16}$/);
    assert.throws(() => bootstrapCampaign(fixture.game, fixture.characters, fixture.input), { code: 'EXISTS' });
  } finally { fixture.close(); }
});
test('stale character or forged weapon score is rejected before campaign creation', () => {
  const fixture = setup();
  try {
    fixture.input.players[0].expectedCharacterRevision = 2;
    assert.throws(() => bootstrapCampaign(fixture.game, fixture.characters, fixture.input), { code: 'PROFILE' });
    fixture.input.players[0].expectedCharacterRevision = 1; fixture.input.players[0].weapon.abilityScore = 30;
    assert.throws(() => bootstrapCampaign(fixture.game, fixture.characters, fixture.input), { code: 'PROFILE' });
    assert.equal(fixture.game.db.prepare('SELECT count(*) n FROM game_campaigns').get().n, 0);
  } finally { fixture.close(); }
});
test('unhandled existing conditions cannot disappear during bootstrap', () => {
  const fixture = setup();
  try { fixture.characters.db.prepare('UPDATE characters SET runtime=?').run(JSON.stringify({ currentHp: 7, conditions: ['poisoned'] })); assert.throws(() => bootstrapCampaign(fixture.game, fixture.characters, fixture.input), { code: 'PROFILE' }); } finally { fixture.close(); }
});
