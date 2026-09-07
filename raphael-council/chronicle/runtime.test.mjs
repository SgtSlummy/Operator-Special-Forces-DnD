import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChronicleStore } from './store.mjs';
import { speechFixture, runtimeFixture } from './speech-context.fixture.mjs';
import { createChronicleRuntime, registerSessionCommand } from '../discord/chronicle-runtime.mjs';
import { createLaunchHandler, registerLaunchCommand } from '../discord/launch-adapter.mjs';
import { readConfig } from '../discord/bot.mjs';

const host = '100000000000000001', player = '100000000000000002', other = '100000000000000003';
const base = { guildId: '200000000000000001', channelId: '300000000000000001', journalChannelId: '300000000000000002', campaignId: 'fixture', dmIds: [host], dmRoleId: null, playerIds: [host, player, other], playerRoleId: null, publicOrigin: 'https://game.example' };
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'obus-chronicle-'));
  const config = { ...base, chronicleDir: dir };
  const store = new ChronicleStore(join(dir, 'chronicle.sqlite'));
  const output = [], writes = [], order = [];
  const transport = {
    respond: async (_id, _token, body) => output.push(body), edit: async (_id, _token, body) => output.push(body), followup: async () => {},
    member: async user => ({ user: { id: user }, roles: [] }),
    send: async (_channel, payload) => { output.push(payload); return { id: `message-${output.length}` }; },
  };
  const provider = { captureRuntime: async () => runtimeFixture(), authorizeParticipant: async () => true, write: async (kind, evidence, context) => { writes.push({ kind, evidence, context }); return 'A saved story based on the supplied evidence.'; }, transcribe: async () => 'A voice line.', ...overrides.provider };
  const voice = { stop: async () => { order.push('voice-stopped'); }, revoke: user => order.push(`revoke:${user}`), status: () => 'fixture', start: async () => {}, ...overrides.voice };
  const runtime = createChronicleRuntime({ client: {}, config, store, transport, provider, images: {}, makeVoice: () => voice });
  const session = store.start({ campaign: config.campaignId, title: 'Harbor', mode: 'human', host, channel: config.journalChannelId, sourceChannel: config.channelId, requestId: 'start' });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await runtime.close(); } };
  t.after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
  const interaction = (action, user = host, values = {}) => ({ type: 2, id: `${action}:${output.length}`, token: 'fixture', application_id: 'app', guild_id: config.guildId, channel_id: config.channelId,
    member: { user: { id: user, username: user }, roles: [] }, data: { name: 'session', options: [{ name: action, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } });
  const message = (id, user = player, content = 'A harbor bell rings.') => ({ t: 'MESSAGE_CREATE', d: { id, author: { id: user, username: user }, guild_id: config.guildId, channel_id: config.channelId, content, timestamp: new Date().toISOString() } });
  return { runtime, store, config, session, interaction, message, close, dir, provider, voice, writes, order, output, transport };
}

test('gateway records only opted-in campaign members and preserves speaker IDs and duplicate receipts', async t => {
  const f = fixture(t);
  await f.runtime.packet(f.message('before'));
  assert.equal(f.store.evidence(f.session.id).length, 0);
  await f.runtime.handle(f.interaction('consent', player, { enabled: true }));
  await f.runtime.packet(f.message('m1'));
  await f.runtime.packet(f.message('m1'));
  await f.runtime.packet(f.message('other', other));
  const foreign = f.message('foreign'); foreign.d.guild_id = 'elsewhere'; await f.runtime.packet(foreign);
  const evidence = f.store.evidence(f.session.id);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].user, player);
  await f.runtime.handle(f.interaction('consent', player, { enabled: false }));
  await f.runtime.packet(f.message('after'));
  assert.equal(f.store.evidence(f.session.id).length, 1);
  assert.ok(f.order.includes(`revoke:${player}`));
});

test('consent withdrawal discards in-flight speech output and clears raw bytes', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const transcription = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { provider: { transcribe: () => { entered(); return transcription; } } });
  f.store.consent(f.session.id, player, true);
  const bytes = Buffer.alloc(100, 7);
  const task = f.runtime.service.speech(f.session.id, { user: player, speaker: 'Player', bytes, ...speechFixture(f.store, f.session.id, player, 'test') });
  await started;
  f.store.consent(f.session.id, player, false);
  release('This must not be recorded.');
  await task;
  assert.equal(f.store.find(f.session.id, 'voice:test'), null);
  assert.ok(bytes.every(byte => byte === 0));
});

test('Discord edits replace active evidence, deletes exclude it, unrelated edits never create capture', async t => {
  const f = fixture(t); f.store.consent(f.session.id, player, true);
  await f.runtime.packet(f.message('m1', player, 'Old text'));
  const change = (type, id, content) => ({ t: type, d: { guild_id: base.guildId, channel_id: base.channelId, id, content, edited_timestamp: '2026-09-06T18:00:00Z' } });
  await f.runtime.packet(change('MESSAGE_UPDATE', 'uncaptured', 'Private text'));
  await f.runtime.packet(change('MESSAGE_UPDATE', 'm1', 'Corrected text'));
  assert.deepEqual(f.store.evidence(f.session.id).map(e => e.text), ['Corrected text']);
  await f.runtime.packet(change('MESSAGE_DELETE', 'm1'));
  assert.equal(f.store.evidence(f.session.id).length, 0);
  assert.equal(f.store.find(f.session.id, 'discord:m1').text, 'Old text');
});

test('gateway reconnect gap pauses capture and survives host restart', async t => {
  const f = fixture(t); f.store.consent(f.session.id, player, true);
  await f.runtime.gap();
  await f.runtime.packet(f.message('during-gap'));
  assert.equal(f.store.get(f.session.id).status, 'paused');
  assert.equal(f.store.evidence(f.session.id).length, 0);
  await f.close();
  const restored = new ChronicleStore(join(f.dir, 'chronicle.sqlite'));
  try { assert.equal(restored.get(f.session.id).status, 'paused'); assert.ok(restored.entries(f.session.id).some(e => e.kind === 'gap')); }
  finally { restored.close(); }
});

test('end waits for final voice work before recap and all story prompts remain local-only', async t => {
  let release;
  const tail = new Promise(resolve => { release = resolve; });
  const f = fixture(t);
  f.store.consent(f.session.id, player, true);
  f.voice.stop = async ({ flush } = {}) => {
    if (!flush) return;
    await tail;
    f.store.record(f.session.id, 'tail', { user: player, speaker: 'Player', text: 'The final harbor bell.' });
  };
  const ending = f.runtime.handle(f.interaction('end'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes.length, 0);
  release(); await ending;
  assert.equal(f.store.get(f.session.id).status, 'ended');
  assert.ok(JSON.stringify(f.writes).includes('The final harbor bell.'));
  assert.ok(f.writes.every(w => w.context.campaign === base.campaignId && w.context.session === f.session.id && w.context.exportable === false));
});

test('shutdown stops voice, pauses capture and retains durable delivery receipts', async t => {
  const f = fixture(t);
  await f.runtime.tick();
  const count = f.output.length;
  await f.runtime.tick();
  assert.equal(f.output.length, count);
  await f.close();
  assert.ok(f.order.includes('voice-stopped'));
  const restored = new ChronicleStore(join(f.dir, 'chronicle.sqlite'));
  try { assert.equal(restored.get(f.session.id).status, 'paused'); assert.equal(restored.pending().length, 0); }
  finally { restored.close(); }
});

test('command registration uses individual upserts and refuses unrelated name collisions', async () => {
  const posts = [];
  const client = { application: { id: 'existing-davy-jones' }, rest: { get: async () => [{ name: 'music', type: 1 }], post: async (endpoint, payload) => { posts.push({ endpoint, payload }); } } };
  await registerSessionCommand(client, base); await registerLaunchCommand(client, base);
  assert.deepEqual(posts.map(p => p.payload.body.name), ['session', 'raphael']);
  assert.ok(posts.every(p => p.endpoint.includes('existing-davy-jones')));
  client.rest.get = async () => [{ name: 'session', type: 1, description: 'Unrelated existing command' }];
  await assert.rejects(registerSessionCommand(client, base), /left unchanged/);
  assert.equal(posts.length, 2);
});

test('authorized launch uses Activity callback or public browser URL without access tokens', async t => {
  const f = fixture(t); const handle = createLaunchHandler({ config: f.config, transport: f.transport });
  const i = f.interaction('activity', player); i.data.name = 'raphael';
  await handle(i); assert.equal(f.output.at(-1).type, 12);
  i.data.options[0].name = 'web'; await handle(i);
  assert.equal(f.output.at(-1).data.components[0].components[0].url, 'https://game.example/play');
  i.guild_id = 'wrong'; await handle(i); assert.equal(f.output.at(-1).type, 4);
  assert.equal(f.output.at(-1).data.components, undefined);
});

test('bot config preserves defaults and enables extra capture intents only by explicit host setting', () => {
  const env = { DISCORD_TOKEN: 'fixture', RAPHAEL_GUILD_ID: base.guildId, RAPHAEL_CHANNEL_ID: base.channelId, RAPHAEL_CAMPAIGN_ID: 'fixture', RAPHAEL_PLAYER_IDS: player };
  assert.equal(readConfig(env).chronicleEnabled, false);
  const configured = readConfig({ ...env, RAPHAEL_CHRONICLE_ENABLED: '1', RAPHAEL_DM_IDS: host, RAPHAEL_PUBLIC_ORIGIN: 'https://game.example' });
  assert.equal(configured.chronicleEnabled, true); assert.deepEqual(configured.dmIds, [host]);
  assert.throws(() => readConfig({ ...env, RAPHAEL_PUBLIC_ORIGIN: 'https://game.example/other' }), /HTTPS origin/);
});
