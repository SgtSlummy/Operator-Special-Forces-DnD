import test from 'node:test';
import assert from 'node:assert/strict';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { createObusEvidenceBridge } from './obus-evidence.mjs';
import { createObusChronicleProvider } from './obus-provider.mjs';
import { ObusTransport } from '../ai/obus.mjs';

const GM = '111111111111111111', ALICE = '222222222222222222', BOB = '333333333333333333';
const CONTRACT = 'raph-obus-game-evidence-refs-v2';
function fixture(t, count = 1) {
  const store = new ChronicleStore(':memory:'); t.after(() => store.close());
  const session = store.start({ campaign: 'harbor', title: 'Synthetic selection', mode: 'human', host: GM,
    channel: '444444444444444444', sourceChannel: '555555555555555555', requestId: 'start' });
  for (const user of [ALICE, BOB]) { store.consent(session.id, user, true); store.externalConsent(session.id, user, true); }
  const state = { store, session, allowed: true, requests: [], syncs: [], receipts: [], sequence: 0, support: [CONTRACT], free: false,
    runtime: { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
      generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 0, requiredForRoute: true,
      leaseExpiresAtMs: Date.now() + 60000,
      effectivePolicy: { enabled: true, mode: 'local-free', codex: false, exportable: true, tools: false, personalMemory: false, autoMemory: false } } };
  state.add = (user = ALICE, text = 'The beacon is blue.') => store.record(session.id, `discord:${++state.sequence}`, { user, speaker: 'Synthetic', text });
  for (let i = 0; i < count; i++) state.add(i < 32 ? ALICE : BOB, `Recorded fact ${i}.`);
  state.context = () => ({ campaign: 'harbor', session: session.id, owner: GM, sourceRevision: store.evidenceProjection(session.id).revision });
  state.references = () => store.evidenceProjection(session.id).sources.filter(source => !source.deleted).map(({ ref, revision }) => ({ ref, revision }));
  const hostControl = { async getRuntime() { await state.onRuntime?.(); return structuredClone(state.runtime); },
    async syncEvidence(snapshot, check) {
      check(); state.syncs.push(snapshot); await state.onSync?.(snapshot, check); check();
      return { contract: snapshot.contract, campaign: snapshot.campaign, session: snapshot.session, revision: snapshot.revision,
        status: 'saved', sourceCount: snapshot.sources.length, participantCount: snapshot.participants.length };
    } };
  state.bridge = createObusEvidenceBridge({ store, hostControl, campaigns: ['harbor'], authorizeCommand: () => state.allowed, allowStoreSync: true });
  const transport = new ObusTransport({ serviceToken: 'a'.repeat(64), url: 'http://127.0.0.1:38175', fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(url.startsWith('http://127.0.0.1:38175/api/game/'));
    if (url.endsWith('/capabilities')) return Response.json({ contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true,
      provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true, evidence_reference_contracts: state.support });
    if (url.includes('/runtime?')) return Response.json(state.runtime);
    assert.ok(url.endsWith('/route'));
    const job = JSON.parse(options.body); state.requests.push(job); await state.onRoute?.(job, state.requests.length);
    const model = state.free ? 'fixture/free-model:free' : 'local-model:latest';
    const trace = state.free ? [{ destination: 'free', model, provider: 'DeepInfra', gateway: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions', cost: 'zero', cost_basis: 'free-variant+zero-price-ceiling+response-usage',
      route_id: 'fixture-free', attempt: 1, status: 'ready' }] : [{ destination: 'local', model, status: 'ready' }];
    return Response.json({ text: 'A recorded event [S1].', model, routeId: `fixture-route-${state.requests.length}`, trace,
      evidenceRevision: state.wrongRevision ? job.evidence.revision + 1 : job.evidence.revision,
      sources: [...job.evidence.references, ...(state.extraSource ? [{ ref: 'unrequested', revision: 1 }] : [])] });
  } });
  state.provider = createObusChronicleProvider({ transport, evidenceBridge: state.bridge, campaigns: ['harbor'],
    authorizeCommand: async () => { await state.onAuthorize?.(); return state.allowed; },
    onReceipt: async receipt => { state.receipts.push(receipt); await state.onReceipt?.(receipt); } });
  state.service = new ChronicleService({ store, provider: state.provider, images: {}, dataDir: 'unused-fixture-output' });
  state.write = () => state.provider.writeReferences('summary', state.references(), state.context());
  return state;
}

test('real store, bridge, provider and transport use v2 while chat arrives during generation and receipt storage', async t => {
  for (const free of [false, true]) await t.test(free ? 'permitted free fixture' : 'local fixture', async t => {
    const state = fixture(t); state.free = free;
    const context = state.context(), references = state.references();
    state.onRoute = () => { state.add(BOB, 'Later chat during inference.'); };
    state.onReceipt = () => { state.add(BOB, 'Still later chat during receipt.'); };
    const text = await state.provider.writeReferences('summary', references, context);
    assert.equal(text, 'A recorded event [S1].');
    assert.equal(state.requests.length, 1); assert.equal(state.receipts.length, 1);
    const job = state.requests[0];
    assert.equal(job.evidence.contract, CONTRACT); assert.match(job.evidence.selectionHash, /^[0-9a-f]{64}$/);
    assert.equal(job.evidence.revision, context.sourceRevision); assert.deepEqual(job.evidence.references, references);
    assert.equal(job.instructions, ''); assert.equal(job.promptTemplate, 'session-summary-v1');
    assert.equal(job.policy.codex, false); assert.equal(job.policy.tools, false);
    assert.ok(!JSON.stringify(job.evidence).includes('Later chat'));
    assert.equal(state.receipts[0].sourceRevision, context.sourceRevision);
  });
});

test('selection is captured before the first asynchronous authorization', async t => {
  const state = fixture(t); let changed = false;
  state.onAuthorize = () => { if (!changed) { changed = true; state.store.externalConsent(state.session.id, ALICE, false); } };
  await assert.rejects(state.write(), { code: 'CHRONICLE_STALE' });
  assert.equal(state.requests.length, 0); assert.equal(state.receipts.length, 0);
});

test('relevant changes during generation or asynchronous receipt reject stale text', async t => {
  for (const point of ['onRoute', 'onReceipt']) for (const change of ['consent', 'capture', 'correction', 'authorization']) await t.test(`${point}:${change}`, async t => {
    const state = fixture(t), entry = state.store.evidence(state.session.id)[0];
    state[point] = () => {
      if (change === 'consent') state.store.externalConsent(state.session.id, ALICE, false);
      else if (change === 'capture') state.store.consent(state.session.id, ALICE, false);
      else if (change === 'authorization') state.allowed = false;
      else state.store.correct(state.session.id, entry.seq, 'Corrected red beacon.', ALICE, false, 'fix');
    };
    await assert.rejects(state.write(), { code: change === 'authorization' ? 'CHRONICLE_UNAUTHORIZED' : 'CHRONICLE_STALE' });
    assert.equal(state.requests.length, 1);
    if (point === 'onRoute') assert.equal(state.receipts.length, 0);
  });
});

test('unsupported selection capability, mismatched response revision and unrequested sources fail closed', async t => {
  for (const kind of ['unsupported', 'string-capability', 'revision', 'extra-source']) await t.test(kind, async t => {
    const state = fixture(t);
    if (kind === 'unsupported') state.support = [];
    else if (kind === 'string-capability') state.support = CONTRACT;
    else if (kind === 'revision') state.wrongRevision = true;
    else state.extraSource = true;
    await assert.rejects(state.write());
    assert.equal(state.receipts.length, 0);
    if (kind.includes('capability') || kind === 'unsupported') assert.equal(state.requests.length, 0);
  });
});

test('a captured selection allows unrelated participant changes but not relevant consent', async t => {
  const state = fixture(t), captured = state.bridge.captureSelection({ ...state.context(), references: state.references() });
  state.store.externalConsent(state.session.id, BOB, false);
  assert.equal(captured.check(), undefined);
  await captured.sync();
  state.store.externalConsent(state.session.id, ALICE, false);
  assert.throws(() => captured.check(), { code: 'EVIDENCE_CHANGED_DURING_SYNC' });
});

test('synchronization persists only the captured prefix and worker acknowledges that revision', async t => {
  const state = fixture(t), original = state.store.evidenceRevision(state.session.id); let added = false;
  state.onSync = (_snapshot, check) => { if (!added) { added = true; state.add(BOB, 'New chat during upload.'); check(); } };
  const receipt = await state.service.evidenceTick();
  assert.equal(receipt.revision, original);
  assert.equal(state.store.evidenceSync(state.session.id).revision, original);
  assert.ok(state.store.evidenceRevision(state.session.id) > original);
  state.onSync = null;
  const next = await state.service.evidenceTick();
  assert.equal(next.revision, state.store.evidenceRevision(state.session.id));
});

test('service saves exactly the captured window while new chat keeps arriving', async t => {
  const state = fixture(t, 33), oldEnd = state.store.evidence(state.session.id).at(-1).seq;
  assert.equal(state.service.sourceChunks(state.store.evidence(state.session.id)).length, 2);
  state.onRoute = () => { state.add(BOB, 'Another new message.'); };
  const summary = await state.service.summarize(state.session.id, { force: true });
  assert.ok(summary); assert.equal(summary.through, oldEnd);
  assert.equal(state.store.get(state.session.id).watermark, oldEnd);
  assert.equal(state.requests.length, 2);
  assert.equal(state.store.entries(state.session.id).filter(row => row.kind === 'summary').length, 1);
  assert.equal(state.store.evidence(state.session.id, oldEnd).length, 2);
});

test('a consent change affecting an earlier completed chunk prevents the aggregate commit', async t => {
  const state = fixture(t, 33);
  const groups = state.service.sourceChunks(state.store.evidence(state.session.id));
  assert.equal(groups.length, 2);
  state.onRoute = (_job, number) => { if (number === 2) state.store.externalConsent(state.session.id, ALICE, false); };
  const summary = await state.service.summarize(state.session.id, { force: true });
  assert.equal(summary, null);
  assert.equal(state.requests.length, 2); assert.equal(state.receipts.length, 2);
  assert.equal(state.store.get(state.session.id).watermark, 0);
  assert.equal(state.store.entries(state.session.id).filter(row => row.kind === 'summary').length, 0);
});

test('final transaction checks selected consent after the provider has returned', async t => {
  const state = fixture(t), transact = state.store.transaction.bind(state.store); let armed = false;
  const write = state.provider.writeReferences.bind(state.provider);
  state.service.provider = { ...state.provider, async writeReferences(...args) { const result = await write(...args); armed = true; return result; } };
  state.store.transaction = work => {
    if (armed) { armed = false; state.store.externalConsent(state.session.id, ALICE, false); }
    return transact(work);
  };
  const summary = await state.service.summarize(state.session.id, { force: true });
  assert.equal(summary, null); assert.equal(state.requests.length, 1);
  assert.equal(state.store.get(state.session.id).watermark, 0);
});

test('correction of newly appended unselected chat does not invalidate the captured summary', async t => {
  const state = fixture(t), end = state.store.evidence(state.session.id).at(-1).seq;
  state.onRoute = () => {
    const later = state.add(BOB, 'An unrelated later guess.');
    state.store.correct(state.session.id, later.seq, 'A corrected later fact.', BOB, false, 'later-fix');
  };
  const summary = await state.service.summarize(state.session.id, { force: true });
  assert.ok(summary); assert.equal(summary.through, end);
  const correction = state.store.entries(state.session.id).filter(row => row.kind === 'correction').at(-1);
  assert.equal(summary.correctionVersion, correction.seq);
  assert.ok(state.store.evidence(state.session.id, end).some(row => row.text === 'A corrected later fact.'));
});
