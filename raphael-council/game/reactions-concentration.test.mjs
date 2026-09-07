import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GameStore } from './store.mjs';
import { beginOpportunity, reactionProjection, resolveReaction, resumeReaction } from './reactions.mjs';

class FixtureError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// This fixture isolates the reaction continuation contract: attack records a
// committed damage snapshot and may interrupt with a concentration requirement.
// The production GameStore owns dice, HP rules and concentration-save resolution.
function fixture({ concentrationOn = [1], actors = 2 } = {}) {
  const owners = new Map([['mover-owner', 'player'], ['one-owner', 'player'], ['two-owner', 'player']]);
  const actor = (id, x, y) => ({ id, owner: `${id}-owner`, name: id, x, y, size: 1, vision: 12, hp: 30, speed: 30, reactionAvailable: true, weapon: { name: 'Spear', rangeFeet: 5 }, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } });
  const store = {
    state: { campaign: 'fixture', revision: 1, phase: 'combat', turn: 1, order: ['mover', 'one', 'two'], activeIndex: 0, map: { id: 'fixture-map', width: 8, height: 6, blocked: [], difficult: [] }, actors: [actor('mover', 2, 2), actor('one', 1, 1), ...(actors === 2 ? [actor('two', 1, 3)] : [])] },
    receipts: new Map(), snapshots: [], attacks: [], moves: [],
    transaction(fn) {
      const before = { state: structuredClone(this.state), receipts: structuredClone(this.receipts), snapshots: structuredClone(this.snapshots), attacks: structuredClone(this.attacks), moves: structuredClone(this.moves) };
      try { return fn(); } catch (error) { Object.assign(this, before); throw error; }
    },
    member(scope) { const role = owners.get(scope.owner); if (!role) throw new FixtureError('UNAUTHORIZED', 'No membership'); return role; },
    load() { return structuredClone(this.state); },
    save(state) { this.state = structuredClone(state); },
    record(state, kind, body) { state.revision++; this.snapshots.push({ kind, body: structuredClone(body), state: structuredClone(state) }); },
    attack(state, reactor, input, scope, role, kind) {
      assert.equal(kind, 'reaction');
      assert.equal(reactor.reactionAvailable, true, 'a spent reaction cannot attack again');
      const target = state.actors.find(value => value.id === input.targetId);
      assert.equal(scope.owner, reactor.owner);
      assert.equal(role, 'player');
      reactor.reactionAvailable = false;
      target.hp -= 3;
      this.attacks.push(reactor.id);
      if (concentrationOn.includes(this.attacks.length)) state.pendingConcentration = { id: `save-${this.attacks.length}`, actorId: target.id };
      this.record(state, 'attack_resolved', { actorId: reactor.id, targetId: target.id, newHp: target.hp });
      return { type: 'attack', reaction: true, actorId: reactor.id, targetId: target.id, damage: 3, newHp: target.hp, dice: [11] };
    },
    move(state, mover, input) {
      assert.equal(state.pendingConcentration, undefined, 'movement cannot precede a required concentration save');
      assert.equal(state.pendingReaction, undefined);
      this.moves.push(structuredClone(input.path));
      Object.assign(mover, input.path.at(-1));
      this.record(state, 'moved', { actorId: mover.id });
    },
  };
  store.db = {
    prepare(sql) {
      return {
        get(campaign, owner, request) {
          assert.equal(campaign, 'fixture');
          if (sql.startsWith('SELECT role FROM game_members')) return owners.has(owner) ? { role: owners.get(owner) } : undefined;
          if (sql.startsWith('SELECT 1 FROM game_members')) return undefined;
          if (sql.startsWith('SELECT fingerprint,body FROM game_receipts')) return store.receipts.get(`${owner}:${request}`);
          throw new Error(`Unexpected query: ${sql}`);
        },
        run(campaign, owner, request, fingerprint, body) {
          assert.equal(sql, 'INSERT INTO game_receipts VALUES(?,?,?,?,?)');
          assert.equal(campaign, 'fixture');
          const key = `${owner}:${request}`;
          assert.equal(store.receipts.has(key), false, 'reaction receipts must be inserted exactly once');
          store.receipts.set(key, { fingerprint, body });
        },
      };
    },
  };
  assert.equal(beginOpportunity(store, store.state, store.state.actors[0], { scope: { campaign: 'fixture', owner: 'mover-owner' }, path: [{ x: 3, y: 2 }, { x: 4, y: 2 }], requestId: 'original-movement', movedPath: [] }), true);
  return store;
}

function decision(store, actorId, decision, extra = {}) {
  const pending = store.state.pendingReaction;
  const optionId = pending.candidates.find(value => value.actorId === actorId)?.optionId;
  const input = { requestId: `${decision}-${actorId}`, expectedRevision: store.state.revision, pendingId: pending.id, decision, ...(['attack', 'decline'].includes(decision) ? { optionId } : {}), ...extra };
  const scope = { campaign: 'fixture', owner: `${actorId}-owner` };
  return { input, scope, receipt: resolveReaction(store, scope, input, FixtureError) };
}

function reverseOrder(store) {
  decision(store, 'one', 'attack');
  decision(store, 'two', 'attack');
  const order = ['two', 'one'].map(actorId => store.state.pendingReaction.candidates.find(candidate => candidate.actorId === actorId).optionId);
  return decision(store, 'mover', 'order', { order });
}

function resumeAfterSave(store) {
  return store.transaction(() => {
    const state = store.load();
    delete state.pendingConcentration;
    const frame = state.continuations.pop();
    assert.deepEqual(frame, { kind: 'reaction', pendingId: state.pendingReaction.id });
    const resumed = resumeReaction(store, state);
    store.save(state);
    return resumed;
  });
}

const attackReceipts = store => [...store.receipts.values()].map(value => JSON.parse(value.body)).filter(value => value.result.type === 'attack');

test('confirmed order survives concentration and JSON restart without rerolling or resuming movement early', () => {
  const store = fixture({ concentrationOn: [1, 2] });
  const command = reverseOrder(store);
  assert.deepEqual(store.attacks, ['two']);
  assert.equal(store.moves.length, 0);
  assert.equal(store.state.actors[0].hp, 27);
  assert.equal(store.state.pendingReaction.stage, 'resolving');
  assert.equal(store.state.pendingReaction.cursor, 1);
  assert.deepEqual(store.state.pendingReaction.confirmedOrder, command.input.order);
  assert.equal(attackReceipts(store).length, 1);
  const firstSnapshot = store.snapshots.find(value => value.kind === 'attack_resolved');
  assert.equal(firstSnapshot.state.pendingReaction.cursor, 1);
  assert.equal(firstSnapshot.state.pendingReaction.candidates.find(value => value.actorId === 'two').status, 'resolved');
  assert.deepEqual(firstSnapshot.state.continuations, [{ kind: 'reaction', pendingId: command.input.pendingId }]);
  const projection = reactionProjection(store.state, 'mover-owner', 'player', store.state.actors);
  assert.equal(projection.stage, 'resolving');
  assert.equal(projection.canOrder, false);
  assert.equal(projection.canRefresh, false);
  assert.deepEqual(projection.offers, []);
  assert.deepEqual(projection.orderChoices, []);

  store.state = JSON.parse(JSON.stringify(store.state));
  assert.equal(resumeAfterSave(store), true);
  assert.deepEqual(store.attacks, ['two', 'one']);
  assert.equal(store.state.actors[0].hp, 24);
  assert.equal(store.state.pendingReaction.cursor, 2);
  assert.equal(store.moves.length, 0);
  assert.equal(attackReceipts(store).length, 2);
  assert.equal(store.state.continuations.length, 1);
  assert.deepEqual(resolveReaction(store, command.scope, command.input, FixtureError), command.receipt, 'replaying order returns its original receipt');

  store.state = JSON.parse(JSON.stringify(store.state));
  assert.equal(resumeAfterSave(store), true);
  assert.deepEqual(store.attacks, ['two', 'one']);
  assert.equal(store.moves.length, 1);
  assert.equal(store.state.pendingReaction, undefined);
  assert.equal(store.state.continuations.length, 0);
  assert.equal(store.state.actors[0].x, 4);
  assert.equal(attackReceipts(store).length, 2);
  assert.equal(resumeReaction(store, store.state), false);
});

test('pending concentration and pause reject new decisions while immutable declaration replay remains available', () => {
  const store = fixture({ actors: 1 });
  const command = decision(store, 'one', 'attack');
  const before = structuredClone(store.state);
  assert.equal(resumeReaction(store, store.state), false);
  assert.deepEqual(store.state, before);
  assert.throws(() => decision(store, 'mover', 'refresh'), error => error.code === 'CONCENTRATION');
  assert.deepEqual(resolveReaction(store, command.scope, command.input, FixtureError), command.receipt);
  store.state.phase = 'paused';
  assert.equal(resumeReaction(store, store.state), false);
  assert.throws(() => decision(store, 'mover', 'refresh'), error => error.code === 'PAUSED');
  assert.equal(store.attacks.length, 1);
  assert.equal(store.moves.length, 0);
  store.state.phase = 'combat';
  resumeAfterSave(store);
  assert.equal(store.moves.length, 1);
  assert.equal(store.attacks.length, 1);
});

test('ordinary reactions clear only their frame and preserve an enclosing continuation', () => {
  const store = fixture({ concentrationOn: [] });
  store.state.continuations = [{ kind: 'movement', actorId: 'mover', marker: 'outer-frame' }];
  reverseOrder(store);
  assert.deepEqual(store.attacks, ['two', 'one']);
  assert.equal(store.moves.length, 1);
  assert.deepEqual(store.state.continuations, [{ kind: 'movement', actorId: 'mover', marker: 'outer-frame' }]);
  assert.equal(store.state.pendingReaction, undefined);
  for (const snapshot of store.snapshots.filter(value => value.kind === 'attack_resolved')) {
    assert.equal(snapshot.state.continuations.filter(frame => frame.kind === 'reaction').length, 1);
    assert.equal(snapshot.state.continuations.at(-1).kind, 'reaction');
  }
});

test('defeat during concentration stops the saved route and skips remaining reactions without reordering', () => {
  const store = fixture();
  reverseOrder(store);
  store.state.actors[0].hp = 0;
  resumeAfterSave(store);
  assert.deepEqual(store.attacks, ['two']);
  assert.equal(store.moves.length, 0);
  assert.equal(store.state.pendingReaction, undefined);
  assert.equal(store.state.continuations.length, 0);
  assert.equal(attackReceipts(store).length, 1);
});

test('GameStore restart resolves each concentration save before the next ordered reaction and final movement', () => {
  const directory = mkdtempSync(join(tmpdir(), 'raphael-reaction-concentration-'));
  const database = join(directory, 'game.sqlite');
  const dice = [];
  const rollDie = sides => { dice.push(sides); return sides === 20 ? 11 : 3; };
  let game = new GameStore(database, { rollDie });
  try {
    const scope = owner => ({ campaign: 'reaction-concentration', owner });
    const host = scope('host');
    const actor = (id, owner, x, y, initiative) => ({
      id, owner, name: id, team: id === 'mover' ? 'party' : 'guards', x, y, size: 1,
      hp: 40, maxHp: 40, ac: 10, speed: 30, vision: 12, initiative, characterVersion: 'v1',
      weapon: { name: 'Reviewed spear', abilityScore: 10, proficiencyBonus: 0, proficient: false, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 },
      combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } },
      combatReview: { constitutionProficiencyReason: 'Host reviewed fixture saving throw proficiency.' },
    });
    game.createCampaign({
      campaign: host.campaign, title: 'Reaction concentration fixture',
      members: [{ owner: 'host', role: 'host' }, { owner: 'p1', role: 'player' }, { owner: 'p2', role: 'player' }],
      map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] },
      actors: [actor('mover', 'host', 2, 2, 30), actor('one', 'p1', 1, 1, 20), actor('two', 'p2', 1, 3, 10)],
      effects: [],
    });
    game.resolveConcentration(host, { action: 'start', requestId: 'start-ward', expectedRevision: game.view(host).revision, actorId: 'mover', characterVersion: 'v1', sourceLabel: 'Reviewed ward', effectIds: [], reviewed: true, reason: 'Fixture review' });
    game.command(host, { type: 'move', actorId: 'mover', requestId: 'move-original', expectedRevision: game.view(host).revision, path: [{ x: 3, y: 2 }, { x: 4, y: 2 }] });
    for (const [owner, actorId] of [['p1', 'one'], ['p2', 'two']]) {
      const current = game.reactions(scope(owner));
      const offer = current.pending.offers.find(value => value.actorId === actorId);
      game.resolveReaction(scope(owner), { requestId: `declare-${actorId}`, expectedRevision: current.revision, pendingId: current.pending.id, decision: 'attack', optionId: offer.optionId });
    }
    const pending = game.reactions(host);
    const order = ['two', 'one'].map(actorId => pending.pending.orderChoices.find(value => value.actorId === actorId).optionId);
    const orderInput = { requestId: 'reverse-order', expectedRevision: pending.revision, pendingId: pending.pending.id, decision: 'order', order };
    const orderReceipt = game.resolveReaction(host, orderInput);
    let state = game.load(host.campaign);
    assert.equal(state.actors.find(value => value.id === 'mover').x, 2);
    assert.equal(state.actors.find(value => value.id === 'mover').hp, 37);
    assert.equal(state.pendingReaction.cursor, 1);
    assert.equal(state.pendingReaction.stage, 'resolving');
    assert.deepEqual(state.pendingReaction.confirmedOrder, order);
    assert.equal(state.continuations.at(-1).kind, 'reaction');
    assert.equal(game.reactions(scope('p2')).recentResults.length, 1);
    assert.equal(game.reactions(scope('p1')).recentResults.length, 0);
    assert.equal(game.reactions(host).recentResults.length, 0);
    assert.equal(dice.length, 2);
    const firstPendingId = state.pendingConcentration.id;

    game.close();
    game = new GameStore(database, { rollDie });
    assert.deepEqual(game.load(host.campaign), state);
    assert.deepEqual(game.resolveReaction(host, orderInput), orderReceipt);
    const firstSave = { action: 'resolve', requestId: 'save-first', expectedRevision: game.view(host).revision, pendingId: firstPendingId };
    const saveReceipt = game.resolveConcentration(host, firstSave);
    state = game.load(host.campaign);
    assert.equal(state.actors.find(value => value.id === 'mover').x, 2);
    assert.equal(state.actors.find(value => value.id === 'mover').hp, 34);
    assert.equal(state.pendingReaction.cursor, 2);
    assert.notEqual(state.pendingConcentration.id, firstPendingId);
    assert.equal(state.continuations.filter(frame => frame.kind === 'reaction').length, 1);
    assert.equal(game.reactions(scope('p1')).recentResults.length, 1);
    assert.equal(game.reactions(scope('p2')).recentResults.length, 1);
    assert.equal(dice.length, 5);
    assert.deepEqual(game.resolveConcentration(host, firstSave), saveReceipt);
    assert.equal(dice.length, 5);

    game.close();
    game = new GameStore(database, { rollDie });
    assert.deepEqual(game.load(host.campaign), state);
    game.resolveConcentration(host, { action: 'resolve', requestId: 'save-second', expectedRevision: game.view(host).revision, pendingId: state.pendingConcentration.id });
    state = game.load(host.campaign);
    assert.equal(state.pendingReaction, undefined);
    assert.equal(state.pendingConcentration, undefined);
    assert.deepEqual(state.continuations ?? [], []);
    assert.equal(state.actors.find(value => value.id === 'mover').x, 4);
    assert.equal(state.actors.find(value => value.id === 'mover').hp, 34);
    assert.deepEqual(dice, [20, 6, 20, 20, 6, 20]);
    assert.deepEqual(game.resolveReaction(host, orderInput), orderReceipt);
    assert.equal(dice.length, 6);
  } finally {
    game.close();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('raphael-reaction-concentration-'));
    rmSync(target, { recursive: true, force: true });
  }
});
