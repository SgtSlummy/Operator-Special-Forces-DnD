import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';

const host = { campaign: 'focus', owner: 'host' }, player = { campaign: 'focus', owner: 'player' };
const profile = () => ({ attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } });
const actor = (id, owner, x, initiative) => ({ id, owner, team: owner ?? 'enemy', name: id, x, y: 1, size: 1, hp: 40, maxHp: 40, ac: 10, speed: 30, vision: 12, initiative, characterVersion: 'v1', combatCapabilities: profile(), ...(owner ? { combatReview: { constitutionProficiencyReason: 'Reviewed fighter saving throw proficiency.' } } : {}), weapon: { name: 'Spear', abilityScore: 10, proficiencyBonus: 0, proficient: false, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 } });
const hazard = (id, damage, trigger = 'enter', x = 2) => ({ id, name: id, damage, trigger, expiresAtTurn: 99, visible: true, cells: [{ x, y: 1 }] });
function fixture({ effects = [], incoming = false, path = ':memory:', rolls = [] } = {}) {
  const dice = [...rolls], rolled = [];
  const rollDie = sides => { const value = dice.length ? dice.shift() : sides; rolled.push({ sides, value }); return value; };
  let game = new GameStore(path, { rollDie });
  game.createCampaign({ campaign: 'focus', title: 'Concentration fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }], map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('hero', 'player', 1, incoming ? 10 : 20), actor('guard', null, 7, incoming ? 20 : 10)], effects });
  return { get game() { return game; }, rolled, dice, reopen() { game.close(); game = new GameStore(path, { rollDie }); }, close() { game.close(); } };
}
function start(f, actorId = 'hero', effectIds = []) {
  return f.game.resolveConcentration(host, { requestId: `start_${actorId}`, expectedRevision: f.game.view(host).revision, action: 'start', actorId, characterVersion: 'v1', sourceLabel: 'Reviewed ward', effectIds, reviewed: true, reason: 'Reviewed the ongoing concentration source.' });
}
function command(f, scope, actorId, type, rest = {}) {
  return f.game.command(scope, { requestId: `${type}_${f.game.view(scope).revision}`, expectedRevision: f.game.view(scope).revision, actorId, type, ...rest });
}
function saveInput(f, requestId = `save_${f.game.view(player).revision}`) {
  return { requestId, expectedRevision: f.game.view(player).revision, action: 'resolve', pendingId: f.game.load('focus').pendingConcentration.id };
}
const kinds = (f, kind) => f.game.events(host).filter(e => e.kind === kind);

test('ordinary attack saves damage and spent action before concentration; retry cannot attack twice', () => {
  const f = fixture({ incoming: true, rolls: [12, 4, 20] });
  try {
    start(f);
    command(f, host, 'guard', 'move', { path: [6, 5, 4, 3, 2].map(x => ({ x, y: 1 })) });
    const input = { requestId: 'attack_focus', expectedRevision: f.game.view(host).revision, type: 'attack', actorId: 'guard', targetId: 'hero' };
    const receipt = f.game.command(host, input), pending = f.game.load('focus');
    assert.equal(pending.actors[0].hp, 36); assert.equal(pending.actionAvailable, false); assert.ok(pending.pendingConcentration); assert.equal(pending.continuations, undefined);
    const snapshot = JSON.parse(f.game.db.prepare('SELECT snapshot FROM game_outbox WHERE campaign=? AND revision=?').get('focus', receipt.revision).snapshot);
    assert.equal(snapshot.actors[0].hp, 36); assert.equal(snapshot.actionAvailable, false); assert.ok(snapshot.pendingConcentration);
    assert.deepEqual(f.game.command(host, input), receipt); assert.equal(f.rolled.length, 2);
    f.game.resolveConcentration(player, saveInput(f));
    assert.equal(f.game.load('focus').actors[0].hp, 36); assert.equal(f.game.load('focus').actionAvailable, false); assert.equal(f.rolled.length, 3);
    assert.equal(kinds(f, 'attack_resolved').length, 1);
  } finally { f.close(); }
});

test('current and historical map projections never promise mutation authority after reviewer revocation', () => {
  const f = fixture({ effects: [hazard('first', 4)] });
  try {
    start(f); command(f, player, 'hero', 'move', { path: [{ x: 2, y: 1 }] });
    const recovery = { campaign: 'focus', owner: 'recovery' };
    f.game.db.prepare('INSERT INTO game_members VALUES(?,?,?)').run('focus', 'recovery', 'host');
    f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run('focus', 'host');
    const before = f.game.load('focus');
    for (const scope of [player, recovery]) {
      const projections = [f.game.view(scope), ...f.game.updates(scope, 0, 50).views].filter(view => view.pendingConcentration);
      for (const view of projections) for (const key of ['canResolve', 'canEnd', 'canRefresh']) assert.equal(Object.hasOwn(view.pendingConcentration, key), false);
    }
    assert.equal(f.game.concentration(player).pending.canResolve, false); assert.equal(f.game.concentration(player).pending.recoveryRequired, true);
    assert.equal(f.game.concentration(recovery).pending.canRefresh, true); assert.deepEqual(f.game.load('focus'), before);
  } finally { f.close(); }
});

test('trusted seed preserves reviewed sources and rejects shared concentration effect bindings', () => {
  const f = fixture({ effects: [hazard('ward1', 0, 'enter', 10), hazard('ward2', 0, 'enter', 11)] });
  try {
    start(f, 'hero', ['ward1']); start(f, 'guard', ['ward2']);
    const seed = { ...f.game.load('focus'), campaign: 'copy', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }] };
    f.game.createCampaign(seed);
    assert.deepEqual(f.game.load('copy').actors.map(a => a.concentration), seed.actors.map(a => a.concentration));
    seed.campaign = 'badcopy'; seed.actors[1].concentration.effects = structuredClone(seed.actors[0].concentration.effects);
    assert.throws(() => f.game.createCampaign(seed), { code: 'INVALID' }); assert.equal(f.game.hasCampaign('badcopy'), false);
  } finally { f.close(); }
});

test('overlapping hazards wait for separate saves, then resume remaining movement once', () => {
  const f = fixture({ effects: [hazard('first', 4), hazard('second', 6)] });
  try {
    start(f);
    const movement = command(f, player, 'hero', 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] });
    let state = f.game.load('focus');
    assert.equal(state.actors[0].hp, 36); assert.equal(state.actors[0].x, 2); assert.equal(state.movementRemaining, 25);
    assert.deepEqual(state.continuations.map(v => v.kind), ['move', 'effects']);
    const first = saveInput(f, 'save_first'), receipt = f.game.resolveConcentration(player, first);
    state = f.game.load('focus'); assert.equal(state.actors[0].hp, 30); assert.equal(state.actors[0].x, 2); assert.ok(state.pendingConcentration);
    const count = f.rolled.length;
    assert.deepEqual(f.game.resolveConcentration(player, first), receipt); assert.equal(f.rolled.length, count);
    f.game.resolveConcentration(player, saveInput(f, 'save_second'));
    state = f.game.load('focus');
    assert.equal(state.actors[0].x, 4); assert.equal(state.actors[0].hp, 30); assert.equal(state.movementRemaining, 15);
    assert.equal(state.turn, 1); assert.equal(state.actionAvailable, true); assert.equal(state.pendingConcentration, undefined); assert.equal(state.continuations, undefined);
    assert.equal(kinds(f, 'effect_triggered').length, 2); assert.equal(kinds(f, 'actor_moved').length, 3); assert.equal(f.rolled.length, 2);
    assert.equal(movement.result.stopped, true);
  } finally { f.close(); }
});

test('failed save removes a bound later hazard without skipping an unrelated stable effect', () => {
  const f = fixture({ effects: [hazard('first', 4), hazard('bound', 6), hazard('third', 3)], rolls: [1] });
  try {
    start(f, 'hero', ['bound']);
    command(f, player, 'hero', 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    f.game.resolveConcentration(player, saveInput(f));
    const state = f.game.load('focus');
    assert.equal(state.actors[0].hp, 33); assert.equal(state.actors[0].x, 3); assert.equal(state.actors[0].concentration, undefined);
    assert.deepEqual(kinds(f, 'effect_triggered').map(e => e.body.effectId), ['first', 'third']);
    assert.deepEqual(state.effects.map(e => e.id), ['first', 'third']); assert.equal(state.continuations, undefined);
  } finally { f.close(); }
});

test('first damage snapshot includes pending save, HP and remaining work; pause preserves it', () => {
  const f = fixture({ effects: [hazard('first', 4), hazard('second', 6)] });
  try {
    start(f); command(f, player, 'hero', 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    const event = kinds(f, 'effect_triggered')[0];
    const snapshot = JSON.parse(f.game.db.prepare('SELECT snapshot FROM game_outbox WHERE campaign=? AND revision=?').get('focus', event.revision).snapshot);
    assert.equal(snapshot.actors[0].hp, 36); assert.ok(snapshot.pendingConcentration); assert.deepEqual(snapshot.continuations.map(v => v.kind), ['move', 'effects']);
    const frames = structuredClone(snapshot.continuations), pending = structuredClone(snapshot.pendingConcentration);
    command(f, player, 'hero', 'pause');
    assert.throws(() => f.game.resolveConcentration(player, saveInput(f)), { code: 'PAUSED' });
    assert.deepEqual(f.game.load('focus').continuations, frames); assert.deepEqual(f.game.load('focus').pendingConcentration, pending); assert.equal(f.rolled.length, 0);
    command(f, host, 'guard', 'resume'); f.game.resolveConcentration(player, saveInput(f));
    assert.equal(f.game.load('focus').actors[0].hp, 30);
  } finally { f.close(); }
});

test('end-turn save finishes the old turn exactly once before starting the next actor', () => {
  const f = fixture({ effects: [hazard('end', 4, 'end_turn', 1)] });
  try {
    start(f); command(f, player, 'hero', 'end_turn');
    assert.equal(f.game.load('focus').turn, 1); assert.equal(kinds(f, 'turn_ended').length, 0);
    f.game.resolveConcentration(player, saveInput(f));
    const state = f.game.load('focus'); assert.equal(state.turn, 2); assert.equal(state.order[state.activeIndex], 'guard');
    assert.equal(kinds(f, 'turn_ended').length, 1); assert.equal(kinds(f, 'turn_started').length, 1); assert.equal(state.continuations, undefined);
  } finally { f.close(); }
});

test('incoming start-turn save retains the already refreshed turn and action budget', () => {
  const f = fixture({ incoming: true, effects: [hazard('start', 4, 'start_turn', 1)] });
  try {
    start(f); command(f, host, 'guard', 'end_turn');
    let state = f.game.load('focus'); assert.equal(state.turn, 2); assert.equal(state.order[state.activeIndex], 'hero'); assert.equal(state.movementRemaining, 30);
    f.game.resolveConcentration(player, saveInput(f));
    state = f.game.load('focus'); assert.equal(state.turn, 2); assert.equal(state.actors[0].hp, 36); assert.equal(state.actionAvailable, true);
    assert.equal(kinds(f, 'turn_started').length, 1); assert.equal(state.continuations, undefined);
  } finally { f.close(); }
});

test('lethal hazard ends its exact bound source without requiring a save or repeating later effects', () => {
  const f = fixture({ effects: [hazard('lethal', 50, 'end_turn', 1), hazard('bound', 0), hazard('later', 3, 'end_turn', 1)] });
  try {
    start(f, 'hero', ['bound']); command(f, player, 'hero', 'end_turn');
    const state = f.game.load('focus'); assert.equal(state.actors[0].hp, 0); assert.equal(state.actors[0].concentration, undefined); assert.equal(state.pendingConcentration, undefined);
    assert.equal(state.phase, 'complete'); assert.equal(state.continuations, undefined); assert.equal(f.rolled.length, 0);
    assert.deepEqual(kinds(f, 'effect_triggered').map(e => e.body.effectId), ['lethal']); assert.ok(!state.effects.some(e => e.id === 'bound'));
  } finally { f.close(); }
});

test('pending hazard and original movement receipt survive restart without repeating damage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raphael-concentration-'));
  const f = fixture({ path: join(dir, 'game.db'), effects: [hazard('first', 4), hazard('second', 6)] });
  try {
    start(f); const input = { requestId: 'route', expectedRevision: f.game.view(player).revision, actorId: 'hero', type: 'move', path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] };
    const receipt = f.game.command(player, input), saved = f.game.load('focus'); f.reopen();
    assert.deepEqual(f.game.load('focus'), saved); assert.deepEqual(f.game.command(player, input), receipt);
    f.game.resolveConcentration(player, saveInput(f, 'first_save')); f.reopen(); f.game.resolveConcentration(player, saveInput(f, 'second_save'));
    assert.equal(f.game.load('focus').actors[0].hp, 30); assert.equal(f.game.load('focus').actors[0].x, 3); assert.equal(kinds(f, 'effect_triggered').length, 2); assert.equal(f.rolled.length, 2);
    assert.deepEqual(f.game.command(player, input), receipt);
  } finally { f.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('revoked mover cannot resume a paid route after concentration recovery', () => {
  const f = fixture({ effects: [hazard('first', 4)] });
  try {
    start(f); command(f, player, 'hero', 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    const pendingId = f.game.load('focus').pendingConcentration.id;
    f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run('focus', 'player');
    f.game.resolveConcentration(host, { requestId: 'recover', expectedRevision: f.game.view(host).revision, action: 'refresh', pendingId, reviewed: true, reason: 'The player no longer belongs to the campaign.' });
    const state = f.game.load('focus'); assert.equal(state.actors[0].x, 2); assert.equal(state.movementRemaining, 25); assert.equal(state.continuations, undefined); assert.equal(f.rolled.length, 0);
    assert.equal(kinds(f, 'movement_stopped').length, 1);
  } finally { f.close(); }
});
