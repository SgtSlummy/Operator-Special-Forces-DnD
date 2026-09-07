import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { GameStore } from '../game/store.mjs';
import { createMembershipClient } from './client.mjs';
import { createMembershipBridge, startMembershipBridge } from './server.mjs';

const token = 'fixture-membership-token-'.repeat(3);
const host = '111111111111111111';
const player = '222222222222222222';
const outsider = '333333333333333333';
const scope = { campaign: 'bridge-test', owner: host };
const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init });

async function fixture(t, member) {
  const calls = [];
  const game = { member(input) { calls.push(input); return member ? member(input) : input.owner === host ? 'host' : 'player'; } };
  const server = createMembershipBridge({ game, token, campaigns: [scope.campaign] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, url, calls, client: createMembershipClient({ url, token }) };
}

function raw(url, { path = '/v1/authorize-command', method = 'POST', headers = {}, body = method === 'POST' ? JSON.stringify(scope) : undefined } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, timeout: 2000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Fixture request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

function assertDenied(response) {
  assert.notEqual(response.text, JSON.stringify({ allowed: true }));
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.text.includes(token), false);
  assert.equal(response.text.includes('fixture-private-error'), false);
}

test('real bridge reads current GameStore membership and rejects the same host after revocation', async t => {
  const game = new GameStore(':memory:');
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: scope.campaign, title: 'Bridge fixture', members: [{ owner: host, role: 'host' }, { owner: player, role: 'player' }], map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('scout', player, 1, 20), actor('enemy', null, 3, 10)], effects: [] });
  const bridge = await startMembershipBridge({ game, token, campaigns: [scope.campaign], port: 0 });
  t.after(async () => { await bridge.close(); game.close(); });
  const client = createMembershipClient({ url: bridge.url, token });
  assert.equal(await client.status(), true);
  assert.equal(await client.authorizeCommand(scope), true);
  assert.equal(await client.authorizeCommand({ ...scope, owner: player, role: 'host' }), false);
  assert.equal(await client.authorizeCommand({ ...scope, owner: outsider }), false);
  game.db.prepare('DELETE FROM game_members WHERE owner=?').run(host);
  assert.equal(await client.authorizeCommand(scope), false);
  await bridge.close();
  await bridge.close();
  assert.equal(game.db.prepare('SELECT 1 AS alive').get().alive, 1, 'Bridge shutdown must not close the game store');
  assert.equal(await client.authorizeCommand(scope), false);
  assert.equal(await client.status(), false);
});

test('campaign allowlist denies before consulting membership, and responses contain only authorization', async t => {
  const f = await fixture(t);
  assert.equal(await f.client.authorizeCommand({ campaign: 'other-campaign', owner: host }), false);
  assert.equal(f.calls.length, 0);
  const response = await raw(f.url);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { allowed: true });
  assert.deepEqual(f.calls, [scope]);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('bridge status is authenticated and does not inspect campaign records', async t => {
  const f = await fixture(t);
  const response = await raw(f.url, { path: '/v1/status', method: 'GET', body: undefined });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { ready: true, service: 'operator-membership', version: 1 });
  assert.equal(f.calls.length, 0);
  const denied = await raw(f.url, { path: '/v1/status', method: 'GET', body: undefined, headers: { authorization: 'Bearer wrong' } });
  assert.equal(denied.status, 401);
  assertDenied(denied);
});

test('foreign origins, forged Host, proxy headers and bad bearer tokens fail before membership', async t => {
  const f = await fixture(t);
  for (const headers of [
    { origin: 'https://discord.com' }, { origin: 'null' }, { origin: f.url },
    { host: 'attacker.example' }, { host: 'localhost:' + new URL(f.url).port }, { host: '127.0.0.1:1' },
    { authorization: 'Bearer wrong' }, { authorization: '' }, { authorization: `Basic ${token}` },
    { forwarded: 'for=127.0.0.1' }, { 'x-forwarded-for': '127.0.0.1' },
    { 'x-forwarded-host': '127.0.0.1' }, { 'x-forwarded-proto': 'http' },
    { 'x-real-ip': '127.0.0.1' }, { via: '1.1 proxy' },
    Object.fromEntries([...Array.from({ length: 40 }, (_, index) => [`x-padding-${index}`, '1']), ['origin', 'https://attacker.example']]),
  ]) {
    const response = await raw(f.url, { headers });
    assert.equal(response.status, 401, JSON.stringify(headers));
    assertDenied(response);
  }
  assert.equal(f.calls.length, 0);
});

test('unknown or forged body fields and malformed identities cannot reach membership', async t => {
  const f = await fixture(t);
  for (const body of [
    { ...scope, role: 'host' }, { ...scope, allowed: true }, { ...scope, token },
    { campaign: scope.campaign }, { owner: host }, { ...scope, campaign: '' },
    { ...scope, campaign: '../private' }, { ...scope, campaign: 'a'.repeat(65) },
    { ...scope, owner: 'alice' }, { ...scope, owner: '1'.repeat(16) },
    { ...scope, owner: '1'.repeat(21) }, { ...scope, owner: Number(host) },
    null, [], 'host',
  ]) {
    const response = await raw(f.url, { body: JSON.stringify(body) });
    assert.equal(response.status, 400, JSON.stringify(body));
    assertDenied(response);
  }
  for (const body of ['', '{bad json', JSON.stringify({ ...scope, junk: 'x'.repeat(2048) })]) {
    const response = await raw(f.url, { body });
    assert.ok(response.status === 400 || response.status === 413);
    assertDenied(response);
  }
  assert.equal(f.calls.length, 0);
});

test('unsupported methods, routes, query strings and non-JSON content fail closed', async t => {
  const f = await fixture(t);
  for (const options of [
    { method: 'GET' }, { method: 'PUT' }, { method: 'OPTIONS' }, { method: 'DELETE' },
    { path: '/v1/status', method: 'POST' }, { path: '/v1/authorize-command?campaign=other' },
    { path: '/v1/status?x=1', method: 'GET' }, { path: '/v1/unknown' },
    { headers: { 'content-type': 'text/plain' } },
  ]) {
    const response = await raw(f.url, options);
    assert.equal(response.status, 400, JSON.stringify(options));
    assertDenied(response);
  }
  assert.equal(f.calls.length, 0);
});

test('membership exceptions return denial without exposing details', async t => {
  const f = await fixture(t, () => { throw new Error('fixture-private-error ' + token); });
  assert.equal(await f.client.authorizeCommand(scope), false);
  const response = await raw(f.url);
  assertDenied(response);
});

test('client strips claimed roles, uses authenticated POST and refuses redirect following', async () => {
  const calls = [];
  const client = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ allowed: true });
  } });
  assert.equal(await client.authorizeCommand({ ...scope, role: 'host', privateText: 'not forwarded' }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:38176/v1/authorize-command');
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(['manual', 'error'].includes(calls[0].init.redirect));
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), scope);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('client accepts only the exact positive authorization JSON response', async () => {
  const badResponses = [
    () => jsonResponse({ allowed: false }), () => jsonResponse({ allowed: 'true' }),
    () => jsonResponse({ allowed: 1 }), () => jsonResponse({ allowed: true, role: 'host' }),
    () => jsonResponse({ allowed: true, evidence: 'secret' }), () => jsonResponse([true]),
    () => jsonResponse(null), () => jsonResponse(true), () => jsonResponse({}),
    () => jsonResponse({ allowed: true }, { status: 201 }),
    () => jsonResponse({ allowed: true }, { status: 401 }),
    () => jsonResponse({ allowed: true }, { status: 307, headers: { 'content-type': 'application/json', location: 'https://attacker.example/' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response('{"allowed":true}', { headers: { 'content-type': 'text/html' } }),
    () => new Response(' '.repeat(2048) + '{"allowed":true}', { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of badResponses) {
    let calls = 0;
    const client = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async () => { calls++; return response(); } });
    assert.equal(await client.authorizeCommand(scope), false);
    assert.equal(calls, 1, 'A denial must not trigger retries or alternative routes');
  }
});

test('client verifies exact service identity and version for status', async () => {
  const ready = { ready: true, service: 'operator-membership', version: 1 };
  for (const value of [ready, { ...ready, version: 2 }, { ...ready, service: 'other' }, { ...ready, ready: 'true' }, { ...ready, secret: token }, { ready: true }]) {
    const client = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:38176/v1/status');
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      return jsonResponse(value);
    } });
    assert.equal(await client.status(), value === ready);
  }
});

test('client rejects unsafe configuration and malformed scopes before fetching', async () => {
  for (const url of [
    'https://127.0.0.1:38176', 'http://localhost:38176', 'http://example.com:38176',
    'http://[::1]:38176', 'http://127.1:38176', 'http://2130706433:38176',
    'http://user:pass@127.0.0.1:38176', 'http://127.0.0.1:38176/v1',
    'http://127.0.0.1:38176/?x=1', 'http://127.0.0.1:38176/#fragment',
  ]) assert.throws(() => createMembershipClient({ url, token }), undefined, url);
  for (const invalidToken of ['', 'a'.repeat(31), 'a'.repeat(513), 'a'.repeat(32) + '\n', 'a'.repeat(32) + ' ', 'é'.repeat(32)]) {
    assert.throws(() => createMembershipClient({ url: 'http://127.0.0.1:38176', token: invalidToken }));
  }
  let calls = 0;
  const client = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async () => { calls++; return jsonResponse({ allowed: true }); } });
  for (const input of [null, {}, { ...scope, owner: 'alice' }, { ...scope, campaign: '../other' }, { ...scope, campaign: 'a'.repeat(65) }]) {
    assert.equal(await client.authorizeCommand(input), false);
  }
  assert.equal(calls, 0);
});

test('client fails closed when the real server drops a socket mid-request', async t => {
  let calls = 0;
  const server = createServer(request => { calls++; request.socket.destroy(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createMembershipClient({ url: `http://127.0.0.1:${server.address().port}`, token });
  assert.equal(await client.authorizeCommand(scope), false);
  assert.equal(calls, 1, 'Interrupted authorization is not retried');
  assert.equal(await client.status(), false);
  assert.equal(calls, 2);
});

test('client returns denial on connection errors and enforced timeout', async () => {
  const broken = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async () => { throw new Error('fixture-private-error ' + token); } });
  assert.equal(await broken.authorizeCommand(scope), false);
  assert.equal(await broken.status(), false);
  let aborted = false;
  const hanging = createMembershipClient({ url: 'http://127.0.0.1:38176', token, timeoutMs: 100, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }) });
  const keepAlive = setTimeout(() => {}, 2000);
  try { assert.equal(await hanging.authorizeCommand(scope), false); assert.equal(aborted, true); }
  finally { clearTimeout(keepAlive); }
});
