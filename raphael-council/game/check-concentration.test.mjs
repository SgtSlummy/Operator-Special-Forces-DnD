import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GameStore } from './store.mjs';

const campaign = 'checked_concentration';
const host = { campaign, owner: 'host' }, player = { campaign, owner: 'player' }, other = { campaign, owner: 'other' };
const snapshot = { edition: '2024', fields: { dexterity: { value: 14 }, constitution: { value: 14 }, proficiencyBonus: { value: 2 } } };
const characterVersion = `approved-1-${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)}`;
const characters = { character: () => ({ revision: 1, snapshot }) };
const weapon = { name: 'Blade', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const profile = { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } };
const actor = (id, owner, x, initiative, hp = 100) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y: 2, size: 1, hp, maxHp: 100, ac: 12, speed: 30, vision: 8, initiative, characterVersion, weapon, combatCapabilities: profile, combatReview: { constitutionProficiencyReason: 'Reviewed fixture save proficiency.' } });
const effect = (id, trigger = 'enter', x = 7) => ({ id, name: id, trigger, damage: 3, expiresAtTurn: 99, visible: true, cells: [{ x, y: 2 }] });
const consequence = overrides => ({ type: 'single_target_damage', dice: { count: 1, sides: 6, bonus: 0 }, damageType: 'fire', onSuccess: 'half', mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: 'Reviewed no applicable defenses.' }, ...overrides });
function database(game) {
  return JSON.stringify(game.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({ name, rows: game.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() })));
}
function fixture(t, { hp = 100, effects = [], rolls = [2, 6, 12] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-check-concentration-')), path = join(directory, 'game.sqlite');
  let dice = [...rolls], draws = 0;
  const open = () => new GameStore(path, { rollDie: sides => { draws++; const value = dice.shift(); assert.ok(Number.isInteger(value) && value >= 1 && value <= sides, `unexpected d${sides} draw`); return value; } });
  let game = open();
  t.after(() => { game.close(); const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.ok(basename(target).startsWith('raph-check-concentration-')); rmSync(target, { recursive: true, force: true }); });
  game.createCampaign({ campaign, title: 'Checked concentration fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }], map: { id: 'test_map', title: 'Test map', width: 10, height: 10, blocked: [], difficult: [] }, actors: [actor('hero', 'player', 2, 30, hp), actor('ally', 'other', 5, 20), actor('guard', null, 8, 10)], effects: [effect('focus'), effect('unrelated'), ...effects] });
  return {
    get game() { return game; }, get draws() { return draws; },
    restart() { game.close(); game = open(); },
    resetDice(values) { dice = [...values]; },
  };
}
function start(context, actorId = 'hero', effectIds = ['focus']) {
  const game = context.game;
  return game.resolveConcentration(host, { action: 'start', requestId: `start_${actorId}`, expectedRevision: game.view(host).revision, actorId, characterVersion, sourceLabel: `${actorId} reviewed ward`, effectIds, reviewed: true, reason: 'Reviewed concentration source and exact effect bindings.' });
}
function request(context, changes = {}) {
  return context.game.requestCheck(characters, host, { id: 'damage_save', reviewed: true, expectedRevision: context.game.view(host).revision, actorId: 'hero', label: 'Reviewed fire save', kind: 'save', ability: 'dexterity', proficiencyMultiplier: 0, proficiencyReason: 'No Dexterity save proficiency applies.', advantage: [], disadvantage: [], adjustments: [], dc: 100, cost: 'none', consequence: consequence(), ...changes });
}
const resolveDamage = context => context.game.resolveCheck(player, { checkId: 'damage_save', requestId: 'resolve_damage' });
function damageSnapshots(game) {
  return game.db.prepare("SELECT e.kind,o.snapshot FROM game_events e JOIN game_outbox o ON o.campaign=e.campaign AND o.revision=e.revision AND o.kind='projection' WHERE e.campaign=? AND e.kind IN ('check_resolved','save_damage_applied') ORDER BY e.revision").all(campaign).map(row => ({ kind: row.kind, state: JSON.parse(row.snapshot) }));
}
function resolveFocus(context, scope = player, requestId = 'resolve_focus') {
  const view = context.game.concentration(scope);
  return context.game.resolveConcentration(scope, { action: 'resolve', requestId, expectedRevision: view.revision, pendingId: view.pending.id });
}

test('one checked HP write pins one concentration save and continuation in both first damage snapshots', t => {
  const context = fixture(t);
  start(context); request(context);
  const before = context.game.load(campaign), receipt = resolveDamage(context), after = context.game.load(campaign);
  assert.equal(receipt.result.consequence.appliedDamage, 6);
  assert.equal(after.actors.find(item => item.id === 'hero').hp, 94);
  assert.equal(after.actionAvailable, before.actionAvailable);
  assert.equal(after.turn, before.turn);
  assert.equal(context.draws, 2);
  const rows = damageSnapshots(context.game);
  assert.deepEqual(rows.map(row => row.kind), ['check_resolved', 'save_damage_applied']);
  for (const row of rows) {
    assert.equal(row.state.actors.find(item => item.id === 'hero').hp, 94);
    assert.equal(row.state.pendingConcentration.id, after.pendingConcentration.id);
    assert.equal(row.state.pendingConcentration.damageTaken, 6);
    assert.equal(row.state.pendingConcentration.origin.kind, 'checked_save');
    assert.equal(row.state.pendingConcentration.origin.checkId, 'damage_save');
    assert.equal(row.state.continuations.filter(frame => frame.kind === 'checked_damage_done').length, 1);
  }
  const original = structuredClone(receipt), saved = resolveFocus(context);
  assert.equal(saved.result.type, 'concentration_save'); assert.equal(saved.result.success, true);
  assert.equal(context.game.load(campaign).pendingConcentration, undefined);
  assert.equal((context.game.load(campaign).continuations ?? []).length, 0);
  assert.equal(context.game.load(campaign).actors.find(item => item.id === 'hero').hp, 94);
  const beforeReplay = database(context.game), draws = context.draws;
  assert.deepEqual(resolveDamage(context), original);
  assert.equal(database(context.game), beforeReplay); assert.equal(context.draws, draws);
  assert.deepEqual(context.game.rollHistory(player).receipts.find(item => item.requestId === original.requestId), original);
});

test('checked save replay while concentration waits, paused, and restarted never rolls or applies HP twice', t => {
  const context = fixture(t);
  start(context); request(context);
  const receipt = resolveDamage(context);
  for (const step of ['pending', 'paused', 'restarted']) {
    if (step === 'paused') context.game.command(player, { requestId: 'pause_checked', expectedRevision: context.game.view(player).revision, type: 'pause', actorId: 'hero' });
    if (step === 'restarted') context.restart();
    const before = database(context.game), draws = context.draws;
    assert.deepEqual(resolveDamage(context), receipt);
    assert.equal(database(context.game), before); assert.equal(context.draws, draws);
    assert.ok(context.game.load(campaign).pendingConcentration);
  }
  context.game.command(host, { requestId: 'resume_checked', expectedRevision: context.game.view(host).revision, type: 'resume', actorId: 'hero' });
  assert.equal(resolveFocus(context).result.success, true);
  assert.equal(context.game.load(campaign).actors.find(item => item.id === 'hero').hp, 94);
});

test('concentration DC uses checked damage after resistance, not the unmitigated packet', t => {
  const context = fixture(t, { rolls: [2, 6, 12] });
  start(context);
  request(context, { consequence: consequence({ dice: { count: 1, sides: 6, bonus: 44 }, mitigation: { reduction: 0, resistance: true, vulnerability: false, immunity: false, reason: 'Reviewed fire resistance.' } }) });
  const receipt = resolveDamage(context), pending = context.game.concentration(player).pending;
  assert.equal(receipt.result.consequence.appliedDamage, 25);
  assert.equal(pending.damageTaken, 25); assert.equal(pending.dc, 12);
  assert.equal(context.game.load(campaign).actors.find(item => item.id === 'hero').hp, 75);
});

test('immune checked damage creates no concentration save or continuation', t => {
  const context = fixture(t, { rolls: [2, 6] });
  start(context);
  request(context, { consequence: consequence({ mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: true, reason: 'Reviewed fire immunity.' } }) });
  const receipt = resolveDamage(context), state = context.game.load(campaign);
  assert.equal(receipt.result.consequence.appliedDamage, 0);
  assert.equal(state.actors.find(item => item.id === 'hero').hp, 100);
  assert.ok(state.actors.find(item => item.id === 'hero').concentration);
  assert.equal(state.pendingConcentration, undefined);
  assert.equal((state.continuations ?? []).length, 0);
  assert.equal(context.draws, 2);
});

test('failed concentration after checked damage removes only its exact bound effects', t => {
  const context = fixture(t, { rolls: [2, 6, 1] });
  start(context); request(context); resolveDamage(context);
  const receipt = resolveFocus(context), state = context.game.load(campaign);
  assert.equal(receipt.result.success, false);
  assert.deepEqual(receipt.result.removedEffectIds, ['focus']);
  assert.deepEqual(state.effects.map(item => item.id), ['unrelated']);
  assert.equal(state.actors.find(item => item.id === 'hero').hp, 94);
  assert.equal(state.actors.find(item => item.id === 'hero').concentration, undefined);
  assert.equal((state.continuations ?? []).length, 0);
});

test('lethal checked damage ends the target focus before an incoming actor turn hazard creates another private save', t => {
  const context = fixture(t, { hp: 5, rolls: [2, 6, 12], effects: [effect('ally_focus'), effect('turn_flame', 'start_turn', 5)] });
  start(context); start(context, 'ally', ['ally_focus']); request(context);
  const receipt = resolveDamage(context), state = context.game.load(campaign);
  assert.equal(receipt.result.consequence.appliedDamage, 6);
  assert.equal(state.actors.find(item => item.id === 'hero').hp, 0);
  assert.equal(state.actors.find(item => item.id === 'hero').concentration, undefined);
  assert.ok(!state.effects.some(item => item.id === 'focus'));
  assert.equal(state.actors.find(item => item.id === 'ally').hp, 97);
  assert.equal(state.pendingConcentration.actorId, 'ally');
  assert.equal(state.order[state.activeIndex], 'ally');
  const waiting = context.game.concentration(player).pending;
  assert.equal(waiting.canResolve, false); assert.equal(waiting.actorId, undefined); assert.equal(waiting.dc, undefined);
  assert.equal(context.game.concentration(other).pending.damageTaken, 3);
  assert.equal(resolveFocus(context, other).result.success, true);
  assert.equal(context.game.load(campaign).actors.find(item => item.id === 'ally').hp, 97);
  assert.equal(context.draws, 3);
  for (const row of damageSnapshots(context.game)) assert.equal(row.state.actors.find(item => item.id === 'hero').hp, 0);
});

for (const point of ['snapshot', 'receipt']) {
  test(`checked damage ${point} failure rolls back HP, pending save, continuation and request result`, t => {
    const context = fixture(t);
    start(context); request(context);
    const game = context.game, before = database(game);
    if (point === 'snapshot') game.db.exec("CREATE TRIGGER fail_checked_snapshot BEFORE INSERT ON game_outbox WHEN json_extract(NEW.snapshot,'$.pendingConcentration.origin.kind')='checked_save' BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END;");
    else game.db.exec("CREATE TRIGGER fail_checked_receipt BEFORE INSERT ON game_receipts WHEN NEW.request='resolve_damage' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;");
    assert.throws(() => resolveDamage(context), /fixture .* failure/);
    assert.equal(database(game), before);
    game.db.exec(`DROP TRIGGER ${point === 'snapshot' ? 'fail_checked_snapshot' : 'fail_checked_receipt'}`);
    context.resetDice([2, 6, 12]);
    const receipt = resolveDamage(context);
    assert.equal(receipt.result.consequence.appliedDamage, 6);
    assert.equal(game.load(campaign).actors.find(item => item.id === 'hero').hp, 94);
    assert.ok(game.load(campaign).pendingConcentration);
    assert.equal(game.load(campaign).continuations.filter(frame => frame.kind === 'checked_damage_done').length, 1);
    assert.equal(resolveFocus(context).result.success, true);
  });
}
