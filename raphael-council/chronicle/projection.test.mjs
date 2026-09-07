import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { ChronicleService } from './service.mjs';
import { chronicleSnapshot } from './http.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-projection-'));
  const store = new ChronicleStore(join(dir, 'chronicle.sqlite'));
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const s = store.start({ campaign: 'campaign', title: 'Story', mode: 'human', host: 'host', channel: 'journal', sourceChannel: 'chat', requestId: 'start' });
  store.consent(s.id, 'player', true);
  const service = new ChronicleService({ store, dataDir: dir, provider: { write: async () => 'Current corrected recap.' } });
  return { dir, store, s, service };
}

test('deletion masks original and prior corrections in API, pending deliveries and portable reports', async t => {
  const { dir, store, s, service } = fixture(t);
  const original = store.record(s.id, 'discord:message', { user: 'player', speaker: 'Player', text: 'Obsolete original words.' });
  store.reviseMessage(s.id, 'message', { text: 'Obsolete revised words.', requestId: 'edit' });
  store.reviseMessage(s.id, 'message', { deleted: true, requestId: 'delete' });
  const snapshot = chronicleSnapshot(store, { list: () => [] }, { campaign: 'campaign', owner: 'player', role: 'player' });
  assert.doesNotMatch(JSON.stringify(snapshot), /Obsolete/);
  for (const row of store.pending()) assert.doesNotMatch(JSON.stringify(await service.delivery(row)), /Obsolete/);
  await service.end(s.id);
  const report = readFileSync(join(dir, 'reports', `${s.id}.html`), 'utf8');
  const portable = readFileSync(join(dir, 'reports', `${s.id}.jsonl`), 'utf8');
  assert.doesNotMatch(report + portable, /Obsolete/);
  // The host's authoritative audit is retained while shared projections honor removal.
  assert.equal(store.entries(s.id).find(e => e.seq === original.seq).text, 'Obsolete original words.');
});

test('source correction invalidates prior summaries before they can be shown or delivered', async t => {
  const { store, s, service } = fixture(t);
  const source = store.record(s.id, 'discord:message', { user: 'player', speaker: 'Player', text: 'The key is red.' });
  const summary = store.append(s.id, 'summary:first', 'summary', { text: 'Obsolete summary: the key is red.', from: source.seq, through: source.seq, correctionVersion: 0 });
  const row = store.pending().find(value => value.body.entry.seq === summary.seq);
  store.correct(s.id, source.seq, 'The key is blue.', 'player', false, 'correct');
  const projected = store.sharedEntries(s.id).find(e => e.seq === summary.seq);
  assert.equal(projected.invalidated, true);
  assert.doesNotMatch(JSON.stringify(await service.delivery(row)), /Obsolete summary/);
  const snapshot = chronicleSnapshot(store, { list: () => [] }, { campaign: 'campaign', owner: 'player', role: 'player' });
  assert.doesNotMatch(JSON.stringify(snapshot), /Obsolete summary/);
  assert.equal(store.evidence(s.id)[0].text, 'The key is blue.');
});
