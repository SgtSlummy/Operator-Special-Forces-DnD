import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GameError, GameStore, projectState } from './store.mjs';
import { concentrationCommand, concentrationDamage, concentrationProjection, concentrationState, validateConcentrationRecord } from './concentration.mjs';

const campaign = 'concentration_fixture';
const host = { campaign, owner: 'host' };
const player = { campaign, owner: 'player' };
const other = { campaign, owner: 'other' };
const weapon = { name: 'Reviewed blade', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const profile = extra => ({ abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [], ...extra });
const effect = (id, extra = {}) => ({ id, name: id, trigger: 'enter', damage: 3, expiresAtTurn: 99, visible: true, cells: [{ x: 6, y: 6 }], ...extra });
const actor = (id, owner, x, y, initiative, constitution = profile()) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y, size: 1, hp: 100, maxHp: 100, ac: 10, speed: 30, vision: 2, initiative, characterVersion: 'reviewed_fixture', weapon, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: constitution }, combatReview: { constitutionProficiencyReason: 'Reviewed fixture proficiency from approved character sheet.' } });

function snapshot(game) {
  return JSON.stringify(game.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({ name, rows: game.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() })));
}

function fixture(t, { dice = [10], constitution = profile() } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-concentration-'));
  const path = join(directory, 'game.sqlite');
  let rolls = 0, drains = 0, sequence = 0;
  const connections = new Set();
  const open = () => {
    const store = new GameStore(path, { rollDie: sides => { const value = dice[rolls++] ?? 10; assert.ok(value >= 1 && value <= sides); return value; } });
    const drain = store.drainContinuations;
    store.drainContinuations = function (...args) { drains++; return drain?.apply(this, args); };
    connections.add(store);
    return store;
  };
  let game = open();
  t.after(() => {
    for (const connection of connections) connection.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('raph-concentration-'));
    rmSync(target, { recursive: true, force: true });
  });
  game.createCampaign({ campaign, title: 'Concentration regression fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }], map: { id: 'concentration_map', title: 'Fixture', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('hero', 'player', 1, 1, 20, constitution), actor('companion', 'other', 2, 1, 10), actor('hidden_warden', null, 7, 7, 0)], effects: [effect('focus_zone'), effect('fresh_zone'), effect('unrelated_zone')] });
  return {
    get game() { return game; },
    get rolls() { return rolls; },
    get drains() { return drains; },
    run(scope, input, store = game) { return concentrationCommand(store, scope, input, GameError); },
    query(scope = player, store = game) { return concentrationState(store, scope, projectState); },
    next(action, extra = {}) { return { requestId: `concentration_${++sequence}`, expectedRevision: game.view(host).revision, action, ...extra }; },
    mutate(work) { return game.transaction(() => { const state = game.load(campaign); const result = work(state); game.save(state); return result; }); },
    damage(damageTaken, actorId = 'hero', extra = {}) {
      return game.transaction(() => {
        const state = game.load(campaign), target = state.actors.find(item => item.id === actorId);
        target.hp = Math.max(0, target.hp - damageTaken);
        const queued = concentrationDamage(game, state, target, damageTaken, { kind: 'fixture_damage', packetId: `packet_${++sequence}`, ...extra });
        game.record(state, 'fixture_damage', { actorId, damageTaken });
        game.save(state);
        return queued;
      });
    },
    secondConnection: open,
    restart() { game.close(); connections.delete(game); game = open(); },
  };
}

function start(context, extra = {}, scope = host) {
  const input = context.next('start', { actorId: 'hero', characterVersion: 'reviewed_fixture', sourceLabel: 'Private reviewed focus', effectIds: ['focus_zone'], reviewed: true, reason: 'Reviewed concentration source and bound effect.', ...extra });
  const receipt = context.run(scope, input);
  return { input, receipt };
}

function pending(context, scope = player) {
  const value = context.query(scope).pending;
  assert.ok(value, 'expected a private pending concentration save');
  return Array.isArray(value) ? value[0] : value;
}

function resolveSave(context, scope = player, extra = {}) {
  const input = context.next('resolve', { pendingId: pending(context, scope).id, ...extra });
  return { input, receipt: context.run(scope, input) };
}

function rejected(context, work, code) {
  const before = snapshot(context.game), rolls = context.rolls, drains = context.drains;
  assert.throws(work, error => error.code === code);
  assert.equal(snapshot(context.game), before, 'rejected command must not change any saved state, event, receipt, or quota');
  assert.equal(context.rolls, rolls, 'rejected command must not roll');
  assert.equal(context.drains, drains, 'rejected command must not resume suspended work');
}

function replayed(context, work, receipt) {
  const before = snapshot(context.game), rolls = context.rolls, drains = context.drains;
  assert.deepEqual(work(), receipt);
  assert.equal(snapshot(context.game), before, 'saved command must be immutable and consume no quota');
  assert.equal(context.rolls, rolls, 'saved command must not reroll');
  assert.equal(context.drains, drains, 'saved command must not repeat continuation work');
}

test('host starts reviewed concentration with a copied profile and exact effect binding', t => {
  const context = fixture(t);
  const { receipt } = start(context);
  assert.equal(receipt.result.type, 'concentration_started');
  const state = context.game.load(campaign), hero = state.actors.find(item => item.id === 'hero');
  assert.equal(hero.concentration.actorId, 'hero');
  assert.equal(hero.concentration.owner, 'player');
  assert.equal(hero.concentration.characterVersion, 'reviewed_fixture');
  assert.deepEqual(hero.concentration.profile, profile());
  assert.deepEqual(hero.concentration.effects.map(item => item.id), ['focus_zone']);
  assert.equal(hero.concentration.review.owner, 'host');
  assert.equal(typeof hero.concentration.profileFingerprint, 'string');
  assert.equal(typeof hero.concentration.effects[0].fingerprint, 'string');
  assert.doesNotThrow(() => validateConcentrationRecord(hero.concentration, hero, state.effects));
  hero.combatCapabilities.constitutionSave.adjustments.push({ source: 'Not saved', value: 9 });
  assert.deepEqual(context.game.load(campaign).actors[0].concentration.profile, profile());
  assert.equal(context.rolls, 0);
});

test('start requires current host, exact approved version, reviewed source, and unbound effects', t => {
  const context = fixture(t);
  rejected(context, () => start(context, {}, player), 'UNAUTHORIZED');
  rejected(context, () => start(context, { characterVersion: 'forged_version' }), 'CONFLICT');
  rejected(context, () => start(context, { reviewed: false }), 'INVALID');
  rejected(context, () => start(context, { reason: '' }), 'INVALID');
  rejected(context, () => start(context, { effectIds: ['missing_effect'] }), 'CONFLICT');
  rejected(context, () => start(context, { effectIds: ['focus_zone', 'focus_zone'] }), 'INVALID');
  start(context);
  rejected(context, () => start(context, { actorId: 'companion' }), 'CONFLICT');
  rejected(context, () => start(context), 'CONFLICT');
});

test('zero damage does not queue, roll, or change concentration', t => {
  const context = fixture(t);
  start(context);
  const before = context.game.load(campaign).actors[0].concentration;
  assert.equal(context.damage(0), false);
  assert.deepEqual(context.game.load(campaign).actors[0].concentration, before);
  assert.ok(!context.query().pending || context.query().pending.length === 0);
  assert.equal(context.rolls, 0);
});

for (const [damageTaken, expectedDC] of [[1, 10], [21, 10], [25, 12], [61, 30], [90, 30]]) {
  test(`damage packet ${damageTaken} pins concentration DC ${expectedDC}`, t => {
    const context = fixture(t);
    start(context);
    assert.equal(context.damage(damageTaken), true);
    const request = pending(context);
    assert.equal(request.damageTaken, damageTaken);
    assert.equal(request.dc, expectedDC);
    assert.equal(context.game.load(campaign).actors[0].hp, 100 - damageTaken);
    assert.equal(context.rolls, 0);
  });
}

test('defeat and incapacitation end concentration without a saving throw', t => {
  for (const condition of ['defeat', 'incapacitation']) {
    const context = fixture(t);
    start(context);
    if (condition === 'incapacitation') context.mutate(state => { state.actors[0].incapacitated = true; });
    assert.equal(context.damage(condition === 'defeat' ? 120 : 1), false);
    const state = context.game.load(campaign);
    assert.ok(!state.actors[0].concentration);
    assert.ok(!state.effects.some(item => item.id === 'focus_zone'));
    assert.ok(state.effects.some(item => item.id === 'unrelated_zone'));
    assert.equal(context.rolls, 0);
  }
});

test('one successful save retains concentration and clears the pending decision', t => {
  const context = fixture(t, { dice: [8] });
  start(context);
  context.damage(5);
  const { receipt } = resolveSave(context);
  assert.equal(receipt.result.type, 'concentration_save');
  assert.equal(receipt.result.modifier, 4);
  assert.equal(receipt.result.total, 12);
  assert.equal(receipt.result.success, true);
  assert.deepEqual(receipt.result.dice, [8]);
  assert.deepEqual(receipt.result.removedEffectIds, []);
  assert.ok(context.game.load(campaign).actors[0].concentration);
  assert.ok(!context.query().pending || context.query().pending.length === 0);
  assert.equal(receipt.revision, context.game.view(player).revision);
  assert.equal(context.rolls, 1);
  assert.equal(context.drains, 1);
});

test('failure removes only the exact bound effect and leaves HP unchanged', t => {
  const context = fixture(t, { dice: [1] });
  start(context);
  context.mutate(state => { state.effects.find(item => item.id === 'focus_zone').triggered.push('mutable_visit'); });
  context.damage(5);
  const hp = context.game.load(campaign).actors[0].hp;
  const { receipt } = resolveSave(context);
  assert.equal(receipt.result.success, false);
  assert.deepEqual(receipt.result.removedEffectIds, ['focus_zone']);
  const state = context.game.load(campaign);
  assert.equal(state.actors[0].hp, hp, 'save resolution must not apply the damage packet twice');
  assert.ok(!state.actors[0].concentration);
  assert.deepEqual(state.effects.map(item => item.id).sort(), ['fresh_zone', 'unrelated_zone']);
  assert.equal(context.rolls, 1);
});

for (const [label, constitution, dice, kept, count] of [
  ['advantage', profile({ advantage: ['Reviewed blessing'] }), [2, 18], 18, 2],
  ['disadvantage', profile({ disadvantage: ['Reviewed curse'] }), [2, 18], 2, 2],
  ['cancellation', profile({ advantage: ['Blessing A', 'Blessing B'], disadvantage: ['Curse'] }), [8], 8, 1],
]) {
  test(`pinned ${label} uses the reviewed Constitution profile`, t => {
    const context = fixture(t, { constitution, dice });
    start(context);
    context.damage(3);
    const { receipt } = resolveSave(context);
    assert.equal(receipt.result.kept, kept);
    assert.equal(context.rolls, count);
    assert.deepEqual(receipt.result.profile, constitution);
    assert.equal(receipt.result.success, kept + 4 >= 10);
  });
}

test('owner may end a pending concentration save without rolling and resume once', t => {
  const context = fixture(t);
  start(context);
  context.damage(3);
  const input = context.next('end', { actorId: 'hero' });
  const receipt = context.run(player, input);
  assert.equal(receipt.result.type, 'concentration_ended');
  assert.ok(!context.game.load(campaign).actors[0].concentration);
  assert.ok(!context.query().pending || context.query().pending.length === 0);
  assert.equal(context.rolls, 0);
  assert.equal(context.drains, 1);
  replayed(context, () => context.run(player, input), receipt);
});

test('replacement cleans only old bindings and requires separately existing unbound effects', t => {
  const context = fixture(t);
  const original = start(context).receipt;
  rejected(context, () => start(context, { effectIds: ['focus_zone', 'fresh_zone'] }), 'CONFLICT');
  const replacement = start(context, { effectIds: ['fresh_zone'], sourceLabel: 'Replacement focus' }).receipt;
  assert.notEqual(replacement.result.concentrationId, original.result.concentrationId);
  const state = context.game.load(campaign);
  assert.deepEqual(state.actors[0].concentration.effects.map(item => item.id), ['fresh_zone']);
  assert.ok(!state.effects.some(item => item.id === 'focus_zone'));
  assert.ok(state.effects.some(item => item.id === 'fresh_zone'));
  assert.ok(state.effects.some(item => item.id === 'unrelated_zone'));
});

test('ending concentration cannot delete a reused effect ID with a different stable identity', t => {
  const context = fixture(t);
  start(context);
  context.mutate(state => { state.effects.find(item => item.id === 'focus_zone').damage = 17; });
  context.run(player, context.next('end', { actorId: 'hero' }));
  assert.equal(context.game.load(campaign).effects.find(item => item.id === 'focus_zone').damage, 17);
});

test('private pending data never enters another player or generic actor projection', t => {
  const context = fixture(t);
  start(context, { sourceLabel: 'PRIVATE_FOCUS_SECRET', reason: 'PRIVATE_REVIEW_SECRET' });
  context.damage(25, 'hero', { packetId: 'PRIVATE_PACKET_SECRET' });
  const own = context.query(player);
  assert.ok(JSON.stringify(own).includes('PRIVATE_FOCUS_SECRET'));
  const state = context.game.load(campaign);
  const ownProjection = projectState(state, player.owner, 'player');
  const foreignProjection = projectState(state, other.owner, 'player');
  const outsider = concentrationProjection(state, other.owner, 'player', foreignProjection.actors);
  const publicText = JSON.stringify({ query: context.query(other), projection: outsider, view: foreignProjection });
  for (const secret of ['PRIVATE_FOCUS_SECRET', 'PRIVATE_REVIEW_SECRET', 'PRIVATE_PACKET_SECRET', 'profileFingerprint', 'effectFingerprint']) assert.ok(!publicText.includes(secret), `foreign projection leaked ${secret}`);
  assert.ok(ownProjection.actors.some(item => item.id === 'hero'));
});

test('pause blocks new concentration decisions but saved start and save receipts still replay after restart', t => {
  const context = fixture(t, { dice: [8] });
  const started = start(context);
  context.damage(2);
  const saved = resolveSave(context);
  context.game.command(player, { requestId: 'pause_concentration', expectedRevision: context.game.view(player).revision, type: 'pause', actorId: 'hero' });
  rejected(context, () => context.run(player, context.next('end', { actorId: 'hero' })), 'PAUSED');
  replayed(context, () => context.run(host, started.input), started.receipt);
  replayed(context, () => context.run(player, saved.input), saved.receipt);
  const beforeRestart = snapshot(context.game);
  context.restart();
  assert.equal(snapshot(context.game), beforeRestart);
  replayed(context, () => context.run(player, saved.input), saved.receipt);
  const second = context.secondConnection();
  replayed(context, () => context.run(player, saved.input, second), saved.receipt);
});

test('pending save survives restart and is resolved exactly once across two real connections', t => {
  const context = fixture(t, { dice: [8] });
  start(context);
  context.damage(25);
  const before = context.query(), input = context.next('resolve', { pendingId: pending(context).id });
  context.restart();
  assert.deepEqual(context.query(), before);
  const second = context.secondConnection();
  const receipt = context.run(player, input, second);
  assert.equal(context.rolls, 1);
  replayed(context, () => context.run(player, input), receipt);
});

test('current ownership, membership, request fingerprint, and host role are rechecked on replay', t => {
  const context = fixture(t, { dice: [8] });
  const started = start(context);
  context.damage(2);
  const saved = resolveSave(context);
  rejected(context, () => context.run(player, { ...saved.input, expectedRevision: saved.input.expectedRevision + 1 }), 'CONFLICT');
  rejected(context, () => context.run(other, saved.input), 'STALE');
  context.mutate(state => { state.actors[0].owner = 'other'; });
  rejected(context, () => context.run(player, saved.input), 'UNAUTHORIZED');
  context.mutate(state => { state.actors[0].owner = 'player'; });
  context.game.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner='host'").run(campaign);
  rejected(context, () => context.run(host, started.input), 'UNAUTHORIZED');
  context.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, player.owner);
  rejected(context, () => context.run(player, saved.input), 'UNAUTHORIZED');
});

test('pending concentration reserves the decision for its owner and stays read-only during pause', t => {
  const context = fixture(t);
  start(context);
  context.damage(3);
  const pendingId = pending(context).id;
  rejected(context, () => context.run(other, context.next('resolve', { pendingId })), 'UNAUTHORIZED');
  rejected(context, () => context.run(host, context.next('resolve', { pendingId })), 'UNAUTHORIZED');
  rejected(context, () => context.run(other, context.next('end', { actorId: 'hero' })), 'UNAUTHORIZED');
  rejected(context, () => start(context, { actorId: 'companion', effectIds: ['fresh_zone'] }), 'PENDING');
  context.game.command(player, { requestId: 'pause_pending_concentration', expectedRevision: context.game.view(player).revision, type: 'pause', actorId: 'hero' });
  const before = snapshot(context.game), paused = context.query(player);
  assert.equal(paused.pending.paused, true);
  assert.equal(paused.pending.canResolve, false);
  assert.equal(snapshot(context.game), before);
  rejected(context, () => context.run(player, context.next('resolve', { pendingId })), 'PAUSED');
  rejected(context, () => context.run(player, context.next('end', { actorId: 'hero' })), 'PAUSED');
  assert.equal(context.rolls, 0);
});

test('a real suspended opportunity attack blocks starting a new concentration source', t => {
  const context = fixture(t);
  start(context);
  const receipt = context.game.command(player, { requestId: 'suspended_concentration_move', expectedRevision: context.game.view(player).revision, type: 'move', actorId: 'hero', path: [{ x: 0, y: 1 }] });
  assert.equal(receipt.result.stopped, true);
  assert.ok(context.game.load(campaign).pendingReaction);
  rejected(context, () => start(context, { actorId: 'companion', effectIds: ['fresh_zone'] }), 'PENDING');
});

test('damage hook uses the explicit packet amount and does not write HP, receipts, events, or quotas', t => {
  const context = fixture(t);
  start(context);
  const before = snapshot(context.game);
  const state = context.game.load(campaign), hero = state.actors[0];
  hero.hp = 75;
  assert.equal(concentrationDamage(context.game, state, hero, 61, { kind: 'fixture_damage', packetId: 'packet_independent_hp' }), true);
  assert.equal(state.pendingConcentration.dc, 30);
  assert.equal(state.pendingConcentration.damageTaken, 61);
  assert.equal(hero.hp, 75, 'upstream damage is already applied before the hook');
  assert.equal(snapshot(context.game), before, 'hook must not save or record independently of its caller transaction');
  assert.equal(context.rolls, 0);
});

test('a hidden NPC save reveals no hidden identity or source to either player', t => {
  const context = fixture(t);
  start(context, { actorId: 'hidden_warden', sourceLabel: 'HIDDEN_SOURCE_SECRET', effectIds: ['fresh_zone'] });
  context.damage(25, 'hidden_warden', { packetId: 'HIDDEN_PACKET_SECRET' });
  const state = context.game.load(campaign), hiddenId = state.pendingConcentration.id;
  for (const scope of [player, other]) {
    const text = JSON.stringify({ query: context.query(scope), view: projectState(state, scope.owner, 'player') });
    for (const secret of ['hidden_warden', 'HIDDEN_SOURCE_SECRET', 'HIDDEN_PACKET_SECRET', hiddenId]) assert.ok(!text.includes(secret), `hidden projection leaked ${secret}`);
  }
  const { receipt } = resolveSave(context, host);
  assert.equal(receipt.result.actorId, 'hidden_warden');
});

test('changed character source blocks rolling and permits explicit host recovery only', t => {
  const context = fixture(t);
  start(context);
  context.damage(3);
  const pendingId = pending(context).id;
  rejected(context, () => context.run(host, context.next('refresh', { pendingId, reviewed: true, reason: 'Attempt to bypass a valid player save.' })), 'CONFLICT');
  context.mutate(state => { state.actors[0].characterVersion = 'new_reviewed_version'; });
  rejected(context, () => context.run(player, context.next('resolve', { pendingId })), 'CONFLICT');
  rejected(context, () => context.run(player, context.next('refresh', { pendingId, reviewed: true, reason: 'Changed source.' })), 'UNAUTHORIZED');
  const receipt = context.run(host, context.next('refresh', { pendingId, reviewed: true, reason: 'Source changed; end the old reviewed concentration.' }));
  assert.equal(receipt.result.type, 'concentration_refreshed');
  assert.ok(!context.game.load(campaign).actors[0].concentration);
  assert.ok(!context.query().pending || context.query().pending.length === 0);
  assert.equal(context.rolls, 0);
  assert.equal(context.drains, 1);
});

test('changed Constitution sources and reviewer provenance cannot silently change a pending save', t => {
  for (const change of [
    actor => { actor.combatCapabilities.constitutionSave.abilityScore = 18; },
    actor => { actor.combatReview.constitutionProficiencyReason = 'Different reviewed source'; },
  ]) {
    const context = fixture(t);
    start(context);
    context.damage(3);
    const pendingId = pending(context).id;
    context.mutate(state => { change(state.actors[0]); });
    rejected(context, () => context.run(player, context.next('resolve', { pendingId })), 'CONFLICT');
    context.run(host, context.next('refresh', { pendingId, reviewed: true, reason: 'Changed Constitution save source.' }));
    assert.equal(context.rolls, 0);
  }
});

for (const [label, corrupt] of [
  ['DC', pending => { pending.dc = 1; }],
  ['source effect binding', pending => { pending.source.effects[0].id = 'unrelated_zone'; }],
]) {
  test(`malformed persisted ${label} cannot roll or authorize host cleanup`, t => {
    const context = fixture(t);
    start(context);
    context.damage(3);
    const pendingId = pending(context).id;
    context.mutate(state => { corrupt(state.pendingConcentration); });
    rejected(context, () => context.run(player, context.next('resolve', { pendingId })), 'INVALID');
    rejected(context, () => context.run(host, context.next('refresh', { pendingId, reviewed: true, reason: 'Attempt to clean malformed pending data.' })), 'INVALID');
    const state = context.game.load(campaign);
    assert.ok(state.actors[0].concentration);
    assert.deepEqual(state.effects.map(item => item.id).sort(), ['focus_zone', 'fresh_zone', 'unrelated_zone']);
    assert.equal(context.rolls, 0);
  });
}

for (const failure of ['record', 'receipt']) {
  test(`${failure} failure rolls back effect cleanup, pending clearance, events, and continuation changes`, t => {
    const context = fixture(t, { dice: [1] });
    start(context);
    context.damage(3);
    const input = context.next('resolve', { pendingId: pending(context).id });
    const before = snapshot(context.game), originalDrain = context.game.drainContinuations;
    context.game.drainContinuations = function (state, ...args) { state.fixtureContinuationMarker = 'must roll back'; return originalDrain.call(this, state, ...args); };
    const originalRecord = context.game.record;
    if (failure === 'record') context.game.record = () => { throw new Error('fixture record insertion failed'); };
    else context.game.db.exec("CREATE TEMP TRIGGER concentration_receipt_failure BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT, 'fixture receipt insertion failed'); END;");
    assert.throws(() => context.run(player, input), /fixture (record|receipt) insertion failed/);
    if (failure === 'record') context.game.record = originalRecord;
    else context.game.db.exec('DROP TRIGGER concentration_receipt_failure');
    assert.equal(snapshot(context.game), before, 'failure must restore the complete saved transaction');
    const state = context.game.load(campaign);
    assert.ok(state.actors[0].concentration);
    assert.ok(state.effects.some(item => item.id === 'focus_zone'));
    assert.equal(state.fixtureContinuationMarker, undefined);
    assert.ok(pending(context));
  });
}
