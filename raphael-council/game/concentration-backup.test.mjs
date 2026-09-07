import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { GameStore } from './store.mjs';
import { validateConcentrationPersistence } from './concentration.mjs';
import { backupGame, restoreGameBackup, verifyGameBackup } from './backup.mjs';

const sourceLabel = 'Privately reviewed ward';
const saveProfile = { abilityScore: 10, proficient: false, proficiencyBonus: 2, adjustments: [], advantage: [], disadvantage: [] };
const effect = (id, trigger, damage, cells) => ({ id, name: id, trigger, damage, cells, expiresAtTurn: 20, visible: true });
function fixture(t, { effects = [], reactors = false, characterVersion = 'reviewed-profile-v1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'raph-concentration-backup-'));
  const file = join(root, 'source.sqlite'), stores = new Set(), rolls = [], queue = [];
  let forbidRolls = false;
  const open = path => {
    const game = new GameStore(path, { rollDie: sides => {
      assert.equal(forbidRolls, false, 'Restoring, projecting and replaying must never reroll.');
      const value = queue.length ? queue.shift() : sides === 20 ? 15 : 2;
      assert.ok(value >= 1 && value <= sides);
      rolls.push({ sides, value });
      return value;
    } });
    stores.add(game);
    return game;
  };
  t.after(() => {
    for (const game of stores) game.close();
    const target = resolve(root), temporary = resolve(tmpdir());
    assert.ok(target.startsWith(temporary + sep) && target.slice(temporary.length + 1).startsWith('raph-concentration-backup-'));
    rmSync(target, { recursive: true, force: true });
  });
  const game = open(file), campaign = 'concentration-recovery';
  const scopes = Object.fromEntries(['host', 'player', 'alpha', 'beta'].map(owner => [owner, { campaign, owner }]));
  const weapon = { name: 'Reviewed sword', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 4, addAbilityToDamage: true, rangeFeet: 5 };
  const base = { size: 1, hp: 30, maxHp: 30, ac: 12, speed: 30, vision: 12, characterVersion, weapon, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: saveProfile }, combatReview: { constitutionProficiencyReason: 'Reviewed fixture has no Constitution save proficiency.' } };
  game.createCampaign({ campaign, title: 'Concentration recovery fixture', members: Object.keys(scopes).map(owner => ({ owner, role: owner === 'host' ? 'host' : 'player' })), map: { id: 'room', title: 'Room', width: 12, height: 12, blocked: [], difficult: [] }, actors: [
    { ...base, id: 'mover', name: 'Mover', owner: 'player', team: 'party', x: 2, y: 2, initiative: 20 },
    { ...base, id: 'alpha-actor', name: 'Alpha', owner: 'alpha', team: 'foes', x: reactors ? 1 : 8, y: reactors ? 1 : 8, initiative: 10 },
    { ...base, id: 'beta-actor', name: 'Beta', owner: 'beta', team: 'foes', x: reactors ? 1 : 9, y: reactors ? 3 : 8, initiative: 5 },
  ], effects });
  return { root, file, game, scopes, open, rolls, queue, forbid(value) { forbidRolls = value; } };
}
function focus(game, scope, input) { return game.resolveConcentration(scope, input); }
function start(f, actorId = 'mover', effectIds = []) {
  return focus(f.game, f.scopes.host, { requestId: `start-${actorId}`, expectedRevision: f.game.view(f.scopes.host).revision, action: 'start', actorId, characterVersion: f.game.load(f.scopes.host.campaign).actors.find(actor => actor.id === actorId).characterVersion, sourceLabel, effectIds, reviewed: true, reason: 'Record an already reviewed ongoing fixture effect.' });
}
function saveRequest(game, scope, requestId) {
  const current = game.concentration(scope);
  assert.equal(current.pending.canResolve, true);
  return { requestId, expectedRevision: current.revision, action: 'resolve', pendingId: current.pending.id };
}
function moveRequest(game, scope, path, requestId = 'move') {
  return { requestId, expectedRevision: game.view(scope).revision, actorId: 'mover', type: 'move', path };
}
function declaration(game, scope, requestId) {
  const current = game.reactions(scope);
  assert.equal(current.pending.offers.length, 1);
  return { requestId, expectedRevision: current.revision, pendingId: current.pending.id, decision: 'attack', optionId: current.pending.offers[0].optionId };
}
function snapshot(game, f) {
  return {
    state: game.load(f.scopes.host.campaign), events: game.events(f.scopes.host),
    receipts: game.db.prepare('SELECT campaign,owner,request,fingerprint,body FROM game_receipts ORDER BY campaign,owner,request').all(),
    outbox: game.db.prepare('SELECT campaign,revision,kind,snapshot,status FROM game_outbox ORDER BY campaign,revision,kind').all(),
    projections: Object.fromEntries(Object.entries(f.scopes).map(([owner, scope]) => [owner, { view: game.view(scope), concentration: game.concentration(scope), reactions: game.reactions(scope), rolls: game.rollHistory(scope) }])),
  };
}
function restore(f, sourceFile = f.file, name = 'pending') {
  const inspect = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    const state = JSON.parse(inspect.prepare('SELECT body FROM game_campaigns WHERE id=?').get(f.scopes.host.campaign).body);
    assert.doesNotThrow(() => validateConcentrationPersistence(state), `Current persisted continuations: ${JSON.stringify(state.continuations)}`);
    const frames = inspect.prepare("SELECT revision,snapshot FROM game_outbox WHERE campaign=? AND kind='projection' ORDER BY revision").all(f.scopes.host.campaign);
    assert.deepEqual(JSON.parse(frames.at(-1).snapshot), state, 'Final committed snapshot must equal the resumable state.');
    for (const frame of frames) {
      const saved = JSON.parse(frame.snapshot);
      assert.doesNotThrow(() => validateConcentrationPersistence(saved), `Historical revision ${frame.revision} continuations: ${JSON.stringify(saved.continuations)}`);
    }
  } finally { inspect.close(); }
  const backup = join(f.root, `${name}-backup`), destination = join(f.root, `${name}-restored`);
  const manifest = backupGame(sourceFile, backup);
  assert.deepEqual(verifyGameBackup(backup), manifest);
  assert.equal(restoreGameBackup(backup, destination).status, 'restored_to_new_directory');
  const file = join(destination, 'game.sqlite');
  return { game: f.open(file), file };
}
function assertPrivateWait(game, f, owner = 'player') {
  const pending = game.concentration(f.scopes[owner]).pending;
  assert.equal(pending.canResolve, true);
  assert.equal(pending.sourceLabel, sourceLabel);
  for (const other of Object.keys(f.scopes).filter(item => item !== owner)) {
    const projection = game.concentration(f.scopes[other]).pending;
    assert.equal(projection.waiting, true);
    assert.equal(projection.canResolve, false);
    for (const key of ['id', 'actorId', 'actorName', 'concentrationId', 'sourceLabel', 'profile', 'damageTaken', 'dc']) assert.equal(Object.hasOwn(projection, key), false, `${other} must not learn private ${key}`);
  }
}
function assertNoPending(game, f) {
  const state = game.load(f.scopes.host.campaign);
  assert.equal(state.pendingConcentration, undefined);
  assert.equal(state.pendingReaction, undefined);
  assert.equal(state.continuations?.length ?? 0, 0);
}

test('actual restore resumes the confirmed reaction cursor after failed concentration and skips its removed enter hazard', t => {
  const f = fixture(t, { reactors: true, effects: [effect('bound-enter-hazard', 'enter', 7, [{ x: 3, y: 2 }])] });
  start(f, 'mover', ['bound-enter-hazard']);
  const move = moveRequest(f.game, f.scopes.player, [{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  const moveReceipt = f.game.command(f.scopes.player, move);
  const alpha = declaration(f.game, f.scopes.alpha, 'alpha-attack');
  const alphaReceipt = f.game.resolveReaction(f.scopes.alpha, alpha);
  const beta = declaration(f.game, f.scopes.beta, 'beta-attack');
  const betaReceipt = f.game.resolveReaction(f.scopes.beta, beta);
  const current = f.game.reactions(f.scopes.player);
  const order = { requestId: 'explicit-order', expectedRevision: current.revision, pendingId: current.pending.id, decision: 'order', order: [beta.optionId, alpha.optionId] };
  const orderReceipt = f.game.resolveReaction(f.scopes.player, order);
  assert.equal(f.rolls.length, 2, 'Only the first ordered attack rolls before the concentration decision.');
  assert.equal(f.game.load(f.scopes.host.campaign).actors[0].hp, 28);
  assertPrivateWait(f.game, f);
  const before = snapshot(f.game, f);
  f.forbid(true);
  const restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assertPrivateWait(restored.game, f);
  assert.deepEqual(restored.game.command(f.scopes.player, move), moveReceipt);
  assert.deepEqual(restored.game.resolveReaction(f.scopes.alpha, alpha), alphaReceipt);
  assert.deepEqual(restored.game.resolveReaction(f.scopes.beta, beta), betaReceipt);
  assert.deepEqual(restored.game.resolveReaction(f.scopes.player, order), orderReceipt);
  const save = saveRequest(restored.game, f.scopes.player, 'failed-save');
  for (const owner of ['host', 'alpha', 'beta']) assert.throws(() => focus(restored.game, f.scopes[owner], save), { code: 'UNAUTHORIZED' });
  assert.deepEqual(snapshot(restored.game, f), before);
  f.forbid(false);
  f.queue.push(1, 15, 2);
  const receipt = focus(restored.game, f.scopes.player, save);
  assert.equal(receipt.result.success, false);
  assert.deepEqual(receipt.result.removedEffectIds, ['bound-enter-hazard']);
  assertNoPending(restored.game, f);
  const state = restored.game.load(f.scopes.host.campaign), mover = state.actors.find(actor => actor.id === 'mover');
  assert.deepEqual({ x: mover.x, y: mover.y, hp: mover.hp }, { x: 4, y: 2, hp: 26 });
  assert.equal(state.effects.length, 0);
  assert.equal(state.movementRemaining, 20);
  assert.equal(state.actionAvailable, true);
  assert.equal(state.turn, 1);
  assert.equal(f.rolls.length, 5, 'One save and only the remaining attack follow the restored cursor.');
  assert.equal(restored.game.events(f.scopes.host).filter(event => event.kind === 'effect_triggered').length, 0);
  const alphaResult = restored.game.reactions(f.scopes.alpha).recentResults;
  const betaResult = restored.game.reactions(f.scopes.beta).recentResults;
  assert.equal(alphaResult.length, 1);
  assert.equal(betaResult.length, 1);
  assert.ok(betaResult[0].revision < alphaResult[0].revision);
  for (const owner of ['host', 'alpha', 'beta']) assert.deepEqual(restored.game.concentration(f.scopes[owner]).recentResults.filter(item => item.result.type === 'concentration_save'), []);
  assert.deepEqual(restored.game.reactions(f.scopes.player).recentResults, []);
  const final = snapshot(restored.game, f);
  f.forbid(true);
  const twice = restore(f, restored.file, 'completed');
  assert.deepEqual(snapshot(twice.game, f), final);
  assert.deepEqual(focus(twice.game, f.scopes.player, save), receipt);
  assert.deepEqual(twice.game.resolveReaction(f.scopes.player, order), orderReceipt);
  assert.deepEqual(twice.game.command(f.scopes.player, move), moveReceipt);
  assert.deepEqual(snapshot(twice.game, f), final);
  assert.deepEqual(snapshot(f.game, f), before, 'Resolving a restored copy never changes its source.');
});

test('actual restore pauses between overlapping enter hazards and resumes each damage packet and route once', t => {
  const f = fixture(t, { effects: [effect('first', 'enter', 2, [{ x: 3, y: 2 }]), effect('second', 'enter', 3, [{ x: 3, y: 2 }])] });
  start(f);
  const request = moveRequest(f.game, f.scopes.player, [{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  const original = f.game.command(f.scopes.player, request);
  assert.equal(f.game.load(f.scopes.host.campaign).actors[0].hp, 28);
  const firstBefore = snapshot(f.game, f);
  f.forbid(true);
  const first = restore(f);
  assert.deepEqual(snapshot(first.game, f), firstBefore);
  assert.deepEqual(first.game.command(f.scopes.player, request), original);
  const save1 = saveRequest(first.game, f.scopes.player, 'first-save');
  f.forbid(false);
  const receipt1 = focus(first.game, f.scopes.player, save1);
  assert.equal(receipt1.result.damageTaken, 2);
  const midway = first.game.load(f.scopes.host.campaign);
  assert.equal(midway.actors[0].hp, 25);
  assert.equal(midway.actors[0].x, 3);
  assert.equal(midway.pendingConcentration.damageTaken, 3);
  assert.equal(f.rolls.length, 1);
  const secondBefore = snapshot(first.game, f);
  f.forbid(true);
  const second = restore(f, first.file, 'second-hazard');
  assert.deepEqual(snapshot(second.game, f), secondBefore);
  assert.deepEqual(focus(second.game, f.scopes.player, save1), receipt1);
  assert.deepEqual(second.game.command(f.scopes.player, request), original);
  const save2 = saveRequest(second.game, f.scopes.player, 'second-save');
  f.forbid(false);
  const receipt2 = focus(second.game, f.scopes.player, save2);
  assert.equal(receipt2.result.damageTaken, 3);
  assertNoPending(second.game, f);
  const final = second.game.load(f.scopes.host.campaign);
  assert.deepEqual({ x: final.actors[0].x, y: final.actors[0].y, hp: final.actors[0].hp, movement: final.movementRemaining }, { x: 4, y: 2, hp: 25, movement: 20 });
  assert.equal(f.rolls.length, 2);
  assert.equal(second.game.events(f.scopes.host).filter(event => event.kind === 'effect_triggered').length, 2);
  const stable = snapshot(second.game, f);
  f.forbid(true);
  assert.deepEqual(focus(second.game, f.scopes.player, save1), receipt1);
  assert.deepEqual(focus(second.game, f.scopes.player, save2), receipt2);
  assert.deepEqual(second.game.command(f.scopes.player, request), original);
  assert.deepEqual(snapshot(second.game, f), stable);
});

test('actual restore resumes end-turn and next start-turn concentration without advancing initiative twice', t => {
  const f = fixture(t, { effects: [effect('end-damage', 'end_turn', 2, [{ x: 2, y: 2 }]), effect('start-damage', 'start_turn', 3, [{ x: 8, y: 8 }])] });
  start(f);
  start(f, 'alpha-actor');
  const request = { requestId: 'end-turn', expectedRevision: f.game.view(f.scopes.player).revision, type: 'end_turn', actorId: 'mover' };
  const original = f.game.command(f.scopes.player, request);
  assert.equal(f.game.load(f.scopes.host.campaign).turn, 1);
  const before = snapshot(f.game, f);
  f.forbid(true);
  const first = restore(f);
  assert.deepEqual(snapshot(first.game, f), before);
  assert.deepEqual(first.game.command(f.scopes.player, request), original);
  const save1 = saveRequest(first.game, f.scopes.player, 'end-hazard-save');
  f.forbid(false);
  const receipt1 = focus(first.game, f.scopes.player, save1);
  const midway = first.game.load(f.scopes.host.campaign);
  assert.equal(midway.turn, 2);
  assert.equal(midway.activeIndex, 1);
  assert.equal(midway.pendingConcentration.actorId, 'alpha-actor');
  assert.equal(midway.actors[0].hp, 28);
  assert.equal(midway.actors[1].hp, 27);
  assertPrivateWait(first.game, f, 'alpha');
  const secondBefore = snapshot(first.game, f);
  f.forbid(true);
  const second = restore(f, first.file, 'start-hazard');
  assert.deepEqual(snapshot(second.game, f), secondBefore);
  assert.deepEqual(focus(second.game, f.scopes.player, save1), receipt1);
  assert.deepEqual(second.game.command(f.scopes.player, request), original);
  const save2 = saveRequest(second.game, f.scopes.alpha, 'start-hazard-save');
  f.forbid(false);
  const receipt2 = focus(second.game, f.scopes.alpha, save2);
  assertNoPending(second.game, f);
  const final = second.game.load(f.scopes.host.campaign);
  assert.equal(final.turn, 2);
  assert.equal(final.round, 1);
  assert.equal(final.activeIndex, 1);
  assert.equal(final.movementRemaining, 30);
  assert.equal(final.actionAvailable, true);
  assert.equal(final.actors[1].reactionAvailable, true);
  assert.equal(second.game.events(f.scopes.host).filter(event => event.kind === 'turn_ended').length, 1);
  assert.equal(second.game.events(f.scopes.host).filter(event => event.kind === 'turn_started').length, 1);
  assert.equal(second.game.events(f.scopes.host).filter(event => event.kind === 'effect_triggered').length, 2);
  assert.equal(f.rolls.length, 2);
  f.forbid(true);
  const finalBefore = snapshot(second.game, f);
  assert.deepEqual(focus(second.game, f.scopes.alpha, save2), receipt2);
  assert.deepEqual(snapshot(second.game, f), finalBefore);
});

test('actual restore retains the checked-save damage receipt while concentration waits, during pause, and after resolution', t => {
  const characterSnapshot = { edition: '2024', fields: { dexterity: { value: 14 }, constitution: { value: 10 }, proficiencyBonus: { value: 2 } } };
  const characterVersion = `approved-1-${createHash('sha256').update(JSON.stringify(characterSnapshot)).digest('hex').slice(0, 16)}`;
  const characters = { character: () => ({ revision: 1, snapshot: characterSnapshot }) };
  const f = fixture(t, { characterVersion, effects: [effect('bound-ward', 'enter', 7, [{ x: 6, y: 2 }])] });
  start(f, 'mover', ['bound-ward']);
  f.game.requestCheck(characters, f.scopes.host, { id: 'fire-save', reviewed: true, expectedRevision: f.game.view(f.scopes.host).revision, actorId: 'mover', label: 'Reviewed fire save', kind: 'save', ability: 'dexterity', proficiencyMultiplier: 0, proficiencyReason: 'No Dexterity save proficiency applies.', advantage: [], disadvantage: [], adjustments: [], dc: 100, cost: 'none', consequence: { type: 'single_target_damage', dice: { count: 1, sides: 6, bonus: 0 }, damageType: 'fire', onSuccess: 'half', mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: 'Reviewed no applicable defenses.' } } });
  const request = { checkId: 'fire-save', requestId: 'resolve-fire-save' };
  f.queue.push(2, 6);
  const damageReceipt = f.game.resolveCheck(f.scopes.player, request);
  assert.equal(damageReceipt.result.consequence.appliedDamage, 6);
  assert.equal(f.game.load(f.scopes.host.campaign).actors[0].hp, 24);
  assert.equal(f.rolls.length, 2);
  assertPrivateWait(f.game, f);
  const pause = { requestId: 'pause-save', expectedRevision: f.game.view(f.scopes.player).revision, type: 'pause', actorId: 'mover' };
  f.game.command(f.scopes.player, pause);
  const before = snapshot(f.game, f);
  f.forbid(true);
  const restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assert.deepEqual(restored.game.resolveCheck(f.scopes.player, request), damageReceipt);
  const pending = restored.game.concentration(f.scopes.player).pending;
  assert.equal(pending.paused, true);
  assert.throws(() => focus(restored.game, f.scopes.player, { requestId: 'paused-decision', expectedRevision: before.state.revision, action: 'resolve', pendingId: pending.id }), { code: 'PAUSED' });
  assert.deepEqual(snapshot(restored.game, f), before);
  restored.game.command(f.scopes.host, { requestId: 'resume-save', expectedRevision: before.state.revision, type: 'resume', actorId: 'mover' });
  const save = saveRequest(restored.game, f.scopes.player, 'save-after-restore');
  f.forbid(false);
  f.queue.push(1);
  const saveReceipt = focus(restored.game, f.scopes.player, save);
  assert.equal(saveReceipt.result.success, false);
  assert.deepEqual(saveReceipt.result.removedEffectIds, ['bound-ward']);
  assertNoPending(restored.game, f);
  const state = restored.game.load(f.scopes.host.campaign);
  assert.equal(state.actors[0].hp, 24);
  assert.equal(state.turn, 1);
  assert.equal(state.actionAvailable, true);
  assert.equal(f.rolls.length, 3);
  const damageRows = restored.game.db.prepare("SELECT e.kind,o.snapshot FROM game_events e JOIN game_outbox o ON o.campaign=e.campaign AND o.revision=e.revision AND o.kind='projection' WHERE e.campaign=? AND e.kind IN ('check_resolved','save_damage_applied') ORDER BY e.revision").all(f.scopes.host.campaign);
  assert.deepEqual(damageRows.map(row => row.kind), ['check_resolved', 'save_damage_applied']);
  for (const row of damageRows) {
    const saved = JSON.parse(row.snapshot);
    assert.equal(saved.actors[0].hp, 24);
    assert.equal(saved.pendingConcentration.damageTaken, 6);
    assert.equal(saved.continuations.filter(frame => frame.kind === 'checked_damage_done').length, 1);
  }
  const final = snapshot(restored.game, f);
  f.forbid(true);
  const completed = restore(f, restored.file, 'completed-check');
  assert.deepEqual(snapshot(completed.game, f), final);
  assert.deepEqual(completed.game.resolveCheck(f.scopes.player, request), damageReceipt);
  assert.deepEqual(focus(completed.game, f.scopes.player, save), saveReceipt);
  assert.deepEqual(completed.game.rollHistory(f.scopes.player).receipts.find(receipt => receipt.requestId === request.requestId), damageReceipt);
  for (const owner of ['host', 'alpha', 'beta']) {
    assert.equal(completed.game.rollHistory(f.scopes[owner]).receipts.some(receipt => receipt.requestId === request.requestId), false);
    assert.equal(completed.game.concentration(f.scopes[owner]).recentResults.some(receipt => receipt.requestId === save.requestId), false);
  }
  assert.deepEqual(snapshot(completed.game, f), final);
});

test('failed concentration skips all remaining bound start-turn hazards and commits an empty continuation without movement', t => {
  const f = fixture(t, { effects: [effect('first-start-hazard', 'start_turn', 2, [{ x: 8, y: 8 }]), effect('bound-start-hazard', 'start_turn', 7, [{ x: 8, y: 8 }])] });
  start(f, 'alpha-actor', ['bound-start-hazard']);
  const request = { requestId: 'end-into-start-hazards', expectedRevision: f.game.view(f.scopes.player).revision, type: 'end_turn', actorId: 'mover' };
  const original = f.game.command(f.scopes.player, request);
  assert.equal(f.game.load(f.scopes.host.campaign).actors[1].hp, 28);
  assert.equal(f.game.concentration(f.scopes.alpha).pending.damageTaken, 2);
  const before = snapshot(f.game, f);
  f.forbid(true);
  const restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  const requestSave = saveRequest(restored.game, f.scopes.alpha, 'failed-start-save');
  f.forbid(false);
  f.queue.push(1);
  const receipt = focus(restored.game, f.scopes.alpha, requestSave);
  assert.equal(receipt.result.success, false);
  assert.deepEqual(receipt.result.removedEffectIds, ['bound-start-hazard']);
  assertNoPending(restored.game, f);
  const state = restored.game.load(f.scopes.host.campaign);
  assert.equal(state.actors[1].hp, 28);
  assert.deepEqual({ x: state.actors[1].x, y: state.actors[1].y }, { x: 8, y: 8 });
  assert.equal(state.turn, 2);
  assert.equal(state.activeIndex, 1);
  assert.equal(state.movementRemaining, 30);
  assert.equal(state.actionAvailable, true);
  assert.equal(restored.game.events(f.scopes.host).filter(event => event.kind === 'effect_triggered').length, 1);
  assert.equal(f.rolls.length, 1);
  const final = snapshot(restored.game, f);
  f.forbid(true);
  const completed = restore(f, restored.file, 'completed-start-skip');
  assert.deepEqual(snapshot(completed.game, f), final);
  assert.deepEqual(focus(completed.game, f.scopes.alpha, requestSave), receipt);
  assert.deepEqual(completed.game.command(f.scopes.player, request), original);
  assert.deepEqual(snapshot(completed.game, f), final);
});

function tamperBackup(f, mutate, { historical = false } = {}) {
  const directory = join(f.root, 'tampered-backup');
  const manifest = backupGame(f.file, directory);
  const file = join(directory, 'game.sqlite'), db = new DatabaseSync(file);
  try {
    if (historical) {
      const row = db.prepare("SELECT revision,snapshot FROM game_outbox WHERE campaign=? AND kind='projection' AND revision<? ORDER BY revision DESC LIMIT 1").get(f.scopes.host.campaign, manifest.campaigns[0].revision);
      assert.ok(row);
      const state = JSON.parse(row.snapshot);
      mutate(state);
      db.prepare("UPDATE game_outbox SET snapshot=? WHERE campaign=? AND revision=? AND kind='projection'").run(JSON.stringify(state), f.scopes.host.campaign, row.revision);
    } else {
      const row = db.prepare('SELECT revision,body FROM game_campaigns WHERE id=?').get(f.scopes.host.campaign);
      const state = JSON.parse(row.body);
      mutate(state);
      const body = JSON.stringify(state);
      db.prepare('UPDATE game_campaigns SET body=? WHERE id=?').run(body, f.scopes.host.campaign);
      db.prepare("UPDATE game_outbox SET snapshot=? WHERE campaign=? AND revision=? AND kind='projection'").run(body, f.scopes.host.campaign, row.revision);
    }
  } finally { db.close(); }
  // Recompute the fixture manifest: rejection must come from semantic validation,
  // not just noticing a byte checksum mismatch in an otherwise opaque database.
  manifest.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}

for (const [name, mutate] of [
  ['unknown continuation kind', state => { state.continuations[0].kind = 'invented_execution'; }],
  ['duplicate continuation identity', state => { state.continuations.push(structuredClone(state.continuations[0])); }],
  ['duplicate concentration source identity', state => { state.actors[1].concentration.id = state.actors[0].concentration.id; }],
  ['changed pending source fingerprint', state => { state.pendingConcentration.sourceFingerprint = '0'.repeat(64); }],
  ['invalid saved movement path', state => { const frame = state.continuations.find(item => item.kind === 'move'); assert.ok(Array.isArray(frame.path)); frame.path = [{ x: -1, y: 2 }]; }],
]) {
  test(`verification and restore reject a self-consistent backup with ${name}`, t => {
    const f = fixture(t, { effects: [effect('hazard', 'enter', 2, [{ x: 3, y: 2 }])] });
    start(f);
    start(f, 'alpha-actor');
    f.game.command(f.scopes.player, moveRequest(f.game, f.scopes.player, [{ x: 3, y: 2 }, { x: 4, y: 2 }]));
    const sourceBefore = snapshot(f.game, f);
    const directory = tamperBackup(f, mutate), destination = join(f.root, 'rejected-restore');
    assert.throws(() => verifyGameBackup(directory), { code: 'BACKUP' });
    assert.throws(() => restoreGameBackup(directory, destination), { code: 'BACKUP' });
    assert.equal(existsSync(destination), false, 'Reject before reserving a restored data directory.');
    assert.deepEqual(snapshot(f.game, f), sourceBefore);
  });
}

test('verification rejects a malformed historical projection even when current state and final snapshot are valid', t => {
  const f = fixture(t, { effects: [effect('hazard', 'enter', 2, [{ x: 3, y: 2 }])] });
  start(f);
  f.game.command(f.scopes.player, moveRequest(f.game, f.scopes.player, [{ x: 3, y: 2 }, { x: 4, y: 2 }]));
  focus(f.game, f.scopes.player, saveRequest(f.game, f.scopes.player, 'settle-before-backup'));
  const directory = tamperBackup(f, state => { state.continuations = [{ id: 'corrupt-history', kind: 'invented_execution' }]; }, { historical: true });
  assert.throws(() => verifyGameBackup(directory), { code: 'BACKUP' });
  assert.throws(() => restoreGameBackup(directory, join(f.root, 'rejected-history')), { code: 'BACKUP' });
});

test('a legitimately revoked owner remains restorable for explicit host concentration recovery', t => {
  const f = fixture(t, { effects: [effect('bound-hazard', 'enter', 2, [{ x: 3, y: 2 }])] });
  start(f, 'mover', ['bound-hazard']);
  f.game.command(f.scopes.player, moveRequest(f.game, f.scopes.player, [{ x: 3, y: 2 }, { x: 4, y: 2 }]));
  const pending = f.game.concentration(f.scopes.player).pending;
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(f.scopes.player.campaign, f.scopes.player.owner);
  const before = f.game.load(f.scopes.host.campaign);
  f.forbid(true);
  const restored = restore(f);
  assert.deepEqual(restored.game.load(f.scopes.host.campaign), before);
  assert.equal(restored.game.concentration(f.scopes.host).pending.canRefresh, true);
  assert.throws(() => focus(restored.game, f.scopes.player, { requestId: 'revoked-save', expectedRevision: before.revision, action: 'resolve', pendingId: pending.id }), { code: 'UNAUTHORIZED' });
  const request = { requestId: 'review-revoked-owner', expectedRevision: before.revision, action: 'refresh', pendingId: pending.id, reviewed: true, reason: 'The prior controller has been removed; end this unavailable concentration.' };
  const receipt = focus(restored.game, f.scopes.host, request);
  assert.equal(receipt.result.type, 'concentration_refreshed');
  assert.deepEqual(receipt.result.removedEffectIds, ['bound-hazard']);
  assertNoPending(restored.game, f);
  const after = restored.game.load(f.scopes.host.campaign);
  assert.equal(after.actors[0].hp, 28);
  assert.equal(after.actors[0].x, 3, 'Removed controller cannot resume the saved movement.');
  assert.equal(f.rolls.length, 0);
  assert.deepEqual(focus(restored.game, f.scopes.host, request), receipt);
  assert.deepEqual(f.game.load(f.scopes.host.campaign), before);
});
