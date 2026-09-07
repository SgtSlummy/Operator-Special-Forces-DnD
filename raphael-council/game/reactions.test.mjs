import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { GameStore } from './store.mjs';

const campaign = 'reaction-test';
const player = { campaign, owner: 'player' }, host = { campaign, owner: 'host' };
const other = index => ({ campaign, owner: `owner-${index}` });
const weapon = rangeFeet => ({ name: 'Reviewed blade', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 1, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet });
const profile = (id, owner, x, y, initiative) => ({ id, owner, name: id, team: owner === 'player' ? 'party' : 'others', x, y, initiative, size: 1, hp: 30, maxHp: 30, ac: 12, speed: 30, vision: 8, characterVersion: 'reviewed-v1', weapon: weapon(5) });
function fixture(t, { count = 1, hidden = false, startX = 2, hp = 30, disk = false, npc = false } = {}) {
  let path = ':memory:', directory;
  if (disk) { directory = realpathSync(mkdtempSync(join(tmpdir(), 'raph-reactions-test-'))); path = join(directory, 'game.sqlite'); }
  const f = { path, draws: 0, counter: 0 };
  f.roll = sides => { f.draws++; return sides === 20 ? 14 : 4; };
  f.game = new GameStore(path, { rollDie: f.roll });
  const mover = { ...profile('mover', 'player', startX, 2, 20), hp, vision: hidden ? 1 : 8 };
  const reactors = Array.from({ length: count }, (_, index) => ({ ...profile(`reactor-${index}`, npc ? null : other(index).owner, hidden ? 0 : 1, index ? 3 : 1, 10 - index), weapon: { ...weapon(hidden ? 10 : 5), name: `Private reactor blade ${index}` }, combatCapabilities: { attackKind: 'melee', meleeReachFeet: hidden ? 10 : 5 } }));
  f.game.createCampaign({ campaign, title: 'Reaction fixture', members: [player, host, ...Array.from({ length: count }, (_, index) => other(index)), { campaign, owner: 'stranger' }].map(scope => ({ owner: scope.owner, role: scope.owner === 'host' ? 'host' : 'player' })), map: { id: 'map', title: 'Twelve by twelve', width: 12, height: 12, blocked: [], difficult: [] }, actors: [mover, ...reactors], effects: [] });
  t.after(() => {
    f.game.close();
    if (directory) { assert.equal(dirname(realpathSync(directory)), realpathSync(tmpdir())); assert.match(basename(directory), /^raph-reactions-test-[A-Za-z0-9]+$/); rmSync(directory, { recursive: true, force: true }); }
  });
  f.state = () => f.game.load(campaign);
  f.command = (type, fields = {}, scope = player) => f.game.command(scope, { requestId: `command-${++f.counter}`, expectedRevision: f.state().revision, actorId: 'mover', type, ...fields });
  f.move = (path = [{ x: 3, y: 2 }]) => f.command('move', { path });
  f.input = (scope, decision, fields = {}) => ({ requestId: `decision-${++f.counter}`, expectedRevision: f.state().revision, pendingId: f.game.reactions(scope).pending.id, decision, ...fields });
  f.declare = (index, decision = 'attack') => { const scope = npc ? host : other(index); const optionId = f.game.reactions(scope).pending.offers.find(offer => offer.actorId === `reactor-${index}`).optionId; const input = f.input(scope, decision, { optionId }); return { input, receipt: f.game.resolveReaction(scope, input) }; };
  return f;
}
function unchanged(f, work, code) {
  const before = { state: f.state(), events: f.game.events(host), receipts: f.game.db.prepare('SELECT * FROM game_receipts ORDER BY rowid').all(), draws: f.draws };
  assert.throws(work, error => error.code === code);
  assert.deepEqual({ state: f.state(), events: f.game.events(host), receipts: f.game.db.prepare('SELECT * FROM game_receipts ORDER BY rowid').all(), draws: f.draws }, before);
}

test('legacy movement remains unchanged and no reaction projection is invented', t => {
  const f = fixture(t, { count: 0 }); const result = f.move([{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  assert.equal(result.result.stopped, false); assert.equal(f.state().actors[0].x, 4); assert.equal(f.state().movementRemaining, 20);
  assert.equal(f.game.view(player).pendingReaction, undefined); assert.deepEqual(f.game.reactions(player), { revision: f.state().revision, pending: null, recentResults: [] }); assert.equal(f.draws, 0);
});
test('movement suspends before leaving reach, retaining only already spent steps', t => {
  const f = fixture(t, { startX: 1 }); const result = f.move([{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]);
  assert.deepEqual(result.result.path, [{ x: 2, y: 2 }]); assert.equal(f.state().actors[0].x, 2); assert.equal(f.state().movementRemaining, 25); assert.equal(f.state().actionAvailable, true); assert.equal(f.draws, 0);
  assert.deepEqual(f.state().pendingReaction.remainingPath, [{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  assert.equal(f.game.reactions(player).pending.offers.length, 0); assert.equal(f.game.reactions(other(0)).pending.offers.length, 1);
  f.declare(0, 'decline'); assert.equal(f.state().actors[0].x, 4); assert.equal(f.state().movementRemaining, 15); assert.equal(f.state().actors[1].reactionAvailable, true); assert.equal(f.draws, 0);
});
test('explicit attack uses the reaction resource, keeps the turn action and saves full private rolls', t => {
  const f = fixture(t); f.move(); const { input, receipt } = f.declare(0);
  assert.equal(f.state().actors[0].hp, 23); assert.equal(f.state().actors[0].x, 3); assert.equal(f.state().actors[1].reactionAvailable, false); assert.equal(f.state().actionAvailable, true); assert.equal(f.state().turn, 1); assert.equal(f.draws, 2);
  assert.equal(f.game.reactions(player).recentResults.length, 0);
  const saved = f.game.reactions(other(0)).recentResults[0];
  assert.equal(saved.result.type, 'attack'); assert.equal(saved.result.reaction, true); assert.equal(saved.result.declarationRequestId, input.requestId); assert.deepEqual(saved.result.dice, [14]); assert.deepEqual(saved.result.damageDice, [4]); assert.equal(saved.result.damage, 7);
  assert.equal(saved.result.modifiers.length, 3); assert.ok(f.game.rollHistory(other(0)).receipts.some(row => row.requestId === saved.requestId));
  assert.deepEqual(f.game.resolveReaction(other(0), input), receipt); assert.equal(f.draws, 2);
});
test('two declarations never choose their own order or roll until the turn owner confirms', t => {
  const f = fixture(t, { count: 2 }); f.move(); f.declare(0); assert.equal(f.draws, 0); assert.equal(f.game.reactions(player).pending.stage, 'declare');
  f.declare(1); assert.equal(f.draws, 0); const view = f.game.reactions(player).pending; assert.equal(view.stage, 'order'); assert.equal(view.orderChoices.length, 2);
  const order = [1, 0].map(index => view.orderChoices.find(choice => choice.actorId === `reactor-${index}`).optionId);
  unchanged(f, () => f.game.resolveReaction(other(0), f.input(other(0), 'order', { order })), 'UNAUTHORIZED');
  const input = f.input(player, 'order', { order }), result = f.game.resolveReaction(player, input);
  assert.equal(f.draws, 4); assert.deepEqual(f.game.events(host).filter(event => event.kind === 'attack_resolved').map(event => event.body.actorId), ['reactor-1', 'reactor-0']);
  assert.equal(f.game.reactions(player).recentResults.length, 0); assert.equal(f.game.reactions(other(0)).recentResults.length, 1); assert.equal(f.game.reactions(other(1)).recentResults.length, 1);
  assert.deepEqual(f.game.resolveReaction(player, input), result); assert.equal(f.draws, 4);
});
test('hidden prospective candidates and declines expose no identity, count or statistics', t => {
  const f = fixture(t, { count: 2, hidden: true }); const before = f.state().revision; f.move();
  for (const scope of [player, { campaign, owner: 'stranger' }]) { const view = f.game.reactions(scope); assert.deepEqual(view.pending.offers, []); assert.deepEqual(view.pending.orderChoices, []); assert.doesNotMatch(JSON.stringify(view), /reactor-|owner-|Reviewed blade|reachFeet|profileHash/); }
  f.declare(0, 'decline'); assert.equal(f.game.reactions(player).pending.stage, 'declare'); assert.deepEqual(f.game.reactions(player).pending.orderChoices, []);
  f.declare(1, 'decline'); assert.equal(f.game.reactions(player).pending, null); assert.equal(f.draws, 0);
  assert.doesNotMatch(JSON.stringify(f.game.updates(player, before)), /reactor-|owner-|Private reactor blade|profileHash/);
});
test('only declared hidden reactions become anonymous ordering options', t => {
  const f = fixture(t, { count: 2, hidden: true }); f.move(); f.declare(0); assert.deepEqual(f.game.reactions(player).pending.orderChoices, []); f.declare(1);
  const pending = f.game.reactions(player).pending; assert.equal(pending.orderChoices.length, 2);
  for (const [index, choice] of pending.orderChoices.entries()) { assert.deepEqual(Object.keys(choice).sort(), ['label', 'optionId']); assert.equal(choice.label, `Unseen reaction ${index + 1}`); }
  assert.deepEqual(f.game.reactions(player).pending.orderChoices, pending.orderChoices);
  assert.doesNotMatch(JSON.stringify(pending), /reactor-|owner-|Reviewed blade|reachFeet|profileHash/);
  f.game.resolveReaction(player, f.input(player, 'order', { order: pending.orderChoices.map(choice => choice.optionId).reverse() })); assert.equal(f.state().actors[0].hp, 16);
});
test('copied offers, player impersonation, stale controls and unsupported modifiers cannot commit', t => {
  const f = fixture(t); f.move(); const optionId = f.game.reactions(other(0)).pending.offers[0].optionId;
  unchanged(f, () => f.game.resolveReaction(player, f.input(player, 'attack', { optionId })), 'UNAUTHORIZED');
  unchanged(f, () => f.game.resolveReaction(host, f.input(host, 'decline', { optionId })), 'UNAUTHORIZED');
  unchanged(f, () => f.game.resolveReaction(other(0), { ...f.input(other(0), 'attack', { optionId }), expectedRevision: 0 }), 'STALE');
  unchanged(f, () => f.game.resolveReaction(other(0), { ...f.input(other(0), 'attack', { optionId }), damage: 900 }), 'INVALID');
  const { input } = f.declare(0);
  unchanged(f, () => f.game.resolveReaction(other(0), { ...input, decision: 'decline' }), 'CONFLICT');
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, other(0).owner);
  unchanged(f, () => f.game.resolveReaction(other(0), input), 'UNAUTHORIZED');
});
test('pause blocks declarations and refresh without pruning any opportunity', t => {
  const f = fixture(t); f.move(); const pending = structuredClone(f.state().pendingReaction); f.command('pause', {}, host);
  const optionId = pending.candidates[0].optionId;
  unchanged(f, () => f.game.resolveReaction(other(0), f.input(other(0), 'attack', { optionId })), 'PAUSED');
  unchanged(f, () => f.game.resolveReaction(host, f.input(host, 'refresh')), 'PAUSED');
  assert.deepEqual(f.state().pendingReaction, pending); assert.equal(f.game.reactions(player).pending.paused, true);
  f.command('resume', {}, host); f.declare(0, 'decline'); assert.equal(f.state().actors[0].x, 3); assert.equal(f.draws, 0);
});
test('all public gameplay mutation wrappers are blocked while reads remain free', t => {
  const f = fixture(t); f.move();
  for (const type of ['move', 'attack', 'end_turn']) unchanged(f, () => f.command(type, type === 'move' ? { path: [{ x: 3, y: 2 }] } : type === 'attack' ? { targetId: 'reactor-0' } : {}), 'PENDING');
  const calls = [() => f.game.requestCheck(null, host, {}), () => f.game.resolveCheck(player, { requestId: 'new-check', checkId: 'check' }), () => f.game.configureMission(host, {}), () => f.game.adjudicateMission(host, {}), () => f.game.installContent(host, {}), () => f.game.prepareContentCouncil(host), () => f.game.prepareContentDeparture(host, 'departure'), () => f.game.prepareDeparture(host, {}), () => f.game.enterDeparture(player, {}), () => f.game.transitionScene(host, {}), () => f.game.prepareCouncil(host, {}), () => f.game.chooseCouncil(player, {}), () => f.game.askCounsel(player, {}), () => f.game.debrief(player, {})];
  for (const call of calls) unchanged(f, call, 'PENDING');
  const before = f.state(), draws = f.draws, events = f.game.events(host);
  for (let i = 0; i < 3; i++) { f.game.reactions(player); f.game.reactions(other(0)); f.game.view(player); f.game.updates(player, 0); f.game.rollHistory(player); }
  assert.deepEqual(f.state(), before); assert.equal(f.draws, draws); assert.deepEqual(f.game.events(host), events);
});
test('refresh never declines valid owners and quietly removes a revoked waiting owner', t => {
  const f = fixture(t, { count: 2 }); f.move(); const pending = structuredClone(f.state().pendingReaction);
  f.game.resolveReaction(host, f.input(host, 'refresh')); assert.deepEqual(f.state().pendingReaction, pending); assert.equal(f.draws, 0);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, other(0).owner);
  f.game.resolveReaction(player, f.input(player, 'refresh')); assert.equal(f.state().actors[0].x, 2); assert.equal(f.game.reactions(other(1)).pending.offers.length, 1);
  f.declare(1, 'decline'); assert.equal(f.state().actors[0].x, 3); assert.equal(f.game.reactions(player).pending, null); assert.equal(f.draws, 0);
});
test('declared authorization is rechecked at ordered execution after revocation or source change', t => {
  const f = fixture(t, { count: 2 }); f.move(); f.declare(0); f.declare(1); const order = f.game.reactions(player).pending.orderChoices.map(choice => choice.optionId);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, other(0).owner);
  f.game.resolveReaction(player, f.input(player, 'order', { order }));
  assert.equal(f.draws, 2); assert.equal(f.state().actors[1].reactionAvailable, true); assert.equal(f.state().actors[2].reactionAvailable, false); assert.equal(f.state().actors[0].hp, 23);
});
test('a changed remaining route stops movement without undoing an authorized reaction', t => {
  const f = fixture(t); f.move(); const state = f.state(); state.map.blocked.push({ x: 3, y: 2 }); f.game.save(state);
  f.declare(0); assert.equal(f.state().actors[0].x, 2); assert.equal(f.state().actors[0].hp, 23); assert.equal(f.state().movementRemaining, 30); assert.equal(f.game.reactions(player).pending, null); assert.equal(f.draws, 2);
});
test('lethal first ordered reaction stops movement and makes later reactions unavailable', t => {
  const f = fixture(t, { count: 2, hp: 5 }); f.move(); f.declare(0); f.declare(1); const choices = f.game.reactions(player).pending.orderChoices;
  f.game.resolveReaction(player, f.input(player, 'order', { order: [0, 1].map(index => choices.find(choice => choice.actorId === `reactor-${index}`).optionId) }));
  assert.equal(f.state().actors[0].hp, 0); assert.equal(f.state().actors[0].x, 2); assert.equal(f.draws, 2); assert.equal(f.state().actors[2].reactionAvailable, true); assert.equal(f.game.reactions(player).pending, null);
});
test('a later departure from reach can offer a new reaction after an earlier decline', t => {
  const f = fixture(t); f.move([{ x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]); const first = f.state().pendingReaction.id;
  f.declare(0, 'decline'); assert.notEqual(f.state().pendingReaction.id, first); assert.equal(f.state().actors[0].x, 2); assert.equal(f.state().movementRemaining, 20);
  f.declare(0, 'decline'); assert.equal(f.state().actors[0].x, 3); assert.equal(f.state().movementRemaining, 15); assert.equal(f.draws, 0);
});
test('failed dice rolls back declaration, pending state and resources for safe retry', t => {
  const f = fixture(t); f.move(); const optionId = f.game.reactions(other(0)).pending.offers[0].optionId, input = f.input(other(0), 'attack', { optionId });
  f.game.rollDie = () => 99; const state = f.state(), receipts = f.game.receipts(other(0));
  assert.throws(() => f.game.resolveReaction(other(0), input), error => error.code === 'RNG'); assert.deepEqual(f.state(), state); assert.deepEqual(f.game.receipts(other(0)), receipts);
  f.game.rollDie = f.roll; f.game.resolveReaction(other(0), input); assert.equal(f.state().actors[0].hp, 23); assert.equal(f.draws, 2);
});
test('nested savepoints preserve independent rollback and outer failure remains atomic', t => {
  const f = fixture(t); const title = f.state().title;
  assert.throws(() => f.game.transaction(() => {
    const outer = f.state(); outer.title = 'outer'; f.game.save(outer);
    assert.throws(() => f.game.transaction(() => { const inner = f.state(); inner.title = 'inner'; f.game.save(inner); throw new Error('inner failure'); }), /inner failure/);
    assert.equal(f.state().title, 'outer'); throw new Error('outer failure');
  }), /outer failure/);
  assert.equal(f.state().title, title); assert.equal(f.game.transactionDepth, 0); f.move(); assert.ok(f.state().pendingReaction);
});
test('two connections and restart preserve one movement interruption and immutable declaration receipt', t => {
  const f = fixture(t, { disk: true }); const input = { requestId: 'shared-move', expectedRevision: f.state().revision, actorId: 'mover', type: 'move', path: [{ x: 3, y: 2 }] };
  const moved = f.game.command(player, input), peer = new GameStore(f.path, { rollDie: f.roll });
  try { assert.deepEqual(peer.command(player, input), moved); assert.throws(() => peer.command(player, { requestId: 'new-move', expectedRevision: peer.load(campaign).revision, actorId: 'mover', type: 'move', path: [{ x: 3, y: 2 }] }), error => error.code === 'PENDING'); } finally { peer.close(); }
  const pending = f.game.reactions(other(0)).pending; f.game.close(); f.game = new GameStore(f.path, { rollDie: f.roll }); assert.deepEqual(f.game.reactions(other(0)).pending, pending);
  const declared = f.declare(0); f.game.close(); f.game = new GameStore(f.path, { rollDie: f.roll }); assert.deepEqual(f.game.resolveReaction(other(0), declared.input), declared.receipt); assert.equal(f.draws, 2); assert.equal(f.state().actors[0].x, 3); assert.equal(f.game.reactions(other(0)).recentResults.length, 1);
});

test('sparse, repeated and incomplete simultaneous orders are rejected without resolving a subset', t => {
  const f = fixture(t, { count: 2 }); f.move(); f.declare(0); f.declare(1); const choices = f.game.reactions(player).pending.orderChoices.map(choice => choice.optionId);
  const sparse = new Array(2); sparse[1] = choices[1];
  for (const order of [sparse, [choices[0], choices[0]], [choices[0]], [choices[0], 'unknown']]) unchanged(f, () => f.game.resolveReaction(player, f.input(player, 'order', { order })), 'INVALID');
});
test('large reactors receive clickable offers when only a non-anchor footprint cell sees the mover', t => {
  const f = fixture(t); const state = f.state(); Object.assign(state.actors[1], { x: 0, y: 1, size: 2, vision: 1 }); f.game.save(state);
  f.move(); const view = f.game.view(other(0)); assert.ok(view.actors.some(actor => actor.id === 'mover'));
  assert.equal(view.pendingReaction.offers[0].targetId, 'mover'); assert.equal(f.game.reactions(other(0)).pending.offers[0].actorId, 'reactor-0'); f.declare(0, 'decline'); assert.equal(f.state().actors[0].x, 3);
});
test('changed reviewed attack statistics invalidate a declaration instead of silently replacing it', t => {
  const f = fixture(t, { count: 2 }); f.move(); f.declare(0); f.declare(1); const order = f.game.reactions(player).pending.orderChoices.map(choice => choice.optionId);
  const state = f.state(); state.actors[0].hp = 30; state.actors[1].weapon.abilityScore = 30; f.game.save(state);
  f.game.resolveReaction(player, f.input(player, 'order', { order })); assert.equal(f.draws, 2); assert.equal(f.state().actors[1].reactionAvailable, true); assert.equal(f.state().actors[0].hp, 23);
});
test('a reaction does not require or replenish the current-turn action', t => {
  const f = fixture(t); const state = f.state(); state.actionAvailable = false; f.game.save(state); f.move(); f.declare(0);
  assert.equal(f.state().actionAvailable, false); assert.equal(f.state().actors[1].reactionAvailable, false); assert.equal(f.state().actors[0].hp, 23);
});
test('host NPC reaction receipt replay requires the host role to remain current', t => {
  const f = fixture(t, { npc: true }); f.move(); const declared = f.declare(0); assert.equal(f.game.reactions(host).recentResults.length, 1);
  f.game.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner='host'").run(campaign);
  assert.throws(() => f.game.resolveReaction(host, declared.input), error => error.code === 'UNAUTHORIZED'); assert.equal(f.draws, 2);
});
test('failure after attack resolution rolls back damage, movement, saved rolls and the declaration together', t => {
  const f = fixture(t); f.move(); const optionId = f.game.reactions(other(0)).pending.offers[0].optionId, input = f.input(other(0), 'attack', { optionId });
  const before = f.state(), events = f.game.events(host), receipts = f.game.receipts(other(0)), record = f.game.record.bind(f.game);
  f.game.record = (state, kind, body) => { record(state, kind, body); if (kind === 'reaction_decision') throw new Error('fixture delivery snapshot failure'); };
  assert.throws(() => f.game.resolveReaction(other(0), input), /fixture delivery snapshot failure/); assert.deepEqual(f.state(), before); assert.deepEqual(f.game.events(host), events); assert.deepEqual(f.game.receipts(other(0)), receipts);
  f.game.record = record; const receipt = f.game.resolveReaction(other(0), input), draws = f.draws; assert.deepEqual(f.game.resolveReaction(other(0), input), receipt); assert.equal(f.draws, draws); assert.equal(f.game.reactions(other(0)).recentResults.length, 1);
});
