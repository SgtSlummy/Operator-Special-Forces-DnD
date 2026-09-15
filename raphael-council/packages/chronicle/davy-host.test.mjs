import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { ChronicleStore } from '../../chronicle/store.mjs';
import { createDavyChronicleHost } from './davy-host.mjs';

const host = '111111111111111111', player = '222222222222222222';
function fixture(t, { member, bindings = {} } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'davy-host-test-'));
  const roles = new Map([[host, 'host'], [player, 'player']]);
  const store = new ChronicleStore(':memory:');
  const calls = { network: 0, edits: [], voice: [], gameClose: 0 };
  const gameStore = { hasCampaign: campaign => campaign === 'campaign', member: scope => roles.get(scope.owner), close() { calls.gameClose++; } };
  const config = { campaignId: 'campaign', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', chronicleDir: dataDir, dmIds: [], playerIds: [], discordBindings: { campaign: 'campaign', guild: 'guild', dmIds: [host], playerIds: [player], dmRole: 'gm', playerRole: 'party', ...bindings } };
  const transport = { async respond() {}, async edit(...args) { calls.edits.push(args); }, async followup() {}, async send() { return { id: 'sent' }; },
    async member(owner) { return member ? member(owner) : { user: { id: owner, username: owner }, roles: [], permissions: '8' }; } };
  const unavailable = async () => { calls.network++; throw new Error('Offline fixture'); };
  let voiceArgs;
  const options = { client: {}, config, discordTransport: transport, obusTransport: { generate: unavailable, runtime: unavailable, transcribe: unavailable },
    hostControl: { getRuntime: unavailable, syncEvidence: unavailable }, store, gameStore,
    makeVoice: args => { voiceArgs = args; return { async start(...args) { calls.voice.push(args); }, async stop() {}, revoke() {}, status() { return 'idle'; } }; } };
  const runtime = createDavyChronicleHost(options);
  let sequence = 0;
  const interaction = (action, values = {}, owner = host) => ({ type: 2, id: `request-${++sequence}`, application_id: 'app', token: 'fixture',
    guild_id: 'guild', channel_id: 'chat', member: { user: { id: owner, username: owner }, roles: [], permissions: '8' },
    data: { name: 'session', options: [{ name: action, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } });
  const start = () => store.start({ campaign: 'campaign', title: 'Synthetic', mode: 'human', minutes: 10, host, channel: 'journal', sourceChannel: 'chat', requestId: 'seed' });
  t.after(async () => { await runtime.close(); const actual = realpathSync(dataDir); assert.equal(dirname(actual), realpathSync(tmpdir())); assert.ok(basename(actual).startsWith('davy-host-test-')); rmSync(actual, { recursive: true, force: true }); });
  return { runtime, store, roles, calls, options, interaction, start, get voiceArgs() { return voiceArgs; } };
}

test('composition is inert and supplies current membership and capture callbacks', async t => {
  const f = fixture(t);
  assert.equal(f.calls.network, 0);
  assert.equal(typeof f.voiceArgs.authorizeParticipant, 'function');
  assert.equal(typeof f.voiceArgs.captureRuntime, 'function');
  assert.equal(await f.runtime.provider.authorizeParticipant({ campaign: 'campaign', owner: player, role: 'player' }), true);
  f.roles.delete(player);
  assert.equal(await f.runtime.provider.authorizeParticipant({ campaign: 'campaign', owner: player, role: 'player' }), false);
  assert.equal(await f.runtime.provider.authorizeParticipant({ campaign: 'other', owner: host, role: 'host' }), false);
  assert.equal(f.calls.network, 0);
});

test('current shared host can issue GM commands without Discord role grants', async t => {
  const f = fixture(t, { member: async owner => ({ user: { id: owner }, roles: [], permissions: '0' }) });
  await f.runtime.handle(f.interaction('start', { title: 'Authorized mission', mode: 'human' }), { acknowledged: true });
  assert.match(f.calls.edits.at(-1)[2].content, /Authorized mission/);
  assert.equal(f.calls.network, 0);
});

test('Discord administrator with only shared player membership cannot start a session', async t => {
  const f = fixture(t);
  await f.runtime.handle(f.interaction('start', { title: 'Forbidden', mode: 'human' }, player), { acknowledged: true });
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  assert.equal(f.calls.network, 0);
});

test('host demotion blocks GM action even while Discord still reports administrator', async t => {
  const f = fixture(t), session = f.start(); f.roles.set(host, 'player');
  await f.runtime.handle(f.interaction('pause'), { acknowledged: true });
  assert.equal(f.store.get(session.id).status, 'active');
  assert.equal(f.calls.network, 0);
});

test('membership is rechecked after an asynchronous Discord member lookup', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { member: async owner => { entered(); await waiting; return { user: { id: owner }, roles: [], permissions: '8' }; } });
  const session = f.start();
  const action = f.runtime.handle(f.interaction('pause'), { acknowledged: true });
  await started; f.roles.delete(host); release(); await action;
  assert.equal(f.store.get(session.id).status, 'active');
});

test('fresh member response for another account never authorizes command mutation', async t => {
  const f = fixture(t, { member: async () => ({ user: { id: player }, roles: [], permissions: '8' }) });
  const session = f.start();
  await f.runtime.handle(f.interaction('pause'), { acknowledged: true });
  assert.equal(f.store.get(session.id).status, 'active');
});

test('typed capture requires current game membership and retains packet deletion semantics', async t => {
  const f = fixture(t), session = f.start(); f.store.consent(session.id, player, true);
  const packet = id => ({ t: 'MESSAGE_CREATE', d: { id, guild_id: 'guild', channel_id: 'chat', author: { id: player, username: 'Synthetic' }, content: 'The beacon is green.', timestamp: new Date().toISOString() } });
  await f.runtime.packet(packet('before')); assert.ok(f.store.find(session.id, 'discord:before'));
  f.roles.delete(player); await assert.rejects(f.runtime.packet(packet('after')), /membership/); assert.equal(f.store.find(session.id, 'discord:after'), null);
  await f.runtime.packet({ t: 'MESSAGE_DELETE_BULK', d: { ids: ['before'], guild_id: 'guild', channel_id: 'chat' } });
  assert.equal(f.store.evidenceProjection(session.id).sources.find(source => source.ref.endsWith(`:E${f.store.find(session.id, 'discord:before').seq}`))?.deleted, true);
});

test('Discord GM role withdrawal denies a saved host while party access remains', async t => {
  let roles = ['gm', 'party'];
  const f = fixture(t, { bindings: { dmIds: [], playerIds: [] }, member: async owner => ({ user: { id: owner }, roles: [...roles], permissions: '0' }) });
  const session = f.start();
  assert.equal(await f.runtime.provider.authorizeParticipant({ campaign: 'campaign', owner: host, role: 'host' }), true);
  roles = ['party'];
  assert.equal(f.roles.get(host), 'host');
  assert.equal(await f.runtime.provider.authorizeParticipant({ campaign: 'campaign', owner: host, role: 'host' }), false);
  await f.runtime.handle(f.interaction('pause'), { acknowledged: true });
  assert.equal(f.store.get(session.id).status, 'active');
  assert.equal(f.calls.network, 0);
});

test('caller retains ownership of GameStore while core closes ChronicleStore', async t => {
  const f = fixture(t); await f.runtime.close();
  assert.equal(f.calls.gameClose, 0);
  assert.throws(() => f.store.db.prepare('SELECT 1'), /closed|not open/i);
});

test('unknown campaign is rejected without implicit campaign creation', async t => {
  const f = fixture(t);
  assert.throws(() => createDavyChronicleHost({ ...f.options, config: { ...f.options.config, campaignId: 'unknown' } }));
  assert.equal(f.calls.network, 0);
});

for (const withdrawal of ['game membership', 'Discord GM role']) test(`privacy synchronization survives original host ${withdrawal} withdrawal without granting inference`, async t => {
  let discordRoles = ['gm', 'party'];
  const f = fixture(t, { bindings: { dmIds: [], playerIds: [] },
    member: async owner => ({ user: { id: owner }, roles: [...discordRoles], permissions: '0' }) });
  const session = f.start();
  f.store.consent(session.id, player, true); f.store.externalConsent(session.id, player, true);
  const entry = f.store.record(session.id, 'discord:privacy', { user: player, speaker: 'Fixture player', text: 'A private source fact.' });
  const snapshots = [];
  f.options.hostControl.getRuntime = async () => ({ contract: 'raph-obus-game-runtime-v1',
    bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
    sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 60000,
    effectivePolicy: { enabled: false, mode: 'local-free', exportable: true, codex: false } });
  f.options.hostControl.syncEvidence = async snapshot => {
    snapshots.push(snapshot);
    return { contract: 'raph-obus-game-evidence-v1', campaign: snapshot.campaign, session: snapshot.session,
      revision: snapshot.revision, status: 'saved', sourceCount: snapshot.sources.length, participantCount: snapshot.participants.length };
  };
  if (withdrawal === 'game membership') f.roles.delete(host); else discordRoles = ['party'];
  await f.runtime.handle(f.interaction('consent', { enabled: true, external: false }, player), { acknowledged: true });
  assert.equal(f.store.privacy(session.id, player).external, false);
  await f.runtime.handle(f.interaction('correct', { entry: entry.seq, text: 'The participant corrected this fact.' }, player), { acknowledged: true });
  assert.equal(f.store.evidence(session.id).find(value => value.seq === entry.seq).text, 'The participant corrected this fact.');
  await assert.rejects(f.runtime.provider.syncEvidence({ campaign: 'campaign', session: session.id, owner: host }), { code: 'CHRONICLE_UNAUTHORIZED' });
  assert.equal(snapshots.length, 0);
  const saved = await f.runtime.service.evidenceTick();
  assert.equal(saved.revision, f.store.evidenceRevision(session.id));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].participants.find(value => value.user === player).external, false);
  assert.equal(f.store.evidenceSync(session.id).revision, f.store.evidenceRevision(session.id));
  await assert.rejects(f.runtime.provider.writeReferences('summary', [{ ref: `chronicle:${session.id}:E${entry.seq}`, revision: entry.seq }],
    { campaign: 'campaign', session: session.id, owner: host, sourceRevision: saved.revision }), { code: 'CHRONICLE_UNAUTHORIZED' });
  await assert.rejects(f.runtime.provider.captureRuntime({ campaign: 'campaign', owner: host, role: 'host' }, session.id), { code: 'CHRONICLE_UNAUTHORIZED' });
  await f.runtime.handle(f.interaction('pause'), { acknowledged: true });
  assert.equal(f.store.get(session.id).status, 'active');
  assert.equal(f.calls.network, 0);
});


test('production guild admission allows enrolled ordinary members but never prospective or revoked identities',async t=>{
 let admitted=true,bot=false,pending=false;
 const f=fixture(t,{bindings:{admissionEnabled:true,playerIds:[],playerRole:'',dmRole:''},member:async owner=>{if(!admitted)throw Error('removed');return{user:{id:owner,bot},pending,roles:[],permissions:'0'};}});
 const scope={campaign:'campaign',owner:player,role:'player'};assert.equal(await f.runtime.provider.authorizeParticipant(scope),true);
 assert.equal(await f.runtime.provider.authorizeParticipant({...scope,role:'prospective'}),false);
 f.roles.delete(player);assert.equal(await f.runtime.provider.authorizeParticipant(scope),false);f.roles.set(player,'player');
 bot=true;assert.equal(await f.runtime.provider.authorizeParticipant(scope),false);bot=false;pending=true;assert.equal(await f.runtime.provider.authorizeParticipant(scope),false);pending=false;admitted=false;assert.equal(await f.runtime.provider.authorizeParticipant(scope),false);
});
