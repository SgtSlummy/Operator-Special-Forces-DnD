import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GameAi } from './service.mjs';
import { ObusTransport } from './obus.mjs';

const scope = { campaign: 'campaign-one', owner: 'player-one', role: 'host' };
const job = { session: 'campaign', requestId: 'job-one', task: 'narration', query: 'Describe the quay.', evidence: { fact: 'The quay is empty.' }, sourceRevision: 4, exportable: true };
const answer = { text: 'The quay is empty.', trace: [{ destination: 'local' }], sources: [] };
const state = () => ({ contract: 'raph-obus-game-runtime-v1', requiredForRoute: true,
  bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
  sessionPolicyRevision: 3, leaseExpiresAtMs: Date.now() + 100_000, queuedCount: 0, dispatchedCount: 0,
  effectivePolicy: { enabled: true, mode: 'local-free', codex: false, exportable: true, tools: false, personalMemory: false, autoMemory: false } });
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const authority = state(), calls = []; let member = 'host';
  const transport = { runtimeState: async () => structuredClone(authority), capabilities: async () => ({ route_ready: true }),
    generate: async request => { calls.push(request); return answer; } };
  const options = { db, transport, authorize: () => member, configureRuntime: async request => {
    calls.push(request);
    assert.equal(request.expectedGeneration, authority.generation);
    assert.equal(request.expectedSessionPolicyRevision, authority.sessionPolicyRevision);
    authority.effectivePolicy = { ...authority.effectivePolicy, ...request.policy };
    authority.sessionPolicyRevision++;
    return structuredClone(authority);
  } };
  return { db, authority, calls, transport, options, ai: new GameAi(options), revoke() { member = null; } };
}
function settings(authority, extra = {}) {
  return { mode: 'local', codex: false, expectedBootEpoch: authority.bootEpoch, expectedGeneration: authority.generation,
    expectedSessionPolicyRevision: authority.sessionPolicyRevision, requestId: '33333333-3333-4333-8333-333333333333', ...extra };
}

test('two independent consumers observe the same Obus policy without app-local policy writes', async t => {
  const f = fixture(t), other = new GameAi(f.options);
  f.db.exec("CREATE TABLE ai_policy(campaign TEXT,session TEXT,mode TEXT,codex INTEGER,boot TEXT); INSERT INTO ai_policy VALUES('campaign-one','campaign','local-free',1,'legacy')");
  const before = f.db.prepare('SELECT * FROM ai_policy').all();
  assert.equal((await f.ai.policy(scope.campaign, job.session)).codex, false);
  const result = await f.ai.configure(scope, job.session, settings(f.authority));
  assert.equal(result.mode, 'local'); assert.equal(result.sessionPolicyRevision, 4);
  assert.deepEqual(await other.policy(scope.campaign, job.session), result);
  assert.deepEqual(f.db.prepare('SELECT * FROM ai_policy').all(), before);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].session, job.session);
  assert.equal(f.calls[0].opId, '33333333-3333-4333-8333-333333333333');
});

test('stale controls cannot rewrite current Obus policy and are never silently retried', async t => {
  const f = fixture(t), input = settings(f.authority);
  f.authority.sessionPolicyRevision++;
  await assert.rejects(f.ai.configure(scope, job.session, input), { code: 'CONFLICT' });
  assert.equal(f.calls.length, 0);
  f.options.configureRuntime = async () => { f.calls.push('conflict'); throw Object.assign(new Error('conflict'), { status: 409 }); };
  const competing = new GameAi(f.options);
  await assert.rejects(competing.configure(scope, job.session, settings(f.authority)), { status: 409 });
  assert.deepEqual(f.calls, ['conflict']);
});

test('revocation during a policy read prevents the signed mutation', async t => {
  const f = fixture(t);
  f.transport.runtimeState = async () => { f.revoke(); return structuredClone(f.authority); };
  await assert.rejects(f.ai.configure(scope, job.session, settings(f.authority)), /membership/);
  assert.equal(f.calls.length, 0);
});

test('missing, expired or disabled host authority keeps assistance unavailable despite healthy capabilities', async t => {
  for (const change of [a => { a.generation = null; a.leaseExpiresAtMs = null; }, a => { a.leaseExpiresAtMs = 1; }, a => { a.effectivePolicy.enabled = false; }]) {
    const f = fixture(t); change(f.authority);
    assert.equal((await f.ai.status(scope)).ready, false);
    const result = await f.ai.run(scope, job);
    assert.equal(result.provider, 'deterministic'); assert.equal(f.calls.length, 0);
  }
});

test('an Obus outage preserves manual guidance and never invents an enabled policy', async t => {
  const f = fixture(t);
  f.transport.runtimeState = async () => { throw new Error('offline'); };
  const status = await f.ai.status(scope);
  assert.equal(status.ready, false); assert.equal(status.policy, null);
  const result = await f.ai.run(scope, job);
  assert.equal(result.status, 'fallback'); assert.equal(f.calls.length, 0);
});

test('missing current membership never dispatches or replays a stored AI receipt', async t => {
  const f = fixture(t);
  assert.equal((await f.ai.run(scope, job)).provider, 'obus');
  f.revoke();
  await assert.rejects(f.ai.run(scope, job), /membership/);
  await assert.rejects(f.ai.status(scope), /membership/);
  assert.equal(f.calls.length, 1);
});

test('late membership revocation rejects text without saving a receipt', async t => {
  const f = fixture(t);
  f.transport.generate = async () => { f.revoke(); return answer; };
  await assert.rejects(f.ai.run(scope, job), /membership/);
  assert.equal(f.ai.jobs(scope).length, 0);
});

test('host and participant external restrictions are intersected before Obus receives a job', async t => {
  const f = fixture(t); f.authority.effectivePolicy.exportable = false;
  await f.ai.run(scope, job);
  assert.equal(f.calls[0].policy.exportable, false);
  assert.equal(f.calls[0].policy.codex, false);
});

test('read-only Obus runtime state preserves unavailable status and strips unrelated response fields', async () => {
  const authority = state(); authority.generation = null; authority.leaseExpiresAtMs = null; authority.effectivePolicy.enabled = false;
  authority.secret = 'must not escape'; authority.effectivePolicy.secret = 'must not escape';
  const transport = new ObusTransport({ serviceToken: 'a'.repeat(64), fetchImpl: async () => Response.json(authority) });
  const result = await transport.runtimeState(scope, job.session);
  assert.equal(result.generation, null); assert.equal(result.effectivePolicy.enabled, false);
  assert.equal(result.secret, undefined); assert.equal(result.effectivePolicy.secret, undefined);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.effectivePolicy));
  await assert.rejects(transport.runtime(scope, job.session), /enabled, current/);
});

test('read-only state rejects malformed counts and incomplete generation/lease pairs', async () => {
  for (const change of [a => { a.queuedCount = -1; }, a => { a.dispatchedCount = '1'; }, a => { a.generation = null; }, a => { a.leaseExpiresAtMs = null; }]) {
    const authority = state(); change(authority);
    const transport = new ObusTransport({ serviceToken: 'a'.repeat(64), fetchImpl: async () => Response.json(authority) });
    await assert.rejects(transport.runtimeState(scope, job.session), /invalid game runtime/);
  }
});
