import { fork } from 'node:child_process';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LIMITS, validatePdfBytes } from './pdf.mjs';
import { ImportError, ACTIVE } from './store.mjs';

export function resolveAttachment(values, resolvedAttachments) {
  if (!Array.isArray(values) || values.length !== 1) throw new ImportError('Upload exactly one PDF.');
  const attachment = resolvedAttachments?.[values[0]];
  if (!attachment || attachment.id !== values[0] || !/^\d{1,20}$/.test(attachment.id) ||
    typeof attachment.filename !== 'string' || !/\.pdf$/i.test(attachment.filename) ||
    !Number.isSafeInteger(attachment.size) || attachment.size < 8 || attachment.size > LIMITS.bytes) throw new ImportError('Choose a PDF no larger than 10 MiB.');
  let url;
  try { url = new URL(attachment.url); } catch { throw new ImportError('Invalid Discord attachment.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.discordapp.com' || url.port || url.username || url.password ||
    !new RegExp(`^/(?:ephemeral-attachments|attachments)/\\d{1,20}/${attachment.id}/[^/]+$`).test(url.pathname)) throw new ImportError('Only the file uploaded in this Discord form can be imported.');
  return { ...attachment, url: url.href };
}
export async function downloadAttachment(attachment, fetcher = fetch) {
  const response = await fetcher(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new ImportError('The Discord attachment expired or could not be downloaded. Please upload it again.');
  if (Number(response.headers.get('content-length')) > LIMITS.bytes) { await response.body.cancel(); throw new ImportError('PDF exceeds 10 MiB.'); }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > LIMITS.bytes) throw new ImportError('PDF exceeds 10 MiB.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = Buffer.concat(chunks);
  validatePdfBytes(bytes);
  return bytes;
}
export function runWorker(path, { onProgress = () => {}, signal, timeoutMs = LIMITS.timeoutMs } = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|SystemDrive)$/i.test(key)));
    const child = fork(fileURLToPath(new URL('./ocr-child.mjs', import.meta.url)), [], {
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--max-old-space-size=256', '--import', new URL('./offline.mjs', import.meta.url).href],
    });
    let settled = false;
    const finish = (error, draft) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.kill();
      if (error) reject(error); else resolvePromise(draft);
    };
    const abort = () => finish(new ImportError('Import cancelled.'));
    const timer = setTimeout(() => finish(new ImportError('PDF processing timed out. Try a smaller or clearer PDF.')), timeoutMs);
    child.on('message', message => {
      if (message.type === 'progress' && ['reading', 'ocr'].includes(message.progress?.stage)) onProgress(message.progress);
      else if (message.type === 'done') finish(null, message.draft);
      else if (message.type === 'failed') finish(new ImportError(message.error));
    });
    child.on('error', () => finish(new ImportError('The PDF worker could not start.')));
    child.on('exit', () => { if (!settled) finish(new ImportError('The PDF worker stopped. Upload a smaller or clearer PDF.')); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else child.send({ path });
  });
}
export class ImportService {
  constructor(store, directory, { worker = runWorker, fetcher = fetch, log = () => {}, portraitService = null } = {}) {
    this.store = store; this.directory = resolve(directory); this.worker = worker; this.fetcher = fetcher; this.log = log; this.portraitService = portraitService;
    this.queue = []; this.processing = false; this.tasks = new Map(); this.controllers = new Map(); this.closed = false;
  }
  path(jobId) {
    if (!/^[a-f0-9]{24}$/.test(jobId)) throw new ImportError('Invalid import identifier.');
    return join(this.directory, `${jobId}.pdf`);
  }
  async cleanup(jobId) {
    try { await unlink(this.path(jobId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.store.recover();
    this.store.expire();
    // Only generated, exact-name files inside this dedicated source directory.
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{24}\.pdf$/.test(name)) continue;
      const row = this.store.db.prepare('SELECT status FROM import_jobs WHERE id=?').get(name.slice(0, -4));
      if (!row || row.status !== 'review') await this.cleanup(name.slice(0, -4));
    }
  }
  async submit(scope, requestId, values, attachments, edition) {
    if (edition !== '2024') throw new ImportError('Type 2024 to confirm this sheet uses your campaign’s 2024 rules.');
    if (this.closed || this.tasks.size >= 20) throw new ImportError('The importer is busy. Please try again shortly.');
    const attachment = resolveAttachment(values, attachments);
    const job = this.store.createJob(scope, requestId, attachment.filename);
    if (job.duplicate) return job;
    const task = this.prepare(job, scope, attachment);
    this.tasks.set(job.id, task);
    task.finally(() => this.tasks.delete(job.id)).catch(() => this.log({ jobId: job.id, outcome: 'source_cleanup_failed' }));
    return job;
  }
  async prepare(job, scope, attachment) {
    const start = Date.now();
    try {
      const bytes = await downloadAttachment(attachment, this.fetcher);
      if (this.closed || !ACTIVE.includes(this.store.job(job.id, scope).status)) return;
      await writeFile(this.path(job.id), bytes, { flag: 'wx', mode: 0o600 });
      await new Promise((resolveJob, rejectJob) => {
        this.queue.push({ job, scope, hash: createHash('sha256').update(bytes).digest('hex'), resolveJob, rejectJob });
        this.pump();
      });
    } catch (error) {
      this.store.finish(job.id, scope, 'failed', error instanceof ImportError ? error.message : 'Import failed. Please upload a valid, unlocked PDF and try again.');
    } finally {
      const final = this.store.job(job.id, scope);
      if (final.status !== 'review') await this.cleanup(job.id);
      this.log({ jobId: job.id, outcome: final.status, durationMs: Date.now() - start });
    }
  }
  async pump() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const { job, scope, hash, resolveJob, rejectJob } = this.queue.shift();
        if (this.closed || !ACTIVE.includes(this.store.job(job.id, scope).status)) { resolveJob(); continue; }
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        try {
          const draft = await this.worker(this.path(job.id), { signal: controller.signal,
            onProgress: progress => this.store.progress(job.id, scope, progress) });
          this.store.ready(job.id, scope, draft, hash);
          resolveJob();
        } catch (error) { rejectJob(error); }
        finally { this.controllers.delete(job.id); }
      }
    } finally { this.processing = false; }
  }
  async wait(jobId) { await this.tasks.get(jobId); }
  interrupt(jobId) {
    this.controllers.get(jobId)?.abort();
    const queued = this.queue.findIndex(entry => entry.job.id === jobId);
    if (queued !== -1) this.queue.splice(queued, 1)[0].resolveJob();
  }
  async cancel(jobId, scope, revision) {
    const job = this.store.job(jobId, scope);
    if (job.revision !== revision) throw new ImportError('This card is stale. Reopen Review Import.');
    this.store.finish(jobId, scope, 'cancelled');
    this.interrupt(jobId);
    await this.wait(jobId);
    await this.cleanup(jobId);
  }
  async approve(jobId, scope, revision) {
    const character = this.store.approve(jobId, scope, revision);
    await this.cleanup(jobId);
    if (this.portraitService && !character.alreadySaved) {
      try { await this.portraitService.generate(scope, character.revision); }
      catch (error) { this.log({ jobId, outcome: 'portrait_generation_failed', code: error.code ?? 'PORTRAIT_FAILED' }); }
    }
    return character;
  }
  async expire() {
    for (const job of this.store.expire()) {
      this.interrupt(job.id);
      await this.wait(job.id);
      await this.cleanup(job.id);
    }
  }
  async close() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.all([...this.tasks.values()]);
  }
}
