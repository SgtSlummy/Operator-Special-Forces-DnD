import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { GameStore, GameError } from './store.mjs';
import { createAreaDamageService, initializeAreaDamage } from './area-damage.mjs';

const host = { campaign: 'area-test', owner: 'host' };
const alice = { campaign: 'area-test', owner: 'alice' };
const bob = { campaign: 'area-test', owner: 'bob' };
const carol = { campaign: 'area-test', owner: 'carol' };
function fixture(t, { persistent = false } = {}) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'raph-area-test-')) : null;
  const path = directory ? join(directory, 'game.sqlite') : ':memory:';
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, proficiencyBonus: { value: 3 } } };
  const profiles = new Map(['alice', 'bob'].map(owner => [owner, { revision: 2, snapshot: structuredClone(snapshot) }]));
  const pin = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, owner, x, initiative) => ({ id, owner, name: id, team: owner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative, characterVersion: pin, weapon: { name: 'Sword', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
  const draws = [];
  let die = () => [3, 5][draws.length - 1];
  let game = new GameStore(path, { rollDie: sides => { draws.push(sides); return die(sides); } });
  game.createCampaign({ campaign: host.campaign, title: 'Area fixture', members: [{ owner: 'host', role: 'host' }, ...['alice', 'bob', 'carol'].map(owner => ({ owner, role: 'player' }))], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1, 20), actor('ally', 'bob', 2, 15), actor('foe', null, 4, 10)], effects: [] });
  const characters = { character: scope => profiles.get(scope.owner) };
  let service = createAreaDamageService(game, characters, GameError);
  const target = (targetId, actorId, second = false) => ({ targetId, actorId, ability: 'dexterity', dc: second ? 12 : 15, proficiencyMultiplier: second ? 1 : 0, proficiencyReason: second ? 'Reviewed proficiency' : 'Reviewed no proficiency', advantage: [], disadvantage: [], adjustments: [], onSuccess: second ? 'none' : 'half', mitigation: { reduction: 0, resistance: second, vulnerability: false, immunity: false, reason: second ? 'Private defense B' : 'Private defense A' } });
  const input = { id: 'area_fire', reviewed: true, expectedRevision: 1, label: 'Fire wave', sourceActorId: 'scout', cost: 'action', damage: { dice: { count: 2, sides: 6, bonus: 2 }, damageType: 'fire' }, targets: [target('save_a', 'scout'), target('save_b', 'ally', true)], order: ['save_b', 'save_a'] };
  t.after(() => {
    game.close();
    if (directory) {
      const resolved = realpathSync(directory);
      assert.equal(dirname(resolved), realpathSync(tmpdir()));
      assert.ok(basename(resolved).startsWith('raph-area-test-'));
      rmSync(resolved, { recursive: true, force: true });
    }
  });
  return { input, profiles, draws, characters, get game() { return game; }, get service() { return service; }, setDie(value) { die = () => value; }, reopen() { assert.ok(directory); game.close(); game = new GameStore(path, { rollDie: () => { throw new Error('Committed area must not roll on replay'); } }); service = createAreaDamageService(game, characters, GameError); } };
}
const confirmation = prepared => ({ intentId: prepared.intentId, requestId: 'commit_area', approvalId: prepared.approvalId, reviewed: true, order: [...prepared.definition.input.order] });
const expectCode = (work, code) => assert.throws(work, error => error instanceof GameError && error.code === code);
function databaseState(h) {
  return Object.fromEntries(['game_campaigns', 'game_events', 'game_outbox', 'game_receipts', 'game_area_intents'].map(table => [table, h.game.db.prepare(`SELECT * FROM ${table}`).all()]));
}
function changeState(h, change) {
  const state = h.game.load(host.campaign);
  change(state);
  h.game.save(state);
}
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
function noPrivateDefinition(value) {
  const text = JSON.stringify(value);
  for (const forbidden of ['"dc"', '"mitigation"', 'Private defense A', 'Private defense B', '"definitionHash"', '"definition"', '"progress"']) assert.equal(text.includes(forbidden), false, forbidden);
}

test('host prepares canonical immutable review without game changes or dice; initialization is repeatable', t => {
  const h = fixture(t), before = h.game.load(host.campaign);
  const events = h.game.db.prepare('SELECT * FROM game_events').all();
  initializeAreaDamage(h.game.db);
  for (const scope of [alice, bob, { campaign: host.campaign, owner: 'unknown' }]) expectCode(() => h.service.prepare(scope, h.input), 'UNAUTHORIZED');
  const prepared = h.service.prepare(host, h.input);
  assert.equal(prepared.stage, 'prepared'); assert.equal(prepared.definition.input.targets.length, 2);
  assert.match(prepared.approvalId, /^[a-f0-9]{32}$/);
  assert.deepEqual(h.service.prepare(host, reverseKeys(h.input)), prepared);
  assert.deepEqual(h.game.load(host.campaign), before); assert.deepEqual(h.game.db.prepare('SELECT * FROM game_events').all(), events); assert.deepEqual(h.draws, []);
  const changed = structuredClone(h.input); changed.targets[0].dc++;
  expectCode(() => h.service.prepare(host, changed), 'CONFLICT');
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_area_intents').get().n, 1);
});

test('current player controller confirms one common roll and one action; receipt survives reopen without HP changes or another draw', t => {
  const h = fixture(t, { persistent: true });
  const prepared = h.service.prepare(host, h.input), command = confirmation(prepared), before = h.game.load(host.campaign);
  const baseline = databaseState(h);
  for (const scope of [host, bob, carol]) expectCode(() => h.service.commit(scope, command), 'UNAUTHORIZED');
  assert.deepEqual(databaseState(h), baseline); assert.deepEqual(h.draws, []);
  const receipt = h.service.commit(alice, command), after = h.game.load(host.campaign);
  assert.deepEqual(receipt.result.commonDamage, { rollId: 'area_fire:damage', damageType: 'fire', dice: [3, 5], dieSides: 6, bonus: 2, total: 10 });
  assert.deepEqual(receipt.result.order, ['save_b', 'save_a']); assert.equal(receipt.result.cost, 'action');
  assert.deepEqual(h.draws, [6, 6]); assert.equal(after.actionAvailable, false); assert.equal(after.pendingAreaIntentId, h.input.id);
  assert.equal(after.revision, before.revision + 1); assert.equal(receipt.revision, after.revision);
  assert.deepEqual(after.actors.map(actor => actor.hp), before.actors.map(actor => actor.hp));
  const committed = h.service.read(host, h.input.id);
  assert.equal(committed.stage, 'collecting_saves'); assert.equal(committed.progress.nextTargetIndex, 0);
  assert.deepEqual(committed.progress.commonDamage, receipt.result.commonDamage);
  assert.equal(committed.progress.resourceReceiptId, command.requestId);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_receipts').get().n, 1);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_events').get().n, baseline.game_events.length + 1);
  const persisted = databaseState(h);
  assert.deepEqual(h.service.commit(alice, command), receipt);
  expectCode(() => h.service.commit(alice, { ...command, requestId: 'second_commit' }), 'CONFLICT');
  expectCode(() => h.service.commit(alice, { ...command, order: [...command.order].reverse() }), 'CONFLICT');
  assert.deepEqual(databaseState(h), persisted);
  h.reopen();
  assert.deepEqual(h.service.commit(alice, command), receipt); assert.deepEqual(databaseState(h), persisted); assert.deepEqual(h.draws, [6, 6]);
  h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(alice.campaign, alice.owner);
  expectCode(() => h.service.commit(alice, command), 'UNAUTHORIZED');
});

test('player projections expose only their reviewed saves and authorized public ordering; unrelated members receive no private definition', t => {
  const h = fixture(t), prepared = h.service.prepare(host, h.input);
  const own = h.service.read(alice, h.input.id), other = h.service.read(bob, h.input.id);
  assert.deepEqual(own.targets.map(target => target.actorId), ['scout']); assert.deepEqual(other.targets.map(target => target.actorId), ['ally']);
  assert.equal(own.ordering.canConfirm, true); assert.equal(own.ordering.approvalId, prepared.approvalId);
  assert.deepEqual(own.ordering.targets.map(target => target.targetId), ['save_b', 'save_a']);
  assert.equal(Object.hasOwn(other, 'ordering'), false); assert.equal(Object.hasOwn(other, 'approvalId'), false);
  noPrivateDefinition(own); noPrivateDefinition(other);
  assert.equal(JSON.stringify(own.targets).includes('ally'), false); assert.equal(JSON.stringify(other.targets).includes('scout'), false);
  expectCode(() => h.service.read(carol, h.input.id), 'UNAUTHORIZED');
  expectCode(() => h.service.read({ campaign: host.campaign, owner: 'unknown' }, h.input.id), 'UNAUTHORIZED');
  expectCode(() => h.service.read(alice, 'missing'), 'NOT_FOUND');
  expectCode(() => h.service.read(alice, '../bad'), 'INVALID');
});

test('hidden ordering projection fails closed before spending or rolling', t => {
  const h = fixture(t), prepared = h.service.prepare(host, h.input);
  const view = h.game.view.bind(h.game);
  // Exercise the service boundary with a visibility-filtered real game view.
  // This is not a line-of-sight engine test.
  h.game.view = scope => ({ ...view(scope), actors: view(scope).actors.filter(actor => actor.id !== 'ally') });
  const own = h.service.read(alice, h.input.id);
  assert.equal(own.ordering.canConfirm, false); assert.equal(own.ordering.needsHostReview, true);
  for (const key of ['approvalId', 'targets', 'damage', 'sourceActorId']) assert.equal(Object.hasOwn(own.ordering, key), false);
  const before = databaseState(h);
  expectCode(() => h.service.commit(alice, confirmation(prepared)), 'REVIEW');
  assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []); noPrivateDefinition(own);
});

test('hidden no-cost source suppresses the entire ordering proposal even when every target is visible', t => {
  const h = fixture(t);
  h.input.sourceActorId = 'foe'; h.input.cost = 'none';
  const prepared = h.service.prepare(host, h.input);
  const view = h.game.view.bind(h.game);
  // Simulate the audience projection boundary, preserving all target actors.
  h.game.view = scope => { const projected = view(scope); return { ...projected, actors: projected.actors.filter(actor => actor.id !== 'foe') }; };
  assert.deepEqual(h.game.view(alice).actors.map(actor => actor.id).sort(), ['ally', 'scout']);
  const before = databaseState(h), own = h.service.read(alice, h.input.id);
  assert.equal(own.ordering.canConfirm, false); assert.equal(own.ordering.needsHostReview, true);
  for (const key of ['approvalId', 'targets', 'damage', 'sourceActorId']) assert.equal(Object.hasOwn(own.ordering, key), false);
  assert.equal(JSON.stringify(own).includes('foe'), false); noPrivateDefinition(own);
  expectCode(() => h.service.commit(alice, confirmation(prepared)), 'REVIEW');
  assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
});

test('prepared ordering freshness rechecks host, target membership and approval without relying on game revision', async t => {
  const cases = [
    ['host demoted', h => { h.game.db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', host.campaign, host.owner); }, 'UNAUTHORIZED'],
    ['target membership removed', h => { h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(bob.campaign, bob.owner); }, 'TARGET'],
    ['target approved character changed', h => { h.profiles.get('bob').snapshot.fields.dexterity.value = 19; }, 'PROFILE'],
  ];
  for (const [name, mutate, code] of cases) await t.test(name, t => {
    const h = fixture(t), prepared = h.service.prepare(host, h.input);
    assert.equal(h.service.read(alice, h.input.id).ordering.canConfirm, true);
    mutate(h); const before = databaseState(h);
    assert.equal(h.game.load(host.campaign).revision, h.input.expectedRevision);
    const own = h.service.read(alice, h.input.id);
    assert.equal(own.ordering.canConfirm, false); noPrivateDefinition(own);
    expectCode(() => h.service.commit(alice, confirmation(prepared)), code);
    assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
  });
});

test('spent action disables action-cost ordering without disabling reviewed no-cost ordering', async t => {
  for (const cost of ['action', 'none']) await t.test(cost, t => {
    const h = fixture(t); h.input.cost = cost;
    changeState(h, state => { state.actionAvailable = false; });
    const prepared = h.service.prepare(host, h.input), before = databaseState(h);
    assert.equal(h.game.load(host.campaign).revision, h.input.expectedRevision);
    const own = h.service.read(alice, h.input.id);
    assert.equal(own.ordering.canConfirm, cost === 'none');
    assert.equal(Object.hasOwn(own.ordering, 'approvalId'), cost === 'none');
    if (cost === 'action') {
      expectCode(() => h.service.commit(alice, confirmation(prepared)), 'RESOURCE');
      assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
    } else {
      const receipt = h.service.commit(alice, confirmation(prepared));
      assert.equal(receipt.result.cost, 'none'); assert.equal(h.game.load(host.campaign).actionAvailable, false);
      assert.deepEqual(h.draws, [6, 6]);
    }
  });
});

test('unknown prepare fields and malformed or mismatched confirmation never mutate play', t => {
  const h = fixture(t);
  const initial = databaseState(h);
  for (const raw of [{ ...h.input, owner: 'alice' }, { ...h.input, order: ['save_a', 'save_a'] }, { ...h.input, reviewed: false }, { ...h.input, damage: { ...h.input.damage, rolled: [6, 6] } }]) expectCode(() => h.service.prepare(host, raw), 'INVALID');
  assert.deepEqual(databaseState(h), initial);
  const prepared = h.service.prepare(host, h.input), command = confirmation(prepared), before = databaseState(h);
  for (const raw of [{ ...command, extra: true }, { ...command, owner: 'host' }, { ...command, reviewed: false }, { ...command, order: ['save_a'] }, { ...command, requestId: '' }, { ...command, approvalId: null }]) expectCode(() => h.service.commit(alice, raw), 'INVALID');
  for (const raw of [{ ...command, approvalId: 'wrong_token' }, { ...command, order: [...command.order].reverse() }, { ...command, order: ['save_a', 'save_a'] }]) expectCode(() => h.service.commit(alice, raw), 'CONFLICT');
  assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
});

test('prepare validates current revision, phase, living player membership and approved profile before inserting any proposal', async t => {
  const cases = [
    ['stale revision', h => { h.input.expectedRevision++; }, 'STALE'],
    ['paused', h => changeState(h, state => { state.phase = 'paused'; }), 'PAUSED'],
    ['inactive combat', h => changeState(h, state => { state.phase = 'complete'; }), 'UNSUPPORTED'],
    ['wrong action source', h => { h.input.sourceActorId = 'ally'; }, 'TURN'],
    ['removed target owner', h => { h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(bob.campaign, bob.owner); }, 'TARGET'],
    ['dead target', h => changeState(h, state => { state.actors.find(actor => actor.id === 'ally').hp = 0; }), 'TARGET'],
    ['NPC target', h => { h.input.targets[1].actorId = 'foe'; }, 'TARGET'],
    ['changed approved snapshot', h => { h.profiles.get('bob').revision++; }, 'PROFILE'],
  ];
  for (const [name, mutate, code] of cases) await t.test(name, t => {
    const h = fixture(t); mutate(h); const before = databaseState(h);
    expectCode(() => h.service.prepare(host, h.input), code);
    assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
  });
});

test('confirmation rechecks profiles, tokens, membership, turn context, blockers and resources before every new roll', async t => {
  const cases = [
    ['stale revision', h => changeState(h, state => { state.revision++; }), 'STALE'],
    ['paused', h => changeState(h, state => { state.phase = 'paused'; }), 'PAUSED'],
    ['target profile revision', h => { h.profiles.get('bob').revision++; }, 'PROFILE'],
    ['target token pin', h => changeState(h, state => { state.actors.find(actor => actor.id === 'ally').characterVersion = 'approved-999-changed'; }), 'PROFILE'],
    ['target position', h => changeState(h, state => { state.actors.find(actor => actor.id === 'ally').x++; }), 'PROFILE'],
    ['source position', h => changeState(h, state => { state.actors.find(actor => actor.id === 'scout').x++; }), 'PROFILE'],
    ['different active actor', h => changeState(h, state => { state.activeIndex = 1; }), 'PROFILE'],
    ['reviewing host demoted', h => { h.game.db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', host.campaign, host.owner); }, 'UNAUTHORIZED'],
    ['target membership removed', h => { h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(bob.campaign, bob.owner); }, 'TARGET'],
    ['controller membership removed', h => { h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(alice.campaign, alice.owner); }, 'UNAUTHORIZED'],
    ['spent action', h => changeState(h, state => { state.actionAvailable = false; }), 'RESOURCE'],
    ['pending reaction', h => changeState(h, state => { state.pendingReaction = { id: 'reaction' }; }), 'PENDING'],
    ['pending concentration', h => changeState(h, state => { state.pendingConcentration = { id: 'concentration' }; }), 'PENDING'],
    ['pending area', h => changeState(h, state => { state.pendingAreaIntentId = 'another_area'; }), 'PENDING'],
  ];
  for (const [name, mutate, code] of cases) await t.test(name, t => {
    const h = fixture(t), prepared = h.service.prepare(host, h.input); mutate(h); const before = databaseState(h);
    expectCode(() => h.service.commit(alice, confirmation(prepared)), code);
    assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, []);
  });
});

test('invalid die outputs leave no common roll, action cost, pending area, events or receipt', async t => {
  for (const value of [0, 7, 1.5, NaN]) await t.test(String(value), t => {
    const h = fixture(t), prepared = h.service.prepare(host, h.input), before = databaseState(h);
    h.setDie(value);
    assert.throws(() => h.service.commit(alice, confirmation(prepared)), error => error instanceof GameError);
    assert.deepEqual(databaseState(h), before); assert.deepEqual(h.draws, [6]);
  });
});

test('a prepared or committed action remains readable after its source is defeated, with confirmation disabled', t => {
  const h = fixture(t), prepared = h.service.prepare(host, h.input);
  changeState(h, state => { state.actors.find(actor => actor.id === 'scout').hp = 0; });
  const stale = h.service.read(alice, h.input.id);
  assert.equal(stale.ordering.canConfirm, false); noPrivateDefinition(stale);
  changeState(h, state => { state.actors.find(actor => actor.id === 'scout').hp = 20; });
  const receipt = h.service.commit(alice, confirmation(prepared));
  changeState(h, state => { state.actors.find(actor => actor.id === 'scout').hp = 0; state.revision++; });
  const committed = h.service.read(alice, h.input.id);
  assert.equal(committed.stage, 'collecting_saves'); assert.equal(committed.ordering.canConfirm, false); noPrivateDefinition(committed);
  assert.deepEqual(h.service.commit(alice, confirmation(prepared)), receipt); assert.deepEqual(h.draws, [6, 6]);
});

test('reviewed no-cost external source still needs the current controller and preserves its available action', t => {
  const h = fixture(t);
  h.input.sourceActorId = 'foe'; h.input.cost = 'none';
  const prepared = h.service.prepare(host, h.input);
  const own = h.service.read(alice, h.input.id);
  assert.equal(own.ordering.canConfirm, true); assert.equal(own.ordering.sourceActorId, 'foe');
  assert.deepEqual(own.ordering.damage, { damageType: 'fire' });
  for (const key of ['"dice"', '"count"', '"sides"', '"bonus"']) assert.equal(JSON.stringify(own.ordering).includes(key), false);
  assert.deepEqual(prepared.definition.input.damage.dice, { count: 2, sides: 6, bonus: 2 });
  expectCode(() => h.service.commit(host, confirmation(prepared)), 'UNAUTHORIZED');
  const receipt = h.service.commit(alice, confirmation(prepared));
  assert.equal(receipt.result.cost, 'none'); assert.equal(h.game.load(host.campaign).actionAvailable, true);
  assert.deepEqual(h.draws, [6, 6]);
});

test('receipt insertion failure atomically rolls back area stage, event/outbox, pending flag and action cost', t => {
  const h = fixture(t), prepared = h.service.prepare(host, h.input), before = databaseState(h);
  h.game.db.exec("CREATE TEMP TRIGGER reject_area_receipt BEFORE INSERT ON game_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;");
  assert.throws(() => h.service.commit(alice, confirmation(prepared)), /injected receipt failure/);
  assert.deepEqual(h.draws, [6, 6]); assert.deepEqual(databaseState(h), before);
  assert.equal(h.service.read(host, h.input.id).stage, 'prepared');
  assert.equal(h.game.load(host.campaign).actionAvailable, true);
  assert.equal(h.game.load(host.campaign).pendingAreaIntentId, undefined);
});
