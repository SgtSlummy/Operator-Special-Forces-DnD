import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { ChronicleStore } from './store.mjs';
import { runtimeFixture } from './speech-context.fixture.mjs';

// Isolate the experimental module mock flag in this test process. No Discord
// connection, decoder, account, or local speech provider is used by these tests.
if (process.env.RAPHAEL_VOICE_START_TEST_CHILD !== '1') {
  test('voice start lifecycle regression fixtures pass with an isolated Discord transport', () => {
    const env = { ...process.env, RAPHAEL_VOICE_START_TEST_CHILD: '1' };
    // The parent's internal runner marker would suppress the nested test run.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], {
      env, encoding: 'utf8', timeout: 20000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# tests 8\b/, 'All eight transport fixtures must actually execute.');
  });
} else {
  let join, ready;
  mock.module('@discordjs/voice', { namedExports: {
    joinVoiceChannel: (...args) => join(...args), entersState: (...args) => ready(...args),
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected' }, EndBehaviorType: { AfterSilence: 1 },
  } });
  const { createVoiceCapture } = await import('./voice.mjs');
  const config = { campaignId: 'voice-campaign', guildId: 'guild', channelId: 'play', journalChannelId: 'journal', dmIds: [], dmRoleId: 'dm', playerIds: [], playerRoleId: 'players' };
  function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
  function fixture(t) {
    const store = new ChronicleStore(':memory:');
    const session = store.start({ campaign: config.campaignId, title: 'Voice lifecycle', mode: 'human', minutes: 10, host: 'host', channel: config.journalChannelId, sourceChannel: config.channelId, requestId: 'start' });
    const channel = { id: 'voice', type: 2, name: 'Voice', members: new Map() };
    const member = { id: 'host', user: { id: 'host', bot: false }, voice: { channel }, roles: { cache: new Set(['dm']) }, permissions: { has: () => false } };
    let fetchMember = async () => member, joins = 0, destroys = 0;
    const conn = Object.assign(new EventEmitter(), { state: { status: 'ready' }, receiver: { speaking: new EventEmitter() }, destroy: () => { destroys++; } });
    join = () => { joins++; return conn; }; ready = async () => conn;
    const guild = { id: config.guildId, members: { fetch: (...args) => fetchMember(...args) }, voiceAdapterCreator: () => {} };
    const voice = createVoiceCapture({ client: { guilds: { fetch: async () => guild } }, config, store, authorizeParticipant: async () => true, captureRuntime: async () => runtimeFixture(), service: { gap: () => {} } });
    t.after(async () => { await voice.stop(); store.close(); });
    return { store, session, voice, member, conn, get joins() { return joins; }, get destroys() { return destroys; }, set fetchMember(fn) { fetchMember = fn; } };
  }

  test('stopping during current-member lookup cancels voice before joining', async t => {
    const f = fixture(t), entered = deferred(), member = deferred();
    f.fetchMember = () => { entered.resolve(); return member.promise; };
    const starting = f.voice.start(f.session.id, 'host');
    await entered.promise; await f.voice.stop(); member.resolve(f.member);
    await assert.rejects(starting, /cancelled or GM access changed/);
    assert.equal(f.joins, 0); assert.equal(f.voice.status(), 'disconnected');
  });

  test('pausing during member lookup prevents a late voice connection', async t => {
    const f = fixture(t), entered = deferred(), member = deferred();
    f.fetchMember = () => { entered.resolve(); return member.promise; };
    const starting = f.voice.start(f.session.id, 'host');
    await entered.promise; f.store.control(f.session.id, 'pause', 'pause'); member.resolve(f.member);
    await assert.rejects(starting, /cancelled or GM access changed/);
    assert.equal(f.joins, 0); assert.equal(f.voice.status(), 'disconnected');
  });

  test('fresh Discord membership must still grant the requesting host a GM role', async t => {
    const f = fixture(t); f.member.roles.cache.clear();
    await assert.rejects(f.voice.start(f.session.id, 'host'), /cancelled or GM access changed/);
    assert.equal(f.joins, 0);
  });

  test('a denied game authorization prevents any voice join', async t => {
    const f = fixture(t);
    await assert.rejects(f.voice.start(f.session.id, 'host', { authorize: async () => false }), /cancelled or GM access changed/);
    assert.equal(f.joins, 0);
  });

  test('stop during Discord readiness destroys the cancelled connection', async t => {
    const f = fixture(t), entered = deferred(), connected = deferred();
    ready = () => { entered.resolve(); return connected.promise; };
    const starting = f.voice.start(f.session.id, 'host');
    await entered.promise; await f.voice.stop(); connected.resolve(f.conn);
    await assert.rejects(starting, /cancelled or GM access changed/);
    assert.equal(f.voice.status(), 'disconnected'); assert.ok(f.destroys >= 1);
    assert.equal(f.store.entries(f.session.id).some(e => e.text.startsWith('Voice scribe connected')), false);
  });

  test('authorization withdrawn while Discord connects closes the joined connection', async t => {
    const f = fixture(t), entered = deferred(), connected = deferred(); let authorized = true;
    ready = () => { entered.resolve(); return connected.promise; };
    const starting = f.voice.start(f.session.id, 'host', { authorize: async () => authorized });
    await entered.promise; authorized = false; connected.resolve(f.conn);
    await assert.rejects(starting, /cancelled or GM access changed/);
    assert.equal(f.joins, 1);
    assert.equal(f.voice.status(), 'disconnected'); assert.ok(f.destroys >= 1);
  });

  test('an authorization lookup failure after joining also closes voice', async t => {
    const f = fixture(t), entered = deferred(), connected = deferred(); let unavailable = false;
    ready = () => { entered.resolve(); return connected.promise; };
    const starting = f.voice.start(f.session.id, 'host', { authorize: async () => { if (unavailable) throw new Error('Membership lookup unavailable'); return true; } });
    await entered.promise; unavailable = true; connected.resolve(f.conn);
    await assert.rejects(starting, /Membership lookup unavailable|cancelled or GM access changed/);
    assert.equal(f.joins, 1); assert.equal(f.voice.status(), 'disconnected'); assert.ok(f.destroys >= 1);
  });

  test('an authorized connection is recorded only after both authorization checks succeed', async t => {
    const f = fixture(t); let checks = 0;
    await f.voice.start(f.session.id, 'host', { authorize: async () => { checks++; return true; } });
    assert.ok(checks >= 3); assert.equal(f.joins, 1); assert.equal(f.voice.status(), 'connected (ready)');
    assert.equal(f.store.entries(f.session.id).filter(e => e.text.startsWith('Voice scribe connected')).length, 1);
  });
}
