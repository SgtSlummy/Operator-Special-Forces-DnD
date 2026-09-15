import test from 'node:test';
import assert from 'node:assert/strict';
import { createObusEvidenceBridge, evidenceReferences } from './obus-evidence.mjs';
import { ChronicleStore } from './store.mjs';

const BOOT = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222';
const NEW_GENERATION = '33333333-3333-4333-8333-333333333333';
const INPUT = { campaign: 'harbor', session: 'session1', owner: 'delegated-gm' };
function projection() {
  return { revision: 3, participants: [{ user: 'alice', capture: true, external: true, captureEpoch: 1, externalEpoch: 2 }],
    sources: [{ ref: 'chronicle:session1:E1', revision: 1, audience: 'party', owner: '', text: 'The beacon is blue.', provenance: 'chronicle:session1:typed:E1', deleted: false,
      contributors: [{ user: 'alice', captureEpoch: 1, externalEpoch: 2, exportableAtCapture: true }], derivesFrom: [] }] };
}
function runtime() {
  return { contract: 'raph-obus-game-runtime-v1', bootEpoch: BOOT, generation: GENERATION, sessionPolicyRevision: 2,
    leaseExpiresAtMs: Date.now() + 30000, effectivePolicy: { enabled: true, mode: 'local', codex: false, exportable: false } };
}
function receipt(snapshot) {
  return { contract: 'raph-obus-game-evidence-v1', campaign: snapshot.campaign, session: snapshot.session, revision: snapshot.revision, status: 'saved', sourceCount: snapshot.sources.length, participantCount: snapshot.participants.length };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const state = { evidence: projection(), runtime: runtime(), allowed: true, campaign: 'harbor', commands: [], reads: [], sent: [] };
  state.store = { get(id) { return { id, campaign: state.campaign, host: 'original-creator' }; }, evidenceProjection() { return state.evidence; } };
  state.authorize = command => { state.commands.push(command); return state.allowed; };
  state.hostControl = {
    async getRuntime(scope) { state.reads.push(scope); return structuredClone(state.runtime); },
    async syncEvidence(snapshot) { state.sent.push(snapshot); return receipt(snapshot); },
  };
  state.create = (options = {}) => createObusEvidenceBridge({ store: state.store, hostControl: state.hostControl, campaigns: ['harbor'], authorizeCommand: state.authorize, ...options });
  return state;
}

test('explicit current authorizer permits a delegated GM and signs one complete frozen snapshot', async () => {
  const state = fixture();
  const result = await state.create().sync(INPUT);
  assert.equal(state.sent.length, 1);
  assert.equal(state.reads.length, 2);
  assert.deepEqual(state.sent[0].sources, state.evidence.sources);
  assert.deepEqual(state.sent[0].participants, state.evidence.participants);
  assert.deepEqual(state.sent[0].runtime, { contract: 'raph-obus-game-runtime-v1', bootEpoch: BOOT, generation: GENERATION, sessionPolicyRevision: 2 });
  assert.ok(Object.isFrozen(state.sent[0].sources[0].contributors[0]));
  assert.ok(Object.isFrozen(result));
  assert.ok(state.commands.length >= 6);
  for (const command of state.commands) assert.deepEqual(command, { action: 'evidence.sync', ...INPUT });
});

test('campaign allowlist and explicit synchronous authorization are required before transport', async t => {
  for (const [name, alter] of Object.entries({
    denied: state => { state.allowed = false; },
    'truthy nonboolean': state => { state.allowed = 1; },
    'async authorizer': state => { state.authorize = async () => true; },
    'session from another campaign': state => { state.campaign = 'other'; },
  })) await t.test(name, async () => {
    const state = fixture(); alter(state);
    await assert.rejects(state.create().sync(INPUT), { status: 403 });
    assert.equal(state.reads.length, 0); assert.equal(state.sent.length, 0);
  });
  const state = fixture();
  await assert.rejects(state.create().sync({ ...INPUT, campaign: 'other' }), { status: 403 });
  assert.throws(() => state.create({ authorizeCommand: undefined }), { status: 400 });
  assert.throws(() => state.create({ campaigns: undefined }), { status: 400 });
  assert.equal(state.reads.length, 0);
});

test('authorization withdrawn during initial runtime read prevents any evidence dispatch', async () => {
  const state = fixture();
  state.hostControl.getRuntime = async () => { state.allowed = false; return state.runtime; };
  await assert.rejects(state.create().sync(INPUT), { status: 403 });
  assert.equal(state.sent.length, 0);
});

test('authorization withdrawn during sync or final runtime read rejects the receipt', async t => {
  for (const point of ['sync', 'runtime']) await t.test(point, async () => {
    const state = fixture(); let reads = 0;
    state.hostControl.getRuntime = async () => { if (++reads === 2 && point === 'runtime') state.allowed = false; return state.runtime; };
    state.hostControl.syncEvidence = async snapshot => { if (point === 'sync') state.allowed = false; return receipt(snapshot); };
    await assert.rejects(state.create().sync(INPUT), { status: 403 });
  });
});

test('corrections, consent, and deletions during dispatch reject stale receipts, even without a revision bump', async t => {
  for (const [name, mutate] of Object.entries({
    rollback: state => { state.evidence.revision--; },
    text: state => { state.evidence.sources[0].text = 'A corrected beacon'; },
    consent: state => { state.evidence.participants[0].external = false; state.evidence.participants[0].externalEpoch++; },
    deletion: state => { state.evidence.sources[0].deleted = true; state.evidence.sources[0].text = ''; },
  })) await t.test(name, async () => {
    const state = fixture(), original = structuredClone(state.evidence);
    state.hostControl.syncEvidence = async snapshot => { state.sent.push(snapshot); mutate(state); return receipt(snapshot); };
    await assert.rejects(state.create().sync(INPUT), { code: 'EVIDENCE_CHANGED_DURING_SYNC', status: 409 });
    assert.deepEqual(state.sent[0].sources, original.sources);
    assert.deepEqual(state.sent[0].participants, original.participants);
  });
});

test('runtime restart or policy revision during sync rejects the receipt', async t => {
  for (const field of ['bootEpoch', 'generation', 'sessionPolicyRevision']) await t.test(field, async () => {
    const state = fixture();
    state.hostControl.syncEvidence = async snapshot => {
      state.runtime[field] = field === 'sessionPolicyRevision' ? 3 : NEW_GENERATION;
      return receipt(snapshot);
    };
    await assert.rejects(state.create().sync(INPUT), { code: 'EVIDENCE_CHANGED_DURING_SYNC' });
  });
});

test('disabled generation still permits complete local evidence sync without granting generation authority', async () => {
  const state = fixture(); state.runtime.effectivePolicy.enabled = false;
  const before = structuredClone(state.runtime);
  state.hostControl.generate = async () => assert.fail('evidence sync cannot generate');
  state.hostControl.configure = async () => assert.fail('evidence sync cannot enable generation');
  const result = await state.create().sync(INPUT);
  assert.equal(state.sent.length, 1);
  assert.deepEqual(state.runtime, before);
  assert.equal(state.runtime.effectivePolicy.enabled, false);
  assert.deepEqual(Object.keys(result).sort(), ['campaign', 'contract', 'participantCount', 'revision', 'session', 'sourceCount', 'status']);
  assert.equal(Object.hasOwn(result, 'effectivePolicy'), false);
});

test('free-enabled host policy permits private signed sync without granting generation or consent', async t => {
  for (const enabled of [true, false]) for (const exportable of [true, false]) await t.test(`enabled=${enabled}, exportable=${exportable}`, async () => {
    const state = fixture(); state.runtime.effectivePolicy = { enabled, mode: 'local-free', codex: false, exportable };
    state.evidence.participants[0].external = false;
    const before = structuredClone(state.runtime);
    state.hostControl.generate = async () => assert.fail('sync does not dispatch models');
    state.hostControl.configure = async () => assert.fail('sync does not update policy');
    await state.create().sync(INPUT);
    assert.deepEqual(state.runtime, before);
    assert.equal(state.sent[0].participants[0].external, false);
    assert.equal(Object.hasOwn(state.sent[0], 'policy'), false);
  });
});

test('missing or expired lease, unknown policy and disappearing runtime still prevent evidence sync', async t => {
  for (const [name, mutate] of Object.entries({
    'expired lease': state => { state.runtime.leaseExpiresAtMs = Date.now() - 1; },
    'missing lease': state => { delete state.runtime.leaseExpiresAtMs; },
    'missing generation': state => { state.runtime.generation = null; },
    'unknown policy': state => { state.runtime.effectivePolicy.mode = 'auto'; },
    'Codex policy': state => { state.runtime.effectivePolicy.codex = true; },
    'malformed export policy': state => { state.runtime.effectivePolicy.exportable = 1; },
    'invalid enabled': state => { state.runtime.effectivePolicy.enabled = 0; },
  })) await t.test(name, async () => {
    const state = fixture(); mutate(state);
    await assert.rejects(state.create().sync(INPUT), { code: 'EVIDENCE_RUNTIME_UNAVAILABLE' });
    assert.equal(state.sent.length, 0);
  });
  const second = fixture();
  second.hostControl.syncEvidence = async snapshot => { second.runtime.generation = null; return receipt(snapshot); };
  await assert.rejects(second.create().sync(INPUT), { code: 'EVIDENCE_RUNTIME_UNAVAILABLE' });
});

test('evidence is rechecked after final asynchronous runtime read', async () => {
  const state = fixture(); let count = 0;
  state.hostControl.getRuntime = async () => { if (++count === 2) { state.evidence.revision++; state.evidence.sources[0].text = 'Late correction.'; } return state.runtime; };
  await assert.rejects(state.create().sync(INPUT), { code: 'EVIDENCE_CHANGED_DURING_SYNC' });
});

test('mismatched and augmented receipts never become trusted reference receipts', async t => {
  for (const [field, value] of [['campaign', 'other'], ['session', 'other'], ['revision', 10], ['sourceCount', 0], ['participantCount', 0], ['inline', 'secret']]) await t.test(field, async () => {
    const state = fixture(); state.hostControl.syncEvidence = async snapshot => ({ ...receipt(snapshot), [field]: value });
    await assert.rejects(state.create().sync(INPUT), { code: 'INVALID_EVIDENCE_RECEIPT', status: 502 });
  });
});

test('request scope is captured before waiting and cannot be changed by its caller', async () => {
  const state = fixture(), gate = deferred(), input = { ...INPUT }; let count = 0;
  state.hostControl.getRuntime = async scope => { state.reads.push(scope); if (++count === 1) await gate.promise; return state.runtime; };
  const pending = state.create().sync(input);
  input.owner = 'intruder'; input.campaign = 'other'; input.session = 'other';
  gate.resolve(); await pending;
  assert.equal(state.sent[0].campaign, INPUT.campaign);
  assert.equal(state.sent[0].session, INPUT.session);
  assert.ok(state.commands.every(command => command.owner === INPUT.owner));
});

test('large complete projections preserve every source and verify the final receipt', async () => {
  const state = fixture();
  state.evidence.sources = Array.from({ length: 2050 }, (_, index) => ({ ...state.evidence.sources[0], ref: `ref:${index}` }));
  const saved = await state.create().sync(INPUT);
  assert.equal(saved.sourceCount, 2050); assert.equal(state.sent[0].sources.length, 2050);
  assert.ok(Object.isFrozen(state.sent[0].sources));
});

test('per-page guard notices consent, correction and authorization changes before further upload', async t => {
  for (const [name, mutate, code] of [
    ['consent', state => { state.evidence.participants[0].external = false; }, 'EVIDENCE_CHANGED_DURING_SYNC'],
    ['correction', state => { state.evidence.sources[0].text = 'corrected'; }, 'EVIDENCE_CHANGED_DURING_SYNC'],
    ['authorization', state => { state.allowed = false; }, 'EVIDENCE_ACCESS_DENIED'],
  ]) await t.test(name, async () => {
    const state = fixture(); let reached = false;
    state.hostControl.syncEvidence = async (snapshot, assertCurrent) => {
      assertCurrent(); mutate(state); assertCurrent(); reached = true; return receipt(snapshot);
    };
    await assert.rejects(state.create().sync(INPUT), { code }); assert.equal(reached, false);
  });
});

test('oversized complete projections fail closed instead of silently truncating', async () => {
  const state = fixture();
  state.evidence.sources = Array.from({ length: 65537 }, (_, index) => ({ ...state.evidence.sources[0], ref: `ref:${index}` }));
  await assert.rejects(state.create().sync(INPUT), { status: 400 });
  assert.equal(state.sent.length, 0);
});

test('identical evidence may synchronize under a new runtime after restart', async () => {
  const state = fixture(), bridge = state.create();
  const first = await bridge.sync(INPUT);
  state.runtime.bootEpoch = NEW_GENERATION; state.runtime.generation = BOOT;
  const second = await bridge.sync(INPUT);
  assert.equal(first.revision, second.revision);
  assert.deepEqual(state.sent[0].sources, state.sent[1].sources);
  assert.notDeepEqual(state.sent[0].runtime, state.sent[1].runtime);
});

test('reference helper emits frozen bounded refs only; it grants no inline-content authority', async t => {
  const saved = { ...receipt({ ...INPUT, ...projection() }), sourceCount: 40 };
  const references = [{ ref: 'chronicle:session1:E1', revision: 1 }];
  const result = evidenceReferences(saved, references);
  assert.deepEqual(result, { contract: 'raph-obus-game-evidence-refs-v1', revision: 3, references });
  assert.ok(Object.isFrozen(result.references[0]));
  references[0].revision = 2;
  assert.equal(result.references[0].revision, 1);
  const cases = {
    'more than 32': Array.from({ length: 33 }, (_, i) => ({ ref: `ref:${i}`, revision: 1 })),
    'inline text': [{ ref: 'ref:1', revision: 1, text: 'Cannot inject this' }],
    duplicate: [{ ref: 'ref:1', revision: 1 }, { ref: 'ref:1', revision: 1 }],
    fractional: [{ ref: 'ref:1', revision: 1.5 }],
    'overlong ref': [{ ref: 'x'.repeat(161), revision: 1 }],
  };
  for (const [name, input] of Object.entries(cases)) await t.test(name, () => assert.throws(() => evidenceReferences(saved, input), { status: 400 }));
  assert.throws(() => evidenceReferences({ ...saved, sourceCount: 0 }, [{ ref: 'ref:1', revision: 1 }]), { status: 400 });
  assert.throws(() => evidenceReferences({ ...saved, extra: true }, []), { status: 400 });
});

test('real ChronicleStore projection passes the bridge complete and retains its source lineage', async () => {
  const store = new ChronicleStore(':memory:');
  try {
    const session = store.start({ campaign: 'harbor', title: 'Synthetic', mode: 'human', host: '111111111111111111', channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: 'start' });
    store.consent(session.id, '222222222222222222', true);
    store.externalConsent(session.id, '222222222222222222', true);
    store.record(session.id, 'discord:fixture', { user: '222222222222222222', speaker: 'Synthetic', text: 'The beacon is blue.' });
    const projected = store.evidenceProjection(session.id), sent = [];
    const bridge = createObusEvidenceBridge({ store, campaigns: ['harbor'], authorizeCommand: command => command.owner === 'delegated-gm', hostControl: {
      async getRuntime() { return runtime(); }, async syncEvidence(snapshot) { sent.push(snapshot); return receipt(snapshot); },
    } });
    const result = await bridge.sync({ campaign: 'harbor', session: session.id, owner: 'delegated-gm' });
    assert.equal(result.revision, projected.revision);
    assert.deepEqual(sent[0].sources, projected.sources);
    assert.deepEqual(sent[0].participants, projected.participants);
    assert.ok(projected.sources.some(source => source.text === 'The beacon is blue.'));
    assert.ok(projected.sources.every(source => source.contributors.length > 0));
  } finally { store.close(); }
});
