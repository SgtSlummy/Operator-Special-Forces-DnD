import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { issues, correctDraft } from './model.mjs';
const id = () => randomBytes(12).toString('hex');
const TTL = 86_400_000;
export const ACTIVE = ['queued', 'reading', 'ocr', 'review'];
export class ImportError extends Error {}
function scopeCheck(scope) {
  if (!scope || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.campaign) || !/^\d{1,20}$/.test(scope.owner)) throw new ImportError('Invalid campaign or player.');
}
export class CharacterStore {
  constructor(path, { now = Date.now } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS characters (campaign TEXT NOT NULL, owner TEXT NOT NULL,
        revision INTEGER NOT NULL, snapshot TEXT NOT NULL, runtime TEXT NOT NULL,
        PRIMARY KEY(campaign, owner));
      CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
        base_revision INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        progress TEXT, error TEXT, hash TEXT, source_name TEXT, saved_revision INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_import ON import_jobs(campaign, owner)
        WHERE status IN ('queued','reading','ocr','review');
      CREATE TABLE IF NOT EXISTS character_drafts (job_id TEXT PRIMARY KEY REFERENCES import_jobs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS character_versions (campaign TEXT NOT NULL, owner TEXT NOT NULL,
        revision INTEGER NOT NULL, snapshot TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY(campaign, owner, revision));
      CREATE TABLE IF NOT EXISTS character_events (id INTEGER PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL,
        kind TEXT NOT NULL, job_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS character_portraits (campaign TEXT NOT NULL, owner TEXT NOT NULL,
        revision INTEGER NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL, negative_prompt TEXT,
        sha256 TEXT, path TEXT, created_at INTEGER NOT NULL, error TEXT,
        PRIMARY KEY(campaign, owner, revision));
      CREATE TABLE IF NOT EXISTS import_views (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL,
        job_id TEXT, revision INTEGER NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  character(scope) {
    scopeCheck(scope);
    const row = this.db.prepare('SELECT * FROM characters WHERE campaign=? AND owner=?').get(scope.campaign, scope.owner);
    return row ? { revision: row.revision, snapshot: JSON.parse(row.snapshot), runtime: JSON.parse(row.runtime) } : null;
  }
  portrait(scope, revision = null) {
    scopeCheck(scope);
    const row = revision == null
      ? this.db.prepare('SELECT * FROM character_portraits WHERE campaign=? AND owner=? ORDER BY revision DESC LIMIT 1').get(scope.campaign, scope.owner)
      : this.db.prepare('SELECT * FROM character_portraits WHERE campaign=? AND owner=? AND revision=?').get(scope.campaign, scope.owner, revision);
    return row ? { ...row } : null;
  }
  savePortrait(scope, revision, record) {
    scopeCheck(scope);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new ImportError('Invalid character revision.');
    if (!record || !['queued', 'ready', 'failed'].includes(record.status) || typeof record.prompt !== 'string' || record.prompt.length > 16000) {
      throw new ImportError('Invalid portrait record.');
    }
    this.db.prepare(`INSERT INTO character_portraits
      (campaign,owner,revision,status,prompt,negative_prompt,sha256,path,created_at,error)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(campaign,owner,revision) DO UPDATE SET status=excluded.status,
      prompt=excluded.prompt,negative_prompt=excluded.negative_prompt,sha256=excluded.sha256,
      path=excluded.path,created_at=excluded.created_at,error=excluded.error`)
      .run(scope.campaign, scope.owner, revision, record.status, record.prompt, record.negativePrompt ?? null,
        record.sha256 ?? null, record.path ?? null, this.now(), record.error ?? null);
    return this.portrait(scope, revision);
  }
  job(jobId, scope) {
    scopeCheck(scope);
    const row = this.db.prepare('SELECT * FROM import_jobs WHERE id=? AND campaign=? AND owner=?').get(jobId, scope.campaign, scope.owner);
    if (!row) throw new ImportError('This import is not available to you.');
    const draft = this.db.prepare('SELECT data FROM character_drafts WHERE job_id=?').get(jobId);
    return { ...row, draft: draft ? JSON.parse(draft.data) : null, progress: row.progress ? JSON.parse(row.progress) : null };
  }
  latest(scope) {
    scopeCheck(scope);
    const row = this.db.prepare('SELECT id FROM import_jobs WHERE campaign=? AND owner=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(scope.campaign, scope.owner);
    return row ? this.job(row.id, scope) : null;
  }
  createJob(scope, requestId, sourceName = 'character.pdf') {
    scopeCheck(scope);
    if (typeof requestId !== 'string' || requestId.length > 100 || !requestId) throw new ImportError('Invalid upload request.');
    return this.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM import_jobs WHERE request_id=?').get(requestId);
      if (duplicate) return { ...this.job(duplicate.id, scope), duplicate: true };
      const pending = this.db.prepare("SELECT id FROM import_jobs WHERE campaign=? AND owner=? AND status IN ('queued','reading','ocr','review')").get(scope.campaign, scope.owner);
      if (pending) throw new ImportError('Review or cancel your pending import before uploading another sheet.');
      const jobId = id();
      this.db.prepare('INSERT INTO import_jobs (id,campaign,owner,request_id,status,base_revision,created_at,expires_at,source_name) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(jobId, scope.campaign, scope.owner, requestId, 'queued', this.character(scope)?.revision ?? 0, this.now(), this.now() + TTL, sourceName.slice(0, 180));
      return this.job(jobId, scope);
    });
  }
  progress(jobId, scope, progress) {
    const job = this.job(jobId, scope);
    if (!['queued', 'reading', 'ocr'].includes(job.status)) return false;
    this.db.prepare('UPDATE import_jobs SET status=?,progress=? WHERE id=?').run(progress.stage, JSON.stringify(progress), jobId);
    return true;
  }
  ready(jobId, scope, draft, hash) {
    return this.transaction(() => {
      const job = this.job(jobId, scope);
      if (!['queued', 'reading', 'ocr'].includes(job.status) || job.expires_at <= this.now()) return false;
      draft.edition = '2024'; // Explicitly confirmed at the upload boundary, never inferred from the PDF.
      this.db.prepare('INSERT INTO character_drafts(job_id,data) VALUES(?,?)').run(jobId, JSON.stringify(draft));
      this.db.prepare("UPDATE import_jobs SET status='review',revision=revision+1,hash=? WHERE id=?").run(hash, jobId);
      return true;
    });
  }
  assertReview(job, revision) {
    if (job.status !== 'review' || job.revision !== revision || job.expires_at <= this.now()) throw new ImportError('This review is stale. Open My Hero and Review Import again.');
  }
  correct(jobId, scope, revision, words) {
    return this.transaction(() => {
      const job = this.job(jobId, scope);
      this.assertReview(job, revision);
      const correction = correctDraft(job.draft, words);
      if (correction.changed) {
        this.db.prepare('UPDATE character_drafts SET data=? WHERE job_id=?').run(JSON.stringify(correction.draft), jobId);
        this.db.prepare('UPDATE import_jobs SET revision=revision+1 WHERE id=?').run(jobId);
      }
      return correction;
    });
  }
  approve(jobId, scope, revision) {
    return this.transaction(() => {
      const job = this.job(jobId, scope);
      if (job.status === 'saved') return { ...this.character(scope), alreadySaved: true };
      this.assertReview(job, revision);
      if (job.draft.edition !== '2024') throw new ImportError('Confirm 2024 rules before importing.');
      if (issues(job.draft).length) throw new ImportError('Correct required, conflicting, or uncertain fields before approval.');
      const old = this.character(scope);
      if ((old?.revision ?? 0) !== job.base_revision) throw new ImportError('Your character changed during review. Cancel and upload again.');
      const next = job.base_revision + 1;
      const snapshot = JSON.stringify(job.draft);
      // Runtime resources are a separate source of truth. Re-import does not touch them.
      if (old) this.db.prepare('UPDATE characters SET revision=?,snapshot=? WHERE campaign=? AND owner=?').run(next, snapshot, scope.campaign, scope.owner);
      else this.db.prepare('INSERT INTO characters VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, next, snapshot,
        JSON.stringify({ currentHp: job.draft.fields.currentHp?.value ?? null, tempHp: job.draft.fields.tempHp?.value ?? null, spentSlots: {}, consumables: {}, conditions: [], history: [] }));
      this.db.prepare('INSERT INTO character_versions VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, next, snapshot, jobId);
      this.db.prepare('INSERT INTO character_events(campaign,owner,kind,job_id,created_at) VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, 'character_import_approved', jobId, this.now());
      this.db.prepare("UPDATE import_jobs SET status='saved',saved_revision=? WHERE id=?").run(next, jobId);
      return this.character(scope);
    });
  }
  finish(jobId, scope, status, error = null) {
    if (!['cancelled', 'failed', 'expired'].includes(status)) throw new ImportError('Invalid import outcome.');
    const job = this.job(jobId, scope);
    if (!ACTIVE.includes(job.status)) return false;
    this.transaction(() => {
      this.db.prepare('UPDATE import_jobs SET status=?,error=?,revision=revision+1 WHERE id=?').run(status, error, jobId);
      this.db.prepare('DELETE FROM character_drafts WHERE job_id=?').run(jobId);
    });
    return true;
  }
  view(scope, { jobId = null, revision = 0, kind = 'hero' } = {}) {
    scopeCheck(scope);
    if (jobId) this.job(jobId, scope);
    const viewId = id();
    this.db.prepare('INSERT INTO import_views VALUES(?,?,?,?,?,?,?)').run(viewId, scope.campaign, scope.owner, jobId, revision, kind, this.now() + TTL);
    return viewId;
  }
  resolveView(viewId, scope) {
    scopeCheck(scope);
    const view = this.db.prepare('SELECT * FROM import_views WHERE id=? AND campaign=? AND owner=?').get(viewId, scope.campaign, scope.owner);
    if (!view || view.expires_at <= this.now()) throw new ImportError('This private screen expired or belongs to another player. Open My Hero again.');
    return view;
  }
  recover() {
    const rows = this.db.prepare("SELECT * FROM import_jobs WHERE status IN ('queued','reading','ocr')").all();
    for (const job of rows) this.finish(job.id, { campaign: job.campaign, owner: job.owner }, 'failed', 'The host restarted during processing. Upload the PDF again.');
    return rows;
  }
  expire() {
    const rows = this.db.prepare("SELECT * FROM import_jobs WHERE status IN ('queued','reading','ocr','review') AND expires_at<=?").all(this.now());
    for (const job of rows) this.finish(job.id, { campaign: job.campaign, owner: job.owner }, 'expired', 'This import expired after 24 hours. Upload the PDF again.');
    this.db.prepare('DELETE FROM import_views WHERE expires_at<=?').run(this.now());
    return rows;
  }
}
