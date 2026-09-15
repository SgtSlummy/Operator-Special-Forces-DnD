import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ChronicleStore } from './store.mjs';

const host = '111111111111111111', player = '222222222222222222', editor = '333333333333333333';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-evidence-'));
  const path = join(directory, 'chronicle.sqlite');
  const value = { store: new ChronicleStore(path) };
  const session = value.store.start({ campaign: 'synthetic-evidence', title: 'Harbor evidence', mode: 'human', host,
    channel: '444444444444444444', sourceChannel: '555555555555555555', requestId: 'start' });
  value.id = session.id;
  value.restart = () => { value.store.close(); value.store = new ChronicleStore(path); };
  t.after(() => {
    value.store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  return value;
}
function optIn(store, id, user = player) { store.consent(id, user, true); store.externalConsent(id, user, true); }
function record(store, id, source = 'discord:one', text = 'The beacon is blue.') {
  return store.record(id, source, { user: player, speaker: 'Maren', text });
}
function projected(store, id, seq) {
  return store.evidenceProjection(id).sources.find(source => source.ref === `chronicle:${id}:E${seq}`);
}
function externallyCurrent(source, snapshot) {
  return source.contributors.length > 0 && source.contributors.every(contributor => {
    const participant = snapshot.participants.find(value => value.user === contributor.user);
    return contributor.exportableAtCapture && participant?.capture && participant.external &&
      contributor.captureEpoch === participant.captureEpoch && contributor.externalEpoch === participant.externalEpoch;
  });
}

test('projection revisions and complete snapshots survive restart without changing on receipt replay', t => {
  const f = fixture(t);
  assert.deepEqual(f.store.evidenceProjection(f.id), { revision: 0, participants: [], sources: [] });
  f.restart();
  assert.equal(f.store.evidenceProjection(f.id).revision, 0);
  f.store.consent(f.id, player, true);
  assert.equal(f.store.evidenceProjection(f.id).revision, 1);
  f.store.externalConsent(f.id, player, true);
  const entry = record(f.store, f.id);
  const saved = f.store.evidenceProjection(f.id);
  assert.equal(saved.revision, 3);
  assert.deepEqual(saved.participants, [{ user: player, capture: true, external: true, captureEpoch: 1, externalEpoch: 1 }]);
  assert.deepEqual(saved.sources, [{ ref: `chronicle:${f.id}:E${entry.seq}`, revision: entry.seq, audience: 'party', owner: '',
    text: 'The beacon is blue.', provenance: `chronicle:${f.id}:transcript:E${entry.seq}`, deleted: false,
    contributors: [{ user: player, captureEpoch: 1, externalEpoch: 1, exportableAtCapture: true }], derivesFrom: [] }]);
  assert.equal(entry.captureEpoch, 1);
  f.store.consent(f.id, player, true); f.store.externalConsent(f.id, player, true);
  assert.equal(record(f.store, f.id).seq, entry.seq);
  assert.deepEqual(f.store.evidenceProjection(f.id), saved);
  f.restart();
  assert.deepEqual(f.store.evidenceProjection(f.id), saved);
});

test('withdrawal and re-opt-in advance permission revisions without blessing previously captured evidence', t => {
  const { store, id } = fixture(t);
  optIn(store, id);
  const old = record(store, id), first = store.evidenceProjection(id);
  assert.equal(externallyCurrent(projected(store, id, old.seq), first), true);
  store.externalConsent(id, player, false);
  const withdrawn = store.evidenceProjection(id);
  assert.equal(withdrawn.revision, first.revision + 1);
  assert.equal(externallyCurrent(projected(store, id, old.seq), withdrawn), false);
  store.externalConsent(id, player, true);
  const renewed = store.evidenceProjection(id);
  assert.equal(renewed.revision, withdrawn.revision + 1);
  assert.deepEqual(renewed.sources, first.sources);
  assert.equal(externallyCurrent(projected(store, id, old.seq), renewed), false);
  const fresh = record(store, id, 'discord:fresh');
  assert.equal(externallyCurrent(projected(store, id, fresh.seq), store.evidenceProjection(id)), true);
  store.consent(id, player, false); store.consent(id, player, true);
  const recaptured = store.evidenceProjection(id);
  assert.equal(recaptured.participants[0].captureEpoch, 3);
  assert.equal(externallyCurrent(projected(store, id, fresh.seq), recaptured), false);
  assert.equal(store.record(id, 'voice:stale', { user: player, speaker: 'Maren', text: 'Stale speech.', captureEpoch: 1 }), null);
  assert.deepEqual(store.evidenceProjection(id), recaptured);
});

test('corrections advance stable source revisions and retain original and every correcting contributor', t => {
  const { store, id } = fixture(t);
  for (const user of [player, host, editor]) optIn(store, id, user);
  const entry = record(store, id), before = store.evidenceProjection(id);
  const first = store.correct(id, entry.seq, 'The beacon is green.', host, true, 'first');
  const second = store.correct(id, entry.seq, 'The beacon is amber.', editor, true, 'second');
  const snapshot = store.evidenceProjection(id), source = projected(store, id, entry.seq);
  assert.equal(snapshot.revision, before.revision + 2);
  assert.equal(source.ref, `chronicle:${id}:E${entry.seq}`);
  assert.equal(source.revision, second.seq);
  assert.equal(source.text, 'The beacon is amber.');
  assert.deepEqual(source.contributors.map(value => value.user), [player, host, editor]);
  assert.equal(first.captureEpoch, 1); assert.equal(first.externalEpoch, 1); assert.equal(first.exportableAtCapture, true);
  const evidence = store.evidence(id).find(value => value.seq === entry.seq);
  assert.equal(evidence.corrected, true); assert.equal(evidence.revision, second.seq);
  assert.deepEqual(evidence.contributors, source.contributors);
  store.correct(id, entry.seq, 'The beacon is amber.', editor, true, 'second');
  assert.deepEqual(store.evidenceProjection(id), snapshot);
  store.externalConsent(id, host, false);
  assert.equal(externallyCurrent(projected(store, id, entry.seq), store.evidenceProjection(id)), false);
});

test('Discord edits and deletions retain lineage and publish durable empty-text tombstones', t => {
  const f = fixture(t); optIn(f.store, f.id);
  const entry = record(f.store, f.id), before = f.store.evidenceProjection(f.id);
  f.store.externalConsent(f.id, player, false);
  const edit = f.store.reviseMessage(f.id, 'one', { text: 'The beacon is dark.', requestId: 'edit' });
  const edited = projected(f.store, f.id, entry.seq);
  assert.equal(edited.revision, edit.seq);
  assert.equal(edited.text, 'The beacon is dark.');
  assert.deepEqual(edited.contributors, [{ user: player, captureEpoch: 1, externalEpoch: null, exportableAtCapture: false }]);
  const lineage = f.store.projectedEntries(f.id).find(value => value.ref === edited.ref).contributors;
  assert.deepEqual(lineage.map(value => value.externalEpoch), [1, 2]);
  assert.deepEqual(lineage.map(value => value.exportableAtCapture), [true, false]);
  assert.equal(externallyCurrent(edited, f.store.evidenceProjection(f.id)), false);
  const removal = f.store.reviseMessage(f.id, 'one', { deleted: true, requestId: 'delete' });
  const snapshot = f.store.evidenceProjection(f.id), tombstone = projected(f.store, f.id, entry.seq);
  assert.equal(snapshot.revision, before.revision + 3);
  assert.equal(tombstone.revision, removal.seq); assert.equal(tombstone.deleted, true); assert.equal(tombstone.text, '');
  assert.deepEqual(tombstone.contributors, edited.contributors);
  assert.equal(f.store.evidence(f.id).some(value => value.seq === entry.seq), false);
  f.store.reviseMessage(f.id, 'one', { deleted: true, requestId: 'delete' });
  assert.deepEqual(f.store.evidenceProjection(f.id), snapshot);
  assert.throws(() => f.store.correct(f.id, entry.seq, 'Restore deleted text.', host, true, 'restore'));
  f.restart(); assert.deepEqual(f.store.evidenceProjection(f.id), snapshot);
});

test('legacy rows receive a durable baseline without manufacturing historical consent or authors', t => {
  const f = fixture(t); optIn(f.store, f.id);
  const entry = record(f.store, f.id);
  const body = JSON.parse(f.store.db.prepare('SELECT body FROM entries WHERE seq=?').get(entry.seq).body);
  delete body.captureEpoch;
  f.store.db.prepare('UPDATE entries SET body=? WHERE seq=?').run(JSON.stringify(body), entry.seq);
  f.store.db.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run(f.id, 'old-correction', 'correction',
    JSON.stringify({ target: entry.seq, text: 'Legacy corrected fact.', user: host, at: 1 }));
  const unknown = f.store.db.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run(f.id, 'old-note', 'note',
    JSON.stringify({ text: 'An unattributed old note.', at: 1 }));
  const noteSeq = Number(unknown.lastInsertRowid), baseline = f.store.revision(f.id);
  f.store.db.exec('DROP TABLE chronicle_projection');
  f.restart();
  const snapshot = f.store.evidenceProjection(f.id), source = projected(f.store, f.id, entry.seq);
  assert.equal(snapshot.revision, baseline); assert.ok(baseline > 0);
  assert.deepEqual(source.contributors, [
    { user: player, captureEpoch: null, externalEpoch: 1, exportableAtCapture: false },
    { user: host, captureEpoch: null, externalEpoch: null, exportableAtCapture: false },
  ]);
  const unknownContributor = { user: 'unknown', captureEpoch: null, externalEpoch: null, exportableAtCapture: false };
  assert.deepEqual(projected(f.store, f.id, noteSeq).contributors, [unknownContributor]);
  optIn(f.store, f.id, host);
  f.store.correct(f.id, noteSeq, 'Reviewed but still unattributed history.', host, true, 'review-old');
  assert.deepEqual(projected(f.store, f.id, noteSeq).contributors[0], unknownContributor);
  assert.equal(externallyCurrent(projected(f.store, f.id, noteSeq), f.store.evidenceProjection(f.id)), false);
  const persisted = f.store.evidenceProjection(f.id);
  f.restart(); assert.deepEqual(f.store.evidenceProjection(f.id), persisted);
});

test('projection mutations and consent roll back with the surrounding transaction and failed delivery enqueue', t => {
  const { store, id } = fixture(t); optIn(store, id);
  const before = store.evidenceProjection(id), beforeEntries = store.entries(id);
  assert.throws(() => store.transaction(() => {
    store.externalConsent(id, player, false);
    store.append(id, 'rolled-back', 'note', { user: player, text: 'Never committed.' });
    throw new Error('Abort fixture transaction.');
  }), /Abort fixture/);
  assert.deepEqual(store.evidenceProjection(id), before);
  assert.deepEqual(store.entries(id), beforeEntries);
  const enqueue = store.enqueue;
  store.enqueue = () => { throw new Error('Synthetic enqueue failure.'); };
  try { assert.throws(() => record(store, id, 'failed'), /Synthetic enqueue failure/); }
  finally { store.enqueue = enqueue; }
  assert.deepEqual(store.evidenceProjection(id), before);
  assert.equal(store.find(id, 'failed'), null);
  store.db.prepare('UPDATE chronicle_projection SET revision=? WHERE session=?').run(Number.MAX_SAFE_INTEGER, id);
  assert.throws(() => store.consent(id, player, false), /revision limit/);
  assert.equal(store.privacy(id, player).capture, true);
  assert.equal(store.evidenceProjection(id).revision, Number.MAX_SAFE_INTEGER);
});

test('the complete snapshot is session-scoped and excludes unproven generated summaries without truncation', t => {
  const { store, id } = fixture(t); optIn(store, id);
  for (let n = 0; n < 75; n++) record(store, id, `discord:many-${n}`, `Approved synthetic fact ${n}.`);
  const before = store.evidenceProjection(id);
  store.append(id, 'summary:fixture', 'summary', { text: 'Generated summary with no proven contributors.' });
  assert.deepEqual(store.evidenceProjection(id), before);
  const second = store.start({ campaign: 'another-synthetic-campaign', title: 'Other session', mode: 'human', host,
    channel: '444444444444444444', sourceChannel: '555555555555555555', requestId: 'start-other' });
  optIn(store, second.id, editor);
  store.record(second.id, 'discord:other', { user: editor, speaker: 'Other', text: 'Other campaign fact.' });
  const first = store.evidenceProjection(id);
  assert.equal(first.sources.length, 75);
  assert.equal(first.participants.length, 1);
  assert.ok(first.sources.every(source => source.ref.startsWith(`chronicle:${id}:E`)));
  assert.equal(first.sources.some(source => source.text.includes('Other campaign')), false);
  assert.deepEqual(first, before);
});
