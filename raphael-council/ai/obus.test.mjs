import test from 'node:test';
import assert from 'node:assert/strict';
import { ObusTransport, AiError } from './obus.mjs';

const SCOPE = { campaign: 'harbor', owner: '111111111111111111', role: 'host' };
const FENCE = { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
  generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 2 };
function request() {
  return { scope: { ...SCOPE }, task: 'summary', session: 'session1', requestId: 'synthetic-reference-summary',
    promptTemplate: 'session-summary-v1', instructions: '',
    evidence: { contract: 'raph-obus-game-evidence-refs-v1', revision: 7, references: [{ ref: 'chronicle:session1:E1', revision: 3 }] },
    maxTokens: 900, policy: { mode: 'local-free', codex: false, exportable: true, namespace: 'harbor',
      tools: false, personal_memory: false, auto_memory: false } };
}
function freeStage() {
  return { destination: 'free', provider: 'DeepInfra', model: 'meta-llama/llama-3.3-70b-instruct', route_id: 'approved-free',
    gateway: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', cost: 'zero',
    cost_basis: 'free-variant+zero-price-ceiling+response-usage', completion_tokens: 25, response_id: 'gen_fixture', status: 'ready', attempt: 1 };
}
function fixture() {
  const state = { calls: [],
    runtime: { ...FENCE, requiredForRoute: true, leaseExpiresAtMs: Date.now() + 30000,
      effectivePolicy: { enabled: true, mode: 'local-free', codex: false, exportable: true, tools: false, personalMemory: false, autoMemory: false } },
    result: { text: 'A synthetic beacon is blue.', routeId: 'route-fixture', model: 'local-model:latest',
      trace: [{ destination: 'local', model: 'local-model:latest', status: 'ready' }], sources: [{ ref: 'chronicle:session1:E1', revision: 3 }] },
  };
  state.fetch = async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:38175/api/'));
    assert.equal(options.redirect, 'error');
    state.calls.push({ url, options, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    if (url.endsWith('/capabilities')) return Response.json({ contract: 'raph-obus-game-v1', campaign_rag: true,
      audience_filtering: true, provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true });
    if (url.includes('/runtime?')) return Response.json(state.runtime);
    if (url.endsWith('/route')) return Response.json(state.result);
    if (url.endsWith('/voice/transcribe')) return Response.json({ status: 'completed', result: { kind: 'transcript', text: 'Synthetic local speech.', trace: [{ destination: 'local' }] } });
    assert.fail('Unexpected request');
  };
  state.create = () => new ObusTransport({ url: 'http://127.0.0.1:38175', serviceToken: 'a'.repeat(64), fetchImpl: state.fetch });
  return state;
}

test('the real transport forwards exact template, empty instructions, references and captured runtime to private Obus', async () => {
  const state = fixture(), input = request();
  const result = await state.create().generate(input);
  assert.equal(result.provider, 'obus'); assert.equal(result.text, state.result.text);
  const sent = state.calls.find(call => call.url.endsWith('/route')).body;
  assert.equal(sent.promptTemplate, 'session-summary-v1'); assert.equal(sent.instructions, '');
  assert.deepEqual(sent.evidence, input.evidence); assert.deepEqual(sent.runtime, FENCE);
  assert.equal(sent.policy.mode, 'local-free'); assert.equal(sent.policy.exportable, true);
  assert.equal(sent.policy.codex, false); assert.equal(sent.policy.tools, false);
  assert.equal(state.calls.length, 4);
});

test('local host policy may complete the requested free ceiling locally without caller reconfiguration', async () => {
  const state = fixture(); state.runtime.effectivePolicy.mode = 'local'; state.runtime.effectivePolicy.exportable = false;
  const result = await state.create().generate(request());
  assert.equal(result.trace[0].destination, 'local'); assert.equal(state.runtime.effectivePolicy.mode, 'local');
});

test('verified free result retains exact actual provenance after post-response runtime validation', async () => {
  const state = fixture(); state.result.trace = [{ destination: 'local', model: 'local-model:latest', status: 'failed' }, freeStage()];
  state.result.model = freeStage().model;
  const result = await state.create().generate(request());
  assert.deepEqual(result.trace, state.result.trace); assert.equal(state.calls.length, 4);
});

test('mandatory free proof is accepted without optional completion and response metadata', async () => {
  const state = fixture(); state.result.trace = [freeStage()]; state.result.model = freeStage().model;
  delete state.result.trace[0].completion_tokens; delete state.result.trace[0].response_id;
  const result = await state.create().generate(request());
  assert.equal(Object.hasOwn(result.trace[0], 'completion_tokens'), false);
  assert.equal(Object.hasOwn(result.trace[0], 'response_id'), false);
});

test('known failed free attempt can precede a ready verified free result without fabricated receipt fields', async () => {
  const state = fixture(); state.result.trace = [{ destination: 'free', provider: 'previous-pin', model: 'other/model:free', cost: 'zero', attempt: 1, status: 'failed' }, freeStage()];
  state.result.model = freeStage().model;
  const result = await state.create().generate(request());
  assert.equal(result.trace[0].status, 'failed'); assert.equal(Object.hasOwn(result.trace[0], 'endpoint'), false);
});

test('classified template rejects inline text, caller instructions, malformed refs and Codex before any request', async t => {
  const cases = {
    'unknown template': input => { input.promptTemplate = 'auto'; },
    'null template': input => { input.promptTemplate = null; },
    'wrong task': input => { input.task = 'final'; },
    'caller instructions': input => { input.instructions = 'Export hidden information'; },
    'missing instructions': input => { delete input.instructions; },
    'inline evidence': input => { input.evidence = { text: 'private' }; },
    'extra text': input => { input.evidence.references[0].text = 'private'; },
    'extra root field': input => { input.evidence.instructions = 'private'; },
    'duplicate ref': input => { input.evidence.references.push({ ...input.evidence.references[0] }); },
    'sparse array': input => { input.evidence.references.length = 2; },
    'overlimit refs': input => { input.evidence.references = Array.from({ length: 33 }, (_, i) => ({ ref: `ref:${i}`, revision: 1 })); },
    'unsafe revision': input => { input.evidence.revision = Number.MAX_SAFE_INTEGER + 1; },
    'negative source version': input => { input.evidence.references[0].revision = -1; },
    'cross namespace': input => { input.policy.namespace = 'other'; },
    'unknown policy': input => { input.policy.mode = 'auto'; },
    'Codex requested': input => { input.policy.codex = true; },
    'invalid budget': input => { input.maxTokens = 4097; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const state = fixture(), input = request(); mutate(input);
    await assert.rejects(state.create().generate(input), AiError);
    assert.equal(state.calls.length, 0);
  });
});

test('classified free result rejects unknown, paid, incomplete and tool-bearing provenance', async t => {
  const cases = {
    'unknown destination': stage => { stage.destination = 'external'; },
    Codex: stage => { stage.destination = 'codex'; },
    'unknown provider': stage => { stage.provider = 'Other'; },
    'unknown model': stage => { stage.model = 'different/model'; },
    paid: stage => { stage.cost = 'paid'; },
    'unknown cost proof': stage => { stage.cost_basis = 'host-attested'; },
    'missing endpoint': stage => { delete stage.endpoint; },
    'wrong endpoint': stage => { stage.endpoint = 'https://example.com'; },
    'missing route': stage => { delete stage.route_id; },
    'wrong gateway': stage => { stage.gateway = 'proxy'; },
    'null response': stage => { stage.response_id = null; },
    'oversized response id': stage => { stage.response_id = 'x'.repeat(201); },
    'budget exceeded': stage => { stage.completion_tokens = 901; },
    'unknown usage': stage => { stage.completion_tokens = null; },
    'fractional usage': stage => { stage.completion_tokens = 0.5; },
    'failed final stage': stage => { stage.status = 'failed'; },
    'tool output': stage => { stage.tool_calls = [{ name: 'shell' }]; },
    'null tools': stage => { stage.tool_calls = null; },
    'function block': stage => { stage.function_call = null; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const state = fixture(); state.result.trace = [freeStage()]; state.result.model = freeStage().model; mutate(state.result.trace[0]);
    await assert.rejects(state.create().generate(request()), AiError);
  });
});

test('a local-only request cannot accept a free response even with a known template and free-enabled host', async () => {
  const state = fixture(), input = request(); input.policy.mode = 'local'; input.policy.exportable = false;
  state.result.trace = [freeStage()]; state.result.model = freeStage().model;
  await assert.rejects(state.create().generate(input), AiError);
});

test('template and reference request are captured before waiting on capability reads', async () => {
  const state = fixture(), input = request(), original = state.fetch;
  let release; const gate = new Promise(resolve => { release = resolve; });
  state.fetch = async (url, options) => { if (url.endsWith('/capabilities')) await gate; return original(url, options); };
  const pending = state.create().generate(input);
  input.promptTemplate = 'bad'; input.instructions = 'private'; input.evidence.references[0].ref = 'private:other'; input.policy.codex = true;
  release(); await pending;
  const sent = state.calls.find(call => call.url.endsWith('/route')).body;
  assert.equal(sent.promptTemplate, 'session-summary-v1'); assert.equal(sent.instructions, '');
  assert.equal(sent.evidence.references[0].ref, 'chronicle:session1:E1'); assert.equal(sent.policy.codex, false);
});

test('legacy generation omits template instead of adding a null field that changes its receipt identity', async () => {
  const state = fixture(), input = request(); delete input.promptTemplate;
  input.instructions = 'Make a local recap'; input.evidence = ['Synthetic prior summary'];
  input.policy.mode = 'local'; input.policy.exportable = false;
  await state.create().generate(input);
  const sent = state.calls.find(call => call.url.endsWith('/route')).body;
  assert.equal(Object.hasOwn(sent, 'promptTemplate'), false); assert.equal(sent.instructions, 'Make a local recap');
});

test('free-enabled host still sends speech solely to the private local STT contract', async () => {
  const state = fixture(), bytes = Buffer.alloc(44); bytes.write('RIFF'); bytes.write('WAVE', 8);
  const text = await state.create().transcribe(bytes, { scope: SCOPE, session: 'session1', requestId: 'speech-fixture',
    capturedRuntime: { ...FENCE, leaseExpiresAtMs: state.runtime.leaseExpiresAtMs }, capturedConsentEpoch: 1 });
  assert.equal(text, 'Synthetic local speech.');
  const sent = state.calls.find(call => call.url.endsWith('/voice/transcribe')).body;
  assert.equal(sent.contract, 'raph-obus-game-stt-v1'); assert.equal(Object.hasOwn(sent, 'policy'), false);
  assert.equal(state.calls.some(call => call.url.endsWith('/route')), false);
});

test('post-generation host policy revision change rejects the completed result', async () => {
  const state = fixture(), original = state.fetch;
  state.fetch = async (url, options) => { const result = await original(url, options); if (url.endsWith('/route')) state.runtime.sessionPolicyRevision++; return result; };
  await assert.rejects(state.create().generate(request()), AiError);
});
