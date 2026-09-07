import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createConcentrationHttp } from './concentration-http.mjs';

const origin = 'http://localhost';
const tokens = { host: 'a'.repeat(64), p1: 'b'.repeat(64), p2: 'c'.repeat(64) };
const scope = owner => ({ campaign: 'concentration-http', owner });
function request(owner = 'p1', { method = 'GET', body, raw, query = '', headers = {} } = {}) {
  const values = new Headers({ cookie: `raph_game_access=${tokens[owner]}`, ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}) });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) values.delete(key);
    else values.set(key, value);
  }
  return new Request(`${origin}/api/game/concentration${query}`, { method, headers: values, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) });
}
function privateResponse(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('vary'), 'Cookie');
}
function setup(t, { pending = true } = {}) {
  const dice = [], revoked = new Set();
  const game = new GameStore(':memory:', { rollDie: sides => { dice.push(sides); return sides === 20 ? 11 : 3; } });
  t.after(() => game.close());
  const actor = (id, owner, x, initiative) => ({
    id, owner, team: owner, name: id, x, y: 2, size: 1, hp: 40, maxHp: 40, ac: 10, speed: 30, vision: 12, initiative, characterVersion: 'v1',
    weapon: { name: 'Reviewed spear', abilityScore: 10, proficiencyBonus: 0, proficient: false, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 },
    combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } },
    combatReview: { constitutionProficiencyReason: 'Host reviewed fixture proficiency.' },
  });
  game.createCampaign({
    campaign: scope('host').campaign, title: 'HTTP fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'p1', role: 'player' }, { owner: 'p2', role: 'player' }],
    map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] },
    actors: [actor('hero', 'p1', 2, 20), actor('guard', 'p2', 3, 30)], effects: [],
  });
  const start = () => ({ action: 'start', requestId: 'start-source', expectedRevision: game.view(scope('host')).revision, actorId: 'hero', characterVersion: 'v1', sourceLabel: 'Private ward source', effectIds: [], reviewed: true, reason: 'Private source review' });
  if (pending) {
    game.resolveConcentration(scope('host'), start());
    game.command(scope('p2'), { type: 'attack', requestId: 'damage', expectedRevision: game.view(scope('p2')).revision, actorId: 'guard', targetId: 'hero' });
  }
  const services = { game, access: { authenticateAccess(token) { const owner = Object.keys(tokens).find(owner => tokens[owner] === token); if (!owner || revoked.has(owner)) throw new Error('private-access-detail'); return scope(owner); } } };
  const handlers = createConcentrationHttp(() => services);
  return { game, dice, revoked, services, handlers, start, resolve: () => ({ action: 'resolve', requestId: 'resolve-save', expectedRevision: game.view(scope('p1')).revision, pendingId: game.load(scope('p1').campaign).pendingConcentration.id }) };
}

test('GET uses authenticated private projection without spending dice or changing state', async t => {
  const { game, dice, handlers } = setup(t);
  const before = game.load(scope('host').campaign), rolls = dice.length;
  for (const owner of ['host', 'p1', 'p2']) {
    const response = await handlers.concentration(request(owner));
    assert.equal(response.status, 200);
    privateResponse(response);
    const body = await response.json();
    assert.deepEqual(body, { concentration: game.concentration(scope(owner)) });
    if (owner === 'p2') assert.doesNotMatch(JSON.stringify(body), /Private ward source|Private source review/);
  }
  assert.deepEqual(game.load(scope('host').campaign), before);
  assert.equal(dice.length, rolls);
});

test('POST resolves one owner save and retries the identical receipt without another roll', async t => {
  const { game, dice, handlers, resolve } = setup(t);
  const input = resolve();
  const response = await handlers.resolveConcentration(request('p1', { method: 'POST', body: input }));
  assert.equal(response.status, 200);
  privateResponse(response);
  const body = await response.json();
  assert.equal(body.receipt.requestId, input.requestId);
  assert.equal(body.receipt.revision, game.view(scope('p1')).revision);
  assert.deepEqual(body.concentration, game.concentration(scope('p1')));
  assert.equal(game.load(scope('p1').campaign).pendingConcentration, undefined);
  assert.equal(dice.length, 3);
  const retried = await handlers.resolveConcentration(request('p1', { method: 'POST', body: input }));
  assert.equal(retried.status, 200);
  assert.deepEqual((await retried.json()).receipt, body.receipt);
  assert.equal(dice.length, 3);
  const conflict = await handlers.resolveConcentration(request('p1', { method: 'POST', body: { ...input, pendingId: 'another-save' } }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'CONFLICT');
  assert.equal(dice.length, 3);
});

test('copied save IDs and unauthorized source registration cannot act as another player', async t => {
  const { game, handlers, resolve } = setup(t);
  const before = game.load(scope('host').campaign);
  const response = await handlers.resolveConcentration(request('p2', { method: 'POST', body: resolve() }));
  assert.equal(response.status, 403);
  privateResponse(response);
  assert.doesNotMatch(await response.text(), /Private ward source|Private source review/);
  assert.deepEqual(game.load(scope('host').campaign), before);
  const fresh = setup(t, { pending: false });
  const denied = await fresh.handlers.resolveConcentration(request('p1', { method: 'POST', body: fresh.start() }));
  assert.equal(denied.status, 403);
  const accepted = await fresh.handlers.resolveConcentration(request('host', { method: 'POST', body: fresh.start() }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).receipt.requestId, 'start-source');
});

test('both endpoints reject missing, malformed, duplicate and revoked access cookies', async t => {
  const { handlers, resolve, revoked } = setup(t);
  for (const cookie of [null, 'raph_game_access=invalid', 'raph_game_access=%', `raph_game_access=${tokens.p1}; raph_game_access=${tokens.p1}`]) {
    for (const method of ['GET', 'POST']) {
      const response = await handlers[method === 'GET' ? 'concentration' : 'resolveConcentration'](request('p1', { method, body: resolve(), headers: { cookie } }));
      assert.equal(response.status, 401);
      privateResponse(response);
    }
  }
  revoked.add('p1');
  for (const method of ['GET', 'POST']) {
    const response = await handlers[method === 'GET' ? 'concentration' : 'resolveConcentration'](request('p1', { method, body: resolve() }));
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /private-access-detail/);
  }
});

test('membership revocation applies to reads and saved command replay with token or Discord session', async t => {
  for (const session of [false, true]) {
    const { game, handlers, resolve, services } = setup(t);
    const input = resolve();
    if (session) {
      services.auth = { authenticate: async () => scope('p1') };
      services.access.authenticateAccess = () => { throw new Error('Cookie fallback must not replace an authenticated session'); };
    }
    const headers = session ? { cookie: null } : {};
    const response = await handlers.resolveConcentration(request('p1', { method: 'POST', body: input, headers }));
    assert.equal(response.status, 200);
    game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(scope('p1').campaign, 'p1');
    for (const method of ['GET', 'POST']) {
      const denied = await handlers[method === 'GET' ? 'concentration' : 'resolveConcentration'](request('p1', { method, body: input, headers }));
      assert.equal(denied.status, 403);
      privateResponse(denied);
    }
  }
});

test('POST rejects missing or foreign Origin and cross-site metadata before any state change', async t => {
  const { game, handlers, resolve, dice } = setup(t);
  const before = game.load(scope('p1').campaign), count = dice.length;
  for (const headers of [{ origin: null }, { origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await handlers.resolveConcentration(request('p1', { method: 'POST', body: resolve(), headers }));
    assert.equal(response.status, 403);
    privateResponse(response);
  }
  assert.deepEqual(game.load(scope('p1').campaign), before);
  assert.equal(dice.length, count);
});

test('query scope overrides, malformed JSON, oversized bodies and unsupported fields fail privately', async t => {
  const { game, handlers, resolve } = setup(t);
  const before = game.load(scope('p1').campaign);
  for (const method of ['GET', 'POST']) {
    const response = await handlers[method === 'GET' ? 'concentration' : 'resolveConcentration'](request('p1', { method, body: resolve(), query: '?owner=host' }));
    assert.equal(response.status, 400);
    privateResponse(response);
  }
  for (const [options, status] of [
    [{ raw: '{' }, 400], [{ raw: 'null' }, 400], [{ raw: '[]' }, 400],
    [{ body: { ...resolve(), owner: 'host' } }, 400], [{ body: { ...resolve(), dc: 1 } }, 400],
    [{ raw: ' '.repeat(8193) }, 413], [{ body: resolve(), headers: { 'content-length': '9000' } }, 413],
    [{ body: resolve(), headers: { 'content-type': 'text/plain' } }, 415],
  ]) {
    const response = await handlers.resolveConcentration(request('p1', { method: 'POST', ...options }));
    assert.equal(response.status, status);
    privateResponse(response);
  }
  assert.deepEqual(game.load(scope('p1').campaign), before);
});

test('paused saves are readable and rejected mutations retain a safe private conflict response', async t => {
  const { game, handlers, resolve } = setup(t);
  const before = resolve();
  game.command(scope('p1'), { type: 'pause', requestId: 'pause-save', expectedRevision: game.view(scope('p1')).revision, actorId: 'hero' });
  const get = await handlers.concentration(request('p1'));
  assert.equal(get.status, 200);
  const response = await handlers.resolveConcentration(request('p1', { method: 'POST', body: { ...before, expectedRevision: game.view(scope('p1')).revision } }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PAUSED');
  privateResponse(response);
});

test('unknown service failures never expose their message or internal details', async t => {
  const { game, handlers } = setup(t);
  game.concentration = () => { throw new Error('database C:/private secret-provider-key'); };
  const response = await handlers.concentration(request('p1'));
  assert.equal(response.status, 503);
  privateResponse(response);
  assert.doesNotMatch(await response.text(), /database|C:\/private|secret-provider-key/);
});
