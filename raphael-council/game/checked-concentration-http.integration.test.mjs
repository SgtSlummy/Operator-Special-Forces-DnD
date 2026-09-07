import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { createConcentrationHttp } from './concentration-http.mjs';

const origin = 'http://localhost';
const campaign = 'checked_concentration_http';
const tokens = { host: 'a'.repeat(64), player: 'b'.repeat(64), other: 'c'.repeat(64) };
const scope = owner => ({ campaign, owner });
const snapshot = { edition: '2024', fields: { dexterity: { value: 14 }, constitution: { value: 14 }, proficiencyBonus: { value: 2 } } };
const characterVersion = `approved-1-${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)}`;
const characters = { character: () => ({ revision: 1, snapshot }) };
const weapon = { name: 'Blade', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const profile = { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } };
const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y: 2, size: 1, hp: 100, maxHp: 100, ac: 12, speed: 30, vision: 8, initiative, characterVersion, weapon, combatCapabilities: profile, combatReview: { constitutionProficiencyReason: 'Reviewed fixture Constitution save proficiency.' } });
const effect = (id, x) => ({ id, name: id, trigger: 'enter', damage: 3, expiresAtTurn: 99, visible: true, cells: [{ x, y: 2 }] });
function request(owner, path, body) {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: `raph_game_access=${tokens[owner]}`, ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('vary'), 'Cookie');
  return response.json();
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-checked-concentration-http-'));
  const path = join(directory, 'game.sqlite');
  const rolls = [2, 6, 1], draws = [];
  const open = () => new GameStore(path, { rollDie: sides => {
    const value = rolls.shift();
    assert.ok(Number.isInteger(value) && value >= 1 && value <= sides, `unexpected d${sides} draw`);
    draws.push({ sides, value });
    return value;
  } });
  let game = open();
  t.after(() => {
    game.close();
    const target = realpathSync(directory);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.ok(basename(target).startsWith('raph-checked-concentration-http-'));
    rmSync(target, { recursive: true, force: true });
  });
  game.createCampaign({
    campaign, title: 'Checked concentration HTTP fixture',
    members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }],
    map: { id: 'test_map', title: 'Test map', width: 10, height: 10, blocked: [], difficult: [] },
    actors: [actor('hero', 'player', 2, 30), actor('ally', 'other', 5, 20), actor('guard', null, 8, 10)],
    effects: [effect('focus', 7), effect('unrelated', 6)],
  });
  const access = { authenticateAccess(token) {
    const owner = Object.keys(tokens).find(owner => tokens[owner] === token);
    if (!owner) throw new Error('Fixture access denied');
    return scope(owner);
  } };
  const services = () => ({ game, access });
  return {
    get game() { return game; }, draws,
    checks: createGameHttp(services, { getCharacters: () => characters }),
    focus: createConcentrationHttp(services),
    restart() { game.close(); game = open(); },
  };
}

test('reviewed damage and private concentration share HTTP receipts, restart recovery and the final map revision', async t => {
  const context = fixture(t), { checks, focus, draws } = context;
  const start = await json(await focus.resolveConcentration(request('host', '/api/game/concentration', {
    action: 'start', requestId: 'start_focus', expectedRevision: context.game.view(scope('host')).revision,
    actorId: 'hero', characterVersion, sourceLabel: 'Private reviewed ward', effectIds: ['focus'], reviewed: true,
    reason: 'Private review binds only the focus area.',
  })));
  assert.equal(start.receipt.requestId, 'start_focus');
  const prepared = await json(await checks.requestCheck(request('host', '/api/game/checks/request', {
    id: 'damage_save', reviewed: true, expectedRevision: context.game.view(scope('host')).revision,
    actorId: 'hero', label: 'Reviewed fire save', kind: 'save', ability: 'dexterity',
    proficiencyMultiplier: 0, proficiencyReason: 'No Dexterity save proficiency applies.',
    advantage: [], disadvantage: [], adjustments: [], dc: 100, cost: 'none',
    consequence: { type: 'single_target_damage', dice: { count: 1, sides: 6, bonus: 0 }, damageType: 'fire', onSuccess: 'half',
      mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: 'Private review found no fire defenses.' } },
  })));
  assert.deepEqual(prepared.check.consequence, { type: 'single_target_damage', damageType: 'fire', onSuccess: 'half' });
  assert.deepEqual(draws, []);
  const damageInput = { checkId: prepared.check.id, requestId: 'resolve_damage' };
  const damage = await json(await checks.resolveCheck(request('player', '/api/game/checks/resolve', damageInput)));
  assert.equal(damage.receipt.result.consequence.appliedDamage, 6);
  assert.equal(damage.view.actors.find(actor => actor.id === 'hero').hp, 94);
  assert.equal(damage.receipt.revision, damage.view.revision);
  assert.deepEqual(draws, [{ sides: 20, value: 2 }, { sides: 6, value: 6 }]);

  const waiting = (await json(await focus.concentration(request('player', '/api/game/concentration')))).concentration;
  assert.equal(waiting.pending.canResolve, true);
  assert.equal(waiting.pending.actorId, 'hero');
  assert.equal(waiting.pending.damageTaken, 6);
  assert.equal(waiting.pending.dc, 10);
  const privateOther = (await json(await focus.concentration(request('other', '/api/game/concentration')))).concentration;
  assert.equal(privateOther.pending.canResolve, false);
  for (const key of ['id', 'actorId', 'dc', 'damageTaken', 'sourceLabel']) assert.equal(privateOther.pending[key], undefined);
  assert.doesNotMatch(JSON.stringify(privateOther), /Private reviewed ward|Private review binds/);

  const beforeRetry = context.game.load(campaign);
  const retried = await json(await checks.resolveCheck(request('player', '/api/game/checks/resolve', damageInput)));
  assert.deepEqual(retried.receipt, damage.receipt);
  assert.deepEqual(context.game.load(campaign), beforeRetry);
  assert.equal(draws.length, 2);
  const focusInput = { action: 'resolve', requestId: 'resolve_focus', expectedRevision: waiting.revision, pendingId: waiting.pending.id };
  await json(await focus.resolveConcentration(request('other', '/api/game/concentration', focusInput)), 403);
  assert.deepEqual(context.game.load(campaign), beforeRetry);
  assert.equal(draws.length, 2);

  context.restart();
  const restarted = (await json(await focus.concentration(request('player', '/api/game/concentration')))).concentration;
  assert.deepEqual(restarted.pending, waiting.pending);
  const restartedDamage = await json(await checks.resolveCheck(request('player', '/api/game/checks/resolve', damageInput)));
  assert.deepEqual(restartedDamage.receipt, damage.receipt);
  assert.equal(draws.length, 2);
  const settled = await json(await focus.resolveConcentration(request('player', '/api/game/concentration', focusInput)));
  assert.equal(settled.receipt.result.type, 'concentration_save');
  assert.equal(settled.receipt.result.success, false);
  assert.deepEqual(settled.receipt.result.removedEffectIds, ['focus']);
  assert.deepEqual(draws, [{ sides: 20, value: 2 }, { sides: 6, value: 6 }, { sides: 20, value: 1 }]);
  const state = context.game.load(campaign);
  assert.equal(state.pendingConcentration, undefined);
  assert.equal((state.continuations ?? []).length, 0);
  assert.equal(state.actors.find(actor => actor.id === 'hero').hp, 94);
  assert.deepEqual(state.effects.map(effect => effect.id), ['unrelated']);
  assert.equal(state.actors.find(actor => actor.id === 'hero').concentration, undefined);
  assert.ok(state.revision > damage.receipt.revision);
  assert.equal(settled.receipt.revision, state.revision);

  const finalReplay = await json(await checks.resolveCheck(request('player', '/api/game/checks/resolve', damageInput)));
  assert.deepEqual(finalReplay.receipt, damage.receipt);
  assert.equal(finalReplay.view.revision, state.revision);
  assert.deepEqual(finalReplay.view.effects.map(effect => effect.id), ['unrelated']);
  assert.deepEqual(context.game.load(campaign), state);
  assert.equal(draws.length, 3);
  const history = await json(await checks.checks(request('player', '/api/game/checks')));
  assert.deepEqual(history.receipts.find(receipt => receipt.requestId === damageInput.requestId), damage.receipt);
  const staleMap = await checks.map(request('player', `/api/game/map?revision=${damage.receipt.revision}`));
  await json(staleMap, 409);
  const map = await checks.map(request('player', `/api/game/map?revision=${state.revision}`));
  assert.equal(map.status, 200);
  assert.equal(map.headers.get('content-type'), 'image/png');
  assert.equal(map.headers.get('x-raph-revision'), String(state.revision));
  const bytes = Buffer.from(await map.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(bytes.length > 1000);
  assert.equal(draws.length, 3);
});
