import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGameHostDiagnostics } from './diagnostics.mjs';

const env = { RAPHAEL_MEMBERSHIP_CAMPAIGNS: 'harbor' };
const runtime = { generation: 'edcb8ac7-452d-4c0b-ab8d-06a0b490b4fd', leaseExpiresAtMs: 2000, effectivePolicy: { enabled: true, mode: 'local', codex: false } };
function fixture(count = 1) {
  const calls = [], scopes = Array.from({ length: count }, (_, index) => ({ campaign: 'harbor', session: index ? `session${index}` : 'campaign' }));
  return { calls, scopes, options: { env, now: () => 1000,
    openScopeSource() { calls.push('open'); return { listScopes() { calls.push('list'); return scopes; }, close() { calls.push('close'); } }; },
    transport: { async capabilities() { calls.push('capabilities'); return { contract: 'raph-obus-game-v1', campaign_rag: true, provider_allowlist: true, codex_gate: true, verified_free_route_fallback: false, codex_available: false, local_stt: { route_ready: false }, privateSecret: 'never-output' }; }, async runtimeState(scope, session) { calls.push(`runtime:${session}`); return runtime; } }
  } };
}

test('diagnostics closes read-only metadata before network and never claims inference proof', async () => {
  const f = fixture(), result = await collectGameHostDiagnostics(f.options);
  assert.deepEqual(f.calls, ['open', 'list', 'close', 'capabilities', 'runtime:campaign']);
  assert.equal(result.readOnly, true); assert.equal(result.inference, 'not-run');
  assert.equal(result.capabilities.reachable, true); assert.equal(result.capabilities.freeRoutes, false);
  assert.equal(result.capabilities.codexAvailable, false); assert.equal(result.capabilities.localSttReady, false);
  assert.equal(result.sessions[0].authority, 'authorized');
  assert.ok(!JSON.stringify(result).includes('never-output'));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.sessions[0]));
});

test('missing campaign metadata still reports endpoint connectivity without inventing authority', async () => {
  const f = fixture(); f.options.openScopeSource = () => { throw new Error('C:/private/store'); };
  const result = await collectGameHostDiagnostics(f.options);
  assert.equal(result.metadata, 'unavailable'); assert.equal(result.capabilities.reachable, true);
  assert.deepEqual(result.sessions, []); assert.ok(!JSON.stringify(result).includes('C:/private'));
  assert.deepEqual(f.calls, ['capabilities']);
});

test('missing, expired, disabled and malformed leases are distinct from authorization', async () => {
  const f = fixture(5);
  const values = [{ ...runtime, generation: null, leaseExpiresAtMs: null }, { ...runtime, leaseExpiresAtMs: 1000 }, { ...runtime, effectivePolicy: { ...runtime.effectivePolicy, enabled: false } }, runtime, { effectivePolicy: runtime.effectivePolicy }];
  f.options.transport.runtimeState = async (_scope, session) => values[session === 'campaign' ? 0 : Number(session.slice(7))];
  const result = await collectGameHostDiagnostics(f.options);
  assert.deepEqual(result.sessions.map(row => row.authority), ['missing', 'expired', 'disabled', 'authorized', 'unavailable']);
});

test('readiness reads have bounded concurrency and retain canonical order', async () => {
  const f = fixture(12); let active = 0, peak = 0;
  f.options.transport.runtimeState = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return runtime; };
  const result = await collectGameHostDiagnostics(f.options);
  assert.equal(peak, 4); assert.deepEqual(result.sessions.map(row => row.session), f.scopes.map(row => row.session));
});

test('a global deadline bounds hung reads and never launches the remaining queued reads', async () => {
  const f = fixture(10); let requests = 0;
  f.options.transport.capabilities = () => new Promise(() => {});
  f.options.transport.runtimeState = () => { requests++; return new Promise(() => {}); };
  const result = await collectGameHostDiagnostics({ ...f.options, deadlineMs: 25 });
  assert.equal(result.deadlineExceeded, true); assert.equal(result.capabilities.reachable, false);
  assert.equal(requests, 4); assert.equal(result.sessions.length, 10);
  assert.ok(result.sessions.every(row => row.authority === 'unavailable'));
});

test('metadata close failures and private network errors remain explicit and sanitized', async () => {
  const f = fixture();
  f.options.openScopeSource = () => ({ listScopes: () => f.scopes, close() { throw new Error('private path'); } });
  f.options.transport.capabilities = async () => { throw new Error('private token'); };
  const result = await collectGameHostDiagnostics(f.options);
  assert.equal(result.metadata, 'close-failed'); assert.equal(result.capabilities.reachable, false);
  assert.deepEqual(result.sessions, []); assert.ok(!JSON.stringify(result).includes('private'));
});

test('unsafe endpoint construction and invalid deadlines never open metadata', async () => {
  let opened = 0;
  await assert.rejects(collectGameHostDiagnostics({ env: { ...env, RAPHAEL_OBUS_URL: 'https://example.com' }, openScopeSource() { opened++; } }));
  await assert.rejects(collectGameHostDiagnostics({ deadlineMs: 0 }));
  assert.equal(opened, 0);
});
