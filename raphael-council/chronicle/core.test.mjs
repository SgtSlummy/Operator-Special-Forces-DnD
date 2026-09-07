import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { ChronicleStore } from './store.mjs';
import { createChronicleRuntimeCore } from '../discord/chronicle-core.mjs';

const config = { campaignId: 'campaign', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', chronicleDir: tmpdir(), dmIds: ['host'], playerIds: [] };

test('portable core requires explicit dependencies before touching host runtime state', () => {
  let touched = false;
  assert.throws(() => createChronicleRuntimeCore({ config, store: { db: {}, close() {}, all() { touched = true; return []; } } }), /explicitly/);
  assert.equal(touched, false);
});

test('a failed initial voice stop cannot skip later cleanup or expose raw errors', async () => {
  const store = new ChronicleStore(':memory:'); let stopCalls = 0, closed = 0;
  const close = store.close.bind(store); store.close = () => { closed++; close(); };
  const runtime = createChronicleRuntimeCore({ config, store, client: {}, provider: { write: async () => 'Obus fixture.' }, transport: {},
    log() { throw new Error('Logging also unavailable.'); },
    makeVoice: () => ({ start: async () => {}, stop: async () => { if (++stopCalls === 1) throw new Error('secret-token must not escape'); } }) });
  await assert.rejects(runtime.close(), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.doesNotMatch(JSON.stringify(error.errors.map(value => value.message)), /secret-token/);
    return true;
  });
  assert.equal(stopCalls, 2); assert.equal(closed, 1);
});

test('failed capture detachment retains storage and permits a later explicit shutdown retry', async () => {
  const store = new ChronicleStore(':memory:'); let fail = true, closed = 0;
  const close = store.close.bind(store); store.close = () => { closed++; close(); };
  const runtime = createChronicleRuntimeCore({ config, store, client: {}, provider: { write: async () => 'Obus fixture.' },
    transport: { send: async () => ({ id: 'receipt' }) },
    makeVoice: () => ({ start: async () => {}, stop: async () => { if (fail) throw new Error('capture still owns pending work'); } }) });
  const session = store.start({ campaign: 'campaign', title: 'Story', mode: 'human', host: 'host', channel: 'journal', sourceChannel: 'chat', requestId: 'start' });
  const first = runtime.close(); await assert.rejects(first, /did not finish cleanly/);
  assert.equal(closed, 0); assert.equal(store.get(session.id).status, 'paused');
  assert.equal(runtime.handle({ type: 2, data: { name: 'session' } }), false);
  fail = false;
  const second = runtime.close(); assert.notEqual(second, first); await second;
  assert.equal(closed, 1);
});

test('concurrent shutdown joins the same capture drain and closes the dedicated store exactly once', async () => {
  const store = new ChronicleStore(':memory:'); let resolveStop, stopCalls = 0, closeCalls = 0, factoryClient;
  const blocked = new Promise(resolve => { resolveStop = resolve; });
  const close = store.close.bind(store); store.close = () => { closeCalls++; close(); };
  const client = { login() { throw new Error('A portable runtime must not log in another client.'); }, destroy() { throw new Error('The gateway owns this client.'); } };
  const runtime = createChronicleRuntimeCore({ config, store, client, provider: { write: async () => 'Obus fixture.' }, transport: {},
    makeVoice: context => { factoryClient = context.client; return { start: async () => {}, stop: async () => { if (++stopCalls === 1) await blocked; } }; } });
  assert.equal(factoryClient, client);
  const first = runtime.close(), second = runtime.close();
  assert.equal(first, second);
  let settled = false; second.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(closeCalls, 0);
  assert.equal(runtime.handle({ type: 2, data: { name: 'session' } }), false);
  resolveStop(); await Promise.all([first, second]);
  assert.equal(closeCalls, 1); assert.equal(stopCalls, 2);
  assert.equal(runtime.close(), first);
});
