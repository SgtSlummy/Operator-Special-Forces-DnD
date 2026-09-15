import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createVoiceReceiver, MAX_VOICE_STREAMS, MAX_VOICE_PENDING, MAX_VOICE_PCM_BYTES } from './voice-receiver.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(setImmediate); } assert.fail('Controlled voice boundary was not reached.'); }
function fixture(overrides = {}) {
  const state = { opens: 0, releases: 0, decodes: 0, subscriptions: [], decoders: [], calls: [], gaps: [], notes: [], capture: true, epoch: 3, member: true };
  const channel = { id: 'voice', name: 'Campaign', type: 2, guildId: 'guild' };
  const session = { campaign: 'camp', status: 'active', scene: { seq: 7 } };
  const member = user => ({ id: user, displayName: `Speaker ${user}`, user: { bot: false }, voice: { channel, channelId: channel.id }, roles: { cache: new Set() } });
  const guild = { id: 'guild', voiceAdapterCreator: {}, members: { fetch: async ({ user }) => member(user) } };
  const runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: 'boot', generation: 'generation', sessionPolicyRevision: 4, leaseExpiresAtMs: Date.now() + 60000 };
  const listeners = new Set();
  const lease = {
    active: true,
    async subscribe(user, { authorize }) { assert.equal(await authorize(), true); const stream = new PassThrough(); state.subscriptions.push({ user, stream }); return stream; },
    onSpeaking(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    release() { state.releases++; lease.active = false; listeners.clear(); },
  };
  const options = {
    client: { guilds: { fetch: async () => guild } },
    config: { guildId: 'guild', dmIds: ['host'], playerIds: Array.from({ length: 40 }, (_, i) => `p${i}`) },
    store: { get: () => session, hasConsent: () => state.capture, privacy: () => ({ captureEpoch: state.epoch }), transaction: fn => fn(), append: (...args) => state.notes.push(args) },
    service: { gap: (...args) => state.gaps.push(args), speech: async (id, request) => state.calls.push({ id, request, pcm: Buffer.from(request.bytes.subarray(44)) }) },
    authorizeParticipant: async () => state.member,
    captureRuntime: async () => runtime,
    createDecoder: async () => { state.decodes++; const decoder = new PassThrough(); state.decoders.push(decoder); return decoder; },
    openConnection: async ({ authorize }) => { assert.equal(await authorize(), true); state.opens++; return lease; },
    ...overrides,
  };
  const receiver = createVoiceReceiver(options);
  const speak = async (user = 'p0') => { const count = state.subscriptions.length; for (const listener of listeners) listener(user); await until(() => state.subscriptions.length > count); await new Promise(setImmediate); return state.decoders.at(-1); };
  return { state, channel, guild, session, runtime, lease, options, receiver, listeners, speak };
}

test('constructing the portable receiver is inert', () => {
  const f = fixture(); assert.equal(f.receiver.status(), 'disconnected');
  assert.equal(f.state.opens, 0); assert.equal(f.state.decodes, 0); assert.equal(f.listeners.size, 0);
});

test('authorized speech uses frozen account, consent, scene and runtime context and wipes bytes after processing', async () => {
  const f = fixture(); await f.receiver.start('session', 'host');
  try {
    const decoder = await f.speak(); const pcm = Buffer.alloc(19200, 5); decoder.emit('data', pcm);
    f.runtime.sessionPolicyRevision = 9; f.session.scene.seq = 12;
    decoder.emit('end'); await until(() => f.state.calls.length === 1); await new Promise(setImmediate);
    const { id, request, pcm: copy } = f.state.calls[0];
    assert.equal(id, 'session'); assert.equal(request.user, 'p0'); assert.equal(request.speaker, 'Speaker p0'); assert.equal(request.scene, 7);
    assert.deepEqual(request.context.scope, { campaign: 'camp', owner: 'p0', role: 'player' });
    assert.equal(request.context.capturedRuntime.sessionPolicyRevision, 4); assert.equal(request.context.capturedConsentEpoch, 3);
    assert.ok(Object.isFrozen(request.context)); assert.ok(Object.isFrozen(request.context.scope)); assert.ok(Object.isFrozen(request.context.capturedRuntime));
    assert.equal(copy[0], 5); assert.ok(pcm.every(x => x === 0)); assert.ok(request.bytes.every(x => x === 0));
  } finally { await f.receiver.stop(); }
});

test('capture consent and fresh campaign membership are required before decoder/subscription', async () => {
  const f = fixture(); await f.receiver.start('session', 'host');
  try {
    f.state.capture = false; for (const listener of f.listeners) listener('p0');
    await new Promise(setImmediate); assert.equal(f.state.decodes, 0);
    f.state.capture = true; f.state.member = false; for (const listener of f.listeners) listener('p0');
    await new Promise(setImmediate); assert.equal(f.state.decodes, 0); assert.equal(f.state.subscriptions.length, 0);
  } finally { await f.receiver.stop(); }
});

test('consent withdrawal during decoder initialization prevents subscription and destroys decoder', async () => {
  const gate = deferred(), entered = deferred(), decoder = new PassThrough();
  const f = fixture({ createDecoder: async () => { entered.resolve(); await gate.promise; return decoder; } });
  await f.receiver.start('session', 'host'); for (const listener of f.listeners) listener('p0'); await entered.promise;
  f.state.capture = false; f.state.epoch++; f.receiver.revoke('p0'); gate.resolve();
  await f.receiver.stop(); assert.equal(f.state.subscriptions.length, 0); assert.equal(decoder.destroyed, true);
});

test('a subscription resolving after stop is destroyed before stop finishes', async () => {
  const f = fixture(), entered = deferred(), gate = deferred(), late = new PassThrough();
  f.lease.subscribe = async () => { entered.resolve(); await gate.promise; return late; };
  await f.receiver.start('session', 'host'); for (const listener of f.listeners) listener('p0'); await entered.promise;
  const stopping = f.receiver.stop(); gate.resolve(); await stopping;
  assert.equal(late.destroyed, true); assert.equal(f.state.decoders[0].destroyed, true); assert.equal(f.state.calls.length, 0);
});

test('stop with flush detaches capture first and waits for the transcription drain', async () => {
  const f = fixture(), entered = deferred(), gate = deferred(); let finished = false, bytes;
  f.options.service.speech = async (_id, request) => { bytes = request.bytes; entered.resolve(); await gate.promise; };
  await f.receiver.start('session', 'host'); const decoder = await f.speak(); decoder.emit('data', Buffer.alloc(19200, 8));
  const stopping = f.receiver.stop({ flush: true }).then(() => { finished = true; });
  await entered.promise; assert.equal(f.lease.active, false); assert.equal(f.listeners.size, 0); assert.equal(finished, false);
  gate.resolve(); await stopping; assert.ok(bytes.every(x => x === 0));
});

test('stop without flush erases captured PCM without dispatching speech', async () => {
  const f = fixture(); await f.receiver.start('session', 'host'); const decoder = await f.speak();
  const pcm = Buffer.alloc(19200, 9); decoder.emit('data', pcm); await f.receiver.stop();
  assert.equal(f.state.calls.length, 0); assert.ok(pcm.every(x => x === 0)); assert.equal(decoder.destroyed, true);
});

test('simultaneous decoder initialization is bounded before any asynchronous work', async () => {
  const gate = deferred(); const f = fixture({ createDecoder: async () => { f.state.decodes++; await gate.promise; return new PassThrough(); } });
  await f.receiver.start('session', 'host');
  for (let i = 0; i < 40; i++) for (const listener of f.listeners) listener(`p${i}`);
  await until(() => f.state.decodes === MAX_VOICE_STREAMS);
  assert.equal(f.state.decodes, MAX_VOICE_STREAMS); assert.equal(f.state.gaps.length, 1);
  const stopping = f.receiver.stop(); gate.resolve(); await stopping;
});

test('queued transcription jobs remain bounded and excess capture is reported', async () => {
  const f = fixture(), gate = deferred(); let jobs = 0;
  f.options.service.speech = async () => { jobs++; await gate.promise; };
  await f.receiver.start('session', 'host');
  try {
    for (let i = 0; i < MAX_VOICE_PENDING; i++) {
      const decoder = await f.speak(); decoder.emit('data', Buffer.alloc(19200, 1)); decoder.emit('end'); await until(() => jobs === i + 1);
    }
    for (const listener of f.listeners) listener('p0'); await new Promise(setImmediate);
    assert.equal(f.state.subscriptions.length, MAX_VOICE_PENDING); assert.equal(jobs, MAX_VOICE_PENDING);
    assert.ok(f.state.gaps.some(([, text]) => text.includes('queue full')));
  } finally { gate.resolve(); await f.receiver.stop(); }
});

test('oversized frames are zeroed and their stream closed without transcription', async () => {
  const f = fixture(); await f.receiver.start('session', 'host'); const decoder = await f.speak();
  const pcm = Buffer.alloc(MAX_VOICE_PCM_BYTES + 1, 3); decoder.emit('data', pcm); await f.receiver.stop();
  assert.ok(pcm.every(x => x === 0)); assert.equal(f.state.calls.length, 0); assert.equal(decoder.destroyed, true);
});

test('changed consent epochs and current campaign authorization prevent buffered dispatch', async () => {
  for (const revoke of [f => { f.state.epoch++; }, f => { f.state.member = false; }]) {
    const f = fixture(); await f.receiver.start('session', 'host'); const decoder = await f.speak();
    const pcm = Buffer.alloc(19200, 6); decoder.emit('data', pcm); revoke(f); await f.receiver.stop({ flush: true });
    assert.equal(f.state.calls.length, 0); assert.ok(pcm.every(x => x === 0));
  }
});

test('failed lease release is retained so a later close retries it', async () => {
  const f = fixture(); let attempts = 0;
  f.lease.release = () => { if (++attempts === 1) throw new Error('controlled detach failure'); f.lease.active = false; };
  await f.receiver.start('session', 'host'); await assert.rejects(f.receiver.stop(), /did not detach/);
  await f.receiver.stop(); assert.equal(attempts, 2); assert.equal(f.receiver.status(), 'disconnected');
});

test('listener or durable connection-note failures release the acquired lease', async () => {
  for (const boundary of ['listener', 'note']) {
    const f = fixture();
    if (boundary === 'listener') f.lease.onSpeaking = () => { throw new Error('listener failed'); };
    else f.options.store.append = () => { throw new Error('note failed'); };
    await assert.rejects(f.receiver.start('session', 'host'), /failed/);
    assert.equal(f.lease.active, false); assert.equal(f.listeners.size, 0);
    assert.equal(f.receiver.status(), 'disconnected'); await f.receiver.stop();
  }
});

test('failed cleanup after startup rejection remains retryable', async () => {
  const f = fixture(); let releases = 0;
  const receiver = createVoiceReceiver({ ...f.options, openConnection: async () => ({
    release() { if (++releases === 1) throw new Error('controlled release failure'); },
  }) });
  await assert.rejects(receiver.start('session', 'host'), /did not detach/);
  await receiver.stop(); assert.equal(releases, 2);
});

test('late start authorization denial releases even an incomplete lease', async () => {
  const f = fixture(); let releases = 0;
  f.options.openConnection = undefined;
  const receiver = createVoiceReceiver({ ...f.options, openConnection: async () => ({ release: () => { releases++; } }) });
  await assert.rejects(receiver.start('session', 'host'), /unavailable/);
  assert.equal(releases, 1); await receiver.stop();
});
