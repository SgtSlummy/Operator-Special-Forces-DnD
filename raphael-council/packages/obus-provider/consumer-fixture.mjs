import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const before = readdirSync(process.cwd()).sort(); let unexpectedNetwork = 0;
globalThis.fetch = async () => { unexpectedNetwork++; throw new Error('No live network allowed.'); };
const library = await import('@operator/obus-chronicle-provider');
assert.deepEqual(readdirSync(process.cwd()).sort(), before);
assert.equal(fileURLToPath(import.meta.resolve('@operator/obus-chronicle-provider')).startsWith(join(process.cwd(), 'node_modules/@operator/obus-chronicle-provider')), true);
const { ObusTransport, createObusChronicleProvider } = library;
const host = '111111111111111111', speaker = '222222222222222222';
const hostScope = { campaign: 'package-test', owner: host, role: 'host' }, session = 'session-one';
const caps = { contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true, provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true };
function wav() {
  const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40); return bytes;
}
function fixture(options = {}) {
  const calls = [], members = new Set([host, speaker]);
  const state = { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true, bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
    sessionPolicyRevision: 3, leaseExpiresAtMs: Date.now() + 300000,
    effectivePolicy: { enabled: true, mode: 'local-free', exportable: true, codex: false, tools: false, personalMemory: false, autoMemory: false }, queuedCount: 0, dispatchedCount: 0 };
  const transport = new ObusTransport({ url: 'http://127.0.0.1:38175', serviceToken: 'a'.repeat(64), fetchImpl: async (url, request = {}) => {
    const path = new URL(url).pathname, body = request.body ? JSON.parse(request.body) : null; calls.push({ path, body });
    if (options.offline) throw new Error('private-fixture-secret');
    let response;
    if (path === '/api/game/capabilities') response = caps;
    else if (path === '/api/game/runtime') response = state;
    else if (path === '/api/game/route') response = { text: 'The quay is empty.', model: 'fixture', routeId: 'route1', trace: [{ destination: 'local', provider: 'ollama' }], sources: [{ ref: 'scene1', revision: 4 }] };
    else if (path === '/api/voice/transcribe') {
      options.onSpeech?.({ body, members, state });
      response = options.receiptOnly ? { status: 'completed_receipt_only', receipt: { kind: 'stt', requestId: body.requestId, audioSha256: 'a'.repeat(64) } } :
        { status: 'completed', result: { kind: 'transcript', text: 'hello', engine: 'faster-whisper', model: 'tiny', trace: [{ destination: 'local' }] }, receipt: { requestId: body.requestId } };
    } else throw new Error(`Unapproved endpoint ${path}`);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const provider = createObusChronicleProvider({ transport, campaigns: [hostScope.campaign], authorizeCommand: async scope => scope.owner === host && members.has(host),
    authorizeParticipant: options.missingParticipant ? undefined : async scope => members.has(scope.owner) });
  const context = async (sessionId = session) => ({ scope: { campaign: hostScope.campaign, owner: speaker, role: 'player' }, session: sessionId, requestId: 'stable-segment-one', capturedRuntime: await provider.captureRuntime(hostScope, sessionId), capturedConsentEpoch: 2 });
  return { provider, transport, calls, members, state, context, speechPosts: () => calls.filter(call => call.path === '/api/voice/transcribe') };
}

test('installed exports have no platform startup or implicit network side effects', () => {
  assert.deepEqual(Object.keys(library).sort(), ['ObusTransport', 'createObusChronicleProvider']); assert.equal(unexpectedNetwork, 0);
});

test('installed narration goes through actual Obus transport with local-only policy', async () => {
  const f = fixture();
  assert.equal(await f.provider.write('summary', [{ seq: 1, text: 'A quay.' }], { campaign: hostScope.campaign, owner: host, session, sourceRevision: 4 }), 'The quay is empty.');
  const routed = f.calls.filter(call => call.path === '/api/game/route'); assert.equal(routed.length, 1);
  assert.equal(routed[0].body.policy.mode, 'local'); assert.equal(routed[0].body.policy.codex, false); assert.equal(routed[0].body.policy.exportable, false);
  assert.deepEqual(routed[0].body.scope, hostScope); assert.equal(unexpectedNetwork, 0);
});

test('installed transcription sends original scoped runtime with exactly four wire fence fields', async () => {
  const f = fixture(), context = await f.context();
  assert.equal(await f.provider.transcribe(wav(), context), 'hello');
  const [request] = f.speechPosts(); assert.equal(f.speechPosts().length, 1);
  assert.deepEqual(Object.keys(request.body).sort(), ['audio_base64', 'contract', 'mime_type', 'requestId', 'runtime', 'scope', 'session']);
  assert.equal(request.body.contract, 'raph-obus-game-stt-v1'); assert.deepEqual(request.body.scope, context.scope);
  assert.equal(request.body.session, session); assert.equal(request.body.requestId, context.requestId);
  assert.deepEqual(Object.keys(request.body.runtime).sort(), ['bootEpoch', 'contract', 'generation', 'sessionPolicyRevision']);
  assert.equal(request.body.runtime.generation, context.capturedRuntime.generation);
  assert.equal(request.body.runtime.sessionPolicyRevision, context.capturedRuntime.sessionPolicyRevision);
  assert.equal(request.body.mime_type, 'audio/wav');
});

test('installed participant denial and missing context cannot upload audio', async () => {
  const f = fixture(), context = await f.context(); f.members.delete(speaker);
  await assert.rejects(f.provider.transcribe(wav(), context)); await assert.rejects(f.provider.transcribe(wav())); assert.equal(f.speechPosts().length, 0);
  const missing = fixture({ missingParticipant: true }); await assert.rejects(missing.provider.transcribe(wav(), await missing.context())); assert.equal(missing.speechPosts().length, 0);
});

test('installed stale capture fence is denied before upload and cannot rebind to a newer policy', async () => {
  const f = fixture(), context = await f.context(); f.state.sessionPolicyRevision++;
  await assert.rejects(f.provider.transcribe(wav(), context)); assert.equal(f.speechPosts().length, 0);
  assert.equal(context.capturedRuntime.sessionPolicyRevision, 3);
});

test('installed same-generation lease renewal does not relabel or reject the captured identity', async () => {
  const f = fixture(), context = await f.context(); f.state.leaseExpiresAtMs += 30000;
  assert.equal(await f.provider.transcribe(wav(), context), 'hello'); assert.equal(f.speechPosts().length, 1);
});

test('installed receipt-only completion never repeats STT or selects another route', async () => {
  const f = fixture({ receiptOnly: true }), context = await f.context();
  await assert.rejects(f.provider.transcribe(wav(), context)); assert.equal(f.speechPosts().length, 1);
  assert.equal(f.calls.some(call => call.path === '/api/game/route'), false);
});

test('installed late membership revocation suppresses a completed transcript', async () => {
  const f = fixture({ onSpeech: ({ members }) => members.delete(speaker) }), context = await f.context();
  await assert.rejects(f.provider.transcribe(wav(), context)); assert.equal(f.speechPosts().length, 1);
});

test('co-installed chronicle and provider process one authorized scoped utterance through the real service', async t => {
  const { ChronicleStore, createChronicleRuntime } = await import('@operator/chronicle');
  const f = fixture(), store = new ChronicleStore(':memory:');
  const voice = { start: async () => {}, stop: async () => {}, revoke: () => {}, status: () => 'fixture' };
  const runtime = createChronicleRuntime({ client: {}, store, provider: f.provider, makeVoice: () => voice,
    config: { campaignId: hostScope.campaign, guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', chronicleDir: process.cwd(), dmIds: [host], playerIds: [speaker] },
    transport: { member: async user => ({ user: { id: user }, roles: [], permissions: '0' }), respond: async () => {}, edit: async () => {}, followup: async () => {}, send: async () => ({ id: 'receipt' }) }, authorizeCommand: async scope => scope.owner === host });
  t.after(() => runtime.close());
  const actualSession = store.start({ campaign: hostScope.campaign, title: 'Combined consumer', host, mode: 'human', channel: 'journal', sourceChannel: 'chat', requestId: 'start' });
  store.consent(actualSession.id, speaker, true);
  const context = await f.context(actualSession.id), epoch = store.privacy(actualSession.id, speaker).captureEpoch;
  context.capturedConsentEpoch = epoch;
  const bytes = wav();
  await runtime.service.speech(actualSession.id, { user: speaker, speaker: 'Maren', bytes, captureEpoch: epoch, context, authorizeParticipant: async () => true });
  assert.equal(store.find(actualSession.id, 'voice:stable-segment-one').text, 'hello'); assert.ok(bytes.every(value => value === 0));
  assert.equal(f.speechPosts().length, 1); assert.equal(f.speechPosts()[0].body.session, actualSession.id);
  f.members.delete(speaker);
  await runtime.service.speech(actualSession.id, { user: speaker, speaker: 'Maren', bytes: wav(), captureEpoch: epoch, context: { ...context, requestId: 'denied' }, authorizeParticipant: async () => true });
  assert.equal(store.find(actualSession.id, 'voice:denied'), null); assert.equal(f.speechPosts().length, 1);
});

test('installed runtime loss and outages deny assistance without generic routing', async () => {
  const f = fixture(), context = await f.context(); f.state.effectivePolicy.enabled = false;
  await assert.rejects(f.provider.transcribe(wav(), context)); assert.equal(f.speechPosts().length, 0);
  const offline = fixture({ offline: true });
  await assert.rejects(offline.provider.captureRuntime(hostScope, session), error => !String(error).includes('private-fixture-secret'));
  assert.equal(offline.speechPosts().length, 0); assert.equal(unexpectedNetwork, 0);
});
