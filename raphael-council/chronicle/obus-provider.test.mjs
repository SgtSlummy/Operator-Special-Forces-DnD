import test from 'node:test';
import assert from 'node:assert/strict';
import { createObusChronicleProvider } from './obus-provider.mjs';
import { runtimeFixture } from './speech-context.fixture.mjs';
const speechContext = () => ({ scope: { campaign: 'provider-test', owner: '222222222222222222', role: 'player' }, session: 'fixture-session-1', requestId: 'segment-one', capturedRuntime: runtimeFixture(), capturedConsentEpoch: 1 });

const context = { campaign: 'provider-test', owner: '111111111111111111', session: 'fixture-session-1', sourceRevision: 4, exportable: false };
const evidence = [{ seq: 1, kind: 'transcript', text: 'E1: Maren opens the harbor gate.', user: '222222222222222222', speaker: 'Maren' }];
const secret = 'private-fixture-provider-token-or-evidence';
const reply = () => ({ text: 'Maren opens the harbor gate. [E1]', provider: 'obus', model: 'fixture-local-model', routeId: 'fixture-route-1', trace: [{ destination: 'local', provider: 'ollama', model: 'fixture-local-model' }], sources: [] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(options = {}) {
  const requests = [], audio = [], authorizations = [], speechRequests = [], participants = [], runtimes = [];
  const transport = {
    generate: async request => { requests.push(request); return options.generate ? options.generate(request) : reply(); },
    transcribe: async (bytes, context) => { audio.push(Buffer.from(bytes)); speechRequests.push(context); return options.transcribe ? options.transcribe(bytes, context) : '  Maren opens the gate.  '; },
    runtime: async (scope, session) => { runtimes.push({ scope, session }); return options.runtime ? options.runtime(scope, session) : runtimeFixture(); },
  };
  const provider = createObusChronicleProvider({ transport, campaigns: [context.campaign], authorizeCommand: async scope => {
    authorizations.push(scope);
    return options.authorizeCommand ? options.authorizeCommand(scope) : true;
  }, authorizeParticipant: options.missingParticipant ? undefined : async scope => { participants.push(scope); return options.authorizeParticipant ? options.authorizeParticipant(scope) : true; }, ...(options.onReceipt ? { onReceipt: options.onReceipt } : {}) });
  return { provider, requests, audio, authorizations, speechRequests, participants, runtimes };
}
async function rejectsSafely(work) {
  await assert.rejects(work, error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.length > 0);
    assert.equal(error.message.includes(secret), false);
    assert.equal(String(error.stack).includes(secret), false);
    return true;
  });
}
function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}

test('every chronicle kind goes through the injected Obus transport with immutable local-only policy', async () => {
  const f = fixture();
  const forgedContext = { ...context, exportable: true, mode: 'local-free', codex: true, role: 'admin', namespace: 'personal-memory', policy: { mode: 'local-free', codex: true, tools: true }, provider: 'direct-provider' };
  for (const [kind, input] of [['summary', evidence], ['summary', ['Chapter one']], ['final', ['Chapter one']], ['cue', { title: 'Harbor', observableFacts: 'Fog covers the pier.' }]]) {
    assert.equal(await f.provider.write(kind, input, forgedContext), reply().text);
    const request = f.requests.at(-1);
    assert.equal(request.task, kind);
    assert.equal(request.session, context.session);
    assert.deepEqual(request.scope, { campaign: context.campaign, owner: context.owner, role: 'host' });
    assert.equal(request.policy.mode, 'local');
    assert.equal(request.policy.codex, false);
    assert.equal(request.policy.exportable, false);
    assert.equal(request.policy.escalationEligible, false);
    assert.equal(request.policy.namespace, context.campaign);
    assert.equal(request.policy.tools, false);
    assert.equal(request.policy.personal_memory, false);
    assert.equal(request.policy.auto_memory, false);
    assert.match(request.requestId, /^[a-f0-9]{64}$/);
    assert.ok(request.signal instanceof AbortSignal);
  }
  assert.equal(f.requests.length, 4);
  assert.equal(f.audio.length, 0);
  assert.ok(f.authorizations.length >= 8);
});

test('unknown campaigns, malformed scope, unsupported kinds and oversized evidence never dispatch', async () => {
  const f = fixture();
  for (const scope of [undefined, null, {}, { ...context, campaign: 'other' }, { ...context, owner: 'host' }, { ...context, session: '' }, { ...context, session: '../escape' }, { ...context, sourceRevision: -1 }, { ...context, sourceRevision: 1.5 }]) {
    await rejectsSafely(() => f.provider.write('summary', evidence, scope));
  }
  for (const [kind, input] of [['shell', evidence], ['summary', []], ['summary', Array(257).fill('chapter')], ['summary', ['x'.repeat(24001)]], ['cue', { title: 'Harbor', observableFacts: 'x'.repeat(24001) }]]) {
    await rejectsSafely(() => f.provider.write(kind, input, context));
  }
  const circular = []; circular.push(circular);
  await rejectsSafely(() => f.provider.write('summary', circular, context));
  assert.equal(f.requests.length, 0);
  assert.equal(f.audio.length, 0);
});

test('authorization must explicitly allow the current host before dispatch', async () => {
  for (const result of [false, undefined, null, 'host', { allowed: true }]) {
    const f = fixture({ authorizeCommand: async () => result });
    await rejectsSafely(() => f.provider.write('summary', evidence, context));
    assert.equal(f.requests.length, 0);
  }
  const f = fixture({ authorizeCommand: async () => { throw new Error(secret); } });
  await rejectsSafely(() => f.provider.write('summary', evidence, context));
  assert.equal(f.requests.length, 0);
});

test('revocation while Obus runs prevents text delivery and provenance publication', async () => {
  const started = deferred(), release = deferred(), receipts = [];
  let allowed = true;
  const f = fixture({ authorizeCommand: () => allowed, generate: async () => { started.resolve(); await release.promise; return reply(); }, onReceipt: record => receipts.push(record) });
  const result = f.provider.write('summary', evidence, context);
  await started.promise;
  allowed = false;
  release.resolve();
  await rejectsSafely(() => result);
  assert.equal(f.requests.length, 1);
  assert.equal(receipts.length, 0);
});

test('caller mutation during initial authorization cannot change the queued request or its ID', async () => {
  const started = deferred(), release = deferred();
  let authorizationCount = 0;
  const f = fixture({ authorizeCommand: async () => { if (++authorizationCount === 1) { started.resolve(); await release.promise; } return true; } });
  const mutableContext = { ...context }, mutableEvidence = structuredClone(evidence);
  const result = f.provider.write('summary', mutableEvidence, mutableContext);
  await started.promise;
  mutableContext.campaign = 'other'; mutableContext.owner = '999999999999999999'; mutableContext.sourceRevision = 999;
  mutableContext.exportable = true; mutableEvidence[0].text = secret; mutableEvidence.push({ text: secret });
  release.resolve();
  assert.equal(await result, reply().text);
  const request = f.requests[0];
  assert.deepEqual(request.scope, { campaign: context.campaign, owner: context.owner, role: 'host' });
  assert.equal(JSON.stringify(request).includes(secret), false);
  const original = fixture();
  await original.provider.write('summary', evidence, context);
  assert.equal(request.requestId, original.requests[0].requestId);
});

test('request IDs are stable for the same evidence and change with revisions or evidence', async () => {
  const f = fixture();
  await f.provider.write('summary', evidence, context);
  await f.provider.write('summary', structuredClone(evidence), { ...context, codex: true, exportable: true });
  await f.provider.write('summary', evidence, { ...context, sourceRevision: 5 });
  await f.provider.write('summary', [{ ...evidence[0], text: 'E1: The gate stays closed.' }], context);
  assert.equal(f.requests[0].requestId, f.requests[1].requestId);
  assert.notEqual(f.requests[0].requestId, f.requests[2].requestId);
  assert.notEqual(f.requests[0].requestId, f.requests[3].requestId);
});

test('invalid text, missing provenance and free or Codex nested routes are rejected', async () => {
  const invalid = [
    { text: '' }, { text: ' ' }, { text: 42 }, { text: 'x'.repeat(16001) }, { text: '<script>alert(1)</script>' },
    { provider: 'other' }, { routeId: '' }, { trace: [] }, { trace: null },
    { trace: [{ destination: 'free', cost: 'zero' }] },
    { trace: [{ destination: 'local' }, { destination: 'codex' }] },
    { trace: [{ destination: 'local' }, { destination: 'free', cost: 'zero' }] },
    { trace: [{ destination: 'unknown' }] },
  ];
  for (const fields of invalid) {
    const receipts = [];
    const f = fixture({ generate: () => ({ ...reply(), ...fields }), onReceipt: receipt => receipts.push(receipt) });
    await rejectsSafely(() => f.provider.write('summary', evidence, context));
    assert.equal(f.requests.length, 1);
    assert.equal(receipts.length, 0);
  }
});

test('Obus outage is sanitized and never invokes another provider or retry', async () => {
  const f = fixture({ generate: async () => { throw new Error(secret); } });
  await rejectsSafely(() => f.provider.write('summary', evidence, context));
  assert.equal(f.requests.length, 1);
  assert.equal(f.audio.length, 0);
});

test('provenance callback is awaited and receives routing metadata without transcript evidence', async () => {
  const began = deferred(), release = deferred(), receipts = [];
  const f = fixture({ generate: () => ({ ...reply(), text: secret, trace: [{ ...reply().trace[0], prompt: secret, evidence: secret }], sources: [{ id: 'evidence-1', revision: 4, text: secret }] }), onReceipt: async receipt => { receipts.push(receipt); began.resolve(); await release.promise; } });
  let returned = false;
  const result = f.provider.write('summary', [{ ...evidence[0], text: secret }], context).then(text => { returned = true; return text; });
  await began.promise;
  assert.equal(returned, false);
  assert.equal(receipts.length, 1);
  assert.equal(JSON.stringify(receipts[0]).includes(secret), false);
  assert.equal(receipts[0].requestId, f.requests[0].requestId);
  assert.deepEqual(receipts[0].scope, { campaign: context.campaign, owner: context.owner, role: 'host' });
  assert.equal(receipts[0].task, 'summary');
  assert.equal(receipts[0].outcome, 'ready');
  assert.deepEqual(receipts[0].sources, [{ id: 'evidence-1', revision: 4 }]);
  assert.equal(receipts[0].session, context.session);
  assert.equal(receipts[0].sourceRevision, context.sourceRevision);
  assert.equal(receipts[0].provider, 'obus');
  assert.equal(receipts[0].routeId, 'fixture-route-1');
  assert.equal(receipts[0].model, 'fixture-local-model');
  release.resolve();
  assert.equal(await result, secret);
});

test('authorization revoked while a receipt is saved still prevents text delivery', async () => {
  const started = deferred(), release = deferred();
  let allowed = true;
  const f = fixture({ authorizeCommand: () => allowed, onReceipt: async () => { started.resolve(); await release.promise; } });
  const result = f.provider.write('summary', evidence, context);
  await started.promise;
  allowed = false;
  release.resolve();
  await rejectsSafely(() => result);
  assert.equal(f.requests.length, 1);
});

test('a failed provenance callback fails the request instead of silently losing the receipt', async () => {
  let callbacks = 0;
  const f = fixture({ onReceipt: async () => { callbacks++; throw new Error(secret); } });
  await rejectsSafely(() => f.provider.write('summary', evidence, context));
  assert.equal(f.requests.length, 1);
  assert.equal(callbacks, 1);
});

test('speech goes only to injected Obus and returns bounded transcript text', async () => {
  const f = fixture();
  const bytes = wav();
  assert.equal(await f.provider.transcribe(bytes, speechContext()), 'Maren opens the gate.');
  assert.equal(f.audio.length, 1);
  assert.deepEqual(f.audio[0], bytes);
  assert.equal(f.requests.length, 0);
});

test('bad WAV input never reaches Obus and transcription outages are sanitized', async () => {
  const f = fixture();
  for (const input of [null, 'audio', new Uint8Array(46), Buffer.alloc(43), Buffer.alloc(44), Buffer.alloc(6000001)]) {
    await rejectsSafely(() => f.provider.transcribe(input, speechContext()));
  }
  assert.equal(f.audio.length, 0);
  const unavailable = fixture({ transcribe: async () => { throw new Error(secret); } });
  await rejectsSafely(() => unavailable.provider.transcribe(wav(), speechContext()));
  assert.equal(unavailable.audio.length, 1);
  for (const result of [42, 'x'.repeat(6001)]) {
    const invalid = fixture({ transcribe: async () => result });
    await rejectsSafely(() => invalid.provider.transcribe(wav(), speechContext()));
    assert.equal(invalid.audio.length, 1);
  }
});

test('speech requires captured scope and an explicit current participant authority', async () => {
  const f = fixture();
  for (const supplied of [undefined, {}, { ...speechContext(), session: '' }, { ...speechContext(), capturedConsentEpoch: -1 }, { ...speechContext(), scope: { ...speechContext().scope, campaign: 'foreign' } }, { ...speechContext(), capturedRuntime: { ...runtimeFixture(), generation: null } }]) {
    await rejectsSafely(() => f.provider.transcribe(wav(), supplied));
  }
  assert.equal(f.audio.length, 0);
  for (const options of [{ missingParticipant: true }, { authorizeParticipant: async () => false }, { authorizeParticipant: async () => { throw new Error(secret); } }]) {
    const denied = fixture(options);
    await rejectsSafely(() => denied.provider.transcribe(wav(), speechContext()));
    assert.equal(denied.audio.length, 0);
  }
});

test('speech freezes segment identity and audio before an authorization await', async () => {
  const entered = deferred(), release = deferred();
  let checks = 0, receivedAudio;
  const f = fixture({ authorizeParticipant: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } return true; },
    transcribe: (bytes, sent) => { receivedAudio = bytes; assert.equal(sent.scope.owner, '222222222222222222'); return 'Captured.'; } });
  const captured = speechContext(), expected = structuredClone(captured), bytes = wav(), original = Buffer.from(bytes);
  const work = f.provider.transcribe(bytes, captured);
  await entered.promise;
  captured.scope.owner = context.owner; captured.session = 'other'; captured.requestId = 'other'; captured.capturedRuntime.sessionPolicyRevision = 9; bytes.fill(3);
  release.resolve();
  assert.equal(await work, 'Captured.');
  assert.deepEqual(f.speechRequests[0], expected);
  assert.deepEqual(f.audio[0], original);
  assert.ok(receivedAudio.every(value => value === 0));
  assert.equal(f.authorizations.length, 0, 'Participant speech never uses the host-only command callback.');
});

test('participant removal during transcription suppresses the result without retry', async () => {
  let allowed = true;
  const entered = deferred(), release = deferred();
  const f = fixture({ authorizeParticipant: () => allowed, transcribe: async () => { entered.resolve(); await release.promise; return secret; } });
  const work = f.provider.transcribe(wav(), speechContext());
  await entered.promise; allowed = false; release.resolve();
  await rejectsSafely(() => work);
  assert.equal(f.audio.length, 1);
});

test('captureRuntime checks current GM authority around the Obus runtime lookup', async () => {
  const scope = { campaign: context.campaign, owner: context.owner, role: 'host' }, runtime = runtimeFixture();
  const f = fixture({ runtime: () => runtime });
  const saved = await f.provider.captureRuntime(scope, context.session);
  assert.deepEqual(saved, runtime); assert.ok(Object.isFrozen(saved));
  assert.equal(f.authorizations.length, 2); assert.equal(f.runtimes.length, 1);
  await rejectsSafely(() => f.provider.captureRuntime({ ...scope, role: 'player' }, context.session));
  assert.equal(f.runtimes.length, 1);
  let allowed = true;
  const revoked = fixture({ authorizeCommand: () => allowed, runtime: async () => { allowed = false; return runtimeFixture(); } });
  await rejectsSafely(() => revoked.provider.captureRuntime(scope, context.session));
});

test('receipt-only transcription completion never retries or falls back', async () => {
  const f = fixture({ transcribe: async () => { throw Object.assign(new Error(secret), { code: 'RECEIPT_ONLY' }); } });
  await rejectsSafely(() => f.provider.transcribe(wav(), speechContext()));
  assert.equal(f.audio.length, 1); assert.equal(f.requests.length, 0);
});
