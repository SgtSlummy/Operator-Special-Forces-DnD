import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { GameStore } from './store.mjs';

const scope = { campaign: 'turn-start', owner: 'alice' }, host = { ...scope, owner: 'host' };
function actor(id, owner, x, initiative) {
  return { id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp: 5, maxHp: 5, ac: 10, speed: 30, vision: 8, initiative, characterVersion: 'fixture',
    weapon: { name: 'Bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } };
}
function seed(actors, effects) {
  return { campaign: scope.campaign, title: 'Turn-start fixture', members: [{ owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }, { owner: 'host', role: 'host' }],
    map: { id: 'board', title: 'Board', width: 12, height: 12, blocked: [{ x: 9, y: 9 }], difficult: [] }, actors, effects };
}
const hazard = (id, x, damage = 5, expiresAtTurn = 10) => ({ id, name: id, trigger: 'start_turn', damage, expiresAtTurn, visible: true, cells: [{ x, y: 1 }] });
const end = game => ({ requestId: 'end-one', expectedRevision: game.view(scope).revision, actorId: 'hero', type: 'end_turn' });
const ledger = game => ({ state: game.load(scope.campaign), events: game.events(host), receipts: game.receipts(scope), frames: game.updates(scope, 0) });
function memory(t, data) {
  const game = new GameStore(':memory:', { rollDie: () => { throw new Error('Turn effects must not roll dice'); } });
  t.after(() => game.close()); game.createCampaign(data); return game;
}

test('lethal incoming turn effect completes the encounter in the same receipt and survives restart', t => {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'raph-turn-start-'));
  t.after(() => { const target = resolve(root); assert.equal(dirname(target), parent); assert.ok(basename(target).startsWith('raph-turn-start-')); rmSync(target, { recursive: true }); });
  const file = join(root, 'game.sqlite'); let game = new GameStore(file, { rollDie: () => { throw new Error('No dice expected'); } });
  try {
    game.createCampaign(seed([actor('hero', 'alice', 1, 20), actor('foe', null, 3, 10)], [hazard('fire', 3)]));
    game.configureMission(host, { reviewed: true, tracks: [{ id: 'safety', kind: 'location', label: 'Safety', value: 10 }], mission: { id: 'crossing', title: 'Crossing', briefing: 'A fixture encounter.', mapId: 'board', successTeam: 'party', success: { summary: 'The crossing is safe.', changes: [{ trackId: 'safety', delta: 2 }] }, failure: { summary: 'The crossing remains dangerous.', changes: [] } } });
    const request = end(game), receipt = game.command(scope, request);
    assert.equal(receipt.result.complete, true);
    assert.equal(game.view(scope).phase, 'complete');
    assert.equal(game.load(scope.campaign).actors.find(a => a.id === 'foe').hp, 0);
    assert.deepEqual(game.events(host).slice(-4).map(e => e.kind), ['turn_started', 'effect_triggered', 'turn_ended', 'encounter_completed']);
    assert.equal(game.world(scope).mission.status, 'debrief');
    assert.equal(game.world(scope).tracks[0].value, 12);
    const before = ledger(game), world = game.world(scope);
    game.close(); game = new GameStore(file, { rollDie: () => { throw new Error('Retry must not roll'); } });
    assert.deepEqual(game.command(scope, request), receipt);
    assert.deepEqual(ledger(game), before); assert.deepEqual(game.world(scope), world);
  } finally { game.close(); }
});

test('defeated incoming party member is skipped without requiring its player to end the turn', t => {
  const game = memory(t, seed([actor('hero', 'alice', 1, 20), actor('ally', 'bob', 3, 15), actor('foe', null, 5, 10)], [hazard('fire', 3)]));
  const result = game.command(scope, end(game)).result, state = game.load(scope.campaign);
  assert.equal(state.phase, 'combat'); assert.equal(state.order[state.activeIndex], 'foe'); assert.equal(state.turn, 3);
  assert.equal(state.actors.find(a => a.id === 'ally').hp, 0); assert.equal(state.movementRemaining, 30); assert.equal(state.actionAvailable, true);
  assert.equal(result.turn, 3); assert.equal(result.round, 1);
  const ended = game.events(host).filter(e => e.kind === 'turn_ended').map(e => e.body.actorId);
  assert.deepEqual(ended, ['hero', 'ally']);
});

test('consecutive lethal turn effects settle to a living actor and preserve expiry ordering', t => {
  const data = seed([actor('hero', 'alice', 1, 20), actor('ally-one', 'bob', 3, 15), actor('ally-two', 'bob', 5, 12), actor('foe', null, 7, 10)],
    [hazard('first', 3), hazard('second', 5), hazard('expired-before-foe', 7, 5, 4)]);
  const game = memory(t, data); game.command(scope, end(game)); const state = game.load(scope.campaign);
  assert.equal(state.phase, 'combat'); assert.equal(state.order[state.activeIndex], 'foe'); assert.equal(state.turn, 4);
  assert.equal(state.actors.find(a => a.id === 'foe').hp, 5);
  const events = game.events(host);
  assert.deepEqual(events.filter(e => e.kind === 'effect_triggered').map(e => e.body.effectId), ['first', 'second']);
  const expired = events.findIndex(e => e.kind === 'effect_expired');
  assert.ok(expired >= 0); assert.equal(events[expired + 1].kind, 'turn_started'); assert.equal(events[expired + 1].body.actorId, 'foe');
});

test('initial turn-start defeat settles before campaign creation returns', t => {
  const game = memory(t, seed([actor('hero', 'alice', 1, 20), actor('ally', 'bob', 3, 15), actor('foe', null, 5, 10)], [hazard('fire', 1)]));
  const state = game.load(scope.campaign);
  assert.equal(state.phase, 'combat'); assert.equal(state.order[state.activeIndex], 'ally'); assert.equal(state.turn, 2);
  assert.equal(state.actors.find(a => a.id === 'hero').hp, 0);
  const before = ledger(game); game.view(scope); game.view({ ...scope, owner: 'bob' }); assert.deepEqual(ledger(game), before);
});

test('failure while recording lethal turn completion rolls back all effects and revisions', t => {
  const game = memory(t, seed([actor('hero', 'alice', 1, 20), actor('foe', null, 3, 10)], [hazard('fire', 3)]));
  const request = end(game), before = ledger(game);
  game.db.exec("CREATE TRIGGER reject_completion BEFORE INSERT ON game_events WHEN NEW.kind='encounter_completed' BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  assert.throws(() => game.command(scope, request)); assert.deepEqual(ledger(game), before);
  game.db.exec('DROP TRIGGER reject_completion');
  const receipt = game.command(scope, request); assert.equal(receipt.result.complete, true);
  assert.equal(game.events(host).filter(e => e.kind === 'effect_triggered').length, 1);
  assert.equal(game.events(host).filter(e => e.kind === 'encounter_completed').length, 1);
});

test('nonlethal and already-expired start effects leave the living incoming actor in control', t => {
  for (const [damage, expiry, hp] of [[1, 10, 4], [5, 2, 5]]) {
    const game = memory(t, seed([actor('hero', 'alice', 1, 20), actor('foe', null, 3, 10)], [hazard('fire', 3, damage, expiry)]));
    const receipt = game.command(scope, end(game)), state = game.load(scope.campaign);
    assert.equal(state.phase, 'combat'); assert.equal(state.order[state.activeIndex], 'foe'); assert.equal(state.turn, 2);
    assert.equal(state.actors.find(a => a.id === 'foe').hp, hp); assert.equal(receipt.result.complete, undefined);
    assert.equal(game.events(host).filter(e => e.kind === 'turn_ended').length, 1);
  }
});
