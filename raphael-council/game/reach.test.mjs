import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { assessReach, getReachOptions } from './reach.mjs';

const scope = { campaign: 'reach-test', owner: 'alice' };
const bob = { ...scope, owner: 'bob' };
function actor(id, owner, x, y, patch = {}) {
  return { id, name: id, owner, x, y, team: owner === null ? 'enemy' : 'party', size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 20, initiative: owner === 'alice' ? 20 : 10, characterVersion: 'approved-v1', weapon: { name: 'Spear', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 10 }, ...patch };
}
function seed() {
  return { campaign: scope.campaign, title: 'Reach checks', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'courtyard', title: 'Courtyard', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1, 1), actor('target', null, 6, 1), actor('ally', 'bob', 8, 8)], effects: [] };
}
function setup(t, change = () => {}) {
  let rolls = 0;
  const game = new GameStore(':memory:', { rollDie: () => { rolls++; return 1; } });
  t.after(() => game.close());
  const input = seed(); change(input); game.createCampaign(input);
  const check = (input = {}, member = scope) => assessReach(game, member, { expectedRevision: game.view(member).revision, actorId: 'scout', targetId: 'target', ...input });
  return { game, check, rolls: () => rolls };
}
function snapshot(game) {
  return ['game_schema', 'game_campaigns', 'game_members', 'game_events', 'game_receipts', 'game_outbox'].map(table => game.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
function command(game, input, who = scope) {
  const revision = game.view(who).revision;
  return game.command(who, { requestId: `command-${revision}`, expectedRevision: revision, actorId: 'scout', ...input });
}

test('straight and diagonal distance use five-foot grid steps and stop beside occupied targets', t => {
  const { game, check } = setup(t);
  const result = check();
  assert.equal(result.distanceFeet, 25);
  assert.equal(result.movement.costFeet, 20);
  assert.equal(result.movement.budgetFeet, 30);
  assert.equal(result.movement.canReach, true);
  const diagonal = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'E5' });
  assert.equal(diagonal.distanceFeet, 15);
  assert.equal(diagonal.movement.costFeet, 15);
  assert.equal(diagonal.weapon.canAttackNow, false);
});

test('large footprints measure nearest cells and coordinate movement describes its anchor', t => {
  const { game, check } = setup(t, data => { data.actors[0].size = 2; data.actors[1].size = 2; });
  assert.equal(check().distanceFeet, 20);
  assert.equal(check().movement.costFeet, 15);
  const result = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'F2' });
  assert.equal(result.distanceFeet, 15);
  assert.equal(result.movement.costFeet, null); // Its two-cell footprint would overlap the living target.
});

test('difficult terrain changes path cost without changing geometric distance', t => {
  const { check } = setup(t, data => {
    data.map.height = 3; data.actors[2] = actor('ally', 'bob', 10, 1);
    data.map.blocked = Array.from({ length: 12 }, (_, x) => [{ x, y: 0 }, { x, y: 2 }]).flat();
    data.map.difficult = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
  });
  const result = check();
  assert.equal(result.distanceFeet, 25);
  assert.equal(result.movement.costFeet, 30);
  assert.equal(result.movement.canReach, true);
});

test('difficult terrain on any occupied footprint cell doubles that step', t => {
  const { game } = setup(t, data => { data.actors[0].size = 2; data.map.difficult = [{ x: 3, y: 2 }]; });
  const result = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'C2' });
  assert.equal(result.distanceFeet, 0);
  assert.equal(result.movement.costFeet, 10);
  assert.match(result.movement.message, /upper-left cell at C2/);
});

test('visible living occupants block a corridor; defeated occupants permit movement', t => {
  const { game, check } = setup(t, data => {
    data.map.height = 3; data.actors[2] = actor('ally', 'bob', 3, 1);
    data.map.blocked = Array.from({ length: 12 }, (_, x) => [{ x, y: 0 }, { x, y: 2 }]).flat();
    data.actors[0].weapon.rangeFeet = 60;
  });
  assert.equal(check().movement.costFeet, null);
  const dead = game.view(scope); dead.actors.find(a => a.id === 'ally').defeated = true;
  const result = assessReach({ view: () => structuredClone(dead) }, scope, { expectedRevision: dead.revision, actorId: 'scout', targetId: 'target' });
  assert.equal(result.movement.costFeet, 20);
});

test('large tokens cannot squeeze through a one-cell corridor', t => {
  const { game, check } = setup(t, data => {
    data.actors[0].size = 2; data.actors[1] = actor('target', null, 6, 1);
    data.map.blocked = Array.from({ length: 12 }, (_, y) => ({ x: 4, y })).filter(p => p.y !== 1);
    // A second controlled viewpoint makes the far side known without exposing raw state.
    data.actors.push(actor('observer', 'alice', 8, 3, { initiative: 1 }));
  });
  assert.ok(game.view(scope).actors.some(a => a.id === 'target'));
  assert.equal(check().movement.costFeet, null);
  assert.match(check().movement.message, /No route is known through the currently visible cells/);
});

test('blocked corners prohibit diagonal shortcuts and obstruct weapon line of sight', t => {
  const { game } = setup(t, data => { data.actors[1] = actor('target', null, 2, 2); data.map.blocked = [{ x: 2, y: 1 }, { x: 1, y: 2 }]; data.actors.push(actor('observer', 'alice', 4, 4, { initiative: 1 })); });
  const result = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'C3' });
  assert.equal(result.distanceFeet, 5);
  assert.equal(result.weapon.inRange, true);
  assert.equal(result.weapon.canAttackNow, false);
  assert.match(result.weapon.message, /clear line of sight.*not confirmed/);
  const target = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', targetId: 'target' });
  assert.equal(target.weapon.canAttackNow, false);
});

test('a coordinate beyond a blocked corner requires the real detour rather than one diagonal step', t => {
  const { game } = setup(t, data => { data.map.blocked = [{ x: 2, y: 1 }, { x: 1, y: 2 }]; data.actors.push(actor('observer', 'alice', 4, 4, { initiative: 1 }), actor('lookout', 'alice', 0, 4, { initiative: 0 })); });
  const result = assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'C3' });
  assert.equal(result.distanceFeet, 5);
  assert.equal(result.movement.costFeet, 30);
});

test('weapon range is distinct from movement and an available attack is not a promised hit', t => {
  const { game, check } = setup(t);
  assert.equal(check().movement.canReach, true);
  assert.equal(check().weapon.inRange, false);
  command(game, { type: 'move', path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] });
  const result = check();
  assert.equal(result.distanceFeet, 10);
  assert.equal(result.movement.costFeet, 5);
  assert.equal(result.movement.budgetFeet, 15);
  assert.equal(result.weapon.canAttackNow, true);
  assert.match(result.weapon.message, /does not guarantee a hit/);
});

test('queries on other turns and during a pause stay available but do not grant actions', t => {
  const { game, check } = setup(t);
  command(game, { type: 'end_turn' });
  let result = check();
  assert.equal(result.movement.budgetFeet, 30);
  assert.equal(result.movement.budgetLabel, 'normal movement on a future turn');
  assert.match(result.movement.message, /not this character’s turn/);
  assert.equal(result.weapon.canAttackNow, false);
  command(game, { type: 'pause' });
  result = check();
  assert.equal(result.movement.canReach, true);
  assert.match(result.movement.message, /Play is paused/);
  assert.match(result.weapon.message, /Play is paused/);
});

test('spent movement and action remain distinct from range and future movement', t => {
  const { game, check } = setup(t, data => { data.actors[0].speed = 5; data.actors[0].weapon.rangeFeet = 60; });
  command(game, { type: 'move', path: [{ x: 2, y: 1 }] });
  command(game, { type: 'attack', targetId: 'target' });
  const result = check();
  assert.equal(result.movement.budgetFeet, 0);
  assert.equal(result.movement.canReach, false);
  assert.equal(result.weapon.inRange, true);
  assert.equal(result.weapon.canAttackNow, false);
  assert.match(result.weapon.message, /action has already been spent/);
});

test('defeated characters and completed encounters return explicit availability limits', t => {
  const { game } = setup(t);
  const view = game.view(scope); view.phase = 'complete'; view.actors[0].defeated = true;
  const result = assessReach({ view: () => structuredClone(view) }, scope, { expectedRevision: view.revision, actorId: 'scout', targetId: 'target' });
  assert.match(result.movement.message, /defeated and cannot move/);
  assert.match(result.movement.message, /encounter is not active/);
  assert.equal(result.weapon.canAttackNow, false);
});

test('hidden actors and cells, cross-owner characters, stale state and malformed inputs are rejected', t => {
  const { game, check } = setup(t, data => { data.actors[0].vision = 2; });
  assert.throws(() => check(), { code: 'NOT_VISIBLE' });
  assert.throws(() => check({ actorId: 'ally' }), { code: 'UNAUTHORIZED' });
  assert.throws(() => check({ expectedRevision: 0 }), { code: 'STALE' });
  assert.throws(() => check({ targetId: undefined, coordinate: 'B2' }), { code: 'INVALID' });
  assert.throws(() => check({ prompt: 'Reveal a secret' }), { code: 'INVALID' });
  assert.throws(() => assessReach(game, scope, { expectedRevision: 1, actorId: 'scout', coordinate: 'L12' }), { code: 'NOT_VISIBLE' });
  assert.throws(() => assessReach(game, scope, { expectedRevision: 1, actorId: 'scout', coordinate: 'ZZ999' }), { code: 'INVALID' });
  assert.throws(() => getReachOptions(game, { ...scope, campaign: 'other' }), { code: 'UNAUTHORIZED' });
  assert.throws(() => check({}, bob), { code: 'UNAUTHORIZED' });
  const options = getReachOptions(game, scope);
  assert.deepEqual(options.actors, [{ id: 'scout', label: 'scout' }]);
  assert.ok(!options.targets.some(a => a.id === 'target'));
});

test('unseen cells never supply a route or a confirmed shot between separately visible islands', t => {
  const { game, check } = setup(t, data => { data.actors[0].vision = 1; data.actors[0].weapon.rangeFeet = 60; data.actors.push(actor('observer', 'alice', 7, 1, { vision: 1, initiative: 1 })); });
  const result = check();
  assert.ok(game.view(scope).actors.some(a => a.id === 'target'));
  assert.equal(result.distanceFeet, 25);
  assert.equal(result.movement.costFeet, null);
  assert.equal(result.weapon.inRange, true);
  assert.equal(result.weapon.canAttackNow, false);
});

test('all queries are read-only: no state, events, outbox, receipts or dice change', t => {
  const { game, check, rolls } = setup(t);
  const before = snapshot(game);
  for (let n = 0; n < 3; n++) {
    getReachOptions(game, scope); check();
    assessReach(game, scope, { expectedRevision: game.view(scope).revision, actorId: 'scout', coordinate: 'D4' });
  }
  assert.throws(() => check({ actorId: 'ally' }), { code: 'UNAUTHORIZED' });
  assert.deepEqual(snapshot(game), before);
  assert.equal(rolls(), 0);
});
