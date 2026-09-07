import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { bounded, ChronicleError } from './store.mjs';
import { makeReport, thumbnail } from './report.mjs';

export function chunks(entries, limit = 18000) {
  const out = []; let current = [], size = 0;
  for (const e of entries) {
    const record = typeof e === 'string' ? e : { ref: `E${e.seq}`, kind: e.kind, speaker: e.speaker, text: e.text, at: new Date(e.at).toISOString(), scene: e.scene, unverified: e.unverified, corrected: e.corrected };
    const length = JSON.stringify(record).length;
    if (size + length > limit && current.length) { out.push(current); current = []; size = 0; }
    current.push(record); size += length;
  }
  if (current.length) out.push(current); return out;
}
export class ChronicleService {
  constructor({ store, provider, images, dataDir, now = Date.now }) {
    Object.assign(this, { store, provider, images, dataDir, now }); this.tasks = new Map(); this.audio = new Set(); this.retryAt = new Map();
  }
  once(key, work) {
    if (this.tasks.has(key)) return this.tasks.get(key);
    const task = Promise.resolve().then(work).finally(() => this.tasks.delete(key)); this.tasks.set(key, task); return task;
  }
  recover() {
    for (const s of this.store.all()) if (s.status === 'active') {
      this.store.transaction(() => {
        s.status = 'paused'; this.store.save(s);
        this.store.append(s.id, `restart:${randomUUID()}`, 'gap', { text: 'The host restarted. Capture is paused; speech/messages during downtime were not captured. The DM must /session resume and /session voice again.' });
      });
    }
  }
  write(id, kind, evidence) {
    const s = this.store.get(id);
    // External consent is stored separately from capture consent. Full transcripts
    // and recaps remain local until bounded, opted-in excerpt routing is implemented.
    // Obus owns every AI request, including local routing and retrieval.
    return this.provider.write(kind, evidence, { campaign: s.campaign, owner: s.host, session: id, exportable: false, sourceRevision: this.store.entries(id).at(-1)?.seq || 0 });
  }
  async cue(id) {
    const s = this.store.get(id);
    if (s.mode !== 'human') throw new ChronicleError('Read-aloud assistance is only enabled in human DM mode.');
    if (['ending', 'ended'].includes(s.status)) throw new ChronicleError('This session has ended.');
    if (!s.scene) throw new ChronicleError('Use /session scene to supply the observable scene first.');
    // No hidden store, transcript, model draft or private image projection crosses this boundary.
    const scene = this.store.evidence(id).find(e => e.seq === s.scene.seq);
    const text = await this.write(id, 'cue', { title: s.scene.title, observableFacts: scene?.text ?? s.scene.text });
    if (this.store.get(id).scene?.seq !== s.scene.seq) throw new ChronicleError('The scene changed while drafting. Request a fresh cue.');
    return `PRIVATE DM DRAFT · scene E${s.scene.seq} · review before reading\n\n${text}`;
  }
  scene(id, { title, text, requestId, image = false, approvedImage = null }) {
    title = bounded(title, 100); text = bounded(text, 4000);
    return this.store.transaction(() => {
      const s = this.store.get(id); if (s.status !== 'active') throw new ChronicleError('Resume the session before publishing a scene.');
      const previous = this.store.find(id, `scene:${requestId}`); if (previous) return previous;
      // Validate approved assets before committing anything.
      if (approvedImage) this.images.asset(approvedImage);
      const entry = this.store.append(id, `scene:${requestId}`, 'scene', { title, text, approvedImage });
      s.scene = { seq: entry.seq, title, text, approvedImage }; this.store.save(s);
      if (image || s.autoImages) this.store.append(id, `image-request:${requestId}`, 'image-request', { scene: entry.seq }, false);
      return entry;
    });
  }
  requestImage(id, requestId) {
    const s = this.store.get(id); if (!['active', 'paused'].includes(s.status)) throw new ChronicleError('Images must be requested before ending the session.');
    if (!s.scene) throw new ChronicleError('Publish a scene first.');
    return this.store.transaction(() => this.store.append(id, `image-request:${requestId}`, 'image-request', { scene: s.scene.seq }, false));
  }
  async imagesTick(id) {
    if (!this.images) return;
    for (const request of this.store.entries(id).filter(e => e.kind === 'image-request')) {
      if (this.store.find(id, `image-result:${request.seq}`)) continue;
      let binding = this.store.find(id, `image-job:${request.seq}`);
      // Dedicated owner per scene; personal player/DM image jobs can never be shared here.
      const s = this.store.get(id), owner = `chronicle_${request.scene}`, scope = { campaign: s.campaign, owner };
      if (!binding) {
        const scene = this.store.evidence(id).find(e => e.seq === request.scene);
        if (!scene) continue;
        this.images.publishScene({ campaign: s.campaign, audience: owner, id: `scene_${scene.seq}`, title: scene.title, description: scene.text,
          sourceEventId: `chronicle:${id}:E${scene.seq}`, approvedImage: scene.approvedImage, subjects: [] });
        const job = await this.images.requestImage(scope, { requestId: `chronicle_${request.seq}` });
        binding = this.store.transaction(() => this.store.append(id, `image-job:${request.seq}`, 'image-job', { job: job.id, owner }, false));
      }
      const job = this.images.getJob(scope, binding.job);
      if (job.status === 'ready' || job.status === 'failed') this.store.transaction(() => {
        this.store.append(id, `image-result:${request.seq}`, job.status === 'ready' ? 'image' : 'gap', job.status === 'ready'
          ? { job: job.id, owner, title: job.title, scene: request.scene, text: `Scene E${request.scene} · ${job.title}. Illustration details are not additional clues.` }
          : { text: `Image for scene E${request.scene} could not be completed. The DM may request it again.`, scene: request.scene });
      });
    }
  }
  async summarize(id, { force = false } = {}) {
    return this.once(`summary:${id}`, async () => {
      const snapshot = this.store.get(id);
      if (!['active', 'paused'].includes(snapshot.status) || (!force && (snapshot.status !== 'active' || this.now() < snapshot.nextDue))) return null;
      const evidence = this.store.evidence(id, snapshot.watermark);
      if (!evidence.length) { const s = this.store.get(id); s.nextDue = this.now() + s.minutes * 60000; this.store.save(s); return null; }
      const end = evidence.at(-1).seq, correctionVersion = this.store.entries(id).filter(e => e.kind === 'correction').at(-1)?.seq ?? 0;
      const summaries = [];
      for (const group of chunks(evidence)) summaries.push(await this.write(id, 'summary', group));
      return this.store.transaction(() => {
        const s = this.store.get(id), currentCorrection = this.store.entries(id).filter(e => e.kind === 'correction').at(-1)?.seq ?? 0;
        if (!['active', 'paused'].includes(s.status) || currentCorrection !== correctionVersion || s.watermark !== snapshot.watermark) return null;
        const entry = this.store.append(id, `summary:${snapshot.watermark}:${end}:${correctionVersion}`, 'summary', {
          text: summaries.join('\n\n'), from: evidence[0].seq, through: end, correctionVersion,
        });
        s.watermark = end; s.nextDue = this.now() + s.minutes * 60000; this.store.save(s); return entry;
      });
    });
  }
  speech(id, { user, speaker, bytes, at, scene, captureEpoch, context, authorizeParticipant }) {
    if (this.audio.size >= 24) { bytes.fill(0); this.gap(id, 'Speech queue full; this segment was not captured.'); return Promise.resolve(); }
    // Capture metadata is immutable across authorization awaits and provider retries.
    const saved = context && Object.freeze({ scope: Object.freeze({ ...context.scope }), session: context.session,
      requestId: context.requestId, capturedRuntime: Object.freeze({ ...context.capturedRuntime }), capturedConsentEpoch: context.capturedConsentEpoch });
    const permitted = async () => {
      if (!saved || saved.session !== id || saved.scope.owner !== user || saved.scope.campaign !== this.store.get(id).campaign || !['host', 'player'].includes(saved.scope.role) ||
          typeof saved.requestId !== 'string' || !saved.requestId || saved.requestId.length > 100 ||
          !Number.isSafeInteger(captureEpoch) || saved.capturedConsentEpoch !== captureEpoch ||
          saved.capturedRuntime.contract !== 'raph-obus-game-runtime-v1' ||
          !['active', 'ending'].includes(this.store.get(id).status) || !this.store.hasConsent(id, user) ||
          this.store.privacy(id, user).captureEpoch !== captureEpoch || typeof authorizeParticipant !== 'function' ||
          typeof this.provider.authorizeParticipant !== 'function' || typeof this.provider.captureRuntime !== 'function') return false;
      if (await this.provider.authorizeParticipant(saved.scope) !== true || await authorizeParticipant(saved.scope) !== true) return false;
      const currentSession = this.store.get(id);
      const runtime = await this.provider.captureRuntime({ campaign: currentSession.campaign, owner: currentSession.host, role: 'host' }, id);
      if (runtime?.contract !== saved.capturedRuntime.contract || runtime.bootEpoch !== saved.capturedRuntime.bootEpoch ||
          runtime.generation !== saved.capturedRuntime.generation || runtime.sessionPolicyRevision !== saved.capturedRuntime.sessionPolicyRevision ||
          !Number.isSafeInteger(runtime.leaseExpiresAtMs) || runtime.leaseExpiresAtMs <= Date.now()) return false;
      return ['active', 'ending'].includes(this.store.get(id).status) && this.store.hasConsent(id, user) && this.store.privacy(id, user).captureEpoch === captureEpoch;
    };
    const task = (async () => {
      if (!await permitted()) return;
      const text = await this.provider.transcribe(bytes, saved);
      // A later opt-in or membership grant cannot authorize an obsolete segment.
      if (!await permitted()) return;
      if (text) this.store.record(id, `voice:${saved.requestId}`, { user, speaker, text, medium: 'voice', at, scene, captureEpoch }, { finishing: true });
    })().catch(() => this.gap(id, 'A speech segment could not be transcribed. Ask the speaker to add an important missing detail with /session note.')).finally(() => { bytes.fill(0); this.audio.delete(task); });
    this.audio.add(task); return task;
  }
  gap(id, text) { this.store.transaction(() => this.store.append(id, `gap:${randomUUID()}`, 'gap', { text })); }
  async end(id) {
    return this.once(`end:${id}`, async () => {
      let s = this.store.get(id);
      if (s.status === 'ended') return s;
      s.status = 'ending'; s.ended ??= this.now(); this.store.save(s);
      await Promise.allSettled([...this.audio, ...[this.tasks.get(`summary:${id}`)].filter(Boolean)]);
      await this.imagesTick(id);
      const pending = this.store.entries(id).filter(e => e.kind === 'image-request' && !this.store.find(id, `image-result:${e.seq}`));
      if (pending.length) throw new ChronicleError('Capture stopped. Scene images are still rendering; the recap will finish automatically when they are ready.');
      // Final recap always reads the entire corrected source record, not just the last time window.
      const groups = chunks(this.store.evidence(id)), chapters = [];
      for (let i = 0; i < groups.length; i++) {
        const source = `final-chapter:${i}`;
        const cached = this.store.find(id, source);
        const text = cached?.text ?? await this.write(id, 'summary', groups[i]);
        if (!cached) this.store.transaction(() => this.store.append(id, source, 'chapter', { text }, false));
        chapters.push(text);
      }
      let condensed = chapters;
      while (JSON.stringify(condensed).length > 18000) {
        const reduced = []; for (const group of chunks(condensed)) reduced.push(await this.write(id, 'summary', group));
        if (JSON.stringify(reduced).length >= JSON.stringify(condensed).length) throw new ChronicleError('Recap is too long to combine. The chapter record is saved; ask the host to choose a different story model.');
        condensed = reduced;
      }
      const previous = this.store.find(id, 'final-prose');
      const recap = previous?.text ?? (chapters.length ? await this.write(id, 'final', condensed) : 'No story speech, notes or scenes were captured in this session.');
      if (!previous) this.store.transaction(() => this.store.append(id, 'final-prose', 'recap-draft', { text: recap }, false));
      const entries = this.store.sharedEntries(id).filter(e => !['image-request', 'image-job', 'chapter', 'recap-draft', 'command-receipt'].includes(e.kind));
      s = this.store.get(id);
      const html = await makeReport({ session: s, recap, chapters, entries, imageBytes: async e => (await this.images.image({ campaign: s.campaign, owner: e.owner }, e.job)).bytes });
      const directory = join(this.dataDir, 'reports'); await mkdir(directory, { recursive: true });
      const name = `${id}.html`; await writeFile(join(directory, `${name}.tmp`), html, 'utf8'); await rename(join(directory, `${name}.tmp`), join(directory, name));
      // Export the corrected shared record; the full audit remains in the local database.
      await writeFile(join(directory, `${id}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      return this.store.transaction(() => {
        s = this.store.get(id); s.status = 'ended'; s.recap = name; this.store.save(s);
        this.store.append(id, 'final', 'recap', { text: recap });
        this.store.enqueue(id, `report:${id}`, { type: 'report', file: name }); return s;
      });
    });
  }
  async tick() {
    return this.once('tick', async () => {
      for (const s of this.store.all().filter(s => s.status !== 'ended')) {
        if ((this.retryAt.get(s.id) ?? 0) > this.now()) continue;
        try {
          await this.imagesTick(s.id);
          if (s.status === 'ending') await this.end(s.id); else await this.summarize(s.id);
          this.retryAt.delete(s.id);
        } catch {
          this.retryAt.set(s.id, this.now() + 60000);
          // One visible failure per evidence window, no failure-message storm.
          this.store.transaction(() => this.store.append(s.id, `provider-gap:${s.watermark}:${s.status}`, 'gap', { text: 'A story/image task is delayed. The source record is saved; the host will retry in a minute. Check /session status.' }));
        }
      }
    });
  }
  async delivery(row) {
    const s = this.store.get(row.session), item = row.body;
    if (item.type === 'report') {
      const bytes = await readFile(join(this.dataDir, 'reports', item.file));
      if (bytes.length > 9 * 1024 * 1024) return [{ content: `[RECAP] [SESSION:${s.id}] The complete illustrated report exceeds the channel attachment limit. The host can retrieve reports/${s.id}.html and reports/${s.id}.jsonl from the chronicle data folder.` }];
      return [{ content: `[RECAP] [SESSION:${s.id}] Complete illustrated chronicle · smaller scene images · expandable searchable source record. Save this HTML file and open it in your browser.`, files: [{ name: 'session-chronicle.html', data: bytes }] }];
    }
    const e = this.store.sharedEntries(row.session).find(entry => entry.seq === item.entry.seq) ?? item.entry;
    const prefix = `[${e.kind.toUpperCase()}] [SESSION:${s.id}] [E${e.seq}]${e.scene ? ` [SCENE:E${e.scene}]` : ''} ${new Date(e.at).toISOString()}${e.speaker ? ` · ${e.speaker}` : ''}${e.unverified ? ' · speech recognition, unverified' : ''}${e.target ? ` · corrects E${e.target}` : ''}\n`;
    const body = `${e.title ? `${e.title}\n` : ''}${e.text ?? ''}`;
    const messages = []; const size = Math.max(100, 1900 - prefix.length);
    for (let offset = 0; offset < body.length || !messages.length; offset += size) messages.push({ content: prefix + body.slice(offset, offset + size) });
    if (e.kind === 'image') {
      const result = await this.images.image({ campaign: s.campaign, owner: e.owner }, e.job);
      const thumb = await thumbnail(result.bytes, 1280);
      messages[0].files = [{ name: `scene-${e.scene}.jpg`, data: thumb.bytes }];
    }
    return messages;
  }
  async close() { await Promise.allSettled([...this.audio, ...this.tasks.values()]); }
}
