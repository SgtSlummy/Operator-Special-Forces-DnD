import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validatePng } from './provider.mjs';

export class SceneImageError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new SceneImageError(code, message, status); };
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(18).toString('hex');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function scopeOf(scope) {
  if (!identifier(scope?.campaign) || !identifier(scope?.owner) || scope.owner === 'party') fail('UNAUTHORIZED', 'Connect with your player access code.', 401);
  return scope;
}
export const WITNESSLIGHT = 'Original Witnesslight campaign art: ultra-realistic anatomy, faces and worn natural materials, dramatic believable light, restrained oil-painted premium D&D illustration. Muted mineral colors, amber practical lights, selective detail at the subject, broad quiet backgrounds. No hyper-detail, etched ornament everywhere, particles, plastic skin, oversharpening, text, labels, watermark or interface. Use only the supplied observable facts. Never invent a hidden person, clue, trap, room, identity, item property or resolved outcome. Respect darkness, concealment, distance and the viewer\'s senses. Decorative details are noncanonical. The image request changes no action, resource or game time.';

export class SceneImageService {
  constructor({ dataDir, artRoot, provider, resolveScene = null }) {
    this.resolveScene = resolveScene;
    this.dataDir = resolve(dataDir); this.artRoot = realpathSync(artRoot); this.provider = provider;
    mkdirSync(this.dataDir, { recursive: true }); mkdirSync(join(this.dataDir, 'renders'), { recursive: true });
    this.db = new DatabaseSync(join(this.dataDir, 'images.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS scenes(campaign TEXT, audience TEXT, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(campaign,audience));
      CREATE TABLE IF NOT EXISTS revisions(campaign TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS access_codes(digest TEXT PRIMARY KEY,campaign TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS image_views(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,owner TEXT NOT NULL,body TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,owner TEXT NOT NULL,cache_key TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,focus_id TEXT NOT NULL,prompt TEXT NOT NULL,refs TEXT NOT NULL,approved TEXT,message TEXT NOT NULL,created INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS image_cache ON jobs(campaign,owner,cache_key,status);
      CREATE TABLE IF NOT EXISTS requests(campaign TEXT,owner TEXT,request_id TEXT,job_id TEXT NOT NULL,focus_id TEXT NOT NULL,PRIMARY KEY(campaign,owner,request_id));`);
    this.assets = new Map();
    for (const relative of ['manifest.json', 'world/manifest.json', 'people/manifest.json', 'lore/manifest.json']) {
      const path = join(this.artRoot, relative);
      const manifest = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
      for (const asset of manifest.assets ?? []) {
        if (asset.status !== 'generated') continue;
        const absolute = realpathSync(resolve(dirname(path), asset.file));
        if (!absolute.startsWith(this.artRoot + sep) || !statSync(absolute).isFile()) throw new Error('Invalid art library path');
        this.assets.set(asset.id, absolute);
      }
    }
    this.closed = false; this.running = null;
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  asset(id) {
    const path = this.assets.get(id);
    if (!path) fail('INVALID_REQUEST', 'Choose an existing campaign image in the host scene record.', 400);
    return path;
  }
  // Trusted host/game-engine operation. Never expose it as a player HTTP endpoint.
  publishScene(input) {
    if (input?.gameRevision !== undefined && (!Number.isSafeInteger(input.gameRevision) || input.gameRevision < 1)) fail('INVALID_REQUEST', 'Use a committed game revision.', 400);
    if (!identifier(input?.campaign) || !identifier(input?.audience) || !identifier(input?.id) ||
        !text(input.title, 160) || !text(input.description, 6000) || !text(input.sourceEventId, 160) ||
        !Array.isArray(input.subjects ?? []) || (input.subjects ?? []).length > 20) fail('INVALID_REQUEST', 'The host scene record needs a campaign, audience, ID, title, observable description and source event.', 400);
    const references = input.references ?? [];
    if (!Array.isArray(references) || references.length > 4) fail('INVALID_REQUEST', 'Use at most four approved visual references.', 400);
    const checkImage = id => { if (id != null) this.asset(id); return id ?? null; };
    const subjects = (input.subjects ?? []).map(subject => {
      if (!identifier(subject?.id) || subject.id === 'scene' || !text(subject.label, 100) || !text(subject.description, 3000)) fail('INVALID_REQUEST', 'Every visible subject needs its own ID, label and description.', 400);
      return { id: subject.id, label: subject.label.trim(), description: subject.description.trim(), reference: checkImage(subject.reference), approvedImage: checkImage(subject.approvedImage) };
    });
    if (new Set(subjects.map(s => s.id)).size !== subjects.length) fail('INVALID_REQUEST', 'Visible subject IDs must be distinct.', 400);
    const base = { id: input.id, title: input.title.trim(), description: input.description.trim(), sourceEventId: input.sourceEventId.trim(),
      ...(input.gameRevision === undefined ? {} : { gameRevision: input.gameRevision }),
      subjects, references: references.map(id => {
        if (!identifier(id)) fail('INVALID_REQUEST', 'Every reference must name an existing approved image.', 400);
        return checkImage(id);
      }), approvedImage: checkImage(input.approvedImage) };
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT revision,body FROM scenes WHERE campaign=? AND audience=?').get(input.campaign, input.audience);
      if (prior && input.gameRevision !== undefined) {
        const previous = JSON.parse(prior.body);
        if (previous.gameRevision > input.gameRevision) return { ...previous, revision: prior.revision };
      }
      if (prior?.body === JSON.stringify(base)) return { ...base, revision: prior.revision };
      const revision = Number(this.db.prepare('SELECT revision FROM revisions WHERE campaign=?').get(input.campaign)?.revision ?? 0) + 1;
      this.db.prepare('INSERT INTO revisions VALUES(?,?) ON CONFLICT(campaign) DO UPDATE SET revision=excluded.revision').run(input.campaign, revision);
      this.db.prepare('INSERT INTO scenes VALUES(?,?,?,?) ON CONFLICT(campaign,audience) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(input.campaign, input.audience, revision, JSON.stringify(base));
      return { ...base, revision };
    });
  }
  clearPrivateScene(scope) { scopeOf(scope); this.db.prepare('DELETE FROM scenes WHERE campaign=? AND audience=?').run(scope.campaign, scope.owner); }
  refreshScene(scope) {
    scopeOf(scope);
    const scene = this.resolveScene?.(scope);
    if (scene) this.publishScene(scene);
  }
  projection(scope) {
    scopeOf(scope);
    const row = this.db.prepare("SELECT * FROM scenes WHERE campaign=? AND audience IN (?, 'party') ORDER BY CASE WHEN audience=? THEN 0 ELSE 1 END LIMIT 1").get(scope.campaign, scope.owner, scope.owner);
    if (!row) fail('SCENE_UNAVAILABLE', 'The host has not supplied your current view yet. Ask them to update the scene.', 409);
    return { ...JSON.parse(row.body), revision: row.revision };
  }
  scene(scope) {
    this.refreshScene(scope);
    const scene = this.projection(scope);
    return { id: scene.id, revision: scene.revision, title: scene.title, description: scene.description, sourceEventId: scene.sourceEventId,
      subjects: scene.subjects.map(({ id, label }) => ({ id, label })) };
  }
  issueBrowserAccess(scope) {
    scopeOf(scope); const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO access_codes VALUES(?,?,?,?)').run(hash(token), scope.campaign, scope.owner, Date.now() + 30 * 86400000);
    return token;
  }
  authenticateAccess(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('UNAUTHORIZED', 'Enter a valid player access code from your host or Discord.', 401);
    const row = this.db.prepare('SELECT campaign,owner FROM access_codes WHERE digest=? AND expires>?').get(hash(token), Date.now());
    if (!row) fail('UNAUTHORIZED', 'This player access code has expired or was revoked.', 401);
    return { campaign: row.campaign, owner: row.owner };
  }
  revokeAccess(scope) { scopeOf(scope); this.db.prepare('DELETE FROM access_codes WHERE campaign=? AND owner=?').run(scope.campaign, scope.owner); }
  createView(scope, record) {
    scopeOf(scope); const body = JSON.stringify(record);
    if (body.length > 16000) fail('INVALID_REQUEST', 'This image view is too large.', 400);
    const id = opaque(); this.db.prepare('INSERT INTO image_views VALUES(?,?,?,?,?)').run(id, scope.campaign, scope.owner, body, Date.now() + 86400000);
    return id;
  }
  resolveView(scope, id) {
    scopeOf(scope);
    const row = this.db.prepare('SELECT body FROM image_views WHERE id=? AND campaign=? AND owner=? AND expires>?').get(String(id), scope.campaign, scope.owner, Date.now());
    if (!row) fail('NOT_FOUND', 'Open Show what I see again to get a current image control.', 404);
    return JSON.parse(row.body);
  }
  jobRow(scope, id) {
    scopeOf(scope);
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=? AND campaign=? AND owner=?').get(String(id), scope.campaign, scope.owner);
    if (!row) fail('NOT_FOUND', 'That image request is not available to this player.', 404);
    return row;
  }
  getJob(scope, id) {
    this.refreshScene(scope);
    const row = this.jobRow(scope, id), snapshot = JSON.parse(row.snapshot);
    let stale = true;
    try { stale = this.projection(scope).revision !== snapshot.revision; } catch { /* No current projection remains. */ }
    if (row.status === 'queued' || row.status === 'running') this.kick();
    return { id: row.id, status: row.status, title: snapshot.title, focusLabel: snapshot.subjects.find(s => s.id === row.focus_id)?.label ?? 'The whole scene',
      sceneRevision: snapshot.revision, sourceEventId: snapshot.sourceEventId, requestedAt: new Date(row.created).toISOString(), message: row.message, stale };
  }
  async requestImage(scope, { requestId, focusId = 'scene' } = {}) {
    scopeOf(scope);
    this.refreshScene(scope);
    if (!identifier(requestId) || !identifier(focusId)) fail('INVALID_REQUEST', 'Choose the scene or one of its visible subjects.', 400);
    const id = this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM requests WHERE campaign=? AND owner=? AND request_id=?').get(scope.campaign, scope.owner, requestId);
      if (previous) {
        if (previous.focus_id !== focusId) fail('INVALID_REQUEST', 'This request already refers to another view. Start a new image request.', 409);
        return previous.job_id;
      }
      const snapshot = this.projection(scope);
      const focus = focusId === 'scene' ? null : snapshot.subjects.find(s => s.id === focusId);
      if (focusId !== 'scene' && !focus) fail('INVALID_REQUEST', 'That subject is not in your current view. Choose a visible subject.', 400);
      // Neither user prose nor GM-only records are passed to the image provider.
      const refs = focus ? (focus.reference ? [focus.reference] : []) : snapshot.references;
      const approved = focus ? focus.approvedImage : snapshot.approvedImage;
      const fingerprint = hash(JSON.stringify({ snapshot, focusId, refs, approved }));
      const cached = this.db.prepare("SELECT id FROM jobs WHERE campaign=? AND owner=? AND cache_key=? AND status IN ('queued','running','ready') ORDER BY created DESC LIMIT 1").get(scope.campaign, scope.owner, fingerprint);
      const jobId = cached?.id ?? opaque();
      if (!cached) {
        const prompt = `${WITNESSLIGHT}\nView at request time: ${snapshot.description}\n${focus ? `Focus only on this visible subject: ${focus.label}. ${focus.description}. Keep the surrounding view quiet and do not reveal more than the supplied description.` : 'Composition: the whole observable scene from the character viewpoint, landscape.'}\nReference images, if supplied, preserve only the approved visible appearance and style; current supplied facts take precedence. No additional entities or information.`;
        this.db.prepare('INSERT INTO jobs(id,campaign,owner,cache_key,status,snapshot,focus_id,prompt,refs,approved,message,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(jobId, scope.campaign, scope.owner, fingerprint, 'queued', JSON.stringify(snapshot), focusId, prompt, JSON.stringify(refs), approved, 'Preparing your view. Play can continue.', Date.now());
      }
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, requestId, jobId, focusId);
      return jobId;
    });
    this.kick(); return this.getJob(scope, id);
  }
  kick() {
    if (this.closed || this.running) return;
    // Defer until the caller's transaction has committed.
    this.running = Promise.resolve().then(() => this.drain()).catch(() => {}).finally(() => { this.running = null; });
  }
  async drain() {
    while (!this.closed) {
      const job = this.transaction(() => {
        this.db.prepare("UPDATE jobs SET status='failed',message='The host restarted during generation. Request a new image to try again.' WHERE status='running' AND lease<?").run(Date.now());
        if (this.db.prepare("SELECT id FROM jobs WHERE status='running' LIMIT 1").get()) return null;
        const next = this.db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created,id LIMIT 1").get();
        if (!next) return null;
        const lease = Date.now() + 600000;
        this.db.prepare("UPDATE jobs SET status='running',lease=?,message='Rendering your view. Play can continue.' WHERE id=? AND status='queued'").run(lease, next.id);
        return { ...next, lease };
      });
      if (!job) return;
      try {
        const references = JSON.parse(job.refs).map(id => this.asset(id));
        const bytes = await validatePng(job.approved ? await readFile(this.asset(job.approved)) : await this.provider({ prompt: job.prompt, references }));
        const claim = this.db.prepare('SELECT status,lease FROM jobs WHERE id=?').get(job.id);
        if (claim?.status !== 'running' || claim.lease !== job.lease) continue;
        await writeFile(join(this.dataDir, 'renders', `${job.id}.png`), bytes, { flag: 'wx' });
        await writeFile(join(this.dataDir, 'renders', `${job.id}.json`), JSON.stringify({
          jobId: job.id, campaign: job.campaign, owner: job.owner, snapshot: JSON.parse(job.snapshot), focusId: job.focus_id,
          prompt: job.prompt, references: JSON.parse(job.refs), approvedImage: job.approved, sha256: hash(bytes),
          mode: job.approved ? 'host-approved-library-image' : 'openai-image-api', generatedAt: new Date().toISOString(),
        }, null, 2), { flag: 'wx' });
        this.db.prepare("UPDATE jobs SET status='ready',message='Your view is ready. Illustration details do not add clues or change the story.' WHERE id=? AND status='running' AND lease=?").run(job.id, job.lease);
      } catch (error) {
        this.db.prepare("UPDATE jobs SET status='failed',message=? WHERE id=? AND status='running' AND lease=?").run(error?.code === 'PROVIDER_UNAVAILABLE'
          ? 'The host needs to connect image generation. Already approved scene images can still be shown.'
          : 'This image could not be completed. Request a new image to try again; play has not changed.', job.id, job.lease);
      }
    }
  }
  async waitForJob(scope, id, { timeoutMs = 20000 } = {}) {
    const end = Date.now() + Math.min(Math.max(timeoutMs, 0), 600000);
    let job = this.getJob(scope, id);
    while (['queued', 'running'].includes(job.status) && Date.now() < end) {
      await delay(Math.min(300, Math.max(1, end - Date.now()))); job = this.getJob(scope, id);
    }
    return job;
  }
  async image(scope, id) {
    this.refreshScene(scope);
    const row = this.jobRow(scope, id);
    if (row.status !== 'ready') fail('NOT_READY', 'This image is not ready yet. Refresh its status.', 409);
    return { bytes: await readFile(join(this.dataDir, 'renders', `${row.id}.png`)), mimeType: 'image/png', fileName: `view-${row.id}.png` };
  }
  async close() { this.closed = true; await this.running; this.db.close(); }
}
