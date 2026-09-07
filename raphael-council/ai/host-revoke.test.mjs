import test from 'node:test';
import assert from 'node:assert/strict';
import { createObusHostControl } from './host-control.mjs';

const boot = '11111111-1111-4111-8111-111111111111', generation = '22222222-2222-4222-8222-222222222222';
const input = { campaign: 'party', session: 'recording-one', generation, expectedBootEpoch: boot,
  expectedSessionPolicyRevision: 7, opId: '33333333-3333-4333-8333-333333333333' };
const runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: boot, generation: null, leaseExpiresAtMs: null, sessionPolicyRevision: 8,
  effectivePolicy: { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false } };
function client(fetchImpl) { return createObusHostControl({ url: 'http://127.0.0.1:38175', serviceToken: 'a'.repeat(64), hostControlToken: 'b'.repeat(64), fetchImpl }); }

test('child revocation uses the exact signed endpoint and returns only its cleared runtime snapshot', async () => {
  let calls = 0;
  const control = client(async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:38175/api/game/runtime/session/revoke'); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { ...input, contract: runtime.contract });
    assert.match(options.headers['X-Obus-Game-Host-Signature'], /^[a-f0-9]{64}$/);
    assert.equal(options.headers['X-Obus-Game-Token'], 'a'.repeat(64));
    return Response.json({ status: 'session_revoked', runtime });
  });
  const result = await control.revoke(input);
  assert.equal(result.generation, null); assert.equal(result.sessionPolicyRevision, 8); assert.ok(Object.isFrozen(result));
  assert.equal(result.status, undefined); assert.equal(calls, 1);
});

test('revocation cannot target the campaign master or broaden the exact request schema', async () => {
  let calls = 0; const control = client(async () => { calls++; return Response.json({ status: 'session_revoked', runtime }); });
  for (const invalid of [{ ...input, session: 'campaign' }, { ...input, leaseSeconds: 30 }, { ...input, expectedSessionPolicyRevision: -1 }, { ...input, generation: null }]) {
    await assert.rejects(control.revoke(invalid));
  }
  assert.equal(calls, 0);
});

test('uncleared, unrelated or malformed revocation results are rejected without retry', async () => {
  for (const response of [runtime, { status: 'completed', runtime }, { status: 'session_revoked', runtime, extra: true },
    { status: 'session_revoked', runtime: { ...runtime, generation, leaseExpiresAtMs: Date.now() + 30000 } },
    { status: 'session_revoked', runtime: { ...runtime, sessionPolicyRevision: 7 } },
    { status: 'session_revoked', runtime: { ...runtime, bootEpoch: generation } }]) {
    let calls = 0; const control = client(async () => { calls++; return Response.json(response); });
    await assert.rejects(control.revoke(input), { code: 'INVALID_OBUS_RUNTIME_RESPONSE' }); assert.equal(calls, 1);
  }
});
