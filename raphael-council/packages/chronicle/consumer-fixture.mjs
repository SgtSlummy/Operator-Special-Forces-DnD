import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file is copied into an isolated consumer. It never imports workspace code.
const beforeImport = readdirSync(process.cwd()).sort();
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error('Unexpected network request in package fixture.'); };
const chronicle = await import('@operator/chronicle');
assert.deepEqual(readdirSync(process.cwd()).sort(), beforeImport, 'import creates no local runtime state');
assert.equal(networkCalls, 0);
const installed = fileURLToPath(import.meta.resolve('@operator/chronicle'));
assert.equal(installed.startsWith(join(process.cwd(), 'node_modules', '@operator', 'chronicle')), true);
assert.equal(existsSync(join(dirname(installed), '../../../../discord/chronicle-core.mjs')), false, 'consumer has no Operator source tree');
const { ChronicleStore, ChronicleCommands, createChronicleRuntime, createChronicleRuntimeCore, SESSION_COMMAND } = chronicle;

const captureRuntime = () => ({ contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 3, leaseExpiresAtMs: Date.now() + 30000 });
function fixture(t, { allowed = () => true, participant = () => true, providerWrite, providerSpeech } = {}) {
  const dataDir = mkdtempSync(join(process.cwd(), 'session-'));
  const path = join(dataDir, 'chronicle.sqlite');
  const store = new ChronicleStore(path), calls = { speech: [], write: [], respond: [], edit: [], followup: [], send: [], voice: [], close: 0, client: 0 };
  const close = store.close.bind(store); store.close = () => { calls.close += 1; return close(); };
  const client = { login() { calls.client += 1; throw new Error('Existing client must not be logged in again.'); }, destroy() { calls.client += 1; throw new Error('Existing client must remain owned by Davy.'); } };
  const config = { campaignId: 'campaign', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', dmIds: ['host'], dmRoleId: 'dm', playerIds: ['player'], playerRoleId: 'players', chronicleDir: dataDir };
  const provider = {
    async write(kind, evidence, context) { calls.write.push({ kind, evidence, context }); return providerWrite ? providerWrite(kind, evidence, context) : 'The party discovered the harbor bell and agreed to return tomorrow.'; },
    async captureRuntime(scope, session) { assert.equal(scope.campaign, 'campaign'); assert.equal(scope.role, 'host'); assert.equal(typeof session, 'string'); return captureRuntime(); },
    authorizeParticipant: participant,
    async transcribe(bytes, context) { calls.speech.push(context); return providerSpeech ? providerSpeech(bytes, context) : 'The bell is here.'; },
  };
  const voice = {
    async start(id, owner, options) { if (options?.authorize) assert.equal(await options.authorize(), true); calls.voice.push(['start', id, owner]); },
    async stop(options) { calls.voice.push(['stop', options]); },
    revoke(user) { calls.voice.push(['revoke', user]); },
    status() { return 'Fixture capture idle'; },
  };
  const transport = {
    async respond(...args) { calls.respond.push(args); },
    async edit(...args) { calls.edit.push(args); },
    async followup(...args) { calls.followup.push(args); },
    async send(...args) { calls.send.push(args); return { id: `receipt-${calls.send.length}` }; },
    async member(owner) { return { user: { id: owner, username: owner }, roles: owner === 'host' ? ['dm'] : ['players'], permissions: '0' }; },
  };
  const options = { client, config, provider, store, transport, authorizeCommand: allowed, makeVoice: input => {
    assert.equal(input.client, client); assert.equal(input.store, store); assert.equal(input.config, config); assert.ok(input.service);
    return voice;
  } };
  const runtime = createChronicleRuntime(options);
  t.after(async () => { await runtime.close(); assert.equal(calls.client, 0); assert.equal(calls.close, 1); });
  const interaction = (action, values = {}, owner = 'host') => ({
    id: `interaction-${action}-${calls.respond.length}-${calls.edit.length}`, token: 'fixture-token', application_id: 'app', type: 2,
    guild_id: 'guild', channel_id: 'chat', member: { user: { id: owner, username: owner }, roles: owner === 'host' ? ['dm'] : ['players'], permissions: '0' },
    data: { name: 'session', options: [{ name: action, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] },
  });
  const start = () => store.start({ campaign: 'campaign', title: 'Portable harbor mission', mode: 'human', minutes: 10, host: 'host', channel: 'journal', sourceChannel: 'chat', requestId: 'fixture-start' });
  return { runtime, store, calls, voice, options, interaction, start, path, config, provider };
}

test('installed ESM exports only the portable composition API and requires explicit adapters', () => {
  assert.equal(createChronicleRuntime, createChronicleRuntimeCore);
  assert.equal(SESSION_COMMAND.name, 'session');
  assert.deepEqual(Object.keys(chronicle).sort(), ['ChronicleCommandError', 'ChronicleCommands', 'ChronicleError', 'ChronicleStore', 'SESSION_COMMAND', 'createAdaptiveMusic', 'createChronicleRuntime', 'createChronicleRuntimeCore', 'createDavyChronicleHost', 'createVoiceReceiver', 'discordCampaignBindings']);
  assert.throws(() => createChronicleRuntime({}), /explicitly/);
  assert.equal(networkCalls, 0);
});

test('pre-acknowledged interactions edit the existing private reply without acknowledging twice', async t => {
  const f = fixture(t); f.start();
  assert.equal(await f.runtime.handle(f.interaction('status'), { acknowledged: true }), true);
  assert.equal(f.calls.respond.length, 0);
  assert.equal(f.calls.edit.length, 1);
  assert.match(f.calls.edit[0][2].content, /Portable harbor mission/);
  assert.deepEqual(f.calls.edit[0][2].allowed_mentions, { parse: [] });
  await f.runtime.handle(f.interaction('status'));
  assert.deepEqual(f.calls.respond[0][2], { type: 5, data: { flags: 64 } });
  assert.equal(await f.runtime.handle({ type: 2, data: { name: 'music' } }), false);
  assert.equal(f.calls.write.length, 0);
});

test('installed capture honors consent and corrections, and saved state survives a new connection', async t => {
  const f = fixture(t), session = f.start();
  const packet = id => ({ t: 'MESSAGE_CREATE', d: { id, guild_id: 'guild', channel_id: 'chat', author: { id: 'player', username: 'Player' }, content: 'We found the bell.', timestamp: new Date().toISOString() } });
  await f.runtime.packet(packet('before-consent'));
  assert.equal(f.store.find(session.id, 'discord:before-consent'), null);
  await f.runtime.handle(f.interaction('consent', { enabled: true, external: false }, 'player'), { acknowledged: true });
  await f.runtime.packet(packet('after-consent'));
  const captured = f.store.find(session.id, 'discord:after-consent');
  assert.equal(captured.text, 'We found the bell.');
  assert.equal(captured.exportableAtCapture, false);
  await f.runtime.packet({ t: 'MESSAGE_UPDATE', d: { id: 'after-consent', guild_id: 'guild', channel_id: 'chat', content: 'We found a bronze bell.', edited_timestamp: '2026-09-06T12:00:01Z' } });
  assert.equal(f.store.evidence(session.id).find(entry => entry.seq === captured.seq).text, 'We found a bronze bell.');
  await f.runtime.handle(f.interaction('consent', { enabled: false }, 'player'), { acknowledged: true });
  await f.runtime.packet(packet('after-withdrawal'));
  assert.equal(f.store.find(session.id, 'discord:after-withdrawal'), null);
  assert.equal(f.calls.voice.some(call => call[0] === 'revoke' && call[1] === 'player'), true);
  await f.runtime.close();
  const restored = new ChronicleStore(f.path);
  try {
    assert.equal(restored.get(session.id).status, 'paused');
    assert.equal(restored.evidence(session.id).find(entry => entry.seq === captured.seq).text, 'We found a bronze bell.');
    assert.equal(restored.hasConsent(session.id, 'player'), false);
  } finally { restored.close(); }
  assert.equal(networkCalls, 0);
});

test('packaged durable controls recheck game membership before touching the existing voice adapter', async t => {
  let allowed = true;
  const f = fixture(t, { allowed: () => allowed }), session = f.start();
  const queue = new ChronicleCommands(f.store);
  const scope = { campaign: 'campaign', owner: 'host', role: 'host' };
  const input = { requestId: 'queued-voice', type: 'voice', sessionId: session.id, expectedRevision: f.store.revision(session.id) };
  queue.enqueue(scope, input); allowed = false;
  await f.runtime.tick();
  assert.equal(queue.replay(scope, input).status, 'failed');
  assert.equal(f.calls.voice.some(call => call[0] === 'start'), false);
  assert.equal(f.store.get(session.id).status, 'active');
});

test('Obus failure leaves manually saved notes intact and the session usable', async t => {
  const f = fixture(t, { providerWrite: async () => { throw new Error('Obus fixture unavailable'); } }), session = f.start();
  await f.runtime.handle(f.interaction('note', { text: 'A manually confirmed clue.' }), { acknowledged: true });
  const original = f.store.evidence(session.id).find(entry => entry.kind === 'note');
  assert.equal(original.text, 'A manually confirmed clue.');
  await f.runtime.handle(f.interaction('summary'), { acknowledged: true });
  assert.equal(f.calls.write.length, 1);
  assert.equal(f.store.get(session.id).status, 'active');
  assert.equal(f.store.evidence(session.id).find(entry => entry.seq === original.seq).text, original.text);
  await f.runtime.handle(f.interaction('note', { text: 'Manual play continues.' }), { acknowledged: true });
  assert.equal(f.store.evidence(session.id).some(entry => entry.text === 'Manual play continues.'), true);
});

test('packaged final reports complete with the external native canvas dependency installed', async t => {
  const f = fixture(t), session = f.start();
  await f.runtime.handle(f.interaction('note', { text: 'The party found the bronze harbor bell.' }), { acknowledged: true });
  await f.runtime.handle(f.interaction('end'), { acknowledged: true });
  const ended = f.store.get(session.id);
  assert.equal(ended.status, 'ended');
  assert.ok(ended.recap);
  assert.equal(f.calls.write.length > 0, true);
  assert.equal(networkCalls, 0);
});

function speechInput(f, session, requestId = 'segment') {
  const epoch = f.store.privacy(session.id, 'player').captureEpoch;
  return { user: 'player', speaker: 'Maren', bytes: Buffer.alloc(64, 4), captureEpoch: epoch, authorizeParticipant: async () => true,
    context: { scope: { campaign: 'campaign', owner: 'player', role: 'player' }, session: session.id, requestId, capturedRuntime: captureRuntime(), capturedConsentEpoch: epoch } };
}

test('installed speech forwards immutable captured scope and commits a stable source receipt', async t => {
  const f = fixture(t), session = f.start(); f.store.consent(session.id, 'player', true);
  const segment = speechInput(f, session); await f.runtime.service.speech(session.id, segment);
  assert.equal(f.calls.speech.length, 1); assert.deepEqual(f.calls.speech[0], segment.context);
  assert.ok(Object.isFrozen(f.calls.speech[0].capturedRuntime));
  assert.equal(f.store.find(session.id, 'voice:segment').text, 'The bell is here.'); assert.ok(segment.bytes.every(value => value === 0));
});

test('installed speech discards a result after withdrawal and renewed capture consent', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { providerSpeech: async () => { entered(); await pending; return 'Obsolete.'; } }), session = f.start(); f.store.consent(session.id, 'player', true);
  const segment = speechInput(f, session), work = f.runtime.service.speech(session.id, segment); await started;
  f.store.consent(session.id, 'player', false); f.store.consent(session.id, 'player', true); release(); await work;
  assert.equal(f.calls.speech.length, 1); assert.equal(f.store.find(session.id, 'voice:segment'), null); assert.ok(segment.bytes.every(value => value === 0));
});

test('installed speech rejects missing scope and current participant denial before invoking Obus', async t => {
  const f = fixture(t, { participant: () => false }), session = f.start(); f.store.consent(session.id, 'player', true);
  const segment = speechInput(f, session); await f.runtime.service.speech(session.id, segment);
  const missing = speechInput(f, session, 'missing'); delete missing.context; await f.runtime.service.speech(session.id, missing);
  assert.equal(f.calls.speech.length, 0); assert.ok(segment.bytes.every(value => value === 0)); assert.ok(missing.bytes.every(value => value === 0));
});

test('installed receipt-only completion records a gap without rerunning inference', async t => {
  const f = fixture(t, { providerSpeech: async () => { throw Object.assign(new Error('No retained transcript.'), { code: 'RECEIPT_ONLY' }); } }), session = f.start(); f.store.consent(session.id, 'player', true);
  const segment = speechInput(f, session); await f.runtime.service.speech(session.id, segment);
  assert.equal(f.calls.speech.length, 1); assert.equal(f.store.find(session.id, 'voice:segment'), null);
  assert.equal(f.store.entries(session.id).filter(entry => entry.kind === 'gap').length, 1); assert.ok(segment.bytes.every(value => value === 0));
});

test('concurrent close calls join one drain and close the dedicated store once', async t => {
  const f = fixture(t); f.start();
  let release;
  const draining = new Promise(resolve => { release = resolve; });
  f.voice.stop = async () => draining;
  const first = f.runtime.close(), second = f.runtime.close();
  assert.equal(first, second);
  assert.equal(f.calls.close, 0);
  release(); await Promise.all([first, second]);
  assert.equal(f.calls.close, 1);
  assert.throws(() => f.store.db.prepare('SELECT 1'), /closed|not open/i);
  assert.equal(f.calls.client, 0);
});
