import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { assessReach } from './reach.mjs';

function fixture(t, { effects = [], speed = 5, vision = 12, configure = true } = {}) {
  const game = new GameStore(':memory:', { rollDie() { throw new Error('Exploration must not roll combat dice'); } });
  t.after(() => game.close());
  const host = { campaign: 'exploration', owner: 'host' }, player = { campaign: 'exploration', owner: 'player' };
  const profile = { team: 'party', size: 1, hp: 12, maxHp: 20, ac: 12, speed, vision, characterVersion: 'v1', weapon: { name: 'Staff', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } };
  game.createCampaign({ campaign: 'exploration', title: 'Exploration fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }], map: { id: 'room', title: 'Room', width: 12, height: 12, blocked: [{ x: 6, y: 1 }], difficult: [{ x: 2, y: 1 }] }, actors: [{ ...profile, id: 'hero', name: 'Hero', owner: 'player', x: 1, y: 1, initiative: 1 }, { ...profile, id: 'other', name: 'Other', owner: 'other', x: 10, y: 10, initiative: 20 }], effects });
  const mission = { reviewed: true, tracks: [{ id: 'trust', label: 'Trust', kind: 'relationship', value: 40 }], mission: { id: 'hearing', title: 'Hearing', briefing: 'Listen to the witness.', mapId: 'room', resolution: 'adjudicated', outcomes: [{ id: 'agreed', title: 'Agreement', summary: 'An agreement was reached.', changes: [{ trackId: 'trust', delta: 10 }] }] } };
  if (configure) game.configureMission(host, mission);
  let sequence = 0;
  const input = (type, extra = {}) => ({ requestId: `command-${++sequence}`, expectedRevision: game.view(player).revision, actorId: 'hero', type, ...extra });
  return { game, host, player, mission, input };
}
const code = expected => error => error.code === expected;

test('exploration moves an owned actor outside initiative without combat time, dice or budgets', t => {
  const f = fixture(t), before = f.game.load(f.player.campaign), world = f.game.world(f.player);
  assert.equal(before.order[before.activeIndex], 'other');
  const request = f.input('move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
  const receipt = f.game.command(f.player, request), after = f.game.load(f.player.campaign), view = f.game.view(f.player);
  assert.equal(after.actors.find(a => a.id === 'hero').x, 3);
  for (const field of ['turn', 'round', 'activeIndex', 'movementRemaining', 'actionAvailable']) assert.equal(after[field], before[field]);
  assert.equal(view.activeActorId, null); assert.equal(view.movementRemaining, null); assert.equal(view.actionAvailable, null);
  assert.equal(view.canResume, false); assert.equal(f.game.view(f.host).canResume, true);
  assert.equal(receipt.result.movementRemaining, null);
  assert.deepEqual(f.game.world(f.player), world);
  assert.deepEqual(f.game.command(f.player, request), receipt);
  assert.deepEqual(f.game.load(f.player.campaign), after);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(f.player.campaign, f.player.owner);
  assert.throws(() => f.game.command(f.player, request), code('UNAUTHORIZED'));
});

test('exploration rejects other owners, stale previews, jumps, walls and combat commands without mutation', t => {
  const f = fixture(t), before = f.game.load(f.player.campaign);
  const attempts = [
    [f.input('move', { actorId: 'other', path: [{ x: 9, y: 10 }] }), 'UNAUTHORIZED'],
    [f.input('move', { expectedRevision: 0, path: [{ x: 2, y: 1 }] }), 'STALE'],
    [f.input('move', { path: [{ x: 3, y: 1 }] }), 'MOVEMENT'],
    [f.input('move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }] }), 'MOVEMENT'],
    [f.input('attack', { targetId: 'other' }), 'PHASE'],
    [f.input('end_turn'), 'PHASE'],
  ];
  for (const [request, expected] of attempts) { assert.throws(() => f.game.command(f.player, request), code(expected)); assert.deepEqual(f.game.load(f.player.campaign), before); }
  assert.throws(() => f.game.command(f.host, f.input('move', { path: [{ x: 2, y: 1 }] })), code('UNAUTHORIZED'));
});

test('exploration movement still respects immobilization, visible area and path length', t => {
  const still = fixture(t, { speed: 0 });
  assert.throws(() => still.game.command(still.player, still.input('move', { path: [{ x: 2, y: 1 }] })), code('MOVEMENT'));
  const blind = fixture(t, { vision: 0 });
  assert.throws(() => blind.game.command(blind.player, blind.input('move', { path: [{ x: 2, y: 1 }] })), code('NOT_VISIBLE'));
  const normal = fixture(t);
  assert.throws(() => normal.game.command(normal.player, normal.input('move', { path: Array.from({ length: 25 }, (_, i) => ({ x: i % 2 ? 1 : 2, y: 1 })) })), code('INVALID'));
});

test('enter hazards apply per boundary crossing, not per cell or replay, without ticking timed hazards', t => {
  const f = fixture(t, { effects: [{ id: 'fire', name: 'Fire', trigger: 'enter', damage: 2, expiresAtTurn: 2, visible: true, cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }] }] });
  const request = f.input('move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
  f.game.command(f.player, request); f.game.command(f.player, request);
  assert.equal(f.game.view(f.player).actors.find(a => a.id === 'hero').hp, 10);
  f.game.command(f.player, f.input('move', { path: [{ x: 4, y: 1 }, { x: 3, y: 1 }] }));
  const after = f.game.load(f.player.campaign);
  assert.equal(after.actors.find(a => a.id === 'hero').hp, 8);
  assert.equal(after.turn, 1); assert.equal(after.effects.length, 1);
  assert.equal(f.game.events(f.host).filter(e => e.kind === 'effect_triggered').length, 2);
  assert.equal(after.effects[0].triggered.length, 0);
});

test('lethal exploration entry stops movement without inventing combat completion', t => {
  const f = fixture(t, { effects: [{ id: 'fire', name: 'Fire', trigger: 'enter', damage: 20, expiresAtTurn: 2, visible: true, cells: [{ x: 2, y: 1 }] }] });
  const world = f.game.world(f.player), receipt = f.game.command(f.player, f.input('move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] }));
  assert.equal(receipt.result.stopped, true); assert.deepEqual(receipt.result.path, [{ x: 2, y: 1 }]);
  assert.equal(f.game.view(f.player).phase, 'exploration'); assert.deepEqual(f.game.world(f.player), world);
  assert.throws(() => f.game.command(f.player, f.input('move', { path: [{ x: 3, y: 1 }] })), code('DEFEATED'));
});

test('players can pause exploration and only a current host can resume the same phase without an NPC', t => {
  const f = fixture(t), world = f.game.world(f.player);
  f.game.command(f.player, f.input('pause'));
  const paused = f.game.view(f.player);
  assert.equal(paused.phase, 'paused'); assert.equal(paused.resumePhase, 'exploration'); assert.equal(paused.activeActorId, null);
  assert.throws(() => f.game.command(f.player, f.input('move', { path: [{ x: 2, y: 1 }] })), code('PAUSED'));
  assert.throws(() => f.game.command(f.player, f.input('resume')), code('UNAUTHORIZED'));
  const request = f.input('resume'), receipt = f.game.command(f.host, request);
  assert.equal(f.game.view(f.player).phase, 'exploration'); assert.deepEqual(f.game.world(f.player), world);
  assert.deepEqual(f.game.command(f.host, request), receipt);
});

test('configuring an adjudicated mission preserves an existing pause and records exploration for resume', t => {
  const f = fixture(t, { configure: false });
  f.game.command(f.player, f.input('pause'));
  const before = f.game.view(f.host).revision;
  f.game.configureMission(f.host, f.mission);
  const paused = f.game.view(f.host);
  assert.equal(paused.phase, 'paused'); assert.equal(paused.resumePhase, 'exploration'); assert.equal(paused.revision, before + 1);
  f.game.command(f.host, f.input('resume'));
  assert.equal(f.game.view(f.player).phase, 'exploration');
});

test('exploration reach uses known route distance and current permission without imaginary combat turns', t => {
  const f = fixture(t), before = f.game.load(f.player.campaign);
  const query = () => assessReach(f.game, f.player, { expectedRevision: f.game.view(f.player).revision, actorId: 'hero', coordinate: 'D2' });
  const answer = query();
  assert.equal(answer.distanceFeet, 10); assert.equal(answer.movement.costFeet, 10); // Two diagonal steps avoid the difficult cell.
  assert.equal(answer.movement.budgetFeet, null); assert.equal(answer.movement.canReach, true); assert.equal(answer.movement.canMoveNow, true);
  assert.equal(answer.weapon.canAttackNow, false);
  assert.doesNotMatch(answer.summary.join(' '), /future.turn|wait for this character.s turn|feet of null/);
  assert.match(answer.movement.message, /24 grid steps/);
  assert.deepEqual(f.game.load(f.player.campaign), before);
  f.game.command(f.player, f.input('pause'));
  const paused = f.game.load(f.player.campaign), pausedAnswer = query();
  assert.equal(pausedAnswer.movement.canReach, true); assert.equal(pausedAnswer.movement.canMoveNow, false);
  assert.match(pausedAnswer.movement.message, /Play is paused/); assert.deepEqual(f.game.load(f.player.campaign), paused);
  const immobile = fixture(t, { speed: 0 });
  const blocked = assessReach(immobile.game, immobile.player, { expectedRevision: immobile.game.view(immobile.player).revision, actorId: 'hero', coordinate: 'D2' });
  assert.equal(blocked.movement.canReach, false); assert.equal(blocked.movement.canMoveNow, false);
});

test('legacy paused combat without resumePhase still resumes combat and keeps initiative ownership', t => {
  const f = fixture(t, { configure: false });
  f.game.command(f.player, f.input('pause'));
  const state = f.game.load(f.player.campaign); delete state.resumePhase; f.game.save(state);
  f.game.command(f.host, f.input('resume'));
  assert.equal(f.game.view(f.player).phase, 'combat');
  assert.throws(() => f.game.command(f.player, f.input('move', { path: [{ x: 2, y: 1 }] })), code('TURN'));
});
