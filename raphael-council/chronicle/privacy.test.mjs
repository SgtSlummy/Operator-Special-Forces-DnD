import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { speechFixture, runtimeFixture } from './speech-context.fixture.mjs';

const user = '222222222222222222';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t, provider = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chronicle-privacy-'));
  const store = new ChronicleStore(join(dataDir, 'chronicle.sqlite'));
  const session = store.start({ campaign: 'privacy-fixture', title: 'Harbor watch', mode: 'human', host: '111111111111111111', channel: '333333333333333333', sourceChannel: '444444444444444444', requestId: 'start' });
  const service = new ChronicleService({ store, dataDir, provider: { captureRuntime: async () => runtimeFixture(), authorizeParticipant: async () => true, write: async () => 'The party reached the harbor.', transcribe: async () => 'The harbor is quiet.', ...provider } });
  t.after(async () => { await service.close(); store.close(); rmSync(dataDir, { recursive: true, force: true }); });
  store.consent(session.id, user, true);
  return { store, service, id: session.id };
}
function note(store, id, text = 'The party reached the harbor.') {
  return store.record(id, 'discord:message-one', { user, speaker: 'Maren', text });
}

test('withdrawal followed by renewed capture consent discards an in-flight utterance and clears its audio', async t => {
  const transcription = deferred(), entered = deferred();
  const { store, service, id } = fixture(t, { transcribe: () => { entered.resolve(); return transcription.promise; } });
  const bytes = Buffer.alloc(64, 7), captureEpoch = store.privacy(id, user).captureEpoch;
  const pending = service.speech(id, { user, speaker: 'Maren', bytes, ...speechFixture(store, id, user, 'old', captureEpoch) });
  await entered.promise;
  store.consent(id, user, false);
  store.consent(id, user, true);
  transcription.resolve('Audio captured before withdrawal.');
  await pending;
  assert.equal(store.hasConsent(id, user), true);
  assert.equal(store.find(id, 'voice:old'), null);
  assert.ok(bytes.every(value => value === 0));
  const fresh = Buffer.alloc(64, 3);
  await service.speech(id, { user, speaker: 'Maren', bytes: fresh, ...speechFixture(store, id, user, 'fresh') });
  assert.equal(store.find(id, 'voice:fresh').text, 'Audio captured before withdrawal.');
  assert.ok(fresh.every(value => value === 0));
});

test('stale capture epochs are rejected before dispatch and failed transcription clears audio', async t => {
  let calls = 0;
  const { store, service, id } = fixture(t, { transcribe: async () => { calls++; throw new Error('Unavailable'); } });
  const captureEpoch = store.privacy(id, user).captureEpoch;
  store.consent(id, user, false); store.consent(id, user, true);
  const oldBytes = Buffer.alloc(64, 4);
  await service.speech(id, { user, speaker: 'Maren', bytes: oldBytes, ...speechFixture(store, id, user, 'stale', captureEpoch) });
  assert.equal(calls, 0);
  assert.ok(oldBytes.every(value => value === 0));
  const failedBytes = Buffer.alloc(64, 5);
  await service.speech(id, { user, speaker: 'Maren', bytes: failedBytes, ...speechFixture(store, id, user, 'failed') });
  assert.equal(calls, 1);
  assert.ok(failedBytes.every(value => value === 0));
  assert.equal(store.entries(id).filter(entry => entry.kind === 'gap').length, 1);
});

test('a correction during generation discards the stale summary without advancing its watermark', async t => {
  const entered = deferred(), generated = deferred();
  const { store, service, id } = fixture(t, { write: async () => { entered.resolve(); return generated.promise; } });
  const entry = note(store, id, 'The north gate was open.');
  const pending = service.summarize(id, { force: true });
  await entered.promise;
  store.correct(id, entry.seq, 'The north gate was closed.', user, false, 'correction');
  const watermark = store.get(id).watermark;
  generated.resolve('The party used the open north gate.');
  assert.equal(await pending, null);
  assert.equal(store.get(id).watermark, watermark);
  assert.equal(store.entries(id).filter(item => item.kind === 'summary').length, 0);
  assert.equal(store.evidence(id).find(item => item.seq === entry.seq).text, 'The north gate was closed.');
});

test('a summary finishing after pause preserves the latest session controls', async t => {
  const entered = deferred(), generated = deferred();
  const { store, service, id } = fixture(t, { write: async () => { entered.resolve(); return generated.promise; } });
  note(store, id);
  const pending = service.summarize(id, { force: true });
  await entered.promise;
  store.control(id, 'pause', 'pause');
  store.control(id, 'minutes', 'minutes', 20);
  generated.resolve('The party reached the harbor.');
  assert.equal((await pending).kind, 'summary');
  assert.equal(store.get(id).status, 'paused');
  assert.equal(store.get(id).minutes, 20);
});

test('ending drains speech and discards an outstanding interval summary without reopening the session', async t => {
  const entered = deferred(), generated = deferred(), transcription = deferred();
  let writes = 0;
  const { store, service, id } = fixture(t, {
    transcribe: () => transcription.promise,
    write: async () => { if (++writes === 1) { entered.resolve(); return generated.promise; } return 'The party reached the harbor.'; },
  });
  note(store, id);
  const summary = service.summarize(id, { force: true });
  await entered.promise;
  const bytes = Buffer.alloc(64, 9);
  const speech = service.speech(id, { user, speaker: 'Maren', bytes, ...speechFixture(store, id, user, 'last') });
  const ending = service.end(id);
  await Promise.resolve();
  assert.equal(store.get(id).status, 'ending');
  transcription.resolve('A bell rang at the harbor.');
  generated.resolve('A now-obsolete interval summary.');
  await speech;
  assert.equal(await summary, null);
  const ended = await ending;
  assert.equal(ended.status, 'ended');
  assert.equal(store.get(id).status, 'ended');
  assert.equal(store.find(id, 'voice:last').text, 'A bell rang at the harbor.');
  assert.ok(bytes.every(value => value === 0));
  assert.equal(store.entries(id).filter(item => item.kind === 'summary').length, 0);
  assert.equal(store.entries(id).filter(item => item.kind === 'recap').length, 1);
});

test('external consent does not export full transcript summaries or final recaps', async t => {
  const requests = [];
  const { store, service, id } = fixture(t, { write: async (kind, evidence, scope) => { requests.push({ kind, evidence, scope }); return 'The party reached the harbor.'; } });
  store.externalConsent(id, user, true);
  note(store, id);
  await service.summarize(id, { force: true });
  await service.end(id);
  assert.ok(requests.some(request => request.kind === 'summary'));
  assert.ok(requests.some(request => request.kind === 'final'));
  for (const { scope } of requests) {
    assert.equal(scope.exportable, false);
    assert.equal(scope.campaign, 'privacy-fixture');
    assert.equal(scope.session, id);
  }
});
