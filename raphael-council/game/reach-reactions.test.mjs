import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReach } from './reach.mjs';

function fixture(overrides = {}) {
  return {
    revision: 7, phase: 'combat', activeActorId: 'hero', movementRemaining: 25, actionAvailable: true,
    map: {
      title: 'Reach fixture', width: 8, height: 6, blocked: [], difficult: [],
      cells: Array.from({ length: 48 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8) })),
    },
    actors: [
      { id: 'hero', name: 'Maren', x: 1, y: 2, size: 1, controlled: true, defeated: false, speed: 30, weapon: { name: 'Reviewed weapon', rangeFeet: 30 } },
      { id: 'guard', name: 'Visible guard', x: 3, y: 2, size: 1, controlled: false, defeated: false },
    ],
    ...overrides,
  };
}

function query(view, input = { targetId: 'guard' }) {
  const before = structuredClone(view);
  let reads = 0;
  const result = assessReach({ view: () => { reads++; return view; } }, {}, { expectedRevision: 7, actorId: 'hero', ...input });
  assert.equal(reads, 1);
  assert.deepEqual(view, before, 'a reach question cannot mutate the projected game');
  return result;
}

function measurements(result) {
  return {
    revision: result.revision, actorId: result.actorId, targetLabel: result.targetLabel, distanceFeet: result.distanceFeet,
    costFeet: result.movement.costFeet, budgetFeet: result.movement.budgetFeet,
    budgetLabel: result.movement.budgetLabel, canReach: result.movement.canReach,
    weaponName: result.weapon.name, rangeFeet: result.weapon.rangeFeet, inRange: result.weapon.inRange,
  };
}

for (const stage of ['declare', 'order']) {
  test(`pending ${stage} preserves known reach but blocks new movement and attacks`, () => {
    const baseline = query(fixture());
    assert.equal(baseline.distanceFeet, 10);
    assert.equal(baseline.movement.costFeet, 5);
    assert.equal(baseline.movement.canMoveNow, true);
    assert.equal(baseline.weapon.canAttackNow, true);
    const pending = query(fixture({ pendingReaction: { kind: 'opportunity_attack', stage } }));
    assert.deepEqual(measurements(pending), measurements(baseline));
    assert.equal(pending.movement.canMoveNow, false);
    assert.equal(pending.weapon.canAttackNow, false);
    assert.match(pending.movement.message, /reaction is pending; movement waits/i);
    assert.match(pending.weapon.message, /reaction is pending; attacks wait/i);
    assert.doesNotMatch(pending.weapon.message, /attack is available now/i);
    assert.ok(pending.summary.includes(pending.movement.message));
    assert.ok(pending.summary.includes(pending.weapon.message));
    assert.match(pending.summary.join(' '), /spends no movement, action, time, or dice/);
  });
}

test('generic pending information blocks actions without copying reaction identities or choices', () => {
  const pending = query(fixture({ pendingReaction: { pending: true, actorId: 'unseen-sentry-secret', privateReason: 'hidden-ambush-secret', offers: ['private-offer-secret'] } }));
  assert.equal(pending.movement.canMoveNow, false);
  assert.equal(pending.weapon.canAttackNow, false);
  assert.doesNotMatch(JSON.stringify(pending), /unseen-sentry-secret|hidden-ambush-secret|private-offer-secret/);
});

for (const [label, overrides] of [
  ['paused', { phase: 'paused' }],
  ['outside the character turn', { activeActorId: 'guard' }],
  ['exploration', { phase: 'exploration', activeActorId: null, movementRemaining: null, actionAvailable: null }],
]) {
  test(`pending reaction keeps distance questions available during ${label}`, () => {
    const baseline = query(fixture(overrides), { coordinate: 'C3' });
    const pending = query(fixture({ ...overrides, pendingReaction: { pending: true } }), { coordinate: 'C3' });
    assert.deepEqual(measurements(pending), measurements(baseline));
    assert.equal(pending.distanceFeet, 5);
    assert.equal(pending.movement.costFeet, 5);
    assert.equal(pending.movement.canMoveNow, false);
    assert.equal(pending.weapon.canAttackNow, false);
    assert.match(pending.summary.join(' '), /reaction is pending/i);
  });
}

test('resolving a pending reaction restores current availability without changing the known measurements', () => {
  const view = fixture({ pendingReaction: { pending: true } });
  const pending = query(view);
  view.pendingReaction = null;
  const resumed = query(view);
  assert.deepEqual(measurements(resumed), measurements(pending));
  assert.equal(resumed.movement.canMoveNow, true);
  assert.equal(resumed.weapon.canAttackNow, true);
  assert.doesNotMatch(resumed.summary.join(' '), /reaction is pending/i);
});

test('a pending concentration save preserves free measurements but blocks current movement and attacks', () => {
  for (const overrides of [{}, { phase: 'paused' }, { activeActorId: 'guard' }, { pendingReaction: { pending: true } }]) {
    const baseline = query(fixture(overrides));
    const view = fixture({ ...overrides, pendingConcentration: { pending: true, actorId: 'private-caster', reviewReason: 'private-concentration-review' } });
    const pending = query(view);
    assert.deepEqual(measurements(pending), measurements(baseline));
    assert.equal(pending.distanceFeet, 10);
    assert.equal(pending.movement.costFeet, 5);
    assert.equal(pending.movement.canMoveNow, false);
    assert.equal(pending.weapon.canAttackNow, false);
    assert.match(pending.movement.message, /concentration save is pending; movement waits/i);
    assert.match(pending.weapon.message, /concentration save is pending; attacks wait/i);
    assert.doesNotMatch(JSON.stringify(pending), /private-caster|private-concentration-review|attack is available now/i);
    assert.match(pending.summary.join(' '), /spends no movement, action, time, or dice/);
    delete view.pendingConcentration;
    assert.deepEqual(query(view), baseline, 'resolving the save restores the earlier availability without altering reach');
  }
});

test('a pending reaction does not turn unknown terrain into a known route or clear shot', () => {
  const view = fixture();
  view.map.cells = [{ x: 1, y: 2 }, { x: 3, y: 2 }];
  const baseline = query(view);
  view.pendingReaction = { pending: true };
  const pending = query(view);
  assert.deepEqual(measurements(pending), measurements(baseline));
  assert.equal(pending.distanceFeet, 10);
  assert.equal(pending.movement.costFeet, null);
  assert.equal(pending.movement.canReach, false);
  assert.equal(pending.weapon.inRange, true);
  assert.equal(pending.weapon.canAttackNow, false);
  assert.match(pending.movement.message, /No route is known/);
  assert.match(pending.weapon.message, /line of sight.*not confirmed/);
});
