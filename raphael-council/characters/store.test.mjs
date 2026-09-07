import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterStore } from './store.mjs';
import { emptyDraft, addEvidence } from './model.mjs';
const scope = { campaign: 'greyharbor', owner: '123456789012345678' };
export function completeDraft() {
  const draft = emptyDraft();
  const values = { name: 'Maren', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16, constitution: 14,
    intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28, currentHp: 19 };
  for (const [key, value] of Object.entries(values)) addEvidence(draft, key, value, { page: 1, method: 'form' });
  return draft;
}
function ready(store, request = 'request', draft = completeDraft()) {
  const job = store.createJob(scope, request);
  store.ready(job.id, scope, draft, 'hash');
  return store.job(job.id, scope);
}
test('approval is atomic, idempotent, and survives restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'raphael-store-test-'));
  let store = new CharacterStore(join(directory, 'test.sqlite'));
  try {
    const job = ready(store);
    assert.equal(store.approve(job.id, scope, job.revision).revision, 1);
    assert.equal(store.approve(job.id, scope, job.revision).alreadySaved, true);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM character_events').get().n, 1);
    store.close();
    store = new CharacterStore(join(directory, 'test.sqlite'));
    assert.equal(store.character(scope).snapshot.fields.name.value, 'Maren');
    assert.equal(store.character(scope).runtime.currentHp, 19);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('updated PDF approval cannot restore any live resources or history', () => {
  const store = new CharacterStore(':memory:');
  try {
    const first = ready(store, 'one'); store.approve(first.id, scope, first.revision);
    const runtime = { currentHp: 4, spentSlots: { 1: 2 }, consumables: { potions: 0 }, conditions: ['poisoned'], history: ['rescued Elin'] };
    store.db.prepare('UPDATE characters SET runtime=?').run(JSON.stringify(runtime));
    const updated = completeDraft(); updated.fields.currentHp.value = 28; updated.fields.maxHp.value = 34;
    const second = ready(store, 'two', updated);
    const result = store.approve(second.id, scope, second.revision);
    assert.equal(result.revision, 2); assert.equal(result.snapshot.fields.maxHp.value, 34);
    assert.deepEqual(result.runtime, runtime);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM character_versions').get().n, 2);
  } finally { store.close(); }
});
test('ownership, campaign, stale correction and required statistics are enforced', () => {
  const store = new CharacterStore(':memory:');
  try {
    const job = ready(store);
    const view = store.view(scope, { jobId: job.id, revision: job.revision });
    for (const other of [{ ...scope, owner: '2' }, { ...scope, campaign: 'other' }]) {
      assert.throws(() => store.job(job.id, other), /not available/);
      assert.throws(() => store.resolveView(view, other), /another player/);
      assert.throws(() => store.approve(job.id, other, job.revision), /not available/);
    }
    store.correct(job.id, scope, job.revision, 'My Dexterity is 18');
    assert.throws(() => store.approve(job.id, scope, job.revision), /stale/);
    assert.throws(() => store.correct(job.id, scope, job.revision, 'My Dexterity is 12'), /stale/);
    store.finish(job.id, scope, 'cancelled');
    const incomplete = ready(store, 'incomplete', emptyDraft());
    assert.throws(() => store.approve(incomplete.id, scope, incomplete.revision), /required/);
    assert.equal(store.character(scope), null);
  } finally { store.close(); }
});
test('duplicate submissions do not create a second job; concurrent imports are bounded', () => {
  const store = new CharacterStore(':memory:');
  try {
    const job = store.createJob(scope, 'one');
    assert.equal(store.createJob(scope, 'one').id, job.id);
    assert.throws(() => store.createJob(scope, 'two'), /pending/);
  } finally { store.close(); }
});
test('restart fails interrupted jobs, preserves review drafts, and expiry removes abandoned data', () => {
  let now = 1;
  const store = new CharacterStore(':memory:', { now: () => now });
  try {
    const interrupted = store.createJob(scope, 'interrupted');
    store.progress(interrupted.id, scope, { stage: 'ocr' });
    store.recover();
    assert.equal(store.job(interrupted.id, scope).status, 'failed');
    const draft = ready(store, 'review');
    store.recover(); assert.equal(store.job(draft.id, scope).status, 'review');
    now += 86_400_001;
    assert.throws(() => store.approve(draft.id, scope, draft.revision), /stale/);
    store.expire();
    assert.equal(store.job(draft.id, scope).draft, null);
    assert.equal(store.job(draft.id, scope).status, 'expired');
  } finally { store.close(); }
});
test('a newer saved character revision prevents lost updates', () => {
  const store = new CharacterStore(':memory:');
  try {
    const first = ready(store); store.approve(first.id, scope, first.revision);
    const next = ready(store, 'next');
    store.db.prepare('UPDATE characters SET revision=revision+1').run();
    assert.throws(() => store.approve(next.id, scope, next.revision), /changed during/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM character_versions').get().n, 1);
  } finally { store.close(); }
});
