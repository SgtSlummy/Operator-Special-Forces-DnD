import test from 'node:test';
import assert from 'node:assert/strict';
import { ObusTransport } from './obus.mjs';

const base = 'http://127.0.0.1:38175';
const token = 'a'.repeat(64);
const scope = { campaign: 'runtime-test', owner: '111111111111111111', role: 'host' };
const session = 'fixture-session-1';
const requestId = 'fixture-request-1';
const caps = { contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true, provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true };
const bootEpoch = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const envelope = { contract: 'raph-obus-game-runtime-v1', bootEpoch, generation, sessionPolicyRevision: 4 };
const leaseExpiresAtMs = Date.now() + 300_000;
const capturedRuntime = () => ({ ...envelope, leaseExpiresAtMs });
const speechContext = () => ({ scope: { ...scope }, session, requestId, capturedRuntime: capturedRuntime(), capturedConsentEpoch: 0 });
const runtime = () => ({ ...capturedRuntime(), requiredForRoute: true, effectivePolicy: { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false } });
const transcript = () => ({ status: 'completed', result: { kind: 'transcript', text: '  A ship arrives.  ', engine: 'faster-whisper', model: 'tiny', trace: [{ destination: 'local' }] }, receipt: { requestId } });
const answer = { text: 'A ship arrives.', routeId: 'route-1', model: 'fixture-local', trace: [{ destination: 'local', model: 'fixture-local' }], sources: [] };
const job = () => ({ instructions: 'Describe the harbor.', evidence: [{ id: 'E1', text: 'The party sees a ship.' }], scope: { ...scope }, task: 'summary', session, requestId, policy: { mode: 'local', codex: false, exportable: false, tools: false, personal_memory: false, auto_memory: false }, maxTokens: 900 });
function fixture(overrides = {}) {
  const calls = [];
  const transport = new ObusTransport({ url: base, serviceToken: token, fetchImpl: async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push({ url: String(url), path, options, body: options.body ? JSON.parse(options.body) : undefined });
    if (overrides.fetch) return overrides.fetch(url, options);
    if (path === '/api/game/capabilities') return Response.json(overrides.caps ?? caps);
    if (path === '/api/game/runtime') return overrides.runtime ? overrides.runtime(url, options) : Response.json(runtime());
    if (path === '/api/game/route') return overrides.route ? overrides.route(url, options) : Response.json(answer);
    if (path === '/api/voice/transcribe') return overrides.transcribe ? overrides.transcribe(url, options) : Response.json(transcript());
    throw new Error('Unexpected endpoint: ' + path);
  } });
  return { transport, calls, posts: () => calls.filter(call => call.options.method === 'POST') };
}
function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function assertRuntimeGet(call) {
  const url = new URL(call.url);
  assert.equal(call.path, '/api/game/runtime');
  assert.equal(call.options.method ?? 'GET', 'GET');
  assert.deepEqual(Object.fromEntries(url.searchParams), { campaign: scope.campaign, session });
  assert.equal(new Headers(call.options.headers).get('x-obus-game-token'), token);
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.body, undefined);
  assert.ok(call.options.signal instanceof AbortSignal);
}

test('runtime snapshot exposes the current identity and capture lease deadline', async () => {
  const f = fixture();
  assert.deepEqual(await f.transport.runtime(scope, session), capturedRuntime());
  assert.equal(f.calls.length, 1);
  assertRuntimeGet(f.calls[0]);
});

test('generation checks capabilities then runtime and sends the required envelope to the only route', async () => {
  const f = fixture(), input = job();
  assert.equal((await f.transport.generate(input)).text, answer.text);
  assert.deepEqual(f.calls.map(call => call.path), ['/api/game/capabilities', '/api/game/runtime', '/api/game/route', '/api/game/runtime']);
  assertRuntimeGet(f.calls[1]); assertRuntimeGet(f.calls[3]);
  const route = f.posts()[0];
  assert.equal(route.body.contract, 'raph-obus-game-v1');
  assert.deepEqual(route.body.runtime, envelope);
  assert.deepEqual(route.body.scope, input.scope);
  assert.equal(route.body.session, session);
  assert.equal(route.body.requestId, requestId);
  assert.equal(route.body.policy.codex, false);
  assert.equal(route.body.policy.tools, false);
  assert.equal(route.body.policy.personal_memory, false);
  assert.equal(route.body.policy.auto_memory, false);
  assert.equal(route.options.redirect, 'error');
  assert.equal(new Headers(route.options.headers).get('x-obus-game-token'), token);
});

test('missing or invalid capabilities cannot be replaced with a runtime snapshot', async () => {
  for (const invalidCaps of [{ contract: 'old' }, { ...caps, no_personal_memory: false }, { ...caps, codex_gate: false }]) {
    const f = fixture({ caps: invalidCaps });
    await assert.rejects(() => f.transport.generate(job()));
    assert.deepEqual(f.calls.map(call => call.path), ['/api/game/capabilities']);
    assert.equal(f.posts().length, 0);
  }
});

test('invalid runtime contract, epoch, lease or effective policy prevents every generation POST', async () => {
  const invalid = [
    null, {}, { ...runtime(), contract: 'old' }, { ...runtime(), requiredForRoute: false },
    { ...runtime(), bootEpoch: 'invalid' }, { ...runtime(), bootEpoch: '11111111-1111-1111-8111-111111111111' },
    { ...runtime(), generation: '' }, { ...runtime(), sessionPolicyRevision: -1 },
    { ...runtime(), sessionPolicyRevision: 1.5 }, { ...runtime(), sessionPolicyRevision: '4' },
    { ...runtime(), leaseExpiresAtMs: Date.now() - 1 }, { ...runtime(), leaseExpiresAtMs: 'tomorrow' },
    { ...runtime(), effectivePolicy: null },
    ...[{ enabled: false }, { enabled: 'true' }, { mode: 'paid' }, { exportable: 'true' }, { codex: 'false' }, { tools: true }, { personalMemory: true }, { autoMemory: true }].map(change => ({ ...runtime(), effectivePolicy: { ...runtime().effectivePolicy, ...change } })),
  ];
  for (const snapshot of invalid) {
    const f = fixture({ runtime: () => Response.json(snapshot) });
    await assert.rejects(() => f.transport.generate(job()));
    assert.equal(f.posts().length, 0, JSON.stringify(snapshot));
    assert.deepEqual(f.calls.map(call => call.path), ['/api/game/capabilities', '/api/game/runtime']);
  }
});

test('missing endpoint, stale runtime response and runtime outages fail closed with no alternative', async () => {
  for (const status of [404, 409, 503]) {
    const f = fixture({ runtime: () => Response.json({ error: 'private-host-detail' }, { status }) });
    await assert.rejects(() => f.transport.generate(job()), error => !String(error).includes('private-host-detail'));
    assert.equal(f.posts().length, 0);
  }
  const f = fixture({ runtime: () => { throw new Error('fixture socket closed'); } });
  await assert.rejects(() => f.transport.generate(job()));
  assert.equal(f.posts().length, 0);
});

test('a route rejected after its snapshot is never retried or downgraded', async () => {
  const f = fixture({ route: () => Response.json({ error: 'stale-generation' }, { status: 409 }) });
  await assert.rejects(() => f.transport.generate(job()));
  assert.deepEqual(f.calls.map(call => call.path), ['/api/game/capabilities', '/api/game/runtime', '/api/game/route']);
  assert.equal(f.posts().length, 1);
  assert.deepEqual(f.posts()[0].body.runtime, envelope);
});

test('generation snapshots caller scope, policy and evidence before capability and runtime awaits', async () => {
  for (const delayedPath of ['/api/game/capabilities', '/api/game/runtime']) {
    const entered = deferred(), release = deferred();
    const f = fixture({ fetch: async url => {
      const path = new URL(url).pathname;
      if (path === delayedPath) { entered.resolve(); await release.promise; }
      return Response.json(path === '/api/game/capabilities' ? caps : path === '/api/game/runtime' ? runtime() : answer);
    } });
    const input = job(), original = structuredClone(input);
    const result = f.transport.generate(input);
    await entered.promise;
    input.scope.campaign = 'other'; input.scope.owner = 'another-owner'; input.scope.role = 'admin';
    input.policy.codex = true; input.policy.exportable = true; input.policy.mode = 'local-free';
    input.evidence[0].text = 'private-mutation'; input.evidence.push({ text: 'private-mutation' });
    release.resolve();
    await result;
    const posted = f.posts()[0].body;
    assert.deepEqual(posted.scope, original.scope);
    assert.deepEqual(posted.evidence, original.evidence);
    assert.equal(posted.policy.codex, false);
    assert.equal(posted.policy.exportable, false);
    assertRuntimeGet(f.calls.find(call => call.path === '/api/game/runtime'));
  }
});

test('each generation obtains fresh lifecycle identity instead of caching an old snapshot', async () => {
  let revision = 4;
  const f = fixture({ runtime: () => Response.json({ ...runtime(), sessionPolicyRevision: revision }) });
  await f.transport.generate(job()); revision = 5; await f.transport.generate(job());
  assert.deepEqual(f.posts().map(call => call.body.runtime.sessionPolicyRevision), [4, 5]);
  assert.equal(f.calls.filter(call => call.path === '/api/game/runtime').length, 4);
});

test('speech requires scoped runtime authorization and sends the exact new STT envelope', async () => {
  const f = fixture(), bytes = wav();
  assert.equal(await f.transport.transcribe(bytes, speechContext()), 'A ship arrives.');
  assert.deepEqual(f.calls.map(call => call.path), ['/api/game/runtime', '/api/voice/transcribe', '/api/game/runtime']);
  assertRuntimeGet(f.calls[0]); assertRuntimeGet(f.calls[2]);
  assert.deepEqual(f.posts()[0].body, { contract: 'raph-obus-game-stt-v1', scope, session, requestId, runtime: envelope, audio_base64: bytes.toString('base64'), mime_type: 'audio/wav' });
  assert.equal(f.posts()[0].options.redirect, 'error');
  assert.equal(new Headers(f.posts()[0].options.headers).get('x-obus-game-token'), token);
});

test('valid host escalation settings preserve stricter job policy and player-scoped speech', async () => {
  const f = fixture({ runtime: () => Response.json({ ...runtime(), effectivePolicy: { ...runtime().effectivePolicy, mode: 'local-free', codex: true, exportable: true } }) });
  await f.transport.generate(job());
  assert.equal(f.posts()[0].body.policy.mode, 'local');
  assert.equal(f.posts()[0].body.policy.codex, false);
  assert.equal(f.posts()[0].body.policy.exportable, false);
  const playerScope = { ...scope, role: 'player' };
  assert.equal(await f.transport.transcribe(wav(), { ...speechContext(), scope: playerScope }), 'A ship arrives.');
  assert.deepEqual(f.posts()[1].body.scope, playerScope);
  assert.deepEqual(f.posts()[1].body.runtime, envelope);
});

test('legacy bytes-only STT and invalid audio or forged scope fail before any HTTP request', async () => {
  const f = fixture(), context = speechContext();
  await assert.rejects(() => f.transport.transcribe(wav()));
  for (const bytes of [null, 'raw audio', new Uint8Array(46), Buffer.alloc(43), Buffer.alloc(44), Buffer.alloc(6000001)]) {
    await assert.rejects(() => f.transport.transcribe(bytes, context));
  }
  for (const input of [null, {}, { scope, session }, { scope, requestId }, { session, requestId }, { ...context, scope: { ...scope, role: 'admin' } }, { ...context, scope: { ...scope, campaign: '../other' } }, { ...context, scope: { ...scope, owner: '' } }, { ...context, requestId: '../id' }, { ...context, session: '' }]) {
    await assert.rejects(() => f.transport.transcribe(wav(), input));
  }
  assert.equal(f.calls.length, 0);
});

test('speech snapshots scope, request and raw audio before awaiting runtime authorization', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ runtime: async () => { entered.resolve(); await release.promise; return Response.json(runtime()); } });
  const bytes = wav(), expectedAudio = bytes.toString('base64'), mutable = speechContext();
  const result = f.transport.transcribe(bytes, mutable);
  await entered.promise;
  mutable.scope.campaign = 'other'; mutable.scope.owner = 'other-owner'; mutable.scope.role = 'admin';
  mutable.session = 'other-session'; mutable.requestId = 'other-request'; mutable.capturedRuntime.generation = '33333333-3333-4333-8333-333333333333'; mutable.capturedRuntime.sessionPolicyRevision = 99; mutable.capturedConsentEpoch = 99; bytes.fill(0);
  release.resolve();
  assert.equal(await result, 'A ship arrives.');
  assert.deepEqual(f.posts()[0].body.scope, scope);
  assert.equal(f.posts()[0].body.session, session);
  assert.equal(f.posts()[0].body.requestId, requestId);
  assert.equal(f.posts()[0].body.audio_base64, expectedAudio);
  assert.deepEqual(f.posts()[0].body.runtime, envelope); assert.equal(f.posts()[0].body.capturedConsentEpoch, undefined);
});

test('speech runtime denial or post-snapshot rejection never falls back to an unscoped request', async () => {
  for (const denied of [() => Response.json(runtime(), { status: 404 }), () => Response.json({ ...runtime(), leaseExpiresAtMs: Date.now() - 1 }), () => Response.json({ ...runtime(), effectivePolicy: { ...runtime().effectivePolicy, enabled: false } })]) {
    const f = fixture({ runtime: denied });
    await assert.rejects(() => f.transport.transcribe(wav(), speechContext()));
    assert.equal(f.posts().length, 0);
  }
  const f = fixture({ transcribe: () => Response.json({ error: 'private-lifecycle-detail' }, { status: 409 }) });
  await assert.rejects(() => f.transport.transcribe(wav(), speechContext()), error => !String(error).includes('private-lifecycle-detail'));
  assert.deepEqual(f.calls.map(call => call.path), ['/api/game/runtime', '/api/voice/transcribe']);
  assert.equal(f.posts().length, 1);
});

test('missing, invalid or expired capture metadata prevents even a runtime request', async () => {
  const f = fixture();
  const withoutConsent = speechContext(); delete withoutConsent.capturedConsentEpoch;
  const withoutRuntime = speechContext(); delete withoutRuntime.capturedRuntime;
  const invalid = [withoutConsent, withoutRuntime, { ...speechContext(), capturedConsentEpoch: -1 },
    { ...speechContext(), capturedConsentEpoch: 0.5 }, { ...speechContext(), capturedConsentEpoch: '0' },
    ...[null, {}, { ...capturedRuntime(), contract: 'old' }, { ...capturedRuntime(), generation: 'not-a-generation' },
      { ...capturedRuntime(), sessionPolicyRevision: -1 }, { ...capturedRuntime(), leaseExpiresAtMs: Date.now() - 1 },
      { ...capturedRuntime(), leaseExpiresAtMs: 'tomorrow' }].map(capture => ({ ...speechContext(), capturedRuntime: capture })),
  ];
  for (const context of invalid) await assert.rejects(() => f.transport.transcribe(wav(), context));
  assert.equal(f.calls.length, 0);
});

test('captured speech cannot be rebound to a newer boot, host generation or policy', async () => {
  for (const change of [{ bootEpoch: '33333333-3333-4333-8333-333333333333' },
    { generation: '33333333-3333-4333-8333-333333333333' }, { sessionPolicyRevision: 5 }]) {
    const f = fixture({ runtime: () => Response.json({ ...runtime(), ...change }) });
    await assert.rejects(() => f.transport.transcribe(wav(), speechContext()));
    assert.equal(f.posts().length, 0); assert.equal(f.calls.length, 1);
  }
});

test('a normal lease renewal preserves the captured wire identity and stable retry request', async () => {
  let renewal = 0;
  const f = fixture({ runtime: () => Response.json({ ...runtime(), leaseExpiresAtMs: leaseExpiresAtMs + ++renewal * 1000 }) });
  const context = speechContext(), audio = wav();
  assert.equal(await f.transport.transcribe(audio, context), 'A ship arrives.');
  assert.equal(await f.transport.transcribe(audio, context), 'A ship arrives.');
  assert.equal(f.posts().length, 2); assert.deepEqual(f.posts()[0].body, f.posts()[1].body);
  assert.deepEqual(f.posts()[0].body.runtime, envelope); assert.equal(f.posts()[0].body.requestId, requestId);
  assert.deepEqual(context.capturedRuntime, capturedRuntime()); assert.equal(renewal, 4);
});

test('generation and speech discard completed output after a late lifecycle change', async () => {
  for (const type of ['generation', 'speech']) {
    for (const change of [{ bootEpoch: '33333333-3333-4333-8333-333333333333' },
      { generation: '33333333-3333-4333-8333-333333333333' }, { sessionPolicyRevision: 5 },
      { leaseExpiresAtMs: Date.now() - 1 }, { effectivePolicy: { ...runtime().effectivePolicy, enabled: false } }]) {
      let reads = 0;
      const f = fixture({ runtime: () => Response.json({ ...runtime(), ...(reads++ ? change : {}) }) });
      await assert.rejects(() => type === 'generation' ? f.transport.generate(job()) : f.transport.transcribe(wav(), speechContext()));
      assert.equal(f.posts().length, 1, type); assert.equal(reads, 2, type);
    }
  }
});

test('receipt-only and legacy or malformed speech responses never cause another inference', async () => {
  for (const response of [{ text: 'legacy transcript' }, { status: 'completed_receipt_only', receipt: { requestId, transcriptLength: 17 } },
    { ...transcript(), status: 'queued' }, { ...transcript(), result: { ...transcript().result, kind: 'narration' } },
    { ...transcript(), result: { ...transcript().result, text: 'x'.repeat(6001) } }]) {
    const f = fixture({ transcribe: () => Response.json(response) });
    await assert.rejects(() => f.transport.transcribe(wav(), speechContext()));
    assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].path, '/api/voice/transcribe');
  }
  const f = fixture({ transcribe: () => Response.json({ ...transcript(), result: { ...transcript().result, text: 'x'.repeat(6000) } }) });
  assert.equal((await f.transport.transcribe(wav(), speechContext())).length, 6000);
  assert.equal(f.posts().length, 1);
});

test('a local job rejects any mixed free or Codex stage despite permissive host settings', async () => {
  for (const extra of [{ destination: 'free', cost: 'zero' }, { destination: 'codex' }, { destination: 'free', cost: 'paid' }]) {
    const f = fixture({
      runtime: () => Response.json({ ...runtime(), effectivePolicy: { ...runtime().effectivePolicy, mode: 'local-free', exportable: true, codex: true } }),
      route: () => Response.json({ ...answer, trace: [...answer.trace, extra] }),
    });
    await assert.rejects(() => f.transport.generate(job()), /violated/);
    assert.equal(f.posts().length, 1); assert.equal(f.posts()[0].body.policy.mode, 'local');
  }
});
