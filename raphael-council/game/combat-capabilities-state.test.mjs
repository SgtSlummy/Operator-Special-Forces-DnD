import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join } from 'node:path';
import { GameStore, projectState } from './store.mjs';

const scope = owner => ({ campaign: 'capabilities', owner });
const capabilities = source => ({ attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [{ source, value: 1 }], advantage: [], disadvantage: [] } });
function seed(configured = true) {
  const actor = (id, x, initiative) => ({ id, name: id, owner: id, team: id, x, y: 1, initiative, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 12, characterVersion: `approved-${id}`, weapon: { name: 'Reviewed weapon', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 }, ...(configured ? { combatCapabilities: capabilities(`${id}-private-modifier`), combatReview: { constitutionProficiencyReason: `${id}-reviewed-proficiency` }, reactionAvailable: false } : {}) });
  return { campaign: 'capabilities', title: 'Capabilities fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'hero', role: 'player' }, { owner: 'other', role: 'player' }], map: { id: 'room', title: 'Room', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('hero', 1, 20), actor('other', 5, 10)], effects: [] };
}
function fixture(t, input = seed(), path = ':memory:') { const game = new GameStore(path); t.after(() => game.close()); game.createCampaign(input); return game; }
function command(game, owner, type, requestId) { return game.command(scope(owner), { requestId, expectedRevision: game.view(scope(owner)).revision, actorId: 'hero', type }); }
function spent(game, actorId) {
  game.transaction(() => { const state = game.load('capabilities'); state.actors.find(a => a.id === actorId).reactionAvailable = false; game.record(state, 'fixture_reaction_spent', { actorId }); game.save(state); });
}

test('legacy actors retain absent capabilities and no inferred reaction resource', t => {
  const game = fixture(t, seed(false));
  for (const actor of game.load('capabilities').actors) { assert.equal(actor.combatCapabilities, undefined); assert.equal(actor.reactionAvailable, undefined); }
  assert.equal(game.view(scope('hero')).actors[0].combatCapabilities, undefined);
});

test('normalized capabilities and review provenance stay private in current and historical projections', t => {
  const input = seed(), game = fixture(t, input);
  input.actors[0].combatCapabilities.constitutionSave.adjustments[0].value = 99;
  const player = game.view(scope('hero')), own = player.actors.find(a => a.id === 'hero'), other = player.actors.find(a => a.id === 'other');
  assert.equal(own.combatCapabilities.constitutionSave.adjustments[0].value, 1);
  assert.equal(own.combatReview.constitutionProficiencyReason, 'hero-reviewed-proficiency');
  assert.equal(other.combatCapabilities, undefined); assert.equal(other.combatReview, undefined); assert.equal(other.reactionAvailable, undefined);
  assert.doesNotMatch(JSON.stringify(game.updates(scope('hero'), 0)), /other-private-modifier|other-reviewed-proficiency/);
  assert.equal(game.view(scope('host')).actors.find(a => a.id === 'other').combatReview.constitutionProficiencyReason, 'other-reviewed-proficiency');
  const state = game.load('capabilities'), projected = projectState(state, 'hero', 'player');
  projected.actors[0].combatCapabilities.constitutionSave.adjustments[0].value = 88;
  projected.actors[0].combatReview.constitutionProficiencyReason = 'changed';
  assert.equal(state.actors[0].combatCapabilities.constitutionSave.adjustments[0].value, 1);
  assert.equal(state.actors[0].combatReview.constitutionProficiencyReason, 'hero-reviewed-proficiency');
});

test('invalid or unreviewed capability fields reject the entire campaign before persistence', t => {
  const variants = [
    a => { a.combatCapabilities.meleeReachFeet = 10; },
    a => { delete a.combatReview; },
    a => { a.combatReview.extra = 'unsupported'; },
    a => { a.combatReview.constitutionProficiencyReason = ' '; },
    a => { a.combatCapabilities.attackKind = 'guessed'; },
    a => { a.reactionAvailable = 'yes'; },
    a => { delete a.combatCapabilities; delete a.combatReview; },
    a => { a.combatCapabilities = null; },
  ];
  for (const mutate of variants) {
    const game = new GameStore(':memory:'); t.after(() => game.close());
    const input = seed(); mutate(input.actors[0]);
    assert.throws(() => game.createCampaign(input), error => error.code === 'INVALID');
    assert.equal(game.hasCampaign('capabilities'), false);
    assert.equal(game.db.prepare('SELECT count(*) AS n FROM game_events').get().n, 0);
  }
});

test('only the incoming configured actor recovers a reaction before its turn projection', t => {
  const game = fixture(t);
  assert.equal(game.load('capabilities').actors[0].reactionAvailable, true);
  assert.equal(game.load('capabilities').actors[1].reactionAvailable, false);
  spent(game, 'hero');
  command(game, 'hero', 'end_turn', 'first-end');
  const after = game.load('capabilities');
  assert.equal(after.actors[0].reactionAvailable, false); assert.equal(after.actors[1].reactionAvailable, true);
  const incoming = game.updates(scope('other'), after.revision - 1).views[0];
  assert.equal(incoming.activeActorId, 'other'); assert.equal(incoming.actors.find(a => a.id === 'other').reactionAvailable, true);
  game.command(scope('other'), { requestId: 'second-end', expectedRevision: after.revision, actorId: 'other', type: 'end_turn' });
  assert.equal(game.view(scope('hero')).actors.find(a => a.id === 'hero').reactionAvailable, true);
});

test('pause and resume preserve a spent reaction without refreshing the resource', t => {
  const game = fixture(t); spent(game, 'hero');
  command(game, 'hero', 'pause', 'pause'); command(game, 'host', 'resume', 'resume');
  assert.equal(game.load('capabilities').actors[0].reactionAvailable, false);
});

test('capabilities, private review and spent resources survive restart with identical snapshots', t => {
  const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'raph-capabilities-test-'));
  t.after(() => { const actual = realpathSync(root); assert.equal(dirname(actual), parent); assert.ok(basename(actual).startsWith('raph-capabilities-test-')); rmSync(actual, { recursive: true, force: true }); });
  const path = join(root, 'game.sqlite');
  const game = new GameStore(path); game.createCampaign(seed()); spent(game, 'hero');
  const state = game.load('capabilities'), history = game.updates(scope('hero'), 0); game.close();
  const reopened = new GameStore(path);
  try { assert.deepEqual(reopened.load('capabilities'), state); assert.deepEqual(reopened.updates(scope('hero'), 0), history); } finally { reopened.close(); }
});
