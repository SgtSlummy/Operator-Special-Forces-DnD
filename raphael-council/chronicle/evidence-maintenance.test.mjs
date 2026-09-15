import test from 'node:test';
import assert from 'node:assert/strict';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { createObusEvidenceBridge } from './obus-evidence.mjs';
import { createObusChronicleProvider } from './obus-provider.mjs';
import { createStoryProvider } from './provider.mjs';

const campaign = 'maintenance-fixture', host = '111111111111111111', player = '222222222222222222';
const receipt = snapshot => ({ contract: 'raph-obus-game-evidence-v1', campaign: snapshot.campaign, session: snapshot.session,
  revision: snapshot.revision, status: 'saved', sourceCount: snapshot.sources.length, participantCount: snapshot.participants.length });
function fixture(t) {
  const f = { now: 1700000000000, hostAllowed: true, hostChecks: 0, evidenceChecks: 0, runtimeCalls: 0, modelCalls: 0,
    snapshots: [], beforeRuntime: null, onSync: null, services: [] };
  f.store = new ChronicleStore(':memory:', { now: () => f.now });
  f.session = f.store.start({ campaign, title: 'Privacy maintenance', mode: 'human', host,
    channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: 'maintenance-start' });
  f.id = f.session.id;
  for (const user of [host, player]) { f.store.consent(f.id, user, true); f.store.externalConsent(f.id, user, true); }
  f.entry = f.store.record(f.id, 'discord:beacon', { user: player, speaker: 'Fixture participant', text: 'The beacon is blue.' });
  f.runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 3, leaseExpiresAtMs: Date.now() + 60000,
    effectivePolicy: { enabled: false, mode: 'local-free', codex: false, exportable: true } };
  f.control = {
    async getRuntime(scope) { f.runtimeCalls++; if (f.beforeRuntime) await f.beforeRuntime(scope); return f.runtime; },
    async syncEvidence(snapshot) { f.snapshots.push(snapshot); return f.onSync ? f.onSync(snapshot) : receipt(snapshot); },
  };
  f.transport = {
    async generate() { f.modelCalls++; throw new Error('No generation belongs to privacy maintenance.'); },
    async transcribe() { f.modelCalls++; throw new Error('No audio belongs to privacy maintenance.'); },
    async runtime() { f.modelCalls++; return f.runtime; },
  };
  f.authorizeHost = () => { f.hostChecks++; return f.hostAllowed; };
  f.authorizeEvidence = () => { f.evidenceChecks++; return f.hostAllowed; };
  f.bridgeOptions = { store: f.store, hostControl: f.control, campaigns: [campaign], authorizeCommand: f.authorizeEvidence };
  f.bridge = createObusEvidenceBridge({ ...f.bridgeOptions, allowStoreSync: true });
  f.providerOptions = { transport: f.transport, campaigns: [campaign], authorizeCommand: f.authorizeHost, authorizeParticipant: () => false };
  f.provider = createObusChronicleProvider({ ...f.providerOptions, evidenceBridge: f.bridge });
  f.story = createStoryProvider({ store: f.store, campaigns: [campaign], transport: f.transport, hostControl: f.control,
    authorizeCommand: f.authorizeHost, authorizeEvidence: f.authorizeEvidence, authorizeParticipant: () => false });
  f.service = () => { const service = new ChronicleService({ store: f.store, provider: f.story, dataDir: '', now: () => f.now }); f.services.push(service); return service; };
  f.scope = { campaign, session: f.id };
  t.after(async () => { await Promise.allSettled(f.services.map(service => service.close())); f.store.close(); });
  return f;
}

test('store maintenance is explicitly granted by trusted composition, never by a sync request', async t => {
  const f = fixture(t); f.hostAllowed = false;
  const ordinary = createObusEvidenceBridge(f.bridgeOptions);
  const provider = createObusChronicleProvider({ ...f.providerOptions, evidenceBridge: ordinary });
  assert.equal(Object.hasOwn(ordinary, 'syncStored'), false);
  assert.equal(Object.hasOwn(provider, 'syncStoredEvidence'), false);
  for (const allowStoreSync of [1, 'true', null, {}, []]) assert.throws(() => createObusEvidenceBridge({ ...f.bridgeOptions, allowStoreSync }));
  await assert.rejects(ordinary.sync({ ...f.scope, owner: host }), { code: 'EVIDENCE_ACCESS_DENIED' });
  await assert.rejects(ordinary.sync({ ...f.scope, owner: host, allowStoreSync: true }));
  assert.equal(f.snapshots.length, 0); assert.equal(f.runtimeCalls, 0);
});

test('revoked GM and disabled AI do not block current consent withdrawal and corrected source persistence', async t => {
  const f = fixture(t); f.hostAllowed = false;
  f.store.externalConsent(f.id, player, false);
  f.store.correct(f.id, f.entry.seq, 'The beacon is green.', player, false, 'player-correction');
  const saved = await f.story.syncStoredEvidence(f.scope);
  assert.equal(saved.revision, f.store.evidenceRevision(f.id));
  assert.equal(saved.campaign, campaign); assert.equal(saved.session, f.id);
  assert.equal(f.snapshots.length, 1);
  const snapshot = f.snapshots[0];
  assert.equal(snapshot.participants.find(value => value.user === player).external, false);
  assert.equal(snapshot.sources.find(value => value.ref === `chronicle:${f.id}:E${f.entry.seq}`).text, 'The beacon is green.');
  assert.equal(f.hostChecks, 0); assert.equal(f.evidenceChecks, 0); assert.equal(f.modelCalls, 0);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.sources));
});

test('same-author corrections intersect consent history and cannot become exportable after regrant', async t => {
  const f = fixture(t);
  f.store.externalConsent(f.id, player, false);
  f.store.correct(f.id, f.entry.seq, 'Corrected locally.', player, false, 'consent-correction');
  await f.provider.syncStoredEvidence(f.scope);
  const source = f.snapshots.at(-1).sources.find(value => value.ref === `chronicle:${f.id}:E${f.entry.seq}`);
  assert.deepEqual(source.contributors, [{ user: player, captureEpoch: 1, externalEpoch: null, exportableAtCapture: false }]);
  const lineage = f.store.projectedEntries(f.id).find(value => value.ref === source.ref).contributors;
  assert.equal(lineage.length, 2); assert.deepEqual(lineage.map(value => value.externalEpoch), [1, 2]);
  f.store.externalConsent(f.id, player, true);
  await f.provider.syncStoredEvidence(f.scope);
  assert.equal(f.snapshots.at(-1).participants.find(value => value.user === player).external, true);
  assert.deepEqual(f.snapshots.at(-1).sources.find(value => value.ref === source.ref).contributors, source.contributors);
  assert.equal(f.modelCalls, 0);
});

test('same-author corrections at the same consent epoch retain valid export eligibility', async t => {
  const f = fixture(t);
  f.store.correct(f.id, f.entry.seq, 'Corrected with unchanged consent.', player, false, 'same-epoch-correction');
  await f.provider.syncStoredEvidence(f.scope);
  const source = f.snapshots.at(-1).sources.find(value => value.ref === `chronicle:${f.id}:E${f.entry.seq}`);
  assert.deepEqual(source.contributors, [{ user: player, captureEpoch: 1, externalEpoch: 1, exportableAtCapture: true }]);
  assert.equal(f.store.projectedEntries(f.id).find(value => value.ref === source.ref).contributors.length, 1);
});

test('maintenance cannot accept caller identities, text, consent, policy or extra scope fields', async t => {
  const f = fixture(t); f.hostAllowed = false;
  const extras = [{ owner: host }, { sources: [] }, { participants: [] }, { text: 'injected' }, { external: true },
    { policy: { codex: true } }, { action: 'generate' }, { revision: 1000 }, { runtime: f.runtime }];
  for (const extra of extras) {
    await assert.rejects(f.provider.syncStoredEvidence({ ...f.scope, ...extra }), { code: 'CHRONICLE_INPUT' });
    await assert.rejects(f.bridge.syncStored({ ...f.scope, ...extra }), { code: 'INVALID_EVIDENCE_INPUT' });
  }
  let read = false;
  const accessor = { campaign, get session() { read = true; return f.id; } };
  await assert.rejects(f.provider.syncStoredEvidence(accessor), { code: 'CHRONICLE_INPUT' });
  assert.equal(read, false); assert.equal(f.runtimeCalls, 0); assert.equal(f.snapshots.length, 0);
});

test('maintenance refuses unknown sessions and cross-campaign scopes before any transport call', async t => {
  const f = fixture(t);
  const other = f.store.start({ campaign: 'other-campaign', title: 'Other', mode: 'human', host,
    channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: 'other-start' });
  for (const input of [{ campaign: 'other-campaign', session: f.id }, { campaign, session: other.id }, { campaign, session: 'missing' }]) {
    await assert.rejects(f.provider.syncStoredEvidence(input));
  }
  assert.equal(f.snapshots.length, 0); assert.equal(f.runtimeCalls, 0); assert.equal(f.modelCalls, 0);
});

test('maintenance snapshots its scope before awaiting and still checks current stored session ownership', async t => {
  const f = fixture(t), input = { ...f.scope };
  f.beforeRuntime = () => { input.campaign = 'other'; input.session = 'other'; };
  await f.provider.syncStoredEvidence(input);
  assert.equal(f.snapshots[0].campaign, campaign); assert.equal(f.snapshots[0].session, f.id);
  f.snapshots.length = 0;
  const get = f.store.get.bind(f.store);
  f.beforeRuntime = () => { f.store.get = id => ({ ...get(id), campaign: 'other' }); };
  try { await assert.rejects(f.provider.syncStoredEvidence(f.scope)); }
  finally { f.store.get = get; }
  assert.equal(f.snapshots.length, 0);
});

test('GM access loss during synchronization does not discard a valid privacy receipt', async t => {
  const f = fixture(t);
  f.onSync = snapshot => { f.hostAllowed = false; return receipt(snapshot); };
  const saved = await f.provider.syncStoredEvidence(f.scope);
  assert.equal(saved.revision, f.store.evidenceRevision(f.id));
  await assert.rejects(f.provider.syncEvidence({ ...f.scope, owner: host }), { code: 'CHRONICLE_UNAUTHORIZED' });
  assert.equal(f.snapshots.length, 1); assert.equal(f.modelCalls, 0);
});

test('current user and GM generation and capture authorizations remain enforced after maintenance', async t => {
  const f = fixture(t); f.hostAllowed = false;
  await f.provider.syncStoredEvidence(f.scope);
  const context = { ...f.scope, owner: host, sourceRevision: f.store.evidenceRevision(f.id) };
  await assert.rejects(f.provider.write('final', ['Stored chapter.'], context), { code: 'CHRONICLE_UNAUTHORIZED' });
  await assert.rejects(f.provider.writeReferences('summary', [{ ref: `chronicle:${f.id}:E${f.entry.seq}`, revision: f.entry.seq }], context), { code: 'CHRONICLE_UNAUTHORIZED' });
  await assert.rejects(f.provider.captureRuntime({ campaign, owner: host, role: 'host' }, f.id), { code: 'CHRONICLE_UNAUTHORIZED' });
  await assert.rejects(f.provider.syncEvidence({ ...f.scope, owner: host }), { code: 'CHRONICLE_UNAUTHORIZED' });
  assert.equal(f.snapshots.length, 1); assert.equal(f.modelCalls, 0);
});

test('privacy worker rejects a changed projection then retries the actual withdrawal without GM access', async t => {
  const f = fixture(t), service = f.service(); f.hostAllowed = false;
  f.onSync = snapshot => { f.onSync = null; f.store.externalConsent(f.id, player, false); return receipt(snapshot); };
  assert.equal(await service.evidenceTick(), null);
  const failed = f.store.evidenceSync(f.id);
  assert.equal(failed.revision, -1); assert.equal(failed.lastSuccess, 0); assert.equal(failed.attempts, 1);
  f.now = failed.nextAttempt;
  const saved = await service.evidenceTick();
  assert.equal(saved.revision, f.store.evidenceRevision(f.id));
  assert.equal(f.snapshots.at(-1).participants.find(value => value.user === player).external, false);
  assert.equal(f.store.evidenceSync(f.id).attempts, 0); assert.equal(f.modelCalls, 0);
});

test('restarted privacy worker acknowledges ended-session deletion and consent with the original GM absent', async t => {
  const f = fixture(t), first = f.service();
  await first.evidenceTick();
  f.hostAllowed = false;
  f.store.reviseMessage(f.id, 'beacon', { deleted: true, requestId: 'beacon-deleted' });
  f.store.externalConsent(f.id, player, false);
  f.store.save({ ...f.store.get(f.id), status: 'ended' });
  await first.close();
  const restarted = f.service();
  await restarted.evidenceTick();
  assert.equal(f.snapshots.length, 2);
  const source = f.snapshots.at(-1).sources.find(value => value.ref === `chronicle:${f.id}:E${f.entry.seq}`);
  assert.equal(source.deleted, true); assert.equal(source.text, '');
  assert.equal(f.store.evidenceSync(f.id).revision, f.store.evidenceRevision(f.id));
  assert.equal(f.modelCalls, 0);
});

test('maintenance refuses expired leases, changed runtime fences and invalid receipts', async t => {
  const f = fixture(t); f.hostAllowed = false;
  f.runtime.leaseExpiresAtMs = Date.now() - 1;
  await assert.rejects(f.provider.syncStoredEvidence(f.scope)); assert.equal(f.snapshots.length, 0);
  f.runtime.leaseExpiresAtMs = Date.now() + 60000;
  f.onSync = snapshot => { f.runtime.sessionPolicyRevision++; return receipt(snapshot); };
  await assert.rejects(f.provider.syncStoredEvidence(f.scope));
  f.onSync = snapshot => ({ ...receipt(snapshot), campaign: 'wrong' });
  await assert.rejects(f.provider.syncStoredEvidence(f.scope));
  assert.equal(f.modelCalls, 0);
});
