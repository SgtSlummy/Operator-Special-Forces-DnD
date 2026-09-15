import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as portable from './dist/index.mjs';
import * as obus from '../obus-provider/dist/index.mjs';
import { createObusHostControl } from '../../ai/host-control.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const davyRoot = process.env.DAVY_CHRONICLE_TEST_ROOT;
const configModule = davyRoot ? await import(pathToFileURL(join(davyRoot, 'src/discord/chronicle-config.js')).href) : null;
const options = { skip: !configModule && 'Set DAVY_CHRONICLE_TEST_ROOT to the local Davy checkout.', timeout: 90000 };
const GM = '111111111111111111', PLAYER = '222222222222222222', GUILD = '333333333333333333';
const CHANNEL = '444444444444444444', APP = '555555555555555555', CONTRACT = 'raph-obus-game-evidence-refs-v2';
const serviceToken = 'a'.repeat(64), hostToken = 'b'.repeat(64);
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, count = 1) {
  const temporary = realpathSync(tmpdir()), base = mkdtempSync(join(temporary, 'davy-config-obus-'));
  const gameDir = join(base, 'game'), reports = join(base, 'reports'), chronicleFile = join(base, 'chronicle.sqlite');
  mkdirSync(gameDir); mkdirSync(reports);
  const db = new DatabaseSync(join(gameDir, 'game.sqlite'));
  db.exec("CREATE TABLE game_campaigns(id TEXT PRIMARY KEY); INSERT INTO game_campaigns VALUES ('harbor')"); db.close();
  const seedStore = new portable.ChronicleStore(chronicleFile); seedStore.close();
  const state = { imports: [], routes: [], uploads: [], snapshots: [], committed: [], discord: [], sequence: 0, runtime: null,
    store: null, session: null, configured: null, support: [CONTRACT], roles: new Map([[GM, 'host'], [PLAYER, 'player']]), uploadsById: new Map() };
  state.runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 0, requiredForRoute: true,
    leaseExpiresAtMs: Date.now() + 120000, queuedCount: 0, dispatchedCount: 0,
    effectivePolicy: { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false } };
  const receipt = document => ({ contract: 'raph-obus-game-evidence-v1', campaign: document.campaign, session: document.session,
    revision: document.revision, status: 'saved', sourceCount: document.sourceCount ?? document.sources.length, participantCount: document.participants.length });
  const fetchImpl = async (url, request) => {
    assert.ok(url.startsWith('http://127.0.0.1:38175/api/game/')); assert.equal(request.redirect, 'error');
    if (url.includes('/runtime?')) return Response.json(state.runtime);
    if (url.endsWith('/capabilities')) return Response.json({ contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true,
      provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true, evidence_reference_contracts: state.support });
    const body = JSON.parse(request.body);
    if (url.endsWith('/route')) {
      assert.equal(body.evidence.contract, CONTRACT); assert.match(body.evidence.selectionHash, /^[0-9a-f]{64}$/);
      state.routes.push(body); await state.onRoute?.(body);
      return Response.json({ text: 'The synthetic beacon remains blue [S1].', routeId: 'configured-fixture', model: 'fixture-local',
        trace: [{ destination: 'local', model: 'fixture-local', status: 'ready' }], sources: body.evidence.references, evidenceRevision: body.evidence.revision });
    }
    assert.equal(request.headers['X-Obus-Game-Token'], serviceToken);
    const path = new URL(url).pathname;
    const signed = [request.method, path, request.headers['X-Obus-Game-Host-Timestamp'], request.headers['X-Obus-Game-Host-Nonce'], hash(request.body)].join('\n');
    assert.equal(request.headers['X-Obus-Game-Host-Signature'], createHmac('sha256', Buffer.from(hostToken, 'hex')).update(signed).digest('hex'));
    assert.ok(Buffer.byteLength(request.body) <= 512 * 1024);
    if (url.endsWith('/evidence/snapshot')) {
      state.snapshots.push(body); await state.onSnapshot?.(body); return Response.json(receipt(body));
    }
    assert.ok(url.endsWith('/evidence/upload')); assert.ok(Buffer.byteLength(request.body) <= 256 * 1024);
    state.uploads.push(body);
    if (body.operation === 'begin') state.uploadsById.set(body.uploadId, { begin: body, received: new Set(), pages: new Map() });
    const upload = state.uploadsById.get(body.uploadId); assert.ok(upload);
    if (body.operation === 'page') { upload.received.add(body.index); upload.pages.set(body.index, body.sources); }
    if (body.operation === 'commit') {
      assert.equal(upload.received.size, upload.begin.pages.length);
      assert.equal([...upload.pages.values()].flat().length, upload.begin.sourceCount);
      state.committed.push(upload);
    }
    await state.onUpload?.(body);
    const complete = body.operation === 'commit';
    return Response.json({ contract: body.contract, campaign: body.campaign, session: body.session, uploadId: body.uploadId,
      revision: upload.begin.revision, status: complete ? 'complete' : 'pending', pageCount: upload.begin.pages.length,
      sourceCount: upload.begin.sourceCount, participantCount: upload.begin.participants.length,
      received: complete ? [] : [...upload.received].sort((a, b) => a - b), ...(complete ? { receipt: receipt(upload.begin) } : {}) });
  };
  const client = { application: { id: APP }, rest: {
    async get(path) {
      state.discord.push(['get', path]);
      if (path.endsWith('/commands')) return [];
      if (path === `/guilds/${GUILD}`) return { id: GUILD, owner_id: GM };
      if (path === `/guilds/${GUILD}/roles`) return [{ id: GUILD, permissions: '0' }];
      const owner = /\/members\/(\d+)$/.exec(path)?.[1]; assert.ok(owner);
      return { user: { id: owner, username: 'Synthetic' }, roles: [], permissions: '0' };
    },
    async post(path) { state.discord.push(['post', path]); return { id: 'synthetic-receipt' }; },
    async patch(path) { state.discord.push(['patch', path]); },
  } };
  // Only membership and the voice connection are controlled host adapters.
  // Chronicle storage, bridge, provider, transport and signing use production code.
  const game = { GameStore: class {
    hasCampaign(campaign) { return campaign === 'harbor'; }
    member(scope) { return scope.campaign === 'harbor' ? state.roles.get(scope.owner) : null; }
    close() {}
  } };
  const env = { RAPHAEL_CHRONICLE_ENABLED: 'true', RAPHAEL_CHRONICLE_RUNTIME_ROOT: appRoot,
    RAPHAEL_GAME_DATA_DIR: gameDir, RAPHAEL_CHRONICLE_DB_FILE: chronicleFile, RAPHAEL_CHRONICLE_DATA_DIR: reports,
    RAPHAEL_CHRONICLE_CAMPAIGN_ID: 'harbor', RAPHAEL_CAMPAIGN_ID: 'harbor', RAPHAEL_GUILD_ID: GUILD,
    RAPHAEL_CHRONICLE_GUILD_ID: GUILD, RAPHAEL_CHRONICLE_CHANNEL_ID: CHANNEL, RAPHAEL_CHRONICLE_JOURNAL_CHANNEL_ID: CHANNEL,
    RAPHAEL_CHRONICLE_APPLICATION_ID: APP, RAPHAEL_DM_IDS: GM, RAPHAEL_PLAYER_IDS: PLAYER,
    RAPHAEL_OBUS_GAME_TOKEN: serviceToken, RAPHAEL_OBUS_HOST_CONTROL_TOKEN: hostToken };
  const modules = new Map([
    [pathToFileURL(join(appRoot, 'packages/chronicle/dist/index.mjs')).href, { ...portable, ChronicleStore: class extends portable.ChronicleStore {
      constructor(file) { super(file); state.store = this; }
    } }],
    [pathToFileURL(join(appRoot, 'packages/obus-provider/dist/index.mjs')).href, { ...obus, ObusTransport: class extends obus.ObusTransport {
      constructor(input) { super({ ...input, fetchImpl }); }
    } }],
    [pathToFileURL(join(appRoot, 'game/store.mjs')).href, game],
    [pathToFileURL(join(appRoot, 'ai/host-control.mjs')).href, { createObusHostControl: input => createObusHostControl({ ...input, fetchImpl }) }],
    [pathToFileURL(join(davyRoot, 'src/discord/chronicle-voice.js')).href, { createChronicleVoice: () => ({ async start() {}, async stop() {}, revoke() {}, status() { return 'idle'; } }) }],
  ]);
  t.after(async () => {
    await state.configured?.runtime.close();
    const actual = realpathSync(base); assert.equal(dirname(actual), temporary); assert.ok(basename(actual).startsWith('davy-config-obus-'));
    rmSync(actual, { recursive: true, force: true });
  });
  state.configured = await configModule.createConfiguredChronicleRuntime({ client, env,
    voicePlayer: { guilds: new Map(), async connect() {}, async acquireCaptureLease() {} },
    loadModule: async specifier => { state.imports.push(specifier); assert.ok(modules.has(specifier), `Unexpected module ${specifier}`); return modules.get(specifier); } });
  assert.equal(state.configured.configured, true); assert.equal(state.routes.length, 0); assert.equal(state.snapshots.length, 0); assert.equal(state.discord.length, 0);
  state.session = state.store.start({ campaign: 'harbor', title: 'Configured synthetic session', mode: 'human', host: GM,
    channel: CHANNEL, sourceChannel: CHANNEL, requestId: 'start' });
  state.store.consent(state.session.id, PLAYER, true); state.store.externalConsent(state.session.id, PLAYER, true);
  state.add = () => state.store.record(state.session.id, `discord:${++state.sequence}`, { user: PLAYER, speaker: 'Synthetic', text: `The beacon is blue. Fact ${state.sequence}.` });
  for (let i = 0; i < count; i++) state.add();
  state.scope = { campaign: 'harbor', session: state.session.id, owner: GM };
  return state;
}

test('Davy configured loader uses the real bundles and signed refs-v2 flow while chat arrives', options, async t => {
  const f = await fixture(t), projection = f.store.evidenceProjection(f.session.id);
  const references = projection.sources.map(({ ref, revision }) => ({ ref, revision }));
  f.onRoute = () => f.add();
  const result = await f.configured.runtime.provider.writeReferences('summary', references, { ...f.scope, sourceRevision: projection.revision });
  assert.equal(result, 'The synthetic beacon remains blue [S1].'); assert.equal(f.routes.length, 1);
  assert.equal(f.routes[0].evidence.revision, projection.revision); assert.equal(f.routes[0].instructions, '');
  assert.ok(f.store.evidenceProjection(f.session.id).revision > projection.revision);
  assert.deepEqual(f.snapshots.map(snapshot => snapshot.sources.length), [1, 2]);
  assert.ok(f.imports.some(path => path.endsWith('/packages/obus-provider/dist/index.mjs')));
  assert.equal(f.imports.some(path => path.endsWith('/ai/obus.mjs')), false);
  await f.configured.registerCommands();
  assert.equal(f.discord.filter(([method]) => method === 'post').length, 1);
});

test('Davy configured signer aborts paged synchronization before commit after consent withdrawal', options, async t => {
  const f = await fixture(t, 2050);
  f.onUpload = command => { if (command.operation === 'page') f.store.externalConsent(f.session.id, PLAYER, false); };
  await assert.rejects(f.configured.runtime.provider.syncEvidence(f.scope), { code: 'CHRONICLE_STALE' });
  assert.deepEqual(f.uploads.map(command => command.operation), ['begin', 'page']);
  assert.equal(f.committed.length, 0); assert.equal(f.routes.length, 0);
});

test('Davy configured signer completes an unchanged prefix while new chat remains for the next sync', options, async t => {
  const f = await fixture(t, 2050), projection = f.store.evidenceProjection(f.session.id);
  let appended = false;
  f.onUpload = command => { if (command.operation === 'page' && !appended) { appended = true; f.add(); } };
  const saved = await f.configured.runtime.provider.syncEvidence(f.scope);
  assert.equal(saved.revision, projection.revision); assert.equal(saved.sourceCount, 2050);
  assert.equal(f.committed.length, 1); assert.equal(f.uploads.filter(command => command.operation === 'page').length, 9);
  assert.equal(f.store.evidenceProjection(f.session.id).sources.length, 2051); assert.equal(f.routes.length, 0);
});
