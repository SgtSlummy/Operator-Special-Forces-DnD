import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CharacterStore } from './store.mjs';
import { ImportService, runWorker } from './service.mjs';
import { emptyDraft } from './model.mjs';
const scope = { owner: '123456789012345678', campaign: 'greyharbor' };
const attachment = { id: '523456789012345678', filename: 'sheet.pdf', size: 100,
  url: 'https://cdn.discordapp.com/attachments/323456789012345678/523456789012345678/sheet.pdf' };
async function harness(worker) {
  const directory = await mkdtemp(join(tmpdir(), 'raphael-service-test-'));
  const store = new CharacterStore(join(directory, 'test.sqlite'));
  const service = new ImportService(store, join(directory, 'sources'), { worker, fetcher: async () => new Response('%PDF-1.7\n test bytes') });
  await service.initialize();
  return { directory, store, service, cleanup: async () => { await service.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}
const submit = (service, ownerScope = scope, request = 'one', edition = '2024') => service.submit(ownerScope, request, [attachment.id], { [attachment.id]: attachment }, edition);
test('invalid edition never starts a job and worker failure leaves no source or character', async () => {
  const h = await harness(async () => { throw new Error('PRIVATE PDF CONTENT'); });
  try {
    await assert.rejects(submit(h.service, scope, 'bad-edition', '2014'), /2024/);
    assert.equal(h.store.latest(scope), null);
    const job = await submit(h.service); await h.service.wait(job.id);
    assert.equal(h.store.job(job.id, scope).status, 'failed');
    assert.ok(!h.store.job(job.id, scope).error.includes('PRIVATE'));
    assert.equal(h.store.character(scope), null);
    assert.deepEqual(await readdir(join(h.directory, 'sources')), []);
  } finally { await h.cleanup(); }
});
test('cancellation interrupts active OCR, deletes the PDF, and blocks a late result', async () => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const h = await harness(async (_path, { signal }) => {
    started();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return emptyDraft();
  });
  try {
    const job = await submit(h.service); await running;
    await h.service.cancel(job.id, scope, 0);
    assert.equal(h.store.job(job.id, scope).status, 'cancelled');
    assert.equal(h.store.job(job.id, scope).draft, null);
    assert.deepEqual(await readdir(join(h.directory, 'sources')), []);
  } finally { await h.cleanup(); }
});
test('restart removes only importer-owned orphan files and expired drafts', async () => {
  const h = await harness(async () => emptyDraft());
  try {
    const job = await submit(h.service); await h.service.wait(job.id);
    const sources = join(h.directory, 'sources');
    await writeFile(join(sources, 'leave-this-user-file.txt'), 'unrelated');
    h.store.db.prepare('UPDATE import_jobs SET expires_at=0 WHERE id=?').run(job.id);
    await h.service.initialize();
    assert.equal(h.store.job(job.id, scope).status, 'expired');
    assert.deepEqual(await readdir(sources), ['leave-this-user-file.txt']);
  } finally { await h.cleanup(); }
});
test('isolated worker has an enforced deadline', async () => {
  const h = await harness();
  try {
    const path = join(h.directory, 'input.pdf');
    await writeFile(path, '%PDF-1.7\n invalid');
    await assert.rejects(runWorker(path, { timeoutMs: 1 }), /timed out/);
  } finally { await h.cleanup(); }
});
