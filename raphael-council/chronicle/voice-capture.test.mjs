import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { ChronicleStore } from './store.mjs';
import { runtimeFixture } from './speech-context.fixture.mjs';

// These fixtures never connect Discord, decode real audio, or invoke a model.
if (process.env.RAPHAEL_VOICE_CAPTURE_TEST_CHILD !== '1') {
  test('scoped voice capture fixtures execute through isolated receiver and decoder modules', () => {
    const env = { ...process.env, RAPHAEL_VOICE_CAPTURE_TEST_CHILD: '1' }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { env, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# tests 8\b/);
  });
} else {
  let join, lastDecoder;
  function createdDecoder(decoder) { lastDecoder = decoder; }
  class Decoder extends EventEmitter { constructor() { super(); createdDecoder(this); } destroy() { this.destroyed = true; } }
  mock.module('prism-media', { defaultExport: { opus: { Decoder } } });
  mock.module('@discordjs/voice', { namedExports: {
    joinVoiceChannel: (...args) => join(...args), entersState: async connection => connection,
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected' }, EndBehaviorType: { AfterSilence: 1 },
  } });
  const { createVoiceCapture } = await import('./voice.mjs');
  const player = '222222222222222222', host = '111111111111111111';
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  function fixture(t, options = {}) {
    const store = new ChronicleStore(':memory:');
    const session = store.start({ campaign: 'voice-fixture', title: 'Capture', mode: 'human', host, channel: 'journal', sourceChannel: 'play', requestId: 'start' });
    store.consent(session.id, player, true);
    const channel = { id: 'voice', type: 2, name: 'Voice', members: new Map() };
    const member = (id, roles) => ({ id, displayName: id === host ? 'GM' : 'Maren', user: { id, bot: false }, voice: { channel, channelId: channel.id }, roles: { cache: new Set(roles) }, permissions: { has: () => false } });
    const hostMember = member(host, ['dm']), playerMember = member(player, ['players']); channel.members.set(player, playerMember);
    const guild = { id: 'guild', members: { fetch: async ({ user }) => user === host ? hostMember : playerMember }, voiceAdapterCreator: () => {} };
    const calls = [], gaps = []; let joins = 0, runtime = runtimeFixture();
    const conn = Object.assign(new EventEmitter(), { state: { status: 'ready' }, receiver: { speaking: new EventEmitter(), subscribe: () => Object.assign(new EventEmitter(), { pipe: decoder => decoder, destroy() { this.destroyed = true; } }) }, destroy() { this.destroyed = true; } });
    join = () => { joins++; return conn; };
    const service = { gap: (_id, text) => gaps.push(text), speech: async (id, segment) => { calls.push({ id, segment }); try { await options.speech?.(id, segment); } finally { segment.bytes.fill(0); } } };
    const voice = createVoiceCapture({ client: { guilds: { fetch: async () => guild } }, config: { guildId: 'guild', dmIds: [], dmRoleId: 'dm', playerIds: [], playerRoleId: 'players' }, store, service,
      authorizeParticipant: options.missingAuthority ? undefined : scope => options.authorizeParticipant ? options.authorizeParticipant(scope) : true,
      captureRuntime: options.missingAuthority ? undefined : async (...args) => options.captureRuntime ? options.captureRuntime(...args) : runtime });
    t.after(async () => { await voice.stop(); store.close(); });
    const speak = async () => { conn.receiver.speaking.emit('start', player); const decoder = lastDecoder; await flush(); return decoder; };
    return { store, session, voice, conn, calls, gaps, playerMember, speak, get joins() { return joins; }, get runtime() { return runtime; }, set runtime(value) { runtime = value; } };
  }

  test('missing participant/runtime authority fails before joining voice', async t => {
    const f = fixture(t, { missingAuthority: true });
    await assert.rejects(f.voice.start(f.session.id, host), /membership and Obus host authority/); assert.equal(f.joins, 0);
  });

  test('audio received before participant authority resolves is discarded with an explicit gap', async t => {
    const allow = deferred();
    const f = fixture(t, { authorizeParticipant: () => allow.promise }); await f.voice.start(f.session.id, host);
    f.conn.receiver.speaking.emit('start', player); const decoder = lastDecoder, early = Buffer.alloc(20000, 8);
    decoder.emit('data', early); assert.ok(early.every(value => value === 0)); assert.equal(f.calls.length, 0); assert.equal(f.gaps.length, 1);
    allow.resolve(true); await flush(); const bytes = Buffer.alloc(20000, 7); decoder.emit('data', bytes); decoder.emit('end'); await flush();
    assert.equal(f.calls.length, 1); assert.ok(bytes.every(value => value === 0));
    assert.equal(f.calls[0].segment.context.scope.owner, player); assert.equal(f.calls[0].segment.context.session, f.session.id);
  });

  test('captured segment retains its original runtime while future segments use a refreshed policy revision', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const f = fixture(t); await f.voice.start(f.session.id, host);
    const first = await f.speak(); first.emit('data', Buffer.alloc(20000, 1));
    f.runtime = { ...f.runtime, sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 40000 };
    t.mock.timers.tick(10000); await flush(); first.emit('end'); await flush();
    const second = await f.speak(); second.emit('data', Buffer.alloc(20000, 2)); second.emit('end'); await flush();
    assert.equal(f.calls.length, 2);
    const one = f.calls[0].segment.context, two = f.calls[1].segment.context;
    assert.equal(one.capturedRuntime.sessionPolicyRevision, 0); assert.equal(two.capturedRuntime.sessionPolicyRevision, 1);
    assert.notEqual(one.requestId, two.requestId); assert.ok(Object.isFrozen(one.capturedRuntime));
  });

  test('host generation replacement stops voice and discards a buffered segment', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const f = fixture(t); await f.voice.start(f.session.id, host);
    const decoder = await f.speak(), bytes = Buffer.alloc(20000, 2); decoder.emit('data', bytes);
    f.runtime = { ...f.runtime, generation: '33333333-3333-4333-8333-333333333333' };
    t.mock.timers.tick(10000); await flush();
    assert.equal(f.voice.status(), 'disconnected'); assert.equal(f.calls.length, 0); assert.ok(bytes.every(value => value === 0));
    assert.ok(f.gaps.some(text => text.includes('host authority changed')));
  });

  test('withdrawal and regrant during upload authorization cannot reuse the captured consent epoch', async t => {
    const entered = deferred(), release = deferred(); let checks = 0;
    const f = fixture(t, { authorizeParticipant: () => { if (++checks === 2) { entered.resolve(); return release.promise; } return true; } });
    await f.voice.start(f.session.id, host); const decoder = await f.speak(), bytes = Buffer.alloc(20000, 4);
    decoder.emit('data', bytes); decoder.emit('end'); await entered.promise;
    f.store.consent(f.session.id, player, false); f.store.consent(f.session.id, player, true); release.resolve(true); await flush();
    assert.equal(f.calls.length, 0); assert.ok(bytes.every(value => value === 0));
  });

  test('fresh Discord channel membership is required before uploading a captured utterance', async t => {
    const f = fixture(t); await f.voice.start(f.session.id, host); const decoder = await f.speak(), bytes = Buffer.alloc(20000, 5);
    decoder.emit('data', bytes); f.playerMember.voice.channelId = 'different-channel'; decoder.emit('end'); await flush();
    assert.equal(f.calls.length, 0); assert.ok(bytes.every(value => value === 0));
  });

  test('explicit flush-stop waits for scoped final speech without rebinding its captured identity', async t => {
    const entered = deferred(), release = deferred();
    const f = fixture(t, { speech: async (_id, segment) => { assert.equal(await segment.authorizeParticipant(segment.context.scope), true); entered.resolve(); await release.promise; } });
    await f.voice.start(f.session.id, host); const decoder = await f.speak(); decoder.emit('data', Buffer.alloc(20000, 6));
    let stopped = false; const stopping = f.voice.stop({ flush: true }).then(() => { stopped = true; });
    await entered.promise; assert.equal(stopped, false); assert.equal(f.calls[0].segment.context.session, f.session.id);
    release.resolve(); await stopping; assert.ok(f.calls[0].segment.bytes.every(value => value === 0)); assert.equal(stopped, true);
  });

  test('a stopped voice generation cannot authorize an upload that was waiting on membership', async t => {
    const entered = deferred(), release = deferred(); let checks = 0;
    const f = fixture(t, { authorizeParticipant: () => { if (++checks === 2) { entered.resolve(); return release.promise; } return true; } });
    await f.voice.start(f.session.id, host); const decoder = await f.speak(); decoder.emit('data', Buffer.alloc(20000, 7)); decoder.emit('end'); await entered.promise;
    const stopping = f.voice.stop(); release.resolve(true); await stopping;
    assert.equal(f.calls.length, 0); assert.equal(f.voice.status(), 'disconnected');
  });
}
