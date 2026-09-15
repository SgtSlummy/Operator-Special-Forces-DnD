import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { ChronicleStore } from './store.mjs';
import { createChronicleRuntimeCore } from '../discord/chronicle-core.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const config = { campaignId: 'campaign', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', chronicleDir: tmpdir(), dmIds: ['host'], playerIds: ['player'] };
const command = (id, action) => ({ id, token: 'fixture-token', application_id: 'fixture-app', type: 2, guild_id: 'guild', channel_id: 'chat',
  member: { user: { id: 'host' }, roles: [], permissions: '0' }, data: { name: 'session', options: [{ type: 1, name: action }] } });
const packet = id => ({ t: 'MESSAGE_CREATE', d: { id, guild_id: 'guild', channel_id: 'chat', author: { id: 'player', bot: false }, content: `Accepted ${id}`, timestamp: new Date().toISOString() } });
function fixture(options = {}) {
  const state = { starts: 0, stops: 0, closed: 0, connected: false, replies: [] };
  const store = new ChronicleStore(':memory:'); const close = store.close.bind(store); store.close = () => { state.closed++; close(); };
  const rawVoice = options.voice ?? Object.freeze({
    start() { state.starts++; state.connected = true; },
    stop({ flush } = {}) { assert.equal(flush, true); state.stops++; state.connected = false; return options.stop?.(); },
    status() { return state.connected ? 'connected' : 'disconnected'; }, revoke() {},
  });
  const transport = { respond: async () => {}, edit: async (_app, _token, body) => state.replies.push(body.content), followup: async () => {},
    member: async user => options.member ? options.member(user) : ({ user: { id: user }, roles: [], permissions: '0', nick: user }),
    send: async () => ({ id: 'delivery-receipt' }) };
  const runtime = createChronicleRuntimeCore({ config, store, client: {}, provider: { write: options.write ?? (async () => 'A bounded fixture story.') }, transport, makeVoice: () => rawVoice });
  const session = store.start({ campaign: 'campaign', title: 'Shutdown fixture', mode: 'human', host: 'host', channel: 'journal', sourceChannel: 'chat', requestId: 'start' });
  store.consent(session.id, 'player', true);
  return { runtime, store, session, state, rawVoice };
}

test('capture seals immediately, shares its drain, and preserves an active store until final close', async () => {
  const drain = deferred(); const f = fixture({ stop: () => drain.promise });
  await f.runtime.voice.start();
  const first = f.runtime.stopCapture(), second = f.runtime.stopCapture();
  assert.equal(first, second); assert.equal(f.state.connected, false); assert.equal(f.state.stops, 1);
  await assert.rejects(f.runtime.voice.start(), /capture is stopping/); assert.equal(f.state.starts, 1);
  assert.equal(f.store.get(f.session.id).status, 'active'); assert.equal(f.state.closed, 0);
  drain.resolve(); await first; assert.equal(f.runtime.stopCapture(), first);
  await f.runtime.close(); assert.equal(f.state.closed, 1); assert.equal(f.state.stops, 2);
});

test('frozen class adapters retain private-field method bindings without mutating their start method', async () => {
  class OwnedVoice {
    #active = false;
    start() { this.#active = true; }
    stop() { this.#active = false; }
    status() { return this.#active; }
  }
  const raw = Object.freeze(new OwnedVoice()), originalStart = raw.start; const f = fixture({ voice: raw });
  await f.runtime.voice.start(); assert.equal(f.runtime.voice.status(), true);
  await f.runtime.stopCapture(); assert.equal(f.runtime.voice.status(), false);
  assert.equal(raw.start, originalStart); assert.ok(Object.isFrozen(raw));
  await assert.rejects(f.runtime.voice.start(), /capture is stopping/); await f.runtime.close();
});

test('accepted packets waiting on membership and queued behind another packet still commit after capture stops', async () => {
  const entered = deferred(), release = deferred(); let queries = 0;
  const f = fixture({ member: async user => { if (++queries === 1) { entered.resolve(); await release.promise; } return { user: { id: user }, roles: [], permissions: '0' }; } });
  const one = f.runtime.packet(packet('one')); await entered.promise;
  const two = one.then(() => f.runtime.packet(packet('two')));
  await f.runtime.stopCapture(); assert.equal(f.store.get(f.session.id).status, 'active'); assert.equal(f.state.closed, 0);
  release.resolve(); await Promise.all([one, two]);
  assert.ok(f.store.find(f.session.id, 'discord:one')); assert.ok(f.store.find(f.session.id, 'discord:two'));
  await f.runtime.close(); assert.equal(f.state.closed, 1);
});

test('a voice command accepted behind a slow story command cannot restart capture during the drain', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ write: async () => { entered.resolve(); await release.promise; return 'The lantern reveals the safe harbor entrance.'; } });
  f.runtime.service.scene(f.session.id, { title: 'Harbor', text: 'A lantern marks the pier.', requestId: 'scene' });
  const story = f.runtime.handle(command('cue', 'cue')); await entered.promise;
  const voice = f.runtime.handle(command('voice', 'voice'));
  await f.runtime.stopCapture(); assert.equal(f.state.stops, 1); assert.equal(f.state.starts, 0); assert.equal(f.state.closed, 0);
  release.resolve(); await Promise.all([story, voice]);
  assert.equal(f.state.starts, 0); assert.ok(f.state.replies.some(text => text.includes('capture is stopping')));
  assert.equal(f.store.get(f.session.id).status, 'active'); await f.runtime.close();
});

test('direct core close seals capture before waiting on an already accepted story command', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ write: async () => { entered.resolve(); await release.promise; return 'A safe fixture narration remains in the story.'; } });
  f.runtime.service.scene(f.session.id, { title: 'Harbor', text: 'A lantern marks the pier.', requestId: 'scene' });
  await f.runtime.voice.start(); const story = f.runtime.handle(command('cue-close', 'cue')); await entered.promise;
  const closing = f.runtime.close();
  assert.equal(f.state.connected, false); assert.equal(f.state.stops, 1); assert.equal(f.state.closed, 0);
  await assert.rejects(f.runtime.voice.start(), /capture is stopping/);
  release.resolve(); await story; await closing; assert.equal(f.state.closed, 1);
});

test('failed capture detachment remains sealed and retryable without pausing or closing accepted-message storage', async () => {
  let fail = true; const f = fixture({ stop: () => { if (fail) throw new Error('controlled detach failure'); } });
  const first = f.runtime.stopCapture(); await assert.rejects(first, /controlled detach failure/);
  assert.equal(f.state.closed, 0); assert.equal(f.store.get(f.session.id).status, 'active');
  await assert.rejects(f.runtime.voice.start(), /capture is stopping/);
  await f.runtime.packet(packet('after-failure')); assert.ok(f.store.find(f.session.id, 'discord:after-failure'));
  fail = false; const second = f.runtime.stopCapture(); assert.notEqual(second, first); await second;
  assert.equal(f.state.stops, 2); assert.equal(f.state.starts, 0); await f.runtime.close(); assert.equal(f.state.closed, 1);
});
