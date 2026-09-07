import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { createStoryProvider } from './provider.mjs';
import { speechFixture, runtimeFixture } from './speech-context.fixture.mjs';

const owner = '222222222222222222';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(t, overrides = {}) {
  const store = new ChronicleStore(':memory:');
  const session = store.start({ campaign: 'speech-scope', host: '111111111111111111', title: 'Scope test', mode: 'human', channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: 'start' });
  store.consent(session.id, owner, true);
  const calls = [];
  const provider = { captureRuntime: async () => runtimeFixture(), write: async () => 'Saved recap.', authorizeParticipant: async () => true,
    transcribe: async (bytes, context) => { calls.push(context); return 'Maren hears a bell.'; }, ...overrides };
  const service = new ChronicleService({ store, dataDir: tmpdir(), provider });
  t.after(async () => { await service.close(); store.close(); });
  const segment = (requestId = 'segment') => ({ user: owner, speaker: 'Maren', bytes: Buffer.alloc(64, 4), ...speechFixture(store, session.id, owner, requestId) });
  return { store, service, provider, id: session.id, calls, segment };
}

test('speech fails closed without captured context, participant authority or matching session scope', async t => {
  const f = fixture(t);
  for (const mutate of [value => { delete value.context; }, value => { delete value.authorizeParticipant; }, value => { value.context.scope.owner = '999999999999999999'; },
    value => { value.context.scope.campaign = 'other'; }, value => { value.context.session = 'other'; }, value => { value.context.capturedConsentEpoch++; }]) {
    const segment = f.segment(); mutate(segment); await f.service.speech(f.id, segment);
    assert.ok(segment.bytes.every(value => value === 0));
  }
  f.provider.authorizeParticipant = undefined;
  const segment = f.segment(); await f.service.speech(f.id, segment);
  assert.equal(f.calls.length, 0); assert.ok(segment.bytes.every(value => value === 0));
  assert.equal(f.store.entries(f.id).filter(entry => entry.medium === 'voice').length, 0);
});

test('speech snapshots the original capture before awaiting campaign membership', async t => {
  const entered = deferred(), release = deferred(); let checks = 0;
  const f = fixture(t, { authorizeParticipant: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } return true; } });
  const segment = f.segment(), expected = structuredClone(segment.context);
  const task = f.service.speech(f.id, segment);
  await entered.promise; segment.context.scope.campaign = 'other'; segment.context.session = 'other'; segment.context.capturedRuntime.sessionPolicyRevision++;
  release.resolve(); await task;
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], expected);
  assert.equal(f.store.find(f.id, 'voice:segment').text, 'Maren hears a bell.');
  assert.ok(Object.isFrozen(f.calls[0].capturedRuntime));
});

test('membership removal during inference prevents the late transcript commit', async t => {
  const entered = deferred(), release = deferred(); let member = true, calls = 0;
  const f = fixture(t, { authorizeParticipant: async () => member, transcribe: async () => { calls++; entered.resolve(); await release.promise; return 'Private late text.'; } });
  const segment = f.segment(); const work = f.service.speech(f.id, segment);
  await entered.promise; member = false; release.resolve(); await work;
  assert.equal(calls, 1); assert.equal(f.store.find(f.id, 'voice:segment'), null); assert.ok(segment.bytes.every(value => value === 0));
});

test('Discord audience withdrawal during inference prevents the late transcript commit', async t => {
  const entered = deferred(), release = deferred(); let present = true, calls = 0;
  const f = fixture(t, { transcribe: async () => { calls++; entered.resolve(); await release.promise; return 'Out-of-channel text.'; } });
  const segment = f.segment(); segment.authorizeParticipant = async () => present;
  const work = f.service.speech(f.id, segment);
  await entered.promise; present = false; release.resolve(); await work;
  assert.equal(calls, 1); assert.equal(f.store.find(f.id, 'voice:segment'), null); assert.ok(segment.bytes.every(value => value === 0));
});

test('host generation changes during late audience checks suppress the completed transcript', async t => {
  let runtime = runtimeFixture(), audienceChecks = 0;
  const entered = deferred(), release = deferred();
  const f = fixture(t, { captureRuntime: async () => runtime });
  const segment = f.segment();
  segment.authorizeParticipant = async () => { if (++audienceChecks === 2) { entered.resolve(); await release.promise; } return true; };
  const work = f.service.speech(f.id, segment);
  await entered.promise; assert.equal(f.calls.length, 1);
  runtime = { ...runtime, generation: '33333333-3333-4333-8333-333333333333' }; release.resolve(); await work;
  assert.equal(f.store.find(f.id, 'voice:segment'), null); assert.ok(segment.bytes.every(value => value === 0));
});

test('default provider forwards the captured scope and protects it across membership awaits', async () => {
  const entered = deferred(), release = deferred(), captures = []; let checks = 0, receivedAudio;
  const provider = createStoryProvider({ transport: { transcribe: async (bytes, context) => { receivedAudio = bytes; captures.push(context); return 'Scoped transcript.'; } },
    authorizeParticipant: async () => { if (++checks === 1) { entered.resolve(); await release.promise; } return true; } });
  const context = { scope: { campaign: 'speech-scope', owner, role: 'player' }, session: 'session', requestId: 'segment', capturedRuntime: runtimeFixture(), capturedConsentEpoch: 1 };
  const expected = structuredClone(context), bytes = Buffer.alloc(64, 4);
  const work = provider.transcribe(bytes, context); await entered.promise;
  context.scope.owner = '999999999999999999'; context.capturedRuntime.generation = '33333333-3333-4333-8333-333333333333'; bytes.fill(8);
  release.resolve(); assert.equal(await work, 'Scoped transcript.'); assert.deepEqual(captures, [expected]); assert.ok(receivedAudio.every(value => value === 0));
});

test('default provider separates host runtime authority from participant speech authorization', async () => {
  const runtime = runtimeFixture(), seen = []; let currentHost = true;
  const provider = createStoryProvider({ transport: { runtime: async (scope, session) => { seen.push({ scope, session }); return runtime; }, transcribe: async () => { throw new Error('Must not dispatch.'); } },
    authorizeCommand: async () => currentHost, authorizeParticipant: async () => false });
  const scope = { campaign: 'speech-scope', owner, role: 'host' };
  assert.equal(await provider.captureRuntime(scope, 'session'), runtime); assert.equal(seen.length, 1);
  currentHost = false; await assert.rejects(provider.captureRuntime(scope, 'session'), /GM access/); assert.equal(seen.length, 1);
  await assert.rejects(provider.transcribe(Buffer.alloc(64), { scope: { ...scope, role: 'player' }, session: 'session', requestId: 'segment', capturedRuntime: runtime, capturedConsentEpoch: 1 }), /membership/);
  await assert.rejects(provider.transcribe(Buffer.alloc(64)), /Captured speech scope/);
});

test('default provider suppresses results when participant membership changes in flight', async () => {
  let allowed = true, calls = 0;
  const provider = createStoryProvider({ authorizeParticipant: async () => allowed, transport: { transcribe: async () => { calls++; allowed = false; return 'Obsolete.'; } } });
  await assert.rejects(provider.transcribe(Buffer.alloc(64), { scope: { campaign: 'speech-scope', owner, role: 'player' }, session: 'session', requestId: 'segment', capturedRuntime: runtimeFixture(), capturedConsentEpoch: 1 }), /membership changed/);
  assert.equal(calls, 1);
});

test('receipt-only completion records a gap and never repeats inference or commits a fabricated transcript', async t => {
  let calls = 0;
  const f = fixture(t, { transcribe: async () => { calls++; throw Object.assign(new Error('Receipt retained without text.'), { code: 'RECEIPT_ONLY' }); } });
  const segment = f.segment(); await f.service.speech(f.id, segment);
  assert.equal(calls, 1); assert.equal(f.store.find(f.id, 'voice:segment'), null);
  assert.equal(f.store.entries(f.id).filter(entry => entry.kind === 'gap').length, 1);
  assert.ok(segment.bytes.every(value => value === 0));
});
