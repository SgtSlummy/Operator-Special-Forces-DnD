import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createObusChronicleProvider } from './obus-provider.mjs';
import { createObusEvidenceBridge } from './obus-evidence.mjs';

const OWNER = '111111111111111111';
const CONTEXT = { campaign: 'harbor', session: 'session1', owner: OWNER, sourceRevision: 7 };
const REFS = [{ ref: 'chronicle:session1:E1', revision: 3 }, { ref: 'chronicle:session1:E2', revision: 2 }];
function validResult() {
  return { text: 'The party found the blue beacon [E1].', provider: 'obus', model: 'local-model:latest', routeId: 'local-route',
    trace: [{ destination: 'local', model: 'local-model:latest' }], sources: REFS.map(item => ({ ref: item.ref, revision: item.revision })) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const state = { allowed: true, revision: 7, sourceCount: 2, participantCount: 1, authorizations: [], syncs: [], generations: [], receipts: [], result: validResult() };
  state.authorize = async scope => { state.authorizations.push(scope); return state.allowed; };
  state.bridge = { async sync(input) {
    state.syncs.push(input);
    return { contract: 'raph-obus-game-evidence-v1', campaign: input.campaign, session: input.session, revision: state.revision,
      status: 'saved', sourceCount: state.sourceCount, participantCount: state.participantCount };
  } };
  state.transport = { async generate(request) { state.generations.push(request); return state.result; }, async transcribe() { assert.fail('no speech in reference summaries'); } };
  state.create = (options = {}) => createObusChronicleProvider({ transport: state.transport, campaigns: ['harbor'], authorizeCommand: state.authorize,
    evidenceBridge: state.bridge, onReceipt: async receipt => { state.receipts.push(receipt); }, ...options });
  return state;
}

function freeResult() {
  const result = validResult(); result.model = 'meta-llama/llama-3.3-70b-instruct';
  result.trace = [
    { destination: 'local', model: 'local-model:latest', status: 'failed' },
    { destination: 'free', provider: 'DeepInfra', model: result.model, route_id: 'approved-free', gateway: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions', cost: 'zero', cost_basis: 'free-variant+zero-price-ceiling+response-usage',
      completion_tokens: 35, response_id: 'gen_fixture', status: 'ready', attempt: 1 },
  ];
  return result;
}

test('reference summary uses a server-owned template and requested ceiling with checks before saving and returning', async () => {
  const state = fixture();
  assert.equal(await state.create().writeReferences('summary', REFS, CONTEXT), state.result.text);
  assert.equal(state.generations.length, 1);
  assert.equal(state.syncs.length, 3);
  assert.equal(state.receipts.length, 1);
  const request = state.generations[0];
  assert.equal(request.task, 'summary'); assert.equal(request.session, CONTEXT.session); assert.equal(request.maxTokens, 900);
  assert.deepEqual(request.scope, { campaign: CONTEXT.campaign, owner: OWNER, role: 'host' });
  assert.deepEqual(request.evidence, { contract: 'raph-obus-game-evidence-refs-v1', revision: 7, references: REFS });
  assert.equal(request.promptTemplate, 'session-summary-v1');
  assert.equal(request.instructions, '');
  assert.deepEqual(request.policy, { mode: 'local-free', codex: false, exportable: true, escalationEligible: false,
    namespace: 'harbor', tools: false, personal_memory: false, auto_memory: false });
  assert.ok(Object.isFrozen(request.evidence.references[0]));
  assert.equal(Object.hasOwn(request.evidence, 'text'), false);
  assert.match(request.requestId, /^[a-f0-9]{64}$/);
  assert.equal(state.receipts[0].sourceRevision, 7);
  assert.equal(state.receipts[0].sources[0].id, REFS[0].ref);
  assert.ok(Object.isFrozen(state.receipts[0].sources[0]));
  assert.ok(state.authorizations.every(scope => scope.owner === OWNER && scope.role === 'host'));
});

test('request IDs include complete projection and source versions and are stable across reordered references', async () => {
  const state = fixture(), provider = state.create({ onReceipt: undefined });
  await provider.writeReferences('summary', REFS, CONTEXT);
  await provider.writeReferences('summary', [...REFS].reverse(), CONTEXT);
  assert.equal(state.generations[0].requestId, state.generations[1].requestId);
  const first = state.generations[0];
  const legacy = createHash('sha256').update(JSON.stringify({ kind: 'summary', evidence: first.evidence, scope: first.scope, session: first.session })).digest('hex');
  assert.notEqual(first.requestId, legacy, 'template rollout must not replay an old inline-instruction receipt');
  state.revision = 8;
  await provider.writeReferences('summary', REFS, { ...CONTEXT, sourceRevision: 8 });
  assert.notEqual(state.generations[0].requestId, state.generations[2].requestId);
  const corrected = [{ ...REFS[0], revision: 4 }, REFS[1]];
  state.result.sources = corrected;
  await provider.writeReferences('summary', corrected, { ...CONTEXT, sourceRevision: 8 });
  assert.notEqual(state.generations[2].requestId, state.generations[3].requestId);
  assert.equal(state.syncs.length, 8);
});

test('caller mutations during authorization cannot change scope, refs, policy or deduplication identity', async () => {
  const state = fixture(), gate = deferred(), input = { ...CONTEXT }, refs = structuredClone(REFS);
  let first = true;
  state.authorize = async scope => { state.authorizations.push(scope); if (first) { first = false; await gate.promise; } return true; };
  const pending = state.create().writeReferences('summary', refs, input);
  refs[0].ref = 'secret:other'; refs[0].revision = 99; refs.push({ ref: 'secret:more', revision: 9 });
  input.campaign = 'other'; input.owner = '222222222222222222'; input.sourceRevision = 100;
  gate.resolve(); await pending;
  assert.deepEqual(state.generations[0].evidence.references, REFS);
  assert.equal(state.generations[0].scope.campaign, 'harbor');
  assert.equal(state.generations[0].scope.owner, OWNER);
  assert.equal(state.generations[0].evidence.revision, 7);
});

test('syncEvidence requires current host authorization and never invokes generation', async () => {
  const state = fixture();
  const saved = await state.create().syncEvidence({ campaign: 'harbor', session: 'session1', owner: OWNER });
  assert.equal(saved.revision, 7); assert.equal(state.syncs.length, 1);
  assert.equal(state.generations.length, 0); assert.equal(state.receipts.length, 0);
  assert.equal(state.authorizations.length, 2);
  assert.ok(Object.isFrozen(saved));
  state.allowed = false;
  await assert.rejects(state.create().syncEvidence({ campaign: 'harbor', session: 'session1', owner: OWNER }), { code: 'CHRONICLE_UNAUTHORIZED' });
  assert.equal(state.syncs.length, 1);
});

test('the bridge remains optional for inline work but mandatory for reference generation and sync', async () => {
  const state = fixture(), provider = state.create({ evidenceBridge: undefined });
  await assert.rejects(provider.writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_UNAVAILABLE' });
  await assert.rejects(provider.syncEvidence({ campaign: 'harbor', session: 'session1', owner: OWNER }), { code: 'CHRONICLE_UNAVAILABLE' });
  assert.equal(state.generations.length, 0);
  assert.equal(await provider.write('final', ['A prior session summary.'], CONTEXT), state.result.text);
  assert.equal(state.generations.length, 1);
  assert.deepEqual(state.generations[0].evidence, ['A prior session summary.']);
  assert.equal(state.syncs.length, 0);
});

test('only exact bounded summary references and strict host scope are accepted before async work', async t => {
  const cases = {
    empty: state => { state.refs = []; },
    overlimit: state => { state.refs = Array.from({ length: 33 }, (_, i) => ({ ref: `ref:${i}`, revision: 1 })); },
    duplicate: state => { state.refs.push({ ...state.refs[0] }); },
    inline: state => { state.refs[0].text = 'Secret inline text'; },
    'unsafe source revision': state => { state.refs[0].revision = Number.MAX_SAFE_INTEGER + 1; },
    'missing source revision': state => { delete state.refs[0].revision; },
    'sparse refs': state => { state.refs.length = 3; },
    'overlong ref': state => { state.refs[0].ref = 'x'.repeat(161); },
    'wrong campaign': state => { state.context.campaign = 'other'; },
    'invalid owner': state => { state.context.owner = 'gm'; },
    'missing session': state => { delete state.context.session; },
    'unsafe projection revision': state => { state.context.sourceRevision = -1; },
    'context policy injection': state => { state.context.policy = { mode: 'local-free' }; },
    final: state => { state.kind = 'final'; },
    cue: state => { state.kind = 'cue'; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const state = fixture(); state.refs = structuredClone(REFS); state.context = { ...CONTEXT }; state.kind = 'summary'; mutate(state);
    await assert.rejects(state.create().writeReferences(state.kind, state.refs, state.context), { code: 'CHRONICLE_INPUT' });
    assert.equal(state.authorizations.length, 0); assert.equal(state.syncs.length, 0); assert.equal(state.generations.length, 0);
  });
});

test('reference and context getters are rejected before they execute', async () => {
  for (const target of ['reference', 'context']) {
    const state = fixture(), refs = structuredClone(REFS), context = { ...CONTEXT }; let executed = false;
    Object.defineProperty(target === 'reference' ? refs[0] : context, target === 'reference' ? 'ref' : 'owner', { enumerable: true,
      get() { executed = true; throw new Error('must never run'); } });
    await assert.rejects(state.create().writeReferences('summary', refs, context), { code: 'CHRONICLE_INPUT' });
    assert.equal(executed, false); assert.equal(state.syncs.length, 0);
  }
});

test('initial sync receipt must match exact campaign, session and projection revision before generating', async t => {
  for (const [field, value, code] of [['campaign', 'other', 'CHRONICLE_OUTPUT'], ['session', 'other', 'CHRONICLE_OUTPUT'],
    ['revision', 8, 'CHRONICLE_STALE'], ['status', 'queued', 'CHRONICLE_OUTPUT'], ['extra', true, 'CHRONICLE_OUTPUT']]) await t.test(field, async () => {
    const state = fixture(), original = state.bridge.sync;
    state.bridge.sync = async input => ({ ...await original(input), [field]: value });
    await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code });
    assert.equal(state.generations.length, 0); assert.equal(state.receipts.length, 0);
  });
});

test('authorization revoked during sync or generation rejects the result before any receipt', async t => {
  for (const point of ['sync', 'generate']) await t.test(point, async () => {
    const state = fixture(), original = state.bridge.sync;
    state.bridge.sync = async input => { const result = await original(input); if (point === 'sync') state.allowed = false; return result; };
    state.transport.generate = async request => { state.generations.push(request); state.allowed = false; return state.result; };
    await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_UNAUTHORIZED' });
    assert.equal(state.receipts.length, 0);
    assert.equal(state.generations.length, point === 'sync' ? 0 : 1);
  });
});

test('correction or consent changes during generation fail stale before receipt storage', async () => {
  const state = fixture();
  state.transport.generate = async request => { state.generations.push(request); state.revision++; return state.result; };
  await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_STALE' });
  assert.equal(state.receipts.length, 0); assert.equal(state.syncs.length, 2);
});

test('post-generation bridge races and malformed results never become durable receipts', async t => {
  for (const [name, code] of [['EVIDENCE_CHANGED_DURING_SYNC', 'CHRONICLE_STALE'], ['EVIDENCE_ACCESS_DENIED', 'CHRONICLE_UNAUTHORIZED'], ['network', 'CHRONICLE_UNAVAILABLE']]) await t.test(name, async () => {
    const state = fixture(), original = state.bridge.sync; let calls = 0;
    state.bridge.sync = async input => { if (++calls === 2) throw Object.assign(new Error('private error'), { code: name }); return original(input); };
    await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code });
    assert.equal(state.receipts.length, 0);
  });
});

test('an async receipt callback cannot allow stale text to be returned', async () => {
  const state = fixture();
  const provider = state.create({ onReceipt: async value => { state.receipts.push(value); state.revision++; } });
  await assert.rejects(provider.writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_STALE' });
  assert.equal(state.receipts.length, 1); assert.equal(state.receipts[0].sourceRevision, 7);
  assert.equal(state.syncs.length, 3);
});

test('missing, stale, duplicate or nonlocal source provenance and tool output are rejected', async t => {
  const cases = {
    missing: value => { value.sources.pop(); },
    stale: value => { value.sources[0].revision++; },
    'unknown version': value => { value.sources[0].revision = null; },
    duplicate: value => { value.sources.push({ ...value.sources[0] }); },
    'source cap': value => { value.sources = Array.from({ length: 65 }, (_, i) => ({ ref: `ref:${i}`, revision: 1 })); },
    external: value => { value.trace[0].destination = 'free'; },
    codex: value => { value.trace.push({ destination: 'codex', model: 'codex' }); },
    tool: value => { value.tool_calls = [{ name: 'write' }]; },
    'function block': value => { value.function_call = { name: 'write' }; },
    'trace function block': value => { value.trace[0].function_call = { name: 'write' }; },
    html: value => { value.text = '<script>bad()</script>'; },
    'text cap': value => { value.text = 'x'.repeat(16001); },
    'unknown provider': value => { value.provider = 'direct'; },
    'missing model': value => { delete value.model; },
    'invalid route': value => { value.routeId = '<private>'; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const state = fixture(); mutate(state.result);
    await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_OUTPUT' });
    assert.equal(state.receipts.length, 0);
  });
});

test('verified free template result records actual bounded provenance after all evidence checks', async () => {
  const state = fixture(); state.result = freeResult();
  assert.equal(await state.create().writeReferences('summary', REFS, CONTEXT), state.result.text);
  const saved = state.receipts[0].trace.at(-1);
  assert.deepEqual(saved, state.result.trace.at(-1));
  assert.ok(Object.isFrozen(saved)); assert.equal(state.syncs.length, 3);
  state.result.trace.at(-1).provider = 'changed-after-receipt';
  assert.equal(saved.provider, 'DeepInfra');
});

test('verified free receipt may omit optional response metadata without fabricating it', async () => {
  const state = fixture(); state.result = freeResult();
  delete state.result.trace.at(-1).completion_tokens; delete state.result.trace.at(-1).response_id;
  await state.create().writeReferences('summary', REFS, CONTEXT);
  assert.equal(Object.hasOwn(state.receipts[0].trace.at(-1), 'completion_tokens'), false);
  assert.equal(Object.hasOwn(state.receipts[0].trace.at(-1), 'response_id'), false);
});

test('failed free attempts retain candidate metadata without inventing actual response provenance', async () => {
  const state = fixture(); state.result = freeResult();
  state.result.trace.splice(1, 0, { destination: 'free', provider: 'first-free-pin', model: 'other/model:free', cost: 'zero', attempt: 1, status: 'failed' });
  await state.create().writeReferences('summary', REFS, CONTEXT);
  assert.equal(state.receipts[0].trace[1].status, 'failed');
  assert.equal(Object.hasOwn(state.receipts[0].trace[1], 'endpoint'), false);
});

test('free summaries reject unverified cost, destination, model and response provenance before saving', async t => {
  const cases = {
    'missing proof': stage => { delete stage.cost_basis; },
    'host attestation only': stage => { stage.cost_basis = 'host-pin'; },
    'paid cost': stage => { stage.cost = 'paid'; },
    'unknown gateway': stage => { stage.gateway = 'auto'; },
    'unknown endpoint': stage => { stage.endpoint = 'https://example.com/chat/completions'; },
    'unapproved downstream': stage => { stage.provider = 'OtherProvider'; },
    'missing route': stage => { delete stage.route_id; },
    'model mismatch': stage => { stage.model = 'different/model'; },
    'null response id': stage => { stage.response_id = null; },
    'unbounded response id': stage => { stage.response_id = 'a'.repeat(201); },
    'negative usage': stage => { stage.completion_tokens = -1; },
    'overspent usage': stage => { stage.completion_tokens = 901; },
    'fractional usage': stage => { stage.completion_tokens = 1.1; },
    'unknown usage': stage => { stage.completion_tokens = null; },
    'failed final stage': stage => { stage.status = 'failed'; },
    'unknown status': stage => { stage.status = 'queued'; },
    'unknown retry': stage => { stage.attempt = 2; },
    'tool block': stage => { stage.tool_calls = [{ name: 'shell' }]; },
    'null tool block': stage => { stage.tool_calls = null; },
    'unknown destination': stage => { stage.destination = 'external'; },
    Codex: stage => { stage.destination = 'codex'; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const state = fixture(); state.result = freeResult(); mutate(state.result.trace.at(-1));
    await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_OUTPUT' });
    assert.equal(state.receipts.length, 0);
  });
});

test('legacy inline recaps remain local even when a free-capable bridge is configured', async t => {
  for (const kind of ['summary', 'final', 'cue']) await t.test(kind, async () => {
    const state = fixture(); state.result = freeResult();
    const evidence = kind === 'cue' ? { title: 'Beacon', observableFacts: 'A blue beacon.' } : ['A prior summary.'];
    await assert.rejects(state.create().write(kind, evidence, CONTEXT), { code: 'CHRONICLE_OUTPUT' });
    const request = state.generations[0];
    assert.equal(request.policy.mode, 'local'); assert.equal(request.policy.exportable, false);
    assert.equal(Object.hasOwn(request, 'promptTemplate'), false); assert.notEqual(request.instructions, '');
    assert.equal(state.receipts.length, 0); assert.equal(state.syncs.length, 0);
  });
});

test('consent revision changed during free generation prevents durable receipt and text', async () => {
  const state = fixture(); state.result = freeResult();
  state.transport.generate = async request => { state.generations.push(request); state.revision++; return state.result; };
  await assert.rejects(state.create().writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_STALE' });
  assert.equal(state.receipts.length, 0);
});

test('receipt callback failure is sanitized and never retried', async () => {
  const state = fixture(); let calls = 0;
  await assert.rejects(state.create({ onReceipt: async () => { calls++; throw new Error('private disk path'); } }).writeReferences('summary', REFS, CONTEXT), { code: 'CHRONICLE_RECEIPT' });
  assert.equal(calls, 1); assert.equal(state.generations.length, 1);
});

test('AI-off evidence sync through the real bridge does not enable generation', async () => {
  const state = fixture(), runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 30000,
    effectivePolicy: { enabled: false, mode: 'local', codex: false, exportable: false } };
  const projection = { revision: 7, participants: [], sources: [] };
  const bridge = createObusEvidenceBridge({ store: { get() { return { campaign: 'harbor' }; }, evidenceProjection() { return projection; } },
    campaigns: ['harbor'], authorizeCommand: () => true, hostControl: {
      async getRuntime() { return runtime; },
      async syncEvidence(snapshot) { return { contract: 'raph-obus-game-evidence-v1', campaign: snapshot.campaign, session: snapshot.session,
        revision: snapshot.revision, status: 'saved', sourceCount: 0, participantCount: 0 }; },
      async configure() { assert.fail('sync cannot change runtime policy'); },
    } });
  const provider = state.create({ evidenceBridge: bridge });
  assert.equal((await provider.syncEvidence({ campaign: 'harbor', session: 'session1', owner: OWNER })).revision, 7);
  assert.equal(runtime.effectivePolicy.enabled, false);
  assert.equal(state.generations.length, 0);
});
