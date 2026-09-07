import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GameAi } from './service.mjs';
import { createGameHttp } from '../game/http.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const scope = { campaign: 'party', owner: 'host', role: 'host' }; let member = 'host';
  const runtime = { bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
    sessionPolicyRevision: 0, leaseExpiresAtMs: Date.now() + 100_000,
    effectivePolicy: { enabled: true, mode: 'local-free', exportable: true, codex: false, tools: false, personalMemory: false, autoMemory: false } };
  const calls = [];
  const ai = new GameAi({ db, authorize: () => member, transport: {
    runtimeState: async () => structuredClone(runtime), capabilities: async () => ({ route_ready: true }),
  }, configureRuntime: async request => {
    calls.push(request); await new Promise(resolve => setTimeout(resolve, 0));
    runtime.sessionPolicyRevision++; runtime.effectivePolicy = { ...runtime.effectivePolicy, ...request.policy };
    return structuredClone(runtime);
  } });
  const handlers = createGameHttp(() => ({ ai, auth: { authenticate: async () => scope }, access: { authenticateAccess: () => scope }, game: { member: () => member } }));
  const input = { mode: 'local', codex: false, requestId: '33333333-3333-4333-8333-333333333333',
    expectedBootEpoch: runtime.bootEpoch, expectedGeneration: runtime.generation, expectedSessionPolicyRevision: 0 };
  function request(body) { return new Request('http://localhost:3000/api/game/ai', body ? {
    method: 'PATCH', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body),
  } : {}); }
  return { handlers, input, calls, request, setMember(role) { member = role; } };
}

test('AI settings endpoints await the shared Obus snapshot and its signed mutation result', async t => {
  const f = fixture(t);
  const before = await f.handlers.aiStatus(f.request()); assert.equal(before.status, 200);
  assert.equal((await before.json()).policy.mode, 'local-free');
  const changed = await f.handlers.aiConfigure(f.request(f.input)); assert.equal(changed.status, 200);
  const body = await changed.json(); assert.equal(body.policy.mode, 'local'); assert.equal(body.policy.sessionPolicyRevision, 1);
  const after = await f.handlers.aiStatus(f.request());
  assert.deepEqual((await after.json()).policy, body.policy);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].session, 'campaign');
});

test('stale AI controls return conflict without a second Obus mutation', async t => {
  const f = fixture(t);
  assert.equal((await f.handlers.aiConfigure(f.request(f.input))).status, 200);
  const stale = await f.handlers.aiConfigure(f.request({ ...f.input, mode: 'local-free' }));
  assert.equal(stale.status, 409); assert.equal(f.calls.length, 1);
});

test('players and forged scope fields cannot invoke the private host signer', async t => {
  const f = fixture(t); f.setMember('player');
  assert.equal((await f.handlers.aiConfigure(f.request(f.input))).status, 403);
  f.setMember('host');
  for (const extra of [{ campaign: 'another' }, { owner: 'another' }, { role: 'host' }, { policy: {} }]) {
    assert.equal((await f.handlers.aiConfigure(f.request({ ...f.input, ...extra }))).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
