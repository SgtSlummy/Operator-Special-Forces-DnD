import test from 'node:test';
import assert from 'node:assert/strict';
import { tacticalControls, movementPreview, MAX_MOVE_STEPS } from './tactical-controls.mjs';

function view(overrides = {}) {
  return { phase: 'exploration', canResume: false, activeActorId: null, movementRemaining: null, actionAvailable: null, round: 4, turn: 7,
    actors: [{ id: 'first', name: 'First', controlled: true, defeated: false, speed: 30, x: 0, y: 0, size: 1 }, { id: 'second', name: 'Second', controlled: true, defeated: false, speed: 30, x: 0, y: 2, size: 1 }, { id: 'other', name: 'Other', controlled: false, defeated: false, x: 1, y: 2, size: 1 }],
    map: { width: 30, height: 3, cells: Array.from({ length: 90 }, (_, i) => ({ x: i % 30, y: Math.floor(i / 30) })), blocked: [], difficult: [] }, ...overrides };
}
test('exploration selects a living owned actor without inventing a combat turn or resources', () => {
  const v = view(), before = structuredClone(v), c = tacticalControls(v, 'second');
  assert.equal(c.actor.id, 'second'); assert.equal(c.active, undefined); assert.equal(c.canMove, true);
  assert.equal(c.canAttack, false); assert.equal(c.canEnd, false); assert.equal(c.canPause, true); assert.equal(c.canResume, false);
  assert.match(c.status, /Exploration/); assert.doesNotMatch(c.status, /Round|Turn|acting/);
  assert.equal(tacticalControls(v, 'other').actor.id, 'first');
  assert.ok(movementPreview(v, c.actor, 'B1')); assert.deepEqual(v, before);
});
test('a zero-speed default does not prevent selecting another mobile character', () => {
  const v = view(); v.actors[0].speed = 0;
  assert.equal(tacticalControls(v).actor.id, 'second');
  assert.equal(tacticalControls(v, 'first').canMove, false);
  assert.equal(movementPreview(v, v.actors[0], 'C1'), null);
  v.actors[1].defeated = true;
  assert.equal(tacticalControls(v).canMove, false);
});
test('exploration previews retain visibility, footprint, collision and 24-step limits', () => {
  const v = view(), actor = v.actors[0];
  assert.equal(MAX_MOVE_STEPS, 24);
  assert.equal(movementPreview(v, actor, 'Y1').path.length, 24);
  assert.equal(movementPreview(v, actor, 'Z1'), null);
  assert.equal(movementPreview(v, actor, 'B3'), null);
  assert.equal(movementPreview(v, v.actors[2], 'C3'), null);
  v.map.cells = v.map.cells.filter(p => p.x < 2);
  assert.equal(movementPreview(v, actor, 'C1'), null);
  actor.size = 2;
  assert.equal(movementPreview(v, actor, 'B1'), null);
});
test('combat previews keep initiative and remaining movement constraints', () => {
  const v = view({ phase: 'combat', activeActorId: 'first', movementRemaining: 5, actionAvailable: true });
  const c = tacticalControls(v, 'second');
  assert.equal(c.actor.id, 'first'); assert.equal(c.canAttack, true); assert.equal(c.canEnd, true);
  assert.equal(movementPreview(v, c.actor, 'C1'), null);
  assert.equal(movementPreview(v, c.actor, 'B1').cost, 5);
  v.activeActorId = 'other';
  assert.equal(tacticalControls(v).canMove, false); assert.equal(tacticalControls(v).canAttack, false);
});
test('paused exploration remains exploration and only projected host authority enables resume', () => {
  const v = view({ phase: 'paused', resumePhase: 'exploration' });
  let c = tacticalControls(v);
  assert.equal(c.exploration, true); assert.equal(c.canMove, false); assert.equal(c.canPause, false); assert.equal(c.canResume, false);
  assert.equal(movementPreview(v, c.actor, 'C1'), null); assert.equal(c.status, 'Paused · exploration');
  v.canResume = true; v.actors = v.actors.map(a => ({ ...a, controlled: false }));
  c = tacticalControls(v);
  assert.equal(c.actor, undefined); assert.equal(c.transitionActor.id, 'first'); assert.equal(c.canResume, true);
  assert.equal(c.canMove, false); assert.equal(c.canAttack, false);
});
test('complete scenes cannot move, attack, end turns or pause', () => {
  const c = tacticalControls(view({ phase: 'complete' }));
  for (const key of ['canMove', 'canAttack', 'canEnd', 'canPause', 'canResume']) assert.equal(c[key], false);
});
