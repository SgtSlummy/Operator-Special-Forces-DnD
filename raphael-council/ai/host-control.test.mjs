import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createObusHostControl } from './host-control.mjs';

const CONTRACT = 'raph-obus-game-runtime-v1';
const BOOT = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'ab'.repeat(32);
const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const NONCE = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const NOW = 1735689600000;
const scope = { campaign: 'camp-1', session: 'session-1' };
const registration = { ...scope, generation: GENERATION, expectedBootEpoch: BOOT, expectedGeneration: null, opId: OP, leaseSeconds: 30 };
const renewal = { ...scope, generation: GENERATION, expectedBootEpoch: BOOT, expectedSessionPolicyRevision: 0, opId: OP, leaseSeconds: 30 };
const configuration = { ...scope, expectedBootEpoch: BOOT, expectedGeneration: GENERATION, expectedSessionPolicyRevision: 0, opId: OP, policy: { enabled: true, mode: 'local-free', exportable: false, codex: false } };
const effectivePolicy = { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false };

test('master release uses its signed CAS route and rejects child scope or an unreleased response', async () => {
 const input={...renewal,session:'campaign'};delete input.leaseSeconds;let call;
 const client=make(async(url,options)=>{call={url,options};return json({status:'host_released',runtime:snapshot({generation:null,leaseExpiresAtMs:null,sessionPolicyRevision:1,effectivePolicy:{...effectivePolicy,enabled:false}})});});
 const result=await client.release(input);assert.equal(result.generation,null);assert.equal(result.leaseExpiresAtMs,null);assert.match(call.url,/host-generation\/release$/);assert.equal(call.options.method,'POST');assert.match(call.options.headers['X-Obus-Game-Host-Signature'],/^[a-f0-9]{64}$/);
 await assert.rejects(client.release({...input,session:'child'}),checkCode('INVALID_HOST_CONTROL_INPUT',400));
 await assert.rejects(make(async()=>json({status:'host_released',runtime:snapshot()})).release(input),checkCode('INVALID_OBUS_RUNTIME_RESPONSE',502));
});
function snapshot(overrides = {}) {
  return { contract: CONTRACT, requiredForRoute: true, bootEpoch: BOOT, generation: GENERATION, sessionPolicyRevision: 0, leaseExpiresAtMs: NOW + 30000, effectivePolicy, queuedCount: 0, dispatchedCount: 0, ...overrides };
}
function json(value = snapshot(), options = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...options });
}
function make(fetchImpl = async () => json(), options = {}) {
  return createObusHostControl({ url: 'http://127.0.0.1:38175', serviceToken: TOKEN, hostControlToken: KEY, now: () => NOW, nonce: () => NONCE, fetchImpl, ...options });
}
function checkCode(code, status) {
  return error => { assert.equal(error.name, 'ObusHostControlError'); assert.equal(error.code, code); if (status !== undefined) assert.equal(error.status, status); return true; };
}

test('register signs the cross-language verified wire vector with decoded raw key bytes', async () => {
  let call;
  const client = make(async (url, options) => { call = { url, ...options }; return json(); });
  const result = await client.register(registration);
  const expectedBody = '{"campaign":"camp-1","contract":"raph-obus-game-runtime-v1","expectedBootEpoch":"11111111-1111-4111-8111-111111111111","expectedGeneration":null,"generation":"22222222-2222-4222-8222-222222222222","leaseSeconds":30,"opId":"33333333-3333-4333-8333-333333333333","session":"session-1"}';
  assert.equal(call.url, 'http://127.0.0.1:38175/api/game/runtime/host-generation');
  assert.equal(call.method, 'PUT');
  assert.equal(call.body, expectedBody);
  assert.equal(createHash('sha256').update(call.body).digest('hex'), '76c174f7ce7accce9028c8d1ae1c47df9cf44450387200908fbba61410e54c64');
  assert.equal(call.headers['X-Obus-Game-Host-Signature'], '1664d4d647a334338c7311a6829b0f277b2c562805d0440b2e5b23011f263630');
  assert.equal(call.headers['X-Obus-Game-Host-Timestamp'], '1735689600');
  assert.equal(call.headers['X-Obus-Game-Host-Nonce'], NONCE);
  assert.equal(call.headers['X-Obus-Game-Token'], TOKEN);
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.redirect, 'error');
  assert.equal(call.credentials, 'omit');
  assert.equal(call.cache, 'no-store');
  assert.equal(call.signal.aborted, true);
  assert.deepEqual(result, snapshot());
});

test('factory is inert and GET sends only service authentication and exact scope', async () => {
  let calls = 0;
  const client = make(async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:38175/api/game/runtime?campaign=camp-1&session=session-1');
    assert.equal(options.method, 'GET');
    assert.equal(Object.hasOwn(options, 'body'), false);
    assert.deepEqual(options.headers, { Accept: 'application/json', 'X-Obus-Game-Token': TOKEN });
    return json(snapshot({ generation: null, leaseExpiresAtMs: null, effectivePolicy: { ...effectivePolicy, enabled: false } }));
  }, { nonce: () => { assert.fail('GET must not sign'); } });
  assert.equal(calls, 0);
  assert.deepEqual(Object.keys(client), ['syncEvidence', 'getRuntime', 'register', 'renew', 'revoke', 'release', 'configure']);
  assert.equal(Object.isFrozen(client), true);
  const result = await client.getRuntime(scope);
  assert.equal(result.generation, null);
  assert.equal(result.leaseExpiresAtMs, null);
  assert.equal(result.effectivePolicy.enabled, false);
  assert.equal(calls, 1);
});

test('renew and configure keep caller CAS intact and recursively sort policy fields', async () => {
  const calls = [];
  let nonceCounter = 0;
  const client = make(async (url, options) => { calls.push({ url, ...options }); return json(); }, { nonce: () => (++nonceCounter).toString(16).padStart(64, '0') });
  await client.renew(renewal);
  await client.configure(configuration);
  assert.equal(calls[0].url, 'http://127.0.0.1:38175/api/game/runtime/host-generation/renew');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body), { ...renewal, contract: CONTRACT });
  assert.equal(calls[1].url, 'http://127.0.0.1:38175/api/game/runtime');
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].body), { ...configuration, contract: CONTRACT });
  assert.match(calls[1].body, /"policy":\{"codex":false,"enabled":true,"exportable":false,"mode":"local-free"\}/);
  assert.notEqual(calls[0].headers['X-Obus-Game-Host-Nonce'], calls[1].headers['X-Obus-Game-Host-Nonce']);
  for (const call of calls) {
    const digest = createHash('sha256').update(call.body, 'utf8').digest('hex');
    const signed = [call.method, new URL(call.url).pathname, call.headers['X-Obus-Game-Host-Timestamp'], call.headers['X-Obus-Game-Host-Nonce'], digest].join('\n');
    assert.equal(call.headers['X-Obus-Game-Host-Signature'], createHmac('sha256', Buffer.from(KEY, 'hex')).update(signed, 'utf8').digest('hex'));
  }
  assert.equal(Object.hasOwn(configuration, 'contract'), false);
});

test('endpoint and explicit credentials reject aliases, nonloopback, paths and invalid keys', () => {
  const badUrls = ['https://127.0.0.1:38175', 'http://localhost:38175', 'http://[::1]:38175', 'http://127.1:38175', 'http://2130706433:38175', 'http://127.0.0.1.evil.test', 'http://user:pass@127.0.0.1:38175', 'http://127.0.0.1:38175/path', 'http://127.0.0.1:38175?x=1', 'http://127.0.0.1:38175#x', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:038175', ' http://127.0.0.1:38175', 'http://127.0.0.1:38175\\evil'];
  for (const url of badUrls) assert.throws(() => make(undefined, { url }), checkCode('INVALID_HOST_CONTROL_INPUT', 400));
  for (const options of [{ serviceToken: undefined }, { serviceToken: 'token' }, { hostControlToken: KEY.toUpperCase() }, { hostControlToken: 'ab'.repeat(31) }, { hostControlToken: 'ab'.repeat(33) }, { fetchImpl: null }, { now: null }, { nonce: null }, { extra: true }]) assert.throws(() => make(undefined, options), checkCode('INVALID_HOST_CONTROL_INPUT', 400));
  assert.throws(() => createObusHostControl(), checkCode('INVALID_HOST_CONTROL_INPUT', 400));
});

test('request schemas reject missing or broadened authority without fetching', async () => {
  let calls = 0;
  const client = make(async () => { calls++; return json(); });
  const invalid = checkCode('INVALID_HOST_CONTROL_INPUT', 400);
  const trials = [
    ['getRuntime', { ...scope, owner: 'someone' }], ['getRuntime', { ...scope, session: '' }], ['getRuntime', { ...scope, campaign: 'other/campaign' }],
    ['register', { ...registration, expectedBootEpoch: undefined }], ['register', { ...registration, expectedGeneration: undefined }], ['register', { ...registration, generation: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }], ['register', { ...registration, leaseSeconds: 60 }],
    ['renew', { ...renewal, expectedSessionPolicyRevision: -1 }], ['renew', { ...renewal, expectedSessionPolicyRevision: Number.MAX_SAFE_INTEGER + 1 }], ['renew', { ...renewal, opId: '' }], ['renew', { ...renewal, generation: null }],
    ['configure', { ...configuration, expectedGeneration: null }], ['configure', { ...configuration, expectedSessionPolicyRevision: undefined }], ['configure', { ...configuration, policy: { ...configuration.policy, codex: true } }], ['configure', { ...configuration, policy: { ...configuration.policy, tools: true } }], ['configure', { ...configuration, policy: { ...configuration.policy, mode: 'paid' } }], ['configure', { ...configuration, policy: { ...configuration.policy, enabled: 1 } }],
  ];
  for (const [operation, input] of trials) await assert.rejects(client[operation](input), invalid);
  const accessor = { ...scope };
  Object.defineProperty(accessor, 'session', { enumerable: true, get() { assert.fail('accessor executed'); } });
  await assert.rejects(client.getRuntime(accessor), invalid);
  await assert.rejects(client.getRuntime({ ...scope, [Symbol('hidden')]: true }), invalid);
  assert.equal(calls, 0);
});

test('invalid signing dependencies fail before dispatch', async () => {
  for (const options of [{ now: () => -1 }, { now: () => NaN }, { now: () => '1735689600000' }, { now: () => { throw Error('private'); } }, { nonce: () => NONCE.toUpperCase() }, { nonce: () => 'ab' }, { nonce: () => { throw Error('private'); } }]) {
    let calls = 0;
    const client = make(async () => { calls++; return json(); }, options);
    await assert.rejects(client.register(registration), checkCode('INVALID_HOST_CONTROL_INPUT', 400));
    assert.equal(calls, 0);
  }
});

test('safe snapshot projection freezes policy and strips private server fields', async () => {
  const server = snapshot({ owner: 'other', prompt: 'private text', trace: { secret: TOKEN }, effectivePolicy: { ...effectivePolicy, providerToken: TOKEN } });
  const result = await make(async () => json(server)).getRuntime(scope);
  assert.deepEqual(result, snapshot());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.effectivePolicy), true);
  assert.throws(() => { result.effectivePolicy.codex = true; }, TypeError);
});

test('runtime snapshots reject malformed authority, unsafe policy and count fields', async () => {
  const invalidValues = [
    null, [], {}, snapshot({ contract: 'other' }), snapshot({ bootEpoch: 'bad' }), snapshot({ generation: '' }), snapshot({ sessionPolicyRevision: -1 }), snapshot({ sessionPolicyRevision: 0.5 }), snapshot({ leaseExpiresAtMs: -1 }), snapshot({ requiredForRoute: false }), snapshot({ requiredForRoute: undefined }), snapshot({ queuedCount: -1 }), snapshot({ dispatchedCount: '0' }), snapshot({ effectivePolicy: { ...effectivePolicy, codex: true } }), snapshot({ effectivePolicy: { ...effectivePolicy, tools: true } }), snapshot({ effectivePolicy: { ...effectivePolicy, personalMemory: true } }), snapshot({ effectivePolicy: { ...effectivePolicy, autoMemory: true } }), snapshot({ effectivePolicy: { ...effectivePolicy, mode: 'remote' } }),
  ];
  for (const value of invalidValues) await assert.rejects(make(async () => json(value)).getRuntime(scope), checkCode('INVALID_OBUS_RUNTIME_RESPONSE', 502));
});

test('control operations accept minimal mutation snapshots but never fill omitted server fields', async () => {
  const response = snapshot();
  delete response.requiredForRoute; delete response.queuedCount; delete response.dispatchedCount;
  assert.deepEqual(await make(async () => json(response)).register(registration), response);
  delete response.generation;
  await assert.rejects(make(async () => json(response)).register(registration), checkCode('INVALID_OBUS_RUNTIME_RESPONSE', 502));
});

test('redirects, non-JSON, invalid UTF-8 and oversized body streams are rejected and cancelled', async () => {
  let cancelled = 0;
  const oversized = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } });
  const alternatives = [
    () => Object.defineProperty(json(), 'redirected', { value: true }),
    () => Object.defineProperty(json(), 'url', { value: 'http://elsewhere.test/' }),
    () => json(undefined, { headers: { 'content-type': 'text/html' } }),
    () => json(undefined, { status: 201 }),
    () => json(undefined, { headers: { 'content-type': 'application/json', 'content-length': '8193' } }),
    () => json(undefined, { headers: { 'content-type': 'application/json', 'content-length': '-1' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    oversized,
  ];
  for (const response of alternatives) await assert.rejects(make(async () => response()).getRuntime(scope), checkCode('INVALID_OBUS_RUNTIME_RESPONSE', 502));
  assert.equal(cancelled, 1);
});

test('denial and network errors are sanitized and never retried or followed by fresh GET', async () => {
  const codes = new Map([[401, 'OBUS_HOST_CONTROL_DENIED'], [403, 'OBUS_HOST_CONTROL_DENIED'], [409, 'OBUS_HOST_CONTROL_CONFLICT'], [412, 'OBUS_HOST_CONTROL_CONFLICT'], [429, 'OBUS_HOST_CONTROL_LIMITED'], [500, 'OBUS_HOST_CONTROL_UNAVAILABLE']]);
  for (const [status, code] of codes) {
    let calls = 0;
    const client = make(async () => { calls++; return json({ secret: TOKEN }, { status }); });
    await assert.rejects(client.configure(configuration), error => { checkCode(code, status)(error); assert.equal(error.message.includes(TOKEN), false); return true; });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(make(async () => { calls++; throw Error(`credential ${TOKEN}`); }).register(registration), error => { checkCode('OBUS_HOST_CONTROL_UNAVAILABLE', 503)(error); assert.equal(error.message.includes(TOKEN), false); assert.equal(error.cause, undefined); return true; });
  assert.equal(calls, 1);
});

test('deadline aborts a stalled response body without retry', async () => {
  let signal, calls = 0, cancelled = false;
  const client = make(async (_url, options) => {
    calls++; signal = options.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(client.getRuntime(scope), checkCode('OBUS_HOST_CONTROL_TIMEOUT', 504));
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});
