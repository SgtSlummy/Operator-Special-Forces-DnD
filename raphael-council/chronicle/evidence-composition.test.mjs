import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { createStoryProvider } from './provider.mjs';
import { createChronicleRuntime } from '../discord/chronicle-runtime.mjs';

const campaign = 'synthetic-composition', host = '111111111111111111', player = '222222222222222222';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function receipt(snapshot) {
  return { contract: 'raph-obus-game-evidence-v1', campaign: snapshot.campaign, session: snapshot.session,
    revision: snapshot.revision, status: 'saved', sourceCount: snapshot.sources.length, participantCount: snapshot.participants.length };
}
function result(request, text = 'The synthetic beacon is blue.') {
  return { text, provider: 'obus', model: 'local-model:latest', routeId: 'synthetic-local-route',
    trace: [{ destination: 'local', model: 'local-model:latest' }],
    sources: (request.evidence?.references ?? []).map(({ ref, revision }) => ({ ref, revision })) };
}
function fixture(t, { realProvider = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-composition-')), path = join(directory, 'chronicle.sqlite');
  const f = { directory, path, now: 1700000000000, generations: [], snapshots: [], authorizations: { command: 0, evidence: 0 },
    services: [], releases: [], runtimeClosers: [], generate: null, sync: null };
  f.store = new ChronicleStore(path, { now: () => f.now });
  f.start = (name = campaign) => {
    const session = f.store.start({ campaign: name, title: 'Synthetic composition', mode: 'human', host,
      channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: `start-${name}` });
    for (const user of [host, player]) { f.store.consent(session.id, user, true); f.store.externalConsent(session.id, user, true); }
    return session;
  };
  f.session = f.start(); f.id = f.session.id;
  f.record = (source = `discord:source-${f.id}`, text = 'Private synthetic source text: the beacon is blue.', id = f.id) =>
    f.store.record(id, source, { user: player, speaker: 'Synthetic speaker', text });
  f.entry = f.record();
  f.runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 2, leaseExpiresAtMs: Date.now() + 30000,
    effectivePolicy: { enabled: true, mode: 'local', codex: false, exportable: false } };
  f.hostControl = {
    async getRuntime() { return f.runtime; },
    async syncEvidence(snapshot) { f.snapshots.push(snapshot); return f.sync ? f.sync(snapshot) : receipt(snapshot); },
  };
  f.transport = {
    async generate(request) { f.generations.push(request); return f.generate ? f.generate(request) : result(request); },
    async transcribe() { throw new Error('No speech is used by this fixture.'); },
    async runtime() { return f.runtime; },
  };
  f.buildProvider = () => realProvider ? createStoryProvider({ store: f.store, campaigns: [campaign], transport: f.transport,
    hostControl: f.hostControl, authorizeCommand: () => { f.authorizations.command++; return true; },
    authorizeEvidence: () => { f.authorizations.evidence++; return true; } }) : {
    async write() { return 'Synthetic inline result.'; }, async writeReferences() { return 'Synthetic referenced result.'; },
    async syncEvidence(context) {
      const snapshot = { campaign: context.campaign, session: context.session, ...f.store.evidenceProjection(context.session) };
      f.snapshots.push(snapshot); return f.sync ? f.sync(snapshot) : receipt(snapshot);
    },
  };
  f.makeService = () => { const service = new ChronicleService({ store: f.store, provider: f.buildProvider(), dataDir: directory, now: () => f.now }); f.services.push(service); return service; };
  f.service = f.makeService();
  f.restart = async () => {
    await f.service.close(); f.store.close();
    f.store = new ChronicleStore(path, { now: () => f.now }); f.service = f.makeService();
  };
  t.after(async () => {
    for (const release of f.releases) release();
    for (const close of f.runtimeClosers) await close();
    await Promise.allSettled(f.services.map(service => service.close()));
    try { f.store.close(); } catch { /* A runtime explicitly owns and closed this fixture store. */ }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  return f;
}

test('real story-provider composition synchronizes trusted sources and summarizes exact references without inline source text', async t => {
  const f = fixture(t, { realProvider: true });
  const summary = await f.service.summarize(f.id, { force: true });
  assert.equal(summary.kind, 'summary');
  assert.equal(f.generations.length, 1); assert.ok(f.snapshots.length >= 1);
  const request = f.generations[0];
  assert.deepEqual(request.evidence.references, [{ ref: `chronicle:${f.id}:E${f.entry.seq}`, revision: f.entry.seq }]);
  assert.equal(JSON.stringify(request).includes(f.entry.text), false);
  assert.equal('facts' in request.evidence, false);
  assert.equal(request.policy.mode, 'local-free'); assert.equal(request.policy.codex, false); assert.equal(request.policy.exportable, true);
  assert.equal(request.promptTemplate, 'session-summary-v1'); assert.equal(request.instructions, '');
  assert.equal(f.runtime.effectivePolicy.mode, 'local'); assert.equal(f.runtime.effectivePolicy.exportable, false);
  assert.equal(request.scope.campaign, campaign); assert.equal(request.scope.owner, host); assert.equal(request.scope.role, 'host');
  assert.equal(f.snapshots[0].sources.find(source => source.ref === request.evidence.references[0].ref).text, f.entry.text);
  assert.ok(f.authorizations.command > 0); assert.ok(f.authorizations.evidence > 0);
  assert.equal(f.store.get(f.id).watermark, f.entry.seq);
});

test('a source correction during real-provider inference withholds the summary and leaves its watermark unchanged', async t => {
  const f = fixture(t, { realProvider: true }), entered = deferred(), generated = deferred();
  f.releases.push(() => generated.resolve());
  f.generate = async request => { entered.resolve(); await generated.promise; return result(request, 'An obsolete summary.'); };
  const pending = f.service.summarize(f.id, { force: true });
  await entered.promise;
  f.store.correct(f.id, f.entry.seq, 'Corrected source: the beacon is green.', host, true, 'while-generating');
  generated.resolve();
  const [outcome] = await Promise.allSettled([pending]);
  assert.ok(outcome.status === 'rejected' || outcome.value === null);
  assert.equal(f.store.get(f.id).watermark, 0);
  assert.equal(f.store.entries(f.id).filter(entry => entry.kind === 'summary').length, 0);
  assert.equal(f.store.evidence(f.id)[0].text, 'Corrected source: the beacon is green.');
});

test('complete final recap uses references for raw chapters and local inline strings for condensation and final prose', async t => {
  const f = fixture(t, { realProvider: true });
  for (let n = 1; n < 75; n++) f.record(`discord:chapter-${n}`, `Synthetic raw source ${n}.`);
  f.generate = async request => result(request, request.evidence?.references ? `Chapter ${'x'.repeat(7000)}` : request.task === 'final' ? 'Final synthetic recap.' : 'Condensed synthetic chapter.');
  const ended = await f.service.end(f.id);
  assert.equal(ended.status, 'ended');
  const referenced = f.generations.filter(request => request.evidence?.references);
  const condensed = f.generations.filter(request => request.task === 'summary' && Array.isArray(request.evidence));
  const final = f.generations.find(request => request.task === 'final');
  assert.equal(referenced.length, 3);
  assert.equal(referenced.reduce((sum, request) => sum + request.evidence.references.length, 0), 75);
  assert.ok(condensed.length > 0);
  assert.ok(condensed.every(request => request.evidence.every(value => typeof value === 'string')));
  assert.ok(Array.isArray(final.evidence) && final.evidence.every(value => typeof value === 'string'));
  for (const request of [...condensed, final]) {
    assert.equal(request.policy.mode, 'local'); assert.equal(request.policy.codex, false); assert.equal(request.policy.exportable, false);
  }
  assert.equal(f.store.find(f.id, 'final-prose').text, 'Final synthetic recap.');
});

test('scheduler permits one flight, manual commands and shutdown draining while refusing to acknowledge a changed projection', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  f.releases.push(() => release.resolve());
  f.sync = async snapshot => { entered.resolve(); await release.promise; return receipt(snapshot); };
  const first = f.service.evidenceTick(), second = f.service.evidenceTick();
  assert.equal(first, second);
  await entered.promise;
  assert.equal(f.snapshots.length, 1);
  f.store.control(f.id, 'pause', 'manual-pause');
  f.store.externalConsent(f.id, player, false);
  assert.equal(f.store.get(f.id).status, 'paused');
  assert.equal(f.store.privacy(f.id, player).external, false);
  let closed = false;
  const closing = f.service.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  release.resolve();
  assert.equal(await first, null); await closing;
  assert.equal(closed, true);
  const state = f.store.evidenceSync(f.id);
  assert.equal(state.revision, -1); assert.equal(state.lastSuccess, 0); assert.equal(state.lastError, 'stale');
  assert.ok(state.nextAttempt > f.now);
});

test('scheduler persists acknowledgement, refreshes at thirty seconds and resynchronizes after restart', async t => {
  const f = fixture(t);
  await f.service.evidenceTick();
  const saved = f.store.evidenceSync(f.id);
  assert.equal(saved.revision, f.store.evidenceRevision(f.id)); assert.equal(saved.lastSuccess, f.now);
  await f.service.evidenceTick(); assert.equal(f.snapshots.length, 1);
  f.now += 29999; await f.service.evidenceTick(); assert.equal(f.snapshots.length, 1);
  f.now++; await f.service.evidenceTick(); assert.equal(f.snapshots.length, 2);
  const renewed = f.store.evidenceSync(f.id);
  await f.restart();
  assert.deepEqual(f.store.evidenceSync(f.id), renewed);
  await f.service.evidenceTick(); assert.equal(f.snapshots.length, 3);
});

test('scheduler persists bounded retry backoff across restart and stores only sanitized failure metadata', async t => {
  const f = fixture(t);
  f.sync = async () => { throw new Error('Raw secret or transcript must never be persisted.'); };
  await f.service.evidenceTick();
  assert.equal(f.store.evidenceSync(f.id).attempts, 1);
  assert.equal(f.store.evidenceSync(f.id).nextAttempt, f.now + 1000);
  assert.equal(f.store.evidenceSync(f.id).lastError, 'unavailable');
  f.now += 999; await f.service.evidenceTick(); assert.equal(f.snapshots.length, 1);
  f.now++; await f.service.evidenceTick(); assert.equal(f.snapshots.length, 2);
  const failed = f.store.evidenceSync(f.id);
  assert.equal(failed.attempts, 2); assert.equal(failed.nextAttempt, f.now + 2000);
  await f.restart();
  assert.deepEqual(f.store.evidenceSync(f.id), failed);
  await f.service.evidenceTick(); assert.equal(f.snapshots.length, 2);
  f.now = failed.nextAttempt; f.sync = null;
  await f.service.evidenceTick();
  assert.equal(f.snapshots.length, 3);
  assert.deepEqual(f.store.evidenceSync(f.id), { revision: f.store.evidenceRevision(f.id), lastSuccess: f.now, attempts: 0, nextAttempt: 0, lastError: null });
});

test('scheduler synchronizes deletion tombstones and consent changes even when the session has ended', async t => {
  const f = fixture(t);
  await f.service.evidenceTick();
  f.store.reviseMessage(f.id, `source-${f.id}`, { deleted: true, requestId: 'deleted' });
  f.store.save({ ...f.store.get(f.id), status: 'ended' });
  await f.service.evidenceTick();
  assert.equal(f.snapshots.length, 2);
  assert.equal(f.snapshots.at(-1).sources[0].deleted, true); assert.equal(f.snapshots.at(-1).sources[0].text, '');
  f.store.externalConsent(f.id, player, false);
  await f.service.evidenceTick();
  assert.equal(f.snapshots.length, 3);
  assert.equal(f.snapshots.at(-1).participants.find(value => value.user === player).external, false);
  assert.equal(f.store.evidenceSync(f.id).revision, f.store.evidenceRevision(f.id));
});

test('scheduler rotates fairly across due sessions when an earlier session keeps becoming dirty', async t => {
  const f = fixture(t), otherA = f.start('synthetic-second'), otherB = f.start('synthetic-third');
  const ids = [f.id, otherA.id, otherB.id].sort((a, b) => a.localeCompare(b));
  await f.service.evidenceTick();
  f.store.externalConsent(ids[0], player, false);
  await f.service.evidenceTick();
  f.store.externalConsent(ids[0], player, true);
  await f.service.evidenceTick();
  assert.deepEqual(f.snapshots.map(snapshot => snapshot.session), ids);
  await f.service.evidenceTick();
  assert.equal(f.snapshots[3].session, ids[0]);
});

test('scheduler never acknowledges corrupt receipt identities or revisions', async t => {
  const f = fixture(t);
  const changes = [{ contract: 'other-contract' }, { campaign: 'other-campaign' }, { session: 'other-session' }, { revision: 999999 }];
  for (const change of changes) {
    f.sync = async snapshot => ({ ...receipt(snapshot), ...change });
    assert.equal(await f.service.evidenceTick(), null);
    const state = f.store.evidenceSync(f.id);
    assert.equal(state.revision, -1); assert.equal(state.lastSuccess, 0);
    assert.ok(['stale', 'unavailable'].includes(state.lastError));
    f.now = state.nextAttempt;
  }
  assert.equal(f.snapshots.length, changes.length);
});

test('raw source chunks satisfy both count and serialized JSON limits without losing or changing entries', t => {
  const f = fixture(t);
  const records = Array.from({ length: 70 }, (_, index) => ({ seq: index + 1, kind: 'note', speaker: 'Fixture', text: `Fact ${index}.`, at: 0 }));
  const groups = f.service.sourceChunks(records);
  assert.ok(groups.every(group => group.length <= 32 && JSON.stringify(group).length <= 14000));
  assert.deepEqual(groups.flat().map(entry => [entry.ref, entry.text]), records.map(entry => [`E${entry.seq}`, entry.text]));
  const boundary = Array.from({ length: 3 }, (_, index) => ({ seq: index + 1, kind: 'note', text: '', at: 0 }));
  const overhead = boundary.reduce((sum, entry) => sum + JSON.stringify({ ref: `E${entry.seq}`, kind: entry.kind, text: '', at: new Date(entry.at).toISOString() }).length, 0);
  const budget = 14000 - overhead;
  boundary.forEach((entry, index) => { entry.text = 'x'.repeat(Math.floor(budget / 3) + (index < budget % 3 ? 1 : 0)); });
  const bounded = f.service.sourceChunks(boundary);
  assert.ok(bounded.every(group => JSON.stringify(group).length <= 14000));
  assert.deepEqual(bounded.flat().map(entry => entry.text), boundary.map(entry => entry.text));
  assert.throws(() => f.service.sourceChunks([{ seq: 1, kind: 'note', text: 'x'.repeat(14001), at: 0 }]));
  assert.equal(f.generations.length, 0);
});

test('cheap evidence revision validates the session and survives restart and rollback without materializing sources', async t => {
  const f = fixture(t), expected = f.store.evidenceProjection(f.id).revision;
  const projection = f.store.evidenceProjection;
  f.store.evidenceProjection = () => { throw new Error('Source materialization is forbidden by this fixture.'); };
  try {
    assert.equal(f.store.evidenceRevision(f.id), expected);
    assert.throws(() => f.store.evidenceRevision('missing-session'), /Session not found/);
    assert.throws(() => f.store.transaction(() => { f.store.externalConsent(f.id, player, false); throw new Error('Rollback fixture.'); }), /Rollback fixture/);
    assert.equal(f.store.evidenceRevision(f.id), expected);
  } finally { f.store.evidenceProjection = projection; }
  await f.restart();
  assert.equal(f.store.evidenceRevision(f.id), expected);
  assert.equal(f.store.evidenceRevision(f.id), f.store.evidenceProjection(f.id).revision);
});

function wrapperOptions(f, provider) {
  f.store.save({ ...f.store.get(f.id), status: 'paused' });
  for (const row of f.store.pending()) f.store.delivered(row.id, 'synthetic-delivery');
  return { client: {}, config: { campaignId: campaign, guildId: '555555555555555555', channelId: '444444444444444444',
    chronicleDir: f.directory, dmIds: [host], playerIds: [player] }, store: f.store,
    transport: { async send() { throw new Error('Unexpected Discord send.'); } },
    makeVoice: () => ({ async start() {}, async stop() {} }), ...(provider ? { provider } : {}) };
}

test('default runtime wrapper constructs a sync-capable story provider without credentials or HTTP', async t => {
  const f = fixture(t), previousUrl = process.env.RAPHAEL_OBUS_URL, previousToken = process.env.RAPHAEL_OBUS_GAME_TOKEN;
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden in this fixture.'); });
  process.env.RAPHAEL_OBUS_URL = 'http://127.0.0.1:38175'; process.env.RAPHAEL_OBUS_GAME_TOKEN = 'fixture';
  try {
    const runtime = createChronicleRuntime(wrapperOptions(f));
    f.runtimeClosers.push(() => runtime.close());
    assert.equal(runtime.store, f.store);
    assert.equal(typeof runtime.service.provider.syncEvidence, 'function');
    assert.equal(typeof runtime.service.provider.writeReferences, 'function');
    assert.equal(fetch.mock.callCount(), 0);
    await runtime.close();
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    if (previousUrl === undefined) delete process.env.RAPHAEL_OBUS_URL; else process.env.RAPHAEL_OBUS_URL = previousUrl;
    if (previousToken === undefined) delete process.env.RAPHAEL_OBUS_GAME_TOKEN; else process.env.RAPHAEL_OBUS_GAME_TOKEN = previousToken;
  }
});

test('runtime wrapper preserves an explicitly injected provider by identity', async t => {
  const f = fixture(t), provider = { async write() { return 'Injected result.'; } };
  const runtime = createChronicleRuntime(wrapperOptions(f, provider));
  f.runtimeClosers.push(() => runtime.close());
  assert.equal(runtime.service.provider, provider);
  await runtime.close();
});
