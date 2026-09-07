import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { GameStore } from './store.mjs';
import { backupGame, restoreGameBackup, verifyGameBackup } from './backup.mjs';

function fixture(t, { reactors = 2 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'raph-reactions-backup-'));
  const file = join(root, 'source.sqlite'), stores = new Set();
  let rolls = 0;
  t.after(() => {
    for (const game of stores) game.close();
    const target = resolve(root), temporary = resolve(tmpdir());
    assert.ok(target.startsWith(temporary + sep) && target.slice(temporary.length + 1).startsWith('raph-reactions-backup-'));
    rmSync(target, { recursive: true, force: true });
  });
  const open = (path, { forbidRolls = false } = {}) => {
    const game = new GameStore(path, { rollDie: sides => {
      assert.equal(forbidRolls, false, 'A restored retry must not roll dice again.');
      rolls++;
      return sides === 20 ? 15 : 1;
    } });
    stores.add(game);
    return game;
  };
  const game = open(file), campaign = 'reaction-recovery';
  const scopes = Object.fromEntries(['host', 'player', 'alpha', 'beta'].map(owner => [owner, { campaign, owner }]));
  const weapon = { name: 'Reviewed fixture sword', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 4, addAbilityToDamage: true, rangeFeet: 5 };
  const base = { size: 1, hp: 30, maxHp: 30, ac: 12, speed: 30, vision: 12, characterVersion: 'reviewed-profile-v1', weapon, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } };
  const actors = [
    { ...base, id: 'mover', name: 'Mover', owner: 'player', team: 'party', x: 2, y: 2, initiative: 20 },
    { ...base, id: 'alpha-actor', name: 'Alpha', owner: 'alpha', team: 'foes', x: 1, y: 1, initiative: 10 },
  ];
  if (reactors === 2) actors.push({ ...base, id: 'beta-actor', name: 'Beta', owner: 'beta', team: 'foes', x: 1, y: 3, initiative: 5 });
  game.createCampaign({ campaign, title: 'Reaction recovery fixture', members: Object.keys(scopes).map(owner => ({ owner, role: owner === 'host' ? 'host' : 'player' })), map: { id: 'room', title: 'Room', width: 12, height: 12, blocked: [], difficult: [] }, actors, effects: [] });
  const move = { requestId: 'authorized-move', expectedRevision: game.view(scopes.player).revision, actorId: 'mover', type: 'move', path: [{ x: 3, y: 2 }, { x: 4, y: 2 }] };
  const moveReceipt = game.command(scopes.player, move);
  assert.equal(game.reactions(scopes.player).pending.stage, 'declare');
  const reopen = (previous, path, options) => { previous.close(); stores.delete(previous); return open(path, options); };
  return { root, file, game, scopes, move, moveReceipt, open, reopen, rolls: () => rolls };
}

function declaration(game, scope, decision, requestId) {
  const current = game.reactions(scope);
  assert.equal(current.pending.offers.length, 1);
  return { requestId, expectedRevision: current.revision, pendingId: current.pending.id, decision, optionId: current.pending.offers[0].optionId };
}

function orderRequest(game, scope, optionIds, requestId = 'chosen-order') {
  const current = game.reactions(scope);
  return { requestId, expectedRevision: current.revision, pendingId: current.pending.id, decision: 'order', order: optionIds };
}

function receipts(game) {
  return game.db.prepare('SELECT campaign,owner,request,fingerprint,body FROM game_receipts ORDER BY campaign,owner,request').all();
}

function snapshot(game, f) {
  return { state: game.load(f.scopes.host.campaign), events: game.events(f.scopes.host), receipts: receipts(game), reactions: Object.fromEntries(Object.entries(f.scopes).map(([owner, scope]) => [owner, game.reactions(scope)])) };
}

function restore(f, name, options) {
  const backup = join(f.root, `${name}-backup`), destination = join(f.root, `${name}-restored`);
  const manifest = backupGame(f.file, backup);
  assert.deepEqual(verifyGameBackup(backup), manifest);
  const report = restoreGameBackup(backup, destination);
  assert.equal(report.status, 'restored_to_new_directory');
  const file = join(destination, 'game.sqlite');
  return { game: f.open(file, options), file };
}

test('restore preserves a saved attack declaration while another reactor has not decided', t => {
  const f = fixture(t), first = declaration(f.game, f.scopes.alpha, 'attack', 'alpha-declaration');
  const declarationReceipt = f.game.resolveReaction(f.scopes.alpha, first);
  const before = snapshot(f.game, f), rollsBefore = f.rolls();
  const { game: restored } = restore(f, 'declaration');
  assert.deepEqual(snapshot(restored, f), before);
  assert.deepEqual(restored.resolveReaction(f.scopes.alpha, first), declarationReceipt);
  assert.deepEqual(snapshot(restored, f), before);
  assert.equal(f.rolls(), rollsBefore);
  const second = declaration(restored, f.scopes.beta, 'decline', 'beta-decline');
  const secondReceipt = restored.resolveReaction(f.scopes.beta, second);
  assert.equal(restored.reactions(f.scopes.player).pending, null);
  const actor = restored.load(f.scopes.host.campaign).actors.find(a => a.id === 'mover');
  assert.deepEqual({ x: actor.x, y: actor.y }, { x: 4, y: 2 });
  assert.ok(f.rolls() > rollsBefore);
  const settled = snapshot(restored, f), resolvedRolls = f.rolls();
  assert.deepEqual(restored.resolveReaction(f.scopes.alpha, first), declarationReceipt);
  assert.deepEqual(restored.resolveReaction(f.scopes.beta, second), secondReceipt);
  assert.deepEqual(snapshot(restored, f), settled);
  assert.equal(f.rolls(), resolvedRolls);
  assert.deepEqual(snapshot(f.game, f), before, 'resolving the restored copy leaves the source unchanged');
});

test('restore preserves explicit simultaneous ordering and executes only the selected order', t => {
  const f = fixture(t);
  const alpha = declaration(f.game, f.scopes.alpha, 'attack', 'alpha-declaration');
  f.game.resolveReaction(f.scopes.alpha, alpha);
  const beta = declaration(f.game, f.scopes.beta, 'attack', 'beta-declaration');
  f.game.resolveReaction(f.scopes.beta, beta);
  assert.equal(f.game.reactions(f.scopes.player).pending.stage, 'order');
  const before = snapshot(f.game, f), rollsBefore = f.rolls();
  const { game: restored } = restore(f, 'ordering');
  assert.deepEqual(snapshot(restored, f), before);
  assert.equal(f.rolls(), rollsBefore);
  const request = orderRequest(restored, f.scopes.player, [beta.optionId, alpha.optionId]);
  assert.throws(() => restored.resolveReaction(f.scopes.alpha, request));
  assert.deepEqual(snapshot(restored, f), before);
  const result = restored.resolveReaction(f.scopes.player, request);
  const alphaResult = restored.reactions(f.scopes.alpha).recentResults[0];
  const betaResult = restored.reactions(f.scopes.beta).recentResults[0];
  assert.equal(alphaResult.result.declarationRequestId, alpha.requestId);
  assert.equal(betaResult.result.declarationRequestId, beta.requestId);
  assert.ok(betaResult.revision < alphaResult.revision, 'Beta resolves before Alpha as the mover selected');
  assert.equal(restored.reactions(f.scopes.player).pending, null);
  const settled = snapshot(restored, f), resolvedRolls = f.rolls();
  assert.deepEqual(restored.resolveReaction(f.scopes.player, request), result);
  assert.deepEqual(snapshot(restored, f), settled);
  assert.equal(f.rolls(), resolvedRolls);
});

test('completed owner-private attack receipts survive restore and a second restart without rerolling', t => {
  const f = fixture(t, { reactors: 1 }), request = declaration(f.game, f.scopes.alpha, 'attack', 'alpha-declaration');
  const originalDeclaration = f.game.resolveReaction(f.scopes.alpha, request);
  const results = f.game.reactions(f.scopes.alpha).recentResults;
  assert.equal(results.length, 1);
  assert.equal(results[0].result.type, 'attack');
  assert.equal(results[0].result.reaction, true);
  assert.equal(results[0].result.declarationRequestId, request.requestId);
  assert.notEqual(results[0].requestId, originalDeclaration.requestId, 'resolution has its own retained receipt');
  const before = snapshot(f.game, f), rollsBefore = f.rolls();
  const restored = restore(f, 'completed', { forbidRolls: true });
  assert.deepEqual(snapshot(restored.game, f), before);
  const restarted = f.reopen(restored.game, restored.file, { forbidRolls: true });
  assert.deepEqual(snapshot(restarted, f), before);
  for (const owner of ['player', 'beta', 'host']) assert.deepEqual(restarted.reactions(f.scopes[owner]).recentResults, []);
  assert.deepEqual(restarted.reactions(f.scopes.alpha).recentResults, results);
  assert.deepEqual(restarted.command(f.scopes.player, f.move), f.moveReceipt);
  assert.deepEqual(restarted.resolveReaction(f.scopes.alpha, request), originalDeclaration);
  assert.deepEqual(snapshot(restarted, f), before);
  assert.equal(f.rolls(), rollsBefore);
});

test('restored pending movement blocks a scene transition without altering any declaration or receipt', t => {
  const f = fixture(t), request = declaration(f.game, f.scopes.alpha, 'attack', 'alpha-declaration');
  f.game.resolveReaction(f.scopes.alpha, request);
  const { game: restored } = restore(f, 'scene-guard', { forbidRolls: true });
  const before = snapshot(restored, f);
  assert.throws(() => restored.transitionScene(f.scopes.host, { requestId: 'leave-during-reaction' }), { code: 'PENDING' });
  assert.throws(() => restored.prepareDeparture(f.scopes.host, { requestId: 'offer-during-reaction' }), { code: 'PENDING' });
  assert.deepEqual(snapshot(restored, f), before);
});
