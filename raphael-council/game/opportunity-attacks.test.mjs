import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityCandidates } from './opportunity-attacks.mjs';

function fixture(reactorOverrides = {}, moverOverrides = {}) {
  const mover = { id: 'mover', team: 'party', x: 4, y: 5, size: 1, hp: 20, vision: 12, ...moverOverrides };
  const reactor = { id: 'reactor', team: 'foes', x: 3, y: 5, size: 1, hp: 20, vision: 12, reactionAvailable: true, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 }, ...reactorOverrides };
  const state = { phase: 'combat', turn: 7, actors: [mover, reactor], map: { width: 12, height: 12, blocked: [], difficult: [] } };
  return { state, mover, reactor, from: { x: mover.x, y: mover.y }, to: { x: 5, y: 5 } };
}
const candidates = f => opportunityCandidates(f.state, f.mover, f.from, f.to);
const one = [{ actorId: 'reactor', reachFeet: 5 }];

function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

test('seen ordinary movement leaving melee reach produces only internal candidate fields', () => {
  assert.deepEqual(candidates(fixture()), one);
});

test('same-team creatures remain eligible and mover never reacts to itself', () => {
  const f = fixture({ team: 'party' }, { reactionAvailable: true, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } });
  assert.deepEqual(candidates(f), one);
});

test('reactor vision cannot borrow another actor\'s sight', () => {
  const f = fixture({ vision: 0 });
  f.state.actors.push({ id: 'observer', x: 4, y: 4, size: 1, hp: 20, vision: 12 });
  assert.deepEqual(candidates(f), []);
});

test('a wall between reactor and the departing creature blocks eligibility', () => {
  const f = fixture({ combatCapabilities: { attackKind: 'melee', meleeReachFeet: 10 } }, { x: 5 });
  f.state.map.blocked = [{ x: 4, y: 5 }];
  f.to = { x: 6, y: 5 };
  assert.deepEqual(candidates(f), []);
});

test('shared conservative corner visibility applies to opportunity attacks', () => {
  const f = fixture({}, { y: 6 });
  f.state.map.blocked = [{ x: 4, y: 5 }];
  f.to = { x: 5, y: 7 };
  assert.deepEqual(candidates(f), []);
});

test('large reactor uses its nearest footprint for reach and sight', () => {
  const f = fixture({ x: 2, y: 4, size: 2, vision: 1 });
  assert.deepEqual(candidates(f), one);
});

test('large mover remains in reach until its last occupied cell leaves', () => {
  const f = fixture({ x: 7 }, { x: 5, size: 2 });
  f.to = { x: 4, y: 5 };
  assert.deepEqual(candidates(f), one);
  f.from = { x: 6, y: 5 };
  f.to = { x: 5, y: 5 };
  assert.deepEqual(candidates(f), []);
});

test('one visible mover footprint cell is sufficient', () => {
  const f = fixture({ y: 4, vision: 1 }, { size: 2 });
  f.to = { x: 5, y: 6 };
  assert.deepEqual(candidates(f), one);
});

test('only the inside-to-outside boundary triggers', () => {
  const f = fixture();
  for (const [from, to] of [
    [{ x: 4, y: 5 }, { x: 4, y: 5 }],
    [{ x: 4, y: 5 }, { x: 4, y: 6 }],
    [{ x: 5, y: 5 }, { x: 4, y: 5 }],
    [{ x: 5, y: 5 }, { x: 6, y: 5 }],
  ]) assert.deepEqual(opportunityCandidates(f.state, f.mover, from, to), []);
});

test('attack-specific extended reach delays the trigger until its own boundary', () => {
  const f = fixture({ combatCapabilities: { attackKind: 'melee', meleeReachFeet: 10 } });
  assert.deepEqual(candidates(f), []);
  f.from = { x: 5, y: 5 };
  f.to = { x: 6, y: 5 };
  assert.deepEqual(candidates(f), [{ actorId: 'reactor', reachFeet: 10 }]);
});

test('reaction availability must be explicit and unspent', () => {
  for (const reactionAvailable of [undefined, false, 1, 'true']) assert.deepEqual(candidates(fixture({ reactionAvailable })), []);
});

test('dead or explicitly incapacitated actors cannot react', () => {
  for (const actor of [{ hp: 0 }, { hp: -1 }, { hp: undefined }, { incapacitated: true }]) assert.deepEqual(candidates(fixture(actor)), []);
});

test('Disengage suppresses opportunities only for its recorded turn', () => {
  assert.deepEqual(candidates(fixture({}, { disengagedTurn: 7 })), []);
  assert.deepEqual(candidates(fixture({}, { disengagedTurn: 6 })), one);
  assert.deepEqual(candidates(fixture({}, { disengagedTurn: 8 })), one);
});

test('exploration, paused, and completed phases produce no opportunities', () => {
  for (const phase of ['exploration', 'paused', 'complete']) {
    const f = fixture();
    f.state.phase = phase;
    assert.deepEqual(candidates(f), []);
  }
});

test('ranged and legacy unconfigured actors never gain inferred melee capability', () => {
  for (const combatCapabilities of [undefined, null, {}, { attackKind: 'ranged', meleeReachFeet: 5 }, { meleeReachFeet: 5 }]) {
    assert.deepEqual(candidates(fixture({ combatCapabilities, attack: { name: 'Sword', range: 1 } })), []);
  }
});

test('melee reach accepts only the explicit bounded five-foot increments', () => {
  for (const meleeReachFeet of [undefined, null, 0, 4, 6, 5.5, 35, Infinity, NaN, '5']) {
    assert.deepEqual(candidates(fixture({ combatCapabilities: { attackKind: 'melee', meleeReachFeet } })), []);
  }
  const f = fixture({ combatCapabilities: { attackKind: 'melee', meleeReachFeet: 30 } }, { x: 9 });
  f.to = { x: 10, y: 5 };
  assert.deepEqual(candidates(f), [{ actorId: 'reactor', reachFeet: 30 }]);
});

test('candidate enumeration preserves state order without choosing simultaneous resolution', () => {
  const f = fixture();
  f.state.actors = [{ ...f.reactor, id: 'z-last' }, f.mover, { ...f.reactor, id: 'a-first' }];
  assert.deepEqual(candidates(f), [{ actorId: 'z-last', reachFeet: 5 }, { actorId: 'a-first', reachFeet: 5 }]);
});

test('eligibility is pure, repeatable, and ignores untrusted movement-exemption flags', () => {
  const f = fixture({}, { forcedMovement: true, teleport: true });
  f.to.forcedMovement = true;
  f.to.teleport = true;
  const before = structuredClone(f);
  freezeTree(f);
  assert.deepEqual(candidates(f), one);
  assert.deepEqual(candidates(f), one);
  assert.deepEqual(f, before);
});
