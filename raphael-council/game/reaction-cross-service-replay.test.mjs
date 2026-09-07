import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GameStore } from './store.mjs';

const campaign = 'reaction_replay';
const host = { campaign, owner: 'host' };
const player = { campaign, owner: 'player' };
const other = { campaign, owner: 'other' };
const map = id => ({ id, title: id, width: 8, height: 8, blocked: [], difficult: [] });
const weapon = { name: 'Reviewed blade', abilityScore: 20, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const actor = (id, owner, x, initiative, hp = 30) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y: 2, size: 1, hp, maxHp: 30, ac: 10, speed: 30, vision: 8, initiative, characterVersion: 'reviewed_fixture', weapon });
const mission = (id, mapId) => ({ id, title: id, briefing: 'Reviewed fixture briefing.', mapId, successTeam: 'party', success: { summary: 'Finished.', changes: [] }, failure: { summary: 'Withdrawn.', changes: [] } });

function snapshot(game) {
  return JSON.stringify(game.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({
    name, rows: game.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
  })));
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-reaction-replay-'));
  const path = join(directory, 'game.sqlite');
  let rolls = 0;
  const open = () => new GameStore(path, { rollDie: () => { rolls++; return 2; } });
  let game = open();
  t.after(() => {
    game.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('raph-reaction-replay-'));
    rmSync(target, { recursive: true, force: true });
  });
  game.createCampaign({ campaign, title: 'Replay regression fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }], map: map('first_map'), actors: [actor('hero', 'player', 2, 20), { ...actor('first_guard', null, 3, 10, 1), ac: 1 }], effects: [] });
  game.configureMission(host, { reviewed: true, tracks: [], mission: mission('first', 'first_map') });
  game.command(player, { requestId: 'fixture_finish', expectedRevision: game.view(player).revision, type: 'attack', actorId: 'hero', targetId: 'first_guard' });
  assert.equal(game.load(campaign).actors.find(item => item.id === 'first_guard').hp, 0);
  game.command(player, { requestId: 'fixture_end_turn', expectedRevision: game.view(player).revision, type: 'end_turn', actorId: 'hero' });
  assert.equal(game.load(campaign).phase, 'complete');
  // Arrange the prior debrief/selected branch only. Receipts under test below
  // are created by real services, never inserted or patched by this fixture.
  const world = JSON.parse(game.db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(campaign).body);
  world.mission.status = 'complete';
  world.nextMission = { id: 'second', title: 'second' };
  game.db.prepare('UPDATE world_campaigns SET body=? WHERE campaign=?').run(JSON.stringify(world), campaign);
  return {
    get game() { return game; },
    get rolls() { return rolls; },
    restart() { game.close(); game = open(); },
  };
}

function transitionInput(game, requestId, mapId = 'second_map') {
  return {
    requestId, expectedRevision: game.view(host).revision, expectedWorldRevision: game.world(host).revision, reviewed: true,
    destination: { mapId, map: map(mapId), npcs: [{ ...actor('reactor', null, 3, 10), combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } }], effects: [] },
    placements: [{ actorId: 'hero', x: 2, y: 2 }], mission: mission('second', mapId),
  };
}

function savedService(t, service) {
  const context = fixture(t);
  const game = context.game;
  let scope, input, changed, receipt, preparation;
  if (service === 'enterDeparture') {
    const alternate = game.prepareDeparture(host, transitionInput(game, 'prepare_alternate', 'alternate_map'));
    preparation = transitionInput(game, 'prepare_chosen');
    const chosen = game.prepareDeparture(host, preparation);
    scope = player;
    input = { departureId: chosen.id, requestId: 'saved_departure' };
    changed = { ...input, departureId: alternate.id };
    receipt = game.enterDeparture(scope, input);
  } else {
    preparation = transitionInput(game, 'saved_transition');
    receipt = game.transitionScene(host, preparation);
    scope = host;
    input = preparation;
    changed = { ...input, expectedRevision: input.expectedRevision + 1 };
    if (service === 'askCounsel') {
      scope = player;
      input = { requestId: 'saved_counsel', topic: 'surroundings', expectedRevision: game.view(player).revision, expectedWorldRevision: game.world(player).revision };
      changed = { ...input, expectedRevision: input.expectedRevision + 1 };
      receipt = game.askCounsel(scope, input);
    }
  }
  return { context, scope, input, changed, receipt, preparation, replay: () => context.game[service](scope, input) };
}

function suspend(context) {
  const game = context.game;
  const receipt = game.command(player, { requestId: 'suspended_move', expectedRevision: game.view(player).revision, type: 'move', actorId: 'hero', path: [{ x: 1, y: 2 }] });
  assert.equal(receipt.result.stopped, true);
  assert.ok(game.load(campaign).pendingReaction);
  assert.equal(game.load(campaign).actors.find(item => item.id === 'hero').x, 2);
}

function unchanged(context, work, expected) {
  const before = snapshot(context.game), rolls = context.rolls;
  assert.deepEqual(work(), expected);
  assert.equal(snapshot(context.game), before, 'replay must not alter any state, pending decision, event, receipt, quota, or delivery row');
  assert.equal(context.rolls, rolls, 'replay must not roll dice');
}

function rejected(context, work, code) {
  const before = snapshot(context.game), rolls = context.rolls;
  assert.throws(work, error => error.code === code);
  assert.equal(snapshot(context.game), before, 'rejected replay must not write');
  assert.equal(context.rolls, rolls);
}

for (const service of ['transitionScene', 'enterDeparture', 'askCounsel']) {
  test(`${service} returns its immutable saved receipt during reactions, pause, and restart`, t => {
    const saved = savedService(t, service);
    suspend(saved.context);
    unchanged(saved.context, saved.replay, saved.receipt);
    saved.context.game.command(player, { requestId: 'pause_pending', expectedRevision: saved.context.game.view(player).revision, type: 'pause', actorId: 'hero' });
    assert.equal(saved.context.game.load(campaign).phase, 'paused');
    assert.ok(saved.context.game.load(campaign).pendingReaction);
    unchanged(saved.context, saved.replay, saved.receipt);
    const beforeRestart = snapshot(saved.context.game);
    saved.context.restart();
    assert.equal(snapshot(saved.context.game), beforeRestart);
    unchanged(saved.context, saved.replay, saved.receipt);
  });

  test(`${service} rejects changed payloads, foreign owners, new requests, and revoked membership while pending`, t => {
    const saved = savedService(t, service);
    suspend(saved.context);
    const game = saved.context.game;
    rejected(saved.context, () => game[service](saved.scope, saved.changed), 'CONFLICT');
    rejected(saved.context, () => game[service](other, saved.input), 'PENDING');
    rejected(saved.context, () => game[service](saved.scope, { ...saved.input, requestId: 'new_request' }), 'PENDING');
    game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, saved.scope.owner);
    rejected(saved.context, saved.replay, 'UNAUTHORIZED');
  });
}

test('replay lookup cannot use a receipt from the wrong service table', t => {
  const saved = savedService(t, 'transitionScene');
  const game = saved.context.game;
  const counsel = { requestId: 'host_counsel', topic: 'mission', expectedRevision: game.view(host).revision, expectedWorldRevision: game.world(host).revision };
  game.askCounsel(host, counsel);
  suspend(saved.context);
  rejected(saved.context, () => game.askCounsel(host, { ...counsel, requestId: saved.input.requestId }), 'PENDING');
  rejected(saved.context, () => game.transitionScene(host, { ...saved.input, requestId: counsel.requestId }), 'PENDING');
  rejected(saved.context, () => game.enterDeparture(host, { departureId: 'missing_offer', requestId: counsel.requestId }), 'PENDING');
});

test('a game receipt lookup still delegates fingerprint validation for another command kind', t => {
  const saved = savedService(t, 'enterDeparture');
  suspend(saved.context);
  rejected(saved.context, () => saved.context.game.enterDeparture(player, { ...saved.input, requestId: 'suspended_move' }), 'CONFLICT');
  const game = saved.context.game;
  game.command(host, { requestId: 'host_pause', expectedRevision: game.view(host).revision, type: 'pause', actorId: 'hero' });
  rejected(saved.context, () => game.transitionScene(host, { ...saved.preparation, requestId: 'host_pause' }), 'CONFLICT');
});

test('saved host transition replays require current host authority', t => {
  const saved = savedService(t, 'transitionScene');
  suspend(saved.context);
  saved.context.game.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner='host'").run(campaign);
  rejected(saved.context, saved.replay, 'UNAUTHORIZED');
});

test('saved player departure replays recheck the reviewing host authority', t => {
  const saved = savedService(t, 'enterDeparture');
  suspend(saved.context);
  saved.context.game.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner='host'").run(campaign);
  rejected(saved.context, saved.replay, 'UNAUTHORIZED');
});

test('preparation and all unlisted mutation services remain blocked even with a saved transition request', t => {
  const saved = savedService(t, 'transitionScene');
  suspend(saved.context);
  const game = saved.context.game;
  const operations = [
    () => game.prepareDeparture(host, saved.input),
    () => game.requestCheck(null, host, saved.input),
    () => game.installContent(host, saved.input),
    () => game.prepareContentCouncil(host),
    () => game.prepareContentDeparture(host, saved.input.requestId),
    () => game.prepareCouncil(host, saved.input),
    () => game.chooseCouncil(host, saved.input),
    () => game.adjudicateMission(host, saved.input),
    () => game.configureMission(host, saved.input),
    () => game.debrief(host, saved.input),
  ];
  for (const work of operations) rejected(saved.context, work, 'PENDING');
});
