// discord/chronicle-core.mjs
import { createHash as createHash4, randomUUID as randomUUID5 } from "node:crypto";

// chronicle/service.mjs
import { randomUUID as randomUUID2 } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

// chronicle/store.mjs
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
var ChronicleError = class extends Error {
};
function bounded(value, max = 6e3) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ChronicleError(`Enter text between 1 and ${max} characters.`);
  return value.trim();
}
function interval(value) {
  if (!Number.isInteger(value) || value < 1 || value > 180) throw new ChronicleError("Choose a summary interval from 1 to 180 minutes.");
  return value;
}
var ChronicleStore = class {
  constructor(path, { now = Date.now } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.now = now;
    const existing = path !== ":memory:" && existsSync(path);
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000");
    if (existing && !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_uncertain'").get()) {
      try {
        this.db.prepare("VACUUM INTO ?").run(`${path}.before-chronicle-v4-${Date.now()}-${randomUUID()}.sqlite`);
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(session,source));
      CREATE INDEX IF NOT EXISTS session_entries ON entries(session,seq);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,session TEXT NOT NULL,body TEXT NOT NULL,sent TEXT);
      CREATE TABLE IF NOT EXISTS delivery_attempts(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_uncertain(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS consent(session TEXT,user TEXT,enabled INTEGER NOT NULL,PRIMARY KEY(session,user));
      CREATE TABLE IF NOT EXISTS chronicle_privacy(session TEXT,user TEXT,external INTEGER NOT NULL DEFAULT 0,capture_epoch INTEGER NOT NULL DEFAULT 0,external_epoch INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session,user));
      CREATE TABLE IF NOT EXISTS chronicle_mutations(campaign TEXT,user TEXT,request TEXT,fingerprint TEXT,result TEXT,PRIMARY KEY(campaign,user,request));`);
  }
  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  save(session) {
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(session.id, session.campaign, JSON.stringify(session));
    return session;
  }
  get(id) {
    const row = this.db.prepare("SELECT body FROM sessions WHERE id=?").get(id);
    if (!row) throw new ChronicleError("Session not found.");
    return JSON.parse(row.body);
  }
  all() {
    return this.db.prepare("SELECT body FROM sessions ORDER BY rowid").all().map((row) => JSON.parse(row.body));
  }
  current(campaign) {
    return this.all().reverse().find((s) => s.campaign === campaign && s.status !== "ended") ?? null;
  }
  latest(campaign) {
    return this.all().reverse().find((s) => s.campaign === campaign) ?? null;
  }
  start({ campaign, title, mode, minutes = 10, host, channel, sourceChannel, autoImages = false, requestId }) {
    bounded(campaign, 64);
    bounded(host, 96);
    bounded(channel, 96);
    bounded(sourceChannel, 96);
    bounded(requestId, 96);
    if (!["human", "arcade"].includes(mode)) throw new ChronicleError("Choose human or arcade mode.");
    title = bounded(title, 100);
    interval(minutes);
    return this.transaction(() => {
      const previous = this.all().find((s) => s.campaign === campaign && s.requestId === requestId);
      if (previous) return previous;
      if (this.current(campaign)) throw new ChronicleError("End the current session before starting another.");
      const session = this.save({
        id: randomUUID(),
        campaign,
        title,
        mode,
        minutes,
        host,
        channel,
        sourceChannel,
        autoImages: Boolean(autoImages),
        requestId,
        status: "active",
        started: this.now(),
        nextDue: this.now() + minutes * 6e4,
        watermark: 0,
        scene: null,
        ended: null,
        recap: null
      });
      this.append(session.id, `start:${requestId}`, "session", { text: `${title} \xB7 ${mode} DM \xB7 summaries every ${minutes} minutes. Capture is opt-in: /session consent enabled:true. Speech is processed locally through Obus; text and summaries are saved in this channel. /session pause stops capture.`, at: this.now() });
      return session;
    });
  }
  consent(id, user, enabled) {
    const work = () => {
      const previous = this.privacy(id, user);
      this.db.prepare("INSERT INTO consent VALUES(?,?,?) ON CONFLICT(session,user) DO UPDATE SET enabled=excluded.enabled").run(id, user, enabled ? 1 : 0);
      this.db.prepare("INSERT INTO chronicle_privacy VALUES(?,?,?,?,?) ON CONFLICT(session,user) DO UPDATE SET capture_epoch=excluded.capture_epoch").run(id, user, previous.external ? 1 : 0, previous.captureEpoch + (previous.capture !== Boolean(enabled) ? 1 : 0), previous.externalEpoch);
    };
    return this.db.isTransaction ? work() : this.transaction(work);
  }
  privacy(id, user) {
    const value = this.db.prepare("SELECT * FROM chronicle_privacy WHERE session=? AND user=?").get(id, user);
    return { capture: this.hasConsent(id, user), external: value?.external === 1, captureEpoch: value?.capture_epoch ?? 0, externalEpoch: value?.external_epoch ?? 0 };
  }
  externalConsent(id, user, enabled) {
    const work = () => {
      const previous = this.privacy(id, user);
      this.db.prepare("INSERT INTO chronicle_privacy VALUES(?,?,?,?,?) ON CONFLICT(session,user) DO UPDATE SET external=excluded.external,external_epoch=excluded.external_epoch").run(id, user, enabled ? 1 : 0, previous.captureEpoch, previous.externalEpoch + (previous.external !== Boolean(enabled) ? 1 : 0));
    };
    return this.db.isTransaction ? work() : this.transaction(work);
  }
  revision(id) {
    return this.db.prepare("SELECT MAX(seq) AS revision FROM entries WHERE session=?").get(id)?.revision ?? 0;
  }
  hasConsent(id, user) {
    return this.db.prepare("SELECT enabled FROM consent WHERE session=? AND user=?").get(id, user)?.enabled === 1;
  }
  find(id, source) {
    const row = this.db.prepare("SELECT * FROM entries WHERE session=? AND source=?").get(id, source);
    return row ? this.decode(row) : null;
  }
  decode(row) {
    return { ...JSON.parse(row.body), seq: row.seq, source: row.source, kind: row.kind };
  }
  entries(id, after = 0) {
    return this.db.prepare("SELECT * FROM entries WHERE session=? AND seq>? ORDER BY seq").all(id, after).map((row) => this.decode(row));
  }
  append(id, source, kind, body, publish = true) {
    const existing = this.find(id, source);
    if (existing) return existing;
    const entry = { ...body, at: body.at ?? this.now() };
    const result = this.db.prepare("INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)").run(id, source, kind, JSON.stringify(entry));
    const saved = { ...entry, seq: Number(result.lastInsertRowid), source, kind };
    if (publish) this.enqueue(id, `event:${saved.seq}`, { type: "entry", entry: saved });
    return saved;
  }
  record(id, source, { user, speaker, text, medium = "text", at, scene, captureEpoch }, { finishing = false } = {}) {
    return this.transaction(() => {
      const s = this.get(id);
      if (!(s.status === "active" || finishing && s.status === "ending") || !this.hasConsent(id, user)) return null;
      const privacy = this.privacy(id, user);
      if (captureEpoch !== void 0 && captureEpoch !== privacy.captureEpoch) return null;
      return this.append(id, source, "transcript", { user, speaker: bounded(speaker, 100), text: bounded(text), medium, at: at ?? this.now(), scene: scene ?? s.scene?.seq ?? null, unverified: medium !== "text", exportableAtCapture: privacy.external, externalEpoch: privacy.externalEpoch });
    });
  }
  control(id, action, requestId, value) {
    return this.transaction(() => {
      const s = this.get(id);
      if (this.find(id, `control:${requestId}`)) return s;
      if (["ended", "ending"].includes(s.status)) throw new ChronicleError("The session is closing or ended. Use /session end to finish its recap.");
      if (action === "pause") s.status = "paused";
      else if (action === "resume") {
        s.status = "active";
        s.nextDue = this.now() + s.minutes * 6e4;
      } else if (action === "minutes") {
        s.minutes = interval(value);
        s.nextDue = this.now() + s.minutes * 6e4;
      } else throw new ChronicleError("Unknown session control.");
      this.save(s);
      this.append(id, `control:${requestId}`, "session", { text: action === "minutes" ? `Summary interval changed to ${s.minutes} minutes.` : `Session ${s.status}.` });
      return s;
    });
  }
  correct(id, seq, text, user, isHost, requestId) {
    return this.transaction(() => {
      if (["ended", "ending"].includes(this.get(id).status)) throw new ChronicleError("Correct the record before ending the session.");
      const entries = this.entries(id), entry = entries.find((e) => e.seq === seq);
      const deleted = entries.filter((e) => e.kind === "correction" && e.target === seq).at(-1)?.deleted;
      if (!entry || deleted || !["transcript", "note", "scene"].includes(entry.kind) || !isHost && (entry.kind !== "transcript" || entry.user !== user)) throw new ChronicleError("You can correct your own transcript; the DM can correct public story records.");
      const result = this.append(id, `correction:${requestId}`, "correction", { target: seq, text: bounded(text), user });
      const s = this.get(id);
      s.watermark = 0;
      s.nextDue = this.now();
      this.save(s);
      return result;
    });
  }
  reviseMessage(id, messageId, { text, deleted = false, requestId }) {
    return this.transaction(() => {
      const session = this.get(id), entry = this.find(id, `discord:${messageId}`);
      if (!entry || !["active", "paused"].includes(session.status)) return null;
      const omitted = deleted || !this.hasConsent(id, entry.user);
      const result = this.append(id, `message-revision:${requestId}`, "correction", {
        target: entry.seq,
        user: entry.user,
        deleted: omitted,
        text: omitted ? "Discord message removed from active story evidence." : bounded(text)
      });
      session.watermark = 0;
      session.nextDue = this.now();
      this.save(session);
      return result;
    });
  }
  sharedEntries(id) {
    const entries = this.entries(id), corrections = /* @__PURE__ */ new Map();
    for (const entry of entries) if (entry.kind === "correction") corrections.set(entry.target, entry);
    return entries.map((entry) => {
      const correction = corrections.get(entry.kind === "correction" ? entry.target : entry.seq);
      if (correction?.deleted) return { ...entry, text: "Discord message removed from active story evidence.", deleted: true, corrected: true };
      if (entry.kind === "summary" && [...corrections.values()].some((value) => value.seq > (entry.correctionVersion ?? 0) && (!Number.isInteger(entry.from) || value.target >= entry.from && value.target <= entry.through))) {
        return { ...entry, text: "This summary is awaiting regeneration after a source correction.", invalidated: true };
      }
      return correction && entry.kind !== "correction" ? { ...entry, text: correction.text, corrected: true } : entry;
    });
  }
  evidence(id, after = 0) {
    const entries = this.entries(id), corrections = /* @__PURE__ */ new Map();
    for (const e of entries) if (e.kind === "correction") corrections.set(e.target, e);
    return entries.filter((e) => e.seq > after && ["transcript", "scene", "note"].includes(e.kind) && !corrections.get(e.seq)?.deleted).map((e) => ({ ...e, text: corrections.get(e.seq)?.text ?? e.text, corrected: corrections.has(e.seq) }));
  }
  enqueue(session, id, body) {
    this.db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,?,?,NULL)").run(id, session, JSON.stringify(body));
  }
  pending() {
    return this.db.prepare("SELECT * FROM deliveries WHERE sent IS NULL ORDER BY rowid").all().map((row) => ({ ...row, body: JSON.parse(row.body) }));
  }
  readyDeliveries() {
    return this.db.prepare("SELECT d.* FROM deliveries d LEFT JOIN delivery_attempts a ON a.id=d.id WHERE d.sent IS NULL AND d.id NOT IN (SELECT id FROM delivery_uncertain) AND COALESCE(a.attempts,0)<5 AND COALESCE(a.next_at,0)<=? ORDER BY d.rowid").all(this.now()).map((row) => ({ ...row, body: JSON.parse(row.body) }));
  }
  deliverySending(id) {
    this.db.prepare("INSERT OR IGNORE INTO delivery_uncertain SELECT id FROM deliveries WHERE id=? AND sent IS NULL").run(id);
  }
  clearDeliveryUncertain(id) {
    this.db.prepare("DELETE FROM delivery_uncertain WHERE id=?").run(id);
  }
  deferDelivery(id, { uncertain = false } = {}) {
    return this.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM deliveries WHERE id=? AND sent IS NULL").get(id)) return;
      if (uncertain) this.db.prepare("INSERT OR IGNORE INTO delivery_uncertain VALUES(?)").run(id);
      else this.clearDeliveryUncertain(id);
      const previous = this.db.prepare("SELECT attempts FROM delivery_attempts WHERE id=?").get(id);
      const attempts = Math.min(5, (previous?.attempts ?? 0) + 1), nextAt = this.now() + Math.min(9e5, 6e4 * 2 ** (attempts - 1));
      this.db.prepare("INSERT INTO delivery_attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts,next_at=excluded.next_at").run(id, attempts, nextAt);
      return { attempts, nextAt, failed: attempts >= 5 };
    });
  }
  deliveryState(id) {
    const rows = this.db.prepare("SELECT d.id IN (SELECT id FROM delivery_uncertain) AS uncertain,COALESCE(a.attempts,0) AS attempts,COALESCE(a.next_at,0) AS next_at FROM deliveries d LEFT JOIN delivery_attempts a ON a.id=d.id WHERE d.session=? AND d.sent IS NULL").all(id);
    const retrying = rows.filter((row) => !row.uncertain && row.attempts > 0 && row.attempts < 5);
    return { pending: rows.length, uncertain: rows.filter((row) => row.uncertain).length, failed: rows.filter((row) => !row.uncertain && row.attempts >= 5).length, retrying: retrying.length, nextAttemptAt: retrying.length ? Math.min(...retrying.map((row) => row.next_at)) : null };
  }
  retryDeliveries(id, requestId) {
    bounded(requestId, 96);
    return this.transaction(() => {
      const previous = this.find(id, `delivery-retry:${requestId}`);
      if (previous) return previous.count;
      const result = this.db.prepare("UPDATE delivery_attempts SET attempts=0,next_at=0 WHERE id NOT IN (SELECT id FROM delivery_uncertain) AND id IN (SELECT id FROM deliveries WHERE session=? AND sent IS NULL)").run(id);
      const count = Number(result.changes);
      this.append(id, `delivery-retry:${requestId}`, "delivery-retry", { count, text: `Delivery retry requested for ${count} saved entries.` }, false);
      return count;
    });
  }
  delivered(id, receipt2) {
    this.db.prepare("UPDATE deliveries SET sent=? WHERE id=?").run(String(receipt2), id);
  }
  close() {
    this.db.close();
  }
};

// chronicle/report.mjs
import { createCanvas, loadImage } from "@napi-rs/canvas";
var escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function thumbnail(bytes, width = 640) {
  const image = await loadImage(bytes);
  const ratio = Math.min(1, width / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { bytes: await canvas.encode("jpeg", 65), width: canvas.width, height: canvas.height };
}
async function makeReport({ session, recap, chapters, entries, imageBytes }) {
  const scenes = entries.filter((e) => e.kind === "image");
  const gallery = [];
  for (const entry of scenes) {
    try {
      const thumb = await thumbnail(await imageBytes(entry), 640);
      gallery.push(`<figure><img width="${thumb.width}" height="${thumb.height}" alt="${escapeHtml(entry.title)}" src="data:image/jpeg;base64,${thumb.bytes.toString("base64")}"><figcaption>[E${entry.seq}] ${escapeHtml(entry.title)} \xB7 scene E${entry.scene} \xB7 illustration, not additional story evidence</figcaption></figure>`);
    } catch {
      gallery.push(`<p>[E${entry.seq}] ${escapeHtml(entry.title)} \u2014 image unavailable in this export.</p>`);
    }
  }
  const transcript = entries.map((e) => `<article id="e${e.seq}"><small>[E${e.seq}] [${escapeHtml(e.kind.toUpperCase())}] ${escapeHtml(new Date(e.at).toISOString())}${e.speaker ? ` \xB7 ${escapeHtml(e.speaker)}` : ""}${e.target ? ` \xB7 corrects E${e.target}` : ""}</small><p>${escapeHtml(e.text ?? e.title ?? "")}</p></article>`).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeHtml(session.title)} \xB7 Session chronicle</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;background:#f5eedf;color:#28231b;font:17px/1.6 Georgia,serif}h1,h2{line-height:1.2;color:#634319}p{white-space:pre-wrap}small{font:13px/1.5 system-ui}figure{margin:24px 0;break-inside:avoid}img{max-width:100%;height:auto;border-radius:6px}figcaption{font:14px/1.5 system-ui;color:#625641}article{border-top:1px solid #cfbea2;padding:12px 0}summary{cursor:pointer;font-weight:bold}@media print{body{background:white;margin:0;max-width:none}details{display:block}summary{display:none}}</style><h1>${escapeHtml(session.title)}</h1><small>Session ${escapeHtml(session.id)} \xB7 ${escapeHtml(new Date(session.started).toISOString())} \xB7 ${escapeHtml(session.mode)} DM</small><p>AI-assisted story recap. Speech recognition is unverified; corrections below take precedence. The captured record may contain gaps. DM drafts are excluded.</p><h2>The story</h2><p>${escapeHtml(recap)}</p><h2>Chronological chapters</h2>${chapters.map((c) => `<p>${escapeHtml(c)}</p>`).join("")}<h2>Scenes</h2>${gallery.join("")}<details><summary>Searchable source record and corrections</summary>${transcript}</details></html>`;
}

// chronicle/service.mjs
function chunks(entries, limit = 18e3) {
  const out = [];
  let current = [], size = 0;
  for (const e of entries) {
    const record = typeof e === "string" ? e : { ref: `E${e.seq}`, kind: e.kind, speaker: e.speaker, text: e.text, at: new Date(e.at).toISOString(), scene: e.scene, unverified: e.unverified, corrected: e.corrected };
    const length = JSON.stringify(record).length;
    if (size + length > limit && current.length) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(record);
    size += length;
  }
  if (current.length) out.push(current);
  return out;
}
var ChronicleService = class {
  constructor({ store, provider, images, dataDir, now = Date.now }) {
    Object.assign(this, { store, provider, images, dataDir, now });
    this.tasks = /* @__PURE__ */ new Map();
    this.audio = /* @__PURE__ */ new Set();
    this.retryAt = /* @__PURE__ */ new Map();
  }
  once(key, work) {
    if (this.tasks.has(key)) return this.tasks.get(key);
    const task = Promise.resolve().then(work).finally(() => this.tasks.delete(key));
    this.tasks.set(key, task);
    return task;
  }
  recover() {
    for (const s of this.store.all()) if (s.status === "active") {
      this.store.transaction(() => {
        s.status = "paused";
        this.store.save(s);
        this.store.append(s.id, `restart:${randomUUID2()}`, "gap", { text: "The host restarted. Capture is paused; speech/messages during downtime were not captured. The DM must /session resume and /session voice again." });
      });
    }
  }
  write(id, kind, evidence) {
    const s = this.store.get(id);
    return this.provider.write(kind, evidence, { campaign: s.campaign, owner: s.host, session: id, exportable: false, sourceRevision: this.store.entries(id).at(-1)?.seq || 0 });
  }
  async cue(id) {
    const s = this.store.get(id);
    if (s.mode !== "human") throw new ChronicleError("Read-aloud assistance is only enabled in human DM mode.");
    if (["ending", "ended"].includes(s.status)) throw new ChronicleError("This session has ended.");
    if (!s.scene) throw new ChronicleError("Use /session scene to supply the observable scene first.");
    const scene = this.store.evidence(id).find((e) => e.seq === s.scene.seq);
    const text = await this.write(id, "cue", { title: s.scene.title, observableFacts: scene?.text ?? s.scene.text });
    if (this.store.get(id).scene?.seq !== s.scene.seq) throw new ChronicleError("The scene changed while drafting. Request a fresh cue.");
    return `PRIVATE DM DRAFT \xB7 scene E${s.scene.seq} \xB7 review before reading

${text}`;
  }
  scene(id, { title, text, requestId, image = false, approvedImage = null }) {
    title = bounded(title, 100);
    text = bounded(text, 4e3);
    return this.store.transaction(() => {
      const s = this.store.get(id);
      if (s.status !== "active") throw new ChronicleError("Resume the session before publishing a scene.");
      const previous = this.store.find(id, `scene:${requestId}`);
      if (previous) return previous;
      if (approvedImage) this.images.asset(approvedImage);
      const entry = this.store.append(id, `scene:${requestId}`, "scene", { title, text, approvedImage });
      s.scene = { seq: entry.seq, title, text, approvedImage };
      this.store.save(s);
      if (image || s.autoImages) this.store.append(id, `image-request:${requestId}`, "image-request", { scene: entry.seq }, false);
      return entry;
    });
  }
  requestImage(id, requestId) {
    const s = this.store.get(id);
    if (!["active", "paused"].includes(s.status)) throw new ChronicleError("Images must be requested before ending the session.");
    if (!s.scene) throw new ChronicleError("Publish a scene first.");
    return this.store.transaction(() => this.store.append(id, `image-request:${requestId}`, "image-request", { scene: s.scene.seq }, false));
  }
  async imagesTick(id) {
    if (!this.images) return;
    for (const request of this.store.entries(id).filter((e) => e.kind === "image-request")) {
      if (this.store.find(id, `image-result:${request.seq}`)) continue;
      let binding = this.store.find(id, `image-job:${request.seq}`);
      const s = this.store.get(id), owner = `chronicle_${request.scene}`, scope = { campaign: s.campaign, owner };
      if (!binding) {
        const scene = this.store.evidence(id).find((e) => e.seq === request.scene);
        if (!scene) continue;
        this.images.publishScene({
          campaign: s.campaign,
          audience: owner,
          id: `scene_${scene.seq}`,
          title: scene.title,
          description: scene.text,
          sourceEventId: `chronicle:${id}:E${scene.seq}`,
          approvedImage: scene.approvedImage,
          subjects: []
        });
        const job2 = await this.images.requestImage(scope, { requestId: `chronicle_${request.seq}` });
        binding = this.store.transaction(() => this.store.append(id, `image-job:${request.seq}`, "image-job", { job: job2.id, owner }, false));
      }
      const job = this.images.getJob(scope, binding.job);
      if (job.status === "ready" || job.status === "failed") this.store.transaction(() => {
        this.store.append(id, `image-result:${request.seq}`, job.status === "ready" ? "image" : "gap", job.status === "ready" ? { job: job.id, owner, title: job.title, scene: request.scene, text: `Scene E${request.scene} \xB7 ${job.title}. Illustration details are not additional clues.` } : { text: `Image for scene E${request.scene} could not be completed. The DM may request it again.`, scene: request.scene });
      });
    }
  }
  async summarize(id, { force = false } = {}) {
    return this.once(`summary:${id}`, async () => {
      const snapshot = this.store.get(id);
      if (!["active", "paused"].includes(snapshot.status) || !force && (snapshot.status !== "active" || this.now() < snapshot.nextDue)) return null;
      const evidence = this.store.evidence(id, snapshot.watermark);
      if (!evidence.length) {
        const s = this.store.get(id);
        s.nextDue = this.now() + s.minutes * 6e4;
        this.store.save(s);
        return null;
      }
      const end = evidence.at(-1).seq, correctionVersion = this.store.entries(id).filter((e) => e.kind === "correction").at(-1)?.seq ?? 0;
      const summaries = [];
      for (const group of chunks(evidence)) summaries.push(await this.write(id, "summary", group));
      return this.store.transaction(() => {
        const s = this.store.get(id), currentCorrection = this.store.entries(id).filter((e) => e.kind === "correction").at(-1)?.seq ?? 0;
        if (!["active", "paused"].includes(s.status) || currentCorrection !== correctionVersion || s.watermark !== snapshot.watermark) return null;
        const entry = this.store.append(id, `summary:${snapshot.watermark}:${end}:${correctionVersion}`, "summary", {
          text: summaries.join("\n\n"),
          from: evidence[0].seq,
          through: end,
          correctionVersion
        });
        s.watermark = end;
        s.nextDue = this.now() + s.minutes * 6e4;
        this.store.save(s);
        return entry;
      });
    });
  }
  speech(id, { user, speaker, bytes, at, scene, captureEpoch, context, authorizeParticipant }) {
    if (this.audio.size >= 24) {
      bytes.fill(0);
      this.gap(id, "Speech queue full; this segment was not captured.");
      return Promise.resolve();
    }
    const saved = context && Object.freeze({
      scope: Object.freeze({ ...context.scope }),
      session: context.session,
      requestId: context.requestId,
      capturedRuntime: Object.freeze({ ...context.capturedRuntime }),
      capturedConsentEpoch: context.capturedConsentEpoch
    });
    const permitted = async () => {
      if (!saved || saved.session !== id || saved.scope.owner !== user || saved.scope.campaign !== this.store.get(id).campaign || !["host", "player"].includes(saved.scope.role) || typeof saved.requestId !== "string" || !saved.requestId || saved.requestId.length > 100 || !Number.isSafeInteger(captureEpoch) || saved.capturedConsentEpoch !== captureEpoch || saved.capturedRuntime.contract !== "raph-obus-game-runtime-v1" || !["active", "ending"].includes(this.store.get(id).status) || !this.store.hasConsent(id, user) || this.store.privacy(id, user).captureEpoch !== captureEpoch || typeof authorizeParticipant !== "function" || typeof this.provider.authorizeParticipant !== "function" || typeof this.provider.captureRuntime !== "function") return false;
      if (await this.provider.authorizeParticipant(saved.scope) !== true || await authorizeParticipant(saved.scope) !== true) return false;
      const currentSession = this.store.get(id);
      const runtime = await this.provider.captureRuntime({ campaign: currentSession.campaign, owner: currentSession.host, role: "host" }, id);
      if (runtime?.contract !== saved.capturedRuntime.contract || runtime.bootEpoch !== saved.capturedRuntime.bootEpoch || runtime.generation !== saved.capturedRuntime.generation || runtime.sessionPolicyRevision !== saved.capturedRuntime.sessionPolicyRevision || !Number.isSafeInteger(runtime.leaseExpiresAtMs) || runtime.leaseExpiresAtMs <= Date.now()) return false;
      return ["active", "ending"].includes(this.store.get(id).status) && this.store.hasConsent(id, user) && this.store.privacy(id, user).captureEpoch === captureEpoch;
    };
    const task = (async () => {
      if (!await permitted()) return;
      const text = await this.provider.transcribe(bytes, saved);
      if (!await permitted()) return;
      if (text) this.store.record(id, `voice:${saved.requestId}`, { user, speaker, text, medium: "voice", at, scene, captureEpoch }, { finishing: true });
    })().catch(() => this.gap(id, "A speech segment could not be transcribed. Ask the speaker to add an important missing detail with /session note.")).finally(() => {
      bytes.fill(0);
      this.audio.delete(task);
    });
    this.audio.add(task);
    return task;
  }
  gap(id, text) {
    this.store.transaction(() => this.store.append(id, `gap:${randomUUID2()}`, "gap", { text }));
  }
  async end(id) {
    return this.once(`end:${id}`, async () => {
      let s = this.store.get(id);
      if (s.status === "ended") return s;
      s.status = "ending";
      s.ended ??= this.now();
      this.store.save(s);
      await Promise.allSettled([...this.audio, ...[this.tasks.get(`summary:${id}`)].filter(Boolean)]);
      await this.imagesTick(id);
      const pending = this.store.entries(id).filter((e) => e.kind === "image-request" && !this.store.find(id, `image-result:${e.seq}`));
      if (pending.length) throw new ChronicleError("Capture stopped. Scene images are still rendering; the recap will finish automatically when they are ready.");
      const groups = chunks(this.store.evidence(id)), chapters = [];
      for (let i = 0; i < groups.length; i++) {
        const source = `final-chapter:${i}`;
        const cached = this.store.find(id, source);
        const text = cached?.text ?? await this.write(id, "summary", groups[i]);
        if (!cached) this.store.transaction(() => this.store.append(id, source, "chapter", { text }, false));
        chapters.push(text);
      }
      let condensed = chapters;
      while (JSON.stringify(condensed).length > 18e3) {
        const reduced = [];
        for (const group of chunks(condensed)) reduced.push(await this.write(id, "summary", group));
        if (JSON.stringify(reduced).length >= JSON.stringify(condensed).length) throw new ChronicleError("Recap is too long to combine. The chapter record is saved; ask the host to choose a different story model.");
        condensed = reduced;
      }
      const previous = this.store.find(id, "final-prose");
      const recap = previous?.text ?? (chapters.length ? await this.write(id, "final", condensed) : "No story speech, notes or scenes were captured in this session.");
      if (!previous) this.store.transaction(() => this.store.append(id, "final-prose", "recap-draft", { text: recap }, false));
      const entries = this.store.sharedEntries(id).filter((e) => !["image-request", "image-job", "chapter", "recap-draft", "command-receipt"].includes(e.kind));
      s = this.store.get(id);
      const html = await makeReport({ session: s, recap, chapters, entries, imageBytes: async (e) => (await this.images.image({ campaign: s.campaign, owner: e.owner }, e.job)).bytes });
      const directory = join(this.dataDir, "reports");
      await mkdir(directory, { recursive: true });
      const name = `${id}.html`;
      await writeFile(join(directory, `${name}.tmp`), html, "utf8");
      await rename(join(directory, `${name}.tmp`), join(directory, name));
      await writeFile(join(directory, `${id}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
      return this.store.transaction(() => {
        s = this.store.get(id);
        s.status = "ended";
        s.recap = name;
        this.store.save(s);
        this.store.append(id, "final", "recap", { text: recap });
        this.store.enqueue(id, `report:${id}`, { type: "report", file: name });
        return s;
      });
    });
  }
  async tick() {
    return this.once("tick", async () => {
      for (const s of this.store.all().filter((s2) => s2.status !== "ended")) {
        if ((this.retryAt.get(s.id) ?? 0) > this.now()) continue;
        try {
          await this.imagesTick(s.id);
          if (s.status === "ending") await this.end(s.id);
          else await this.summarize(s.id);
          this.retryAt.delete(s.id);
        } catch {
          this.retryAt.set(s.id, this.now() + 6e4);
          this.store.transaction(() => this.store.append(s.id, `provider-gap:${s.watermark}:${s.status}`, "gap", { text: "A story/image task is delayed. The source record is saved; the host will retry in a minute. Check /session status." }));
        }
      }
    });
  }
  async delivery(row) {
    const s = this.store.get(row.session), item = row.body;
    if (item.type === "report") {
      const bytes = await readFile(join(this.dataDir, "reports", item.file));
      if (bytes.length > 9 * 1024 * 1024) return [{ content: `[RECAP] [SESSION:${s.id}] The complete illustrated report exceeds the channel attachment limit. The host can retrieve reports/${s.id}.html and reports/${s.id}.jsonl from the chronicle data folder.` }];
      return [{ content: `[RECAP] [SESSION:${s.id}] Complete illustrated chronicle \xB7 smaller scene images \xB7 expandable searchable source record. Save this HTML file and open it in your browser.`, files: [{ name: "session-chronicle.html", data: bytes }] }];
    }
    const e = this.store.sharedEntries(row.session).find((entry) => entry.seq === item.entry.seq) ?? item.entry;
    const prefix = `[${e.kind.toUpperCase()}] [SESSION:${s.id}] [E${e.seq}]${e.scene ? ` [SCENE:E${e.scene}]` : ""} ${new Date(e.at).toISOString()}${e.speaker ? ` \xB7 ${e.speaker}` : ""}${e.unverified ? " \xB7 speech recognition, unverified" : ""}${e.target ? ` \xB7 corrects E${e.target}` : ""}
`;
    const body = `${e.title ? `${e.title}
` : ""}${e.text ?? ""}`;
    const messages = [];
    const size = Math.max(100, 1900 - prefix.length);
    for (let offset = 0; offset < body.length || !messages.length; offset += size) messages.push({ content: prefix + body.slice(offset, offset + size) });
    if (e.kind === "image") {
      const result = await this.images.image({ campaign: s.campaign, owner: e.owner }, e.job);
      const thumb = await thumbnail(result.bytes, 1280);
      messages[0].files = [{ name: `scene-${e.scene}.jpg`, data: thumb.bytes }];
    }
    return messages;
  }
  async close() {
    await Promise.allSettled([...this.audio, ...this.tasks.values()]);
  }
};

// discord/chronicle-adapter.mjs
import { createHash } from "node:crypto";
var option = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
var sub = (name, description, options = []) => option(1, name, description, { options });
var SESSION_COMMAND = {
  name: "session",
  description: "DM read-aloud assistant and shared session chronicle",
  type: 1,
  options: [
    sub("start", "DM/Admin: start a story session", [option(3, "title", "Session title", { required: true, max_length: 100 }), option(3, "mode", "Who runs the story?", { required: true, choices: [{ name: "Human DM", value: "human" }, { name: "Automated arcade", value: "arcade" }] }), option(4, "minutes", "Minutes between summaries (1\u2013180; default 10)", { min_value: 1, max_value: 180 }), option(5, "images", "Automatically request an illustration for each published scene")]),
    sub("consent", "Turn capture of your typed messages and voice on or off for this session", [option(5, "enabled", "Allow your speech to be transcribed and saved to the shared story record", { required: true }), option(5, "external", "Allow eligible excerpts to be processed by host-enabled external AI routes")]),
    sub("status", "Show session state, interval and your capture setting"),
    sub("scene", "DM/Admin: publish only what all players can observe", [option(3, "title", "Scene title", { required: true, max_length: 100 }), option(3, "description", "Public observable facts ONLY; never DM secrets", { required: true, max_length: 4e3 }), option(5, "image", "Request a scene illustration"), option(3, "art", "Optional approved campaign art ID", { max_length: 100 })]),
    sub("cue", "DM/Admin: privately draft a passage to read aloud for the current scene"),
    sub("image", "Request a shared illustration of the current public scene"),
    sub("note", "Add a public story note (proposals remain proposals)", [option(3, "text", "Story note", { required: true, max_length: 4e3 })]),
    sub("correct", "Correct your transcript; DM/Admin can correct any public source entry", [option(4, "entry", "Number after E in the entry tag", { required: true, min_value: 1 }), option(3, "text", "Corrected text, retained with an audit trail", { required: true, max_length: 4e3 })]),
    sub("minutes", "DM/Admin: change the summary interval", [option(4, "value", "Minutes between summaries", { required: true, min_value: 1, max_value: 180 })]),
    sub("pause", "DM/Admin: stop voice and typed capture for a break"),
    sub("resume", "DM/Admin: resume the scribe; reconnect voice separately"),
    sub("summary", "DM/Admin: summarize new story evidence now"),
    sub("voice", "DM/Admin: listen in your current voice channel (opted-in speakers only)"),
    sub("leave", "DM/Admin: disconnect voice capture"),
    sub("end", "DM/Admin: stop capture and publish the complete illustrated recap"),
    sub("retry-delivery", "DM/Admin: retry known failed story deliveries; uncertain sends remain paused")
  ]
};
function chronicleIdentity(interaction, config) {
  const member = interaction.member, user = member?.user?.id;
  if (interaction.guild_id !== config.guildId || ![config.channelId, config.journalChannelId].includes(interaction.channel_id) || !user || member.user.bot || !Array.isArray(member.roles)) throw new ChronicleError("Use this command in the configured campaign or story channel.");
  let permissions = 0n;
  try {
    permissions = BigInt(member.permissions ?? "0");
  } catch {
  }
  const host = config.dmIds.includes(user) || config.dmRoleId && member.roles.includes(config.dmRoleId) || Boolean(permissions & (8n | 32n));
  const player = config.playerIds.includes(user) || config.playerRoleId && member.roles.includes(config.playerRoleId);
  if (!host && !player) throw new ChronicleError("The session companion is available to current campaign members.");
  return { user, host: Boolean(host), speaker: (member.nick || member.user.global_name || member.user.username || user).slice(0, 100) };
}
function createChronicleAdapter({ store, service, config, transport, voice, log = () => {
} }) {
  let commands = Promise.resolve();
  let delivering = null;
  store.db.exec("CREATE TABLE IF NOT EXISTS delivery_parts(id TEXT,part INTEGER,receipt TEXT NOT NULL,PRIMARY KEY(id,part))");
  const reply = (i, content) => transport.respond(i.id, i.token, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
  async function handle(i, { acknowledged: alreadyAcknowledged = false } = {}) {
    if (i.type !== 2 || i.data?.name !== "session") return false;
    let acknowledged = alreadyAcknowledged === true;
    try {
      const actor = chronicleIdentity(i, config), action = i.data.options?.[0]?.name;
      const values = Object.fromEntries((i.data.options?.[0]?.options ?? []).map((o) => [o.name, o.value]));
      if (!SESSION_COMMAND.options.some((o) => o.name === action)) throw new ChronicleError("Unknown session command.");
      if (!["consent", "status", "note", "correct", "image"].includes(action) && !actor.host) throw new ChronicleError("Only the DM or a server administrator can use that control.");
      if (!acknowledged) {
        await transport.respond(i.id, i.token, { type: 5, data: { flags: 64 } });
        acknowledged = true;
      }
      const task = (action === "consent" ? Promise.resolve() : commands).then(async () => {
        const current = chronicleIdentity({ ...i, member: await transport.member(actor.user) }, config);
        if (current.user !== actor.user || !["consent", "status", "note", "correct", "image"].includes(action) && !current.host) throw new ChronicleError("Your current campaign role no longer permits this command.");
        actor.host = current.host;
        actor.speaker = current.speaker;
        let result, s = store.current(config.campaignId);
        if (action === "start") {
          s = store.start({
            campaign: config.campaignId,
            title: values.title,
            mode: values.mode,
            minutes: values.minutes ?? 10,
            autoImages: values.images ?? false,
            host: actor.user,
            channel: config.journalChannelId,
            sourceChannel: config.channelId,
            requestId: i.id
          });
          result = `Session started: ${s.title}. Shared story record: <#${s.channel}>. Each speaker should /session consent enabled:true. Use /session scene for public scene facts, then /session cue for private read-aloud text. Use /session voice to connect to your voice channel.`;
        } else {
          if (!s && ["status", "end", "retry-delivery"].includes(action)) s = store.latest(config.campaignId);
          if (!s) throw new ChronicleError("The DM must /session start first.");
          if (action === "status") result = `${s.title} \xB7 ${s.status} \xB7 ${s.mode} DM
Session ${s.id}
Summaries: every ${s.minutes} minutes${s.status === "active" ? `; next due ${new Date(s.nextDue).toISOString()}` : ""}
Your capture: ${store.hasConsent(s.id, actor.user) ? "on" : "off"}
External AI processing: ${store.privacy(s.id, actor.user).external ? "permitted" : "off"}
Voice: ${voice?.status() ?? "not configured"}
Story channel: <#${s.channel}>
Pending story deliveries: ${store.deliveryState(s.id).pending}; failed: ${store.deliveryState(s.id).failed}; need review: ${store.deliveryState(s.id).uncertain}${s.recap ? "\nIllustrated recap saved and queued for the story channel." : ""}`;
          else if (action === "consent") {
            if (!["active", "paused"].includes(s.status)) throw new ChronicleError("Capture is closed for this session.");
            if (typeof values.enabled !== "boolean") throw new ChronicleError("Choose capture on or off.");
            if (values.external !== void 0 && typeof values.external !== "boolean") throw new ChronicleError("Choose external processing on or off.");
            store.transaction(() => {
              if (store.find(s.id, `consent:${i.id}`)) return;
              store.consent(s.id, actor.user, values.enabled);
              if (values.external !== void 0) store.externalConsent(s.id, actor.user, values.external);
              store.append(s.id, `consent:${i.id}`, "session", { text: `${actor.speaker}: capture ${values.enabled ? "on" : "off"}; external AI processing ${store.privacy(s.id, actor.user).external ? "permitted" : "off"}.`, user: actor.user });
            });
            if (!values.enabled) voice?.revoke(actor.user);
            result = `Your capture is ${values.enabled ? "on. Typed messages in the campaign channel and your connected Discord voice stream can now be saved; speech is processed locally through Obus." : "off. Existing records remain; new speech and typed messages will not be saved."}`;
          } else if (["pause", "resume", "minutes"].includes(action)) {
            s = store.control(s.id, action, i.id, values.value);
            if (action === "pause") await voice?.stop();
            result = `${s.status} \xB7 summaries every ${s.minutes} minutes.${action === "resume" ? " Use /session voice to reconnect voice capture." : ""}`;
          } else if (action === "scene") {
            const e = service.scene(s.id, { title: values.title, text: values.description, requestId: i.id, image: values.image, approvedImage: values.art });
            result = `Published scene E${e.seq}. ${s.mode === "human" ? "Use /session cue for your private read-aloud passage." : "The arcade narrator can use these public scene facts."}`;
          } else if (action === "cue") result = await service.cue(s.id);
          else if (action === "image") {
            service.requestImage(s.id, i.id);
            result = "Shared scene image queued. It will appear in the story channel when ready.";
          } else if (action === "note") {
            if (s.status !== "active") throw new ChronicleError("Resume the session before adding a story note.");
            const e = store.transaction(() => store.append(s.id, `note:${i.id}`, "note", { text: bounded(values.text, 4e3), user: actor.user, speaker: actor.speaker, scene: s.scene?.seq ?? null }));
            result = `Public story note saved as E${e.seq}.`;
          } else if (action === "correct") {
            const e = store.correct(s.id, values.entry, values.text, actor.user, actor.host, i.id);
            result = `Correction E${e.seq} saved. It supersedes E${values.entry}; the original remains visible for context. Subsequent summaries and the final recap use the corrected text.`;
          } else if (action === "summary") {
            const e = await service.summarize(s.id, { force: true });
            result = e ? "Summary saved for the story channel." : "No new story evidence to summarize.";
          } else if (action === "voice") {
            if (!voice) throw new ChronicleError("Voice capture is not configured.");
            await voice.start(s.id, actor.user);
            result = "Voice connected. Only current campaign members who opted in are transcribed. Use /session leave or /session pause to disconnect.";
          } else if (action === "leave") {
            await voice?.stop();
            result = "Voice capture disconnected. Typed capture continues unless you pause the session.";
          } else if (action === "retry-delivery") {
            const count = store.retryDeliveries(s.id, i.id);
            result = `Retry requested for ${count} saved deliveries. Uncertain sends stay paused until their outcome is reviewed in Discord.`;
          } else if (action === "end") {
            await voice?.stop({ flush: true });
            await service.end(s.id);
            result = "Session ended. The complete illustrated recap is saved and queued for the story channel.";
          }
        }
        const parts = result.match(/[\s\S]{1,1900}/g) ?? ["Done."];
        await transport.edit(i.application_id, i.token, { content: parts[0], allowed_mentions: { parse: [] } });
        for (const content of parts.slice(1)) await transport.followup(i.application_id, i.token, { content, flags: 64, allowed_mentions: { parse: [] } });
      });
      if (action !== "consent") commands = task.catch(() => {
      });
      await task;
    } catch (error) {
      log({ outcome: "chronicle_command_failed", expected: error instanceof ChronicleError });
      const message2 = error instanceof ChronicleError ? error.message : "The session request could not finish. Check /session status; saved entries are retained.";
      try {
        if (acknowledged) await transport.edit(i.application_id, i.token, { content: message2, allowed_mentions: { parse: [] } });
        else await reply(i, message2);
      } catch {
        log({ outcome: "chronicle_reply_failed" });
      }
    }
    return true;
  }
  async function message(packet) {
    if (packet.guild_id !== config.guildId || packet.channel_id !== config.channelId || !packet.author?.id || packet.author.bot || packet.webhook_id || !packet.content?.trim()) return;
    const s = store.current(config.campaignId);
    if (!s || s.status !== "active" || !store.hasConsent(s.id, packet.author.id)) return;
    const captureEpoch = store.privacy(s.id, packet.author.id).captureEpoch;
    const member = await transport.member(packet.author.id);
    const actor = chronicleIdentity({ guild_id: packet.guild_id, channel_id: packet.channel_id, member: { ...member, user: packet.author } }, config);
    if (store.current(config.campaignId)?.id !== s.id) return;
    store.record(s.id, `discord:${packet.id}`, { user: actor.user, speaker: actor.speaker, text: packet.content, at: Date.parse(packet.timestamp) || Date.now(), captureEpoch });
  }
  async function flush() {
    if (delivering) return delivering;
    delivering = (async () => {
      for (const row of store.readyDeliveries()) {
        let sending = false;
        try {
          const s = store.get(row.session), payloads = await service.delivery(row);
          for (let part = 0; part < payloads.length; part++) {
            if (store.db.prepare("SELECT receipt FROM delivery_parts WHERE id=? AND part=?").get(row.id, part)) continue;
            const nonce = createHash("sha256").update(`${row.id}:${part}`).digest("hex").slice(0, 24);
            store.deliverySending(row.id);
            sending = true;
            const response = await transport.send(s.channel, { ...payloads[part], allowed_mentions: { parse: [] }, nonce, enforce_nonce: true });
            if (typeof response?.id !== "string" || !response.id) throw new Error("Missing delivery receipt.");
            store.transaction(() => {
              store.db.prepare("INSERT OR IGNORE INTO delivery_parts VALUES(?,?,?)").run(row.id, part, response.id);
              store.clearDeliveryUncertain(row.id);
            });
            sending = false;
          }
          store.delivered(row.id, "complete");
        } catch (error) {
          const status = Number(error?.status), rejected = Number.isInteger(status) && status >= 400 && status < 500;
          const uncertain = sending && !rejected;
          store.deferDelivery(row.id, { uncertain });
          log({ outcome: uncertain ? "chronicle_delivery_needs_review" : "chronicle_delivery_retry_deferred" });
        }
      }
    })().finally(() => {
      delivering = null;
    });
    return delivering;
  }
  return { handle, message, flush, close: async () => {
    await commands;
    await delivering;
  } };
}

// chronicle/dispatch.mjs
import { createHash as createHash3, randomUUID as randomUUID4 } from "node:crypto";

// chronicle/commands.mjs
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
var MAX_ATTEMPTS = 3;
var CAMPAIGN_CAPACITY = 100;
var OWNER_CAPACITY = 20;
var MAX_JSON_BYTES = 32768;
var ERROR_MESSAGES = Object.freeze({
  FORBIDDEN: "Access is no longer authorized.",
  NOT_FOUND: "The requested session is unavailable.",
  STALE_REVISION: "The session changed before the command could run.",
  INVALID_COMMAND: "The command is no longer valid.",
  CAPTURE_UNAVAILABLE: "Voice capture is currently unavailable.",
  PROVIDER_UNAVAILABLE: "The required service is currently unavailable.",
  WORKER_EXHAUSTED: "The command could not finish after three worker attempts.",
  COMMAND_FAILED: "The command could not be completed."
});
var ChronicleCommandError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function fail(status, code, message) {
  throw new ChronicleCommandError(status, code, message);
}
function identifier(value, name, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    fail(400, "INVALID_COMMAND", `Invalid ${name}.`);
  }
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 8) fail(400, "INVALID_COMMAND", "Command data is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const out = /* @__PURE__ */ Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key], depth + 1);
    return out;
  }
  fail(400, "INVALID_COMMAND", "Command data must contain only JSON values.");
}
function json(value) {
  const encoded = JSON.stringify(canonical(value));
  if (Buffer.byteLength(encoded) > MAX_JSON_BYTES) fail(400, "INVALID_COMMAND", "Command data is too large.");
  return encoded;
}
function validateScope(scope) {
  if (!scope || typeof scope !== "object") fail(400, "INVALID_COMMAND", "A trusted scope is required.");
  identifier(scope.campaign, "campaign", 128);
  identifier(scope.owner, "owner", 128);
  if (!["host", "player"].includes(scope.role)) fail(400, "INVALID_COMMAND", "Invalid role.");
}
function commandData(scope, input) {
  validateScope(scope);
  if (!input || typeof input !== "object") fail(400, "INVALID_COMMAND", "A command is required.");
  identifier(input.requestId, "request ID");
  identifier(input.type, "command type", 64);
  if (!(input.type === "start" && input.sessionId === null)) identifier(input.sessionId, "session ID", 128);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, "INVALID_COMMAND", "A valid expected revision is required.");
  return {
    scopeJson: json(scope),
    inputJson: json(input),
    fingerprint: createHash2("sha256").update(json({ scope, input })).digest("hex")
  };
}
function sanitizedError(error) {
  const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : "COMMAND_FAILED";
  return { code, message: ERROR_MESSAGES[code], status: Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500 };
}
function receipt(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    sessionId: row.session_id || null,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null
  };
}
function leased(row) {
  return {
    ...receipt(row),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    worker: row.worker,
    scope: JSON.parse(row.scope_json),
    input: JSON.parse(row.input_json)
  };
}
var ChronicleCommands = class {
  constructor(store, { now = Date.now, leaseMs = 3e4 } = {}) {
    if (!store?.db?.prepare || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 3e5) {
      fail(400, "INVALID_COMMAND", "A store and a bounded lease duration are required.");
    }
    this.db = store.db;
    this.now = now;
    this.leaseMs = leaseMs;
    this.db.exec(`CREATE TABLE IF NOT EXISTS chronicle_commands (
      id TEXT PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL, request_id TEXT NOT NULL,
      session_id TEXT NOT NULL, type TEXT NOT NULL, fingerprint TEXT NOT NULL,
      scope_json TEXT NOT NULL, input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, worker TEXT, lease_token TEXT, lease_until INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, result_json TEXT, error_json TEXT,
      UNIQUE(campaign, request_id)
    ); CREATE INDEX IF NOT EXISTS chronicle_commands_pending ON chronicle_commands(campaign,status,created_at);
    CREATE INDEX IF NOT EXISTS chronicle_commands_owner ON chronicle_commands(campaign,owner,created_at);`);
  }
  transaction(work) {
    if (this.db.isTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid queue clock.");
    return value;
  }
  expire(campaign, at) {
    this.db.prepare(`UPDATE chronicle_commands SET status='failed', updated_at=?, error_json=?,
      worker=NULL, lease_token=NULL, lease_until=NULL WHERE campaign=? AND status='running'
      AND lease_until<=? AND attempts>=?`).run(at, JSON.stringify(sanitizedError({ code: "WORKER_EXHAUSTED" })), campaign, at, MAX_ATTEMPTS);
  }
  replay(scope, input) {
    const { fingerprint } = commandData(scope, input);
    const existing = this.db.prepare("SELECT * FROM chronicle_commands WHERE campaign=? AND request_id=?").get(scope.campaign, input.requestId);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) fail(409, "REQUEST_CONFLICT", "This request ID was already used for another command.");
    return receipt(existing);
  }
  enqueue(scope, input) {
    const { scopeJson, inputJson, fingerprint } = commandData(scope, input);
    return this.transaction(() => {
      const existing = this.replay(scope, input);
      if (existing) return existing;
      const at = this.time();
      this.expire(scope.campaign, at);
      const counts = this.db.prepare(`SELECT COUNT(*) AS campaign_count,
        COALESCE(SUM(CASE WHEN owner=? THEN 1 ELSE 0 END),0) AS owner_count
        FROM chronicle_commands WHERE campaign=? AND status IN ('queued','running')`).get(scope.owner, scope.campaign);
      if (counts.campaign_count >= CAMPAIGN_CAPACITY || counts.owner_count >= OWNER_CAPACITY) fail(429, "QUEUE_FULL", "The session command queue is full. Try again after pending commands finish.");
      const id = randomUUID3();
      this.db.prepare(`INSERT INTO chronicle_commands
        (id,campaign,owner,request_id,session_id,type,fingerprint,scope_json,input_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(id, scope.campaign, scope.owner, input.requestId, input.sessionId ?? "", input.type, fingerprint, scopeJson, inputJson, at, at);
      return receipt(this.db.prepare("SELECT * FROM chronicle_commands WHERE id=?").get(id));
    });
  }
  list(scope) {
    validateScope(scope);
    return this.db.prepare(`SELECT * FROM chronicle_commands WHERE campaign=? AND owner=?
      ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(scope.campaign, scope.owner).map(receipt);
  }
  claim(worker, { campaign } = {}) {
    identifier(worker, "worker", 128);
    identifier(campaign, "campaign", 128);
    return this.transaction(() => {
      const at = this.time();
      this.expire(campaign, at);
      const row = this.db.prepare(`SELECT * FROM chronicle_commands WHERE campaign=? AND attempts<?
        AND (status='queued' OR (status='running' AND lease_until<=?)) ORDER BY created_at,rowid LIMIT 1`).get(campaign, MAX_ATTEMPTS, at);
      if (!row) return null;
      this.db.prepare(`UPDATE chronicle_commands SET status='running', attempts=attempts+1,
        worker=?,lease_token=?,lease_until=?,updated_at=? WHERE id=?`).run(worker, randomUUID3(), at + this.leaseMs, at, row.id);
      return leased(this.db.prepare("SELECT * FROM chronicle_commands WHERE id=?").get(row.id));
    });
  }
  renew(claim) {
    identifier(claim?.id, "command ID");
    identifier(claim?.leaseToken, "lease token");
    return this.transaction(() => {
      const at = this.time();
      const update = this.db.prepare(`UPDATE chronicle_commands SET lease_until=?,updated_at=?
        WHERE id=? AND status='running' AND lease_token=? AND lease_until>?`).run(at + this.leaseMs, at, claim.id, claim.leaseToken, at);
      if (!update.changes) fail(409, "STALE_LEASE", "This worker no longer owns the command lease.");
      return leased(this.db.prepare("SELECT * FROM chronicle_commands WHERE id=?").get(claim.id));
    });
  }
  complete(claim, { result = null, error = null } = {}) {
    identifier(claim?.id, "command ID");
    identifier(claim?.leaseToken, "lease token");
    const resultJson = error ? null : json(result), errorJson = error ? JSON.stringify(sanitizedError(error)) : null;
    return this.transaction(() => {
      const at = this.time();
      const update = this.db.prepare(`UPDATE chronicle_commands SET status=?,result_json=?,error_json=?,updated_at=?,
        worker=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='running' AND lease_token=? AND lease_until>?`).run(error ? "failed" : "done", resultJson, errorJson, at, claim.id, claim.leaseToken, at);
      if (!update.changes) fail(409, "STALE_LEASE", "This worker no longer owns the command lease.");
      return receipt(this.db.prepare("SELECT * FROM chronicle_commands WHERE id=?").get(claim.id));
    });
  }
};

// chronicle/dispatch.mjs
var fail2 = (code, message) => Object.assign(new Error(message), { code });
function createChronicleDispatcher({
  store,
  service,
  voice,
  config,
  transport,
  authorize = () => false,
  queue = new ChronicleCommands(store),
  log = () => {
  },
  renewEveryMs = 1e4
}) {
  const worker = `chronicle:${randomUUID4()}`;
  let running = null, closing = false;
  async function execute(claim) {
    const { scope, input } = claim;
    const authorized = async () => {
      if (scope.campaign !== config.campaignId || scope.role !== "host" || !await authorize(scope)) throw fail2("FORBIDDEN", "The GM no longer has access to this campaign.");
      const member = await transport.member(scope.owner);
      const identity = chronicleIdentity({ guild_id: config.guildId, channel_id: config.channelId, member }, config);
      if (identity.user !== scope.owner || !identity.host || !await authorize(scope)) throw fail2("FORBIDDEN", "The GM no longer has access to this campaign.");
    };
    await authorized();
    const actionId = `web:${createHash3("sha256").update(`${scope.owner}:${input.requestId}`).digest("hex")}`;
    const source = `web-command:${actionId}`;
    let session = input.sessionId ? store.get(input.sessionId) : null;
    if (session && session.campaign !== scope.campaign) throw fail2("FORBIDDEN", "This session belongs to another campaign.");
    if (input.type === "start") session = store.all().find((value) => value.campaign === scope.campaign && value.requestId === actionId) ?? null;
    const saved = session && store.find(session.id, source);
    if (saved) return saved.result;
    const controlApplied = session && ["pause", "resume"].includes(input.type) && store.find(session.id, `control:${actionId}`);
    const retryApplied = session && input.type === "retry-delivery" && store.find(session.id, `delivery-retry:${actionId}`);
    const alreadyApplied = controlApplied || retryApplied || input.type === "start" && session || input.type === "end" && session?.status === "ended";
    if (!alreadyApplied) {
      const current = store.current(scope.campaign) || (input.type === "retry-delivery" ? store.latest(scope.campaign) : null);
      if (input.type === "start" ? Boolean(current) : !session || current?.id !== session.id) throw fail2("STALE_SESSION", "The active session changed. Refresh the chronicle.");
      if ((session ? store.revision(session.id) : 0) !== input.expectedRevision) throw fail2("STALE_REVISION", "The session changed before this command ran. Refresh and try again.");
      if (session && !["active", "paused"].includes(session.status) && !["end", "retry-delivery"].includes(input.type)) throw fail2("STALE_SESSION", "This session is closing or ended.");
    }
    if (closing) throw fail2("COMMAND_CANCELLED", "The host is stopping. Refresh after restart.");
    queue.renew(claim);
    if (!alreadyApplied) switch (input.type) {
      case "start":
        session = store.start({
          campaign: scope.campaign,
          title: input.title,
          mode: input.mode,
          minutes: input.minutes,
          host: scope.owner,
          channel: config.journalChannelId,
          sourceChannel: config.channelId,
          requestId: actionId
        });
        break;
      case "pause":
        store.control(session.id, "pause", actionId);
        await voice.stop();
        break;
      case "resume":
        store.control(session.id, "resume", actionId);
        break;
      case "voice":
        await voice.start(session.id, scope.owner, { authorize: async () => {
          if (closing || !await authorize(scope)) return false;
          try {
            queue.renew(claim);
            return true;
          } catch {
            return false;
          }
        } });
        break;
      case "leave":
        await voice.stop();
        break;
      case "summary":
        await service.summarize(session.id, { force: true });
        break;
      case "retry-delivery":
        store.retryDeliveries(session.id, actionId);
        break;
      case "end":
        await voice.stop({ flush: true });
        await service.end(session.id);
        break;
      default:
        throw fail2("INVALID_COMMAND", "Unknown session control.");
    }
    const result = { sessionId: session.id, type: input.type, status: store.get(session.id).status };
    return store.transaction(() => {
      queue.renew(claim);
      store.append(session.id, source, "command-receipt", { result }, false);
      return result;
    });
  }
  return {
    queue,
    tick() {
      if (closing) return Promise.resolve();
      if (running) return running;
      const claim = queue.claim(worker, { campaign: config.campaignId });
      if (!claim) return Promise.resolve();
      const timer = setInterval(() => {
        try {
          queue.renew(claim);
        } catch {
        }
      }, renewEveryMs);
      timer.unref?.();
      running = (async () => {
        try {
          queue.complete(claim, { result: await execute(claim) });
        } catch (error) {
          try {
            queue.complete(claim, { error });
          } catch {
            log({ outcome: "chronicle_command_lease_lost" });
          }
        } finally {
          clearInterval(timer);
        }
      })().finally(() => {
        running = null;
      });
      return running;
    },
    async close() {
      closing = true;
      await running;
    }
  };
}

// discord/chronicle-core.mjs
function createChronicleRuntimeCore({
  client,
  config,
  images,
  transport,
  log = () => {
  },
  authorizeCommand = () => false,
  provider,
  makeVoice,
  store
}) {
  if (!provider || typeof provider.write !== "function" || typeof makeVoice !== "function" || !store?.db || typeof store.close !== "function") {
    throw new TypeError("Supply the Obus story provider, shared voice factory and chronicle store explicitly.");
  }
  const service = new ChronicleService({ store, provider, images, dataDir: config.chronicleDir });
  const voice = makeVoice({ client, config, store, service });
  if (!voice || typeof voice.start !== "function" || typeof voice.stop !== "function") throw new TypeError("Supply a voice adapter with start and stop operations.");
  const adapter = createChronicleAdapter({ store, service, config, transport, voice, log });
  service.recover();
  const dispatcher = createChronicleDispatcher({ store, service, voice, config, transport, authorize: authorizeCommand, log });
  let closing = false, running = null, closingWork = null, storeClosed = false;
  return {
    store,
    service,
    voice,
    handle: (interaction, options) => closing ? false : adapter.handle(interaction, options),
    async packet(packet) {
      if (closing) return;
      if (packet.t === "MESSAGE_CREATE") await adapter.message(packet.d);
      if (["MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK"].includes(packet.t)) {
        const data = packet.d;
        if (data.guild_id !== config.guildId || data.channel_id !== config.channelId) return;
        const session = store.current(config.campaignId);
        if (!session) return;
        if (packet.t === "MESSAGE_UPDATE" && typeof data.content !== "string") return;
        const deleted = packet.t !== "MESSAGE_UPDATE";
        for (const id of packet.t === "MESSAGE_DELETE_BULK" ? data.ids || [] : [data.id]) {
          if (!id) continue;
          store.reviseMessage(session.id, id, {
            text: data.content,
            deleted,
            requestId: `${id}:${deleted ? "deleted" : data.edited_timestamp || createHash4("sha256").update(data.content).digest("hex")}`
          });
        }
      }
    },
    async gap() {
      if (closing) return;
      const session = store.current(config.campaignId);
      if (!session || session.status !== "active") return;
      store.control(session.id, "pause", `gateway-gap:${randomUUID5()}`);
      await voice.stop();
      service.gap(session.id, "Discord disconnected. Capture is paused; messages and speech during the gap were not captured. Use /session resume and /session voice after reconnecting.");
    },
    tick() {
      if (closing) return Promise.resolve();
      const commands = dispatcher.tick();
      if (!running) running = (async () => {
        await service.tick();
        await adapter.flush();
      })().catch(() => log({ outcome: "chronicle_work_deferred" })).finally(() => {
        running = null;
      });
      return Promise.allSettled([commands, running]);
    },
    close() {
      if (closingWork) return closingWork;
      closing = true;
      closingWork = (async () => {
        const failures = [];
        const attempt = async (stage, work) => {
          try {
            await work();
            return true;
          } catch {
            failures.push(new Error(`Chronicle shutdown stage failed: ${stage}.`));
            try {
              log({ outcome: "chronicle_shutdown_deferred", stage });
            } catch {
            }
            return false;
          }
        };
        const stopped = await attempt("capture", () => voice.stop({ flush: true }));
        if (!stopped) await attempt("pause", () => service.recover());
        await attempt("commands", () => dispatcher.close());
        await attempt("interactions", () => adapter.close());
        const detached = await attempt("capture-final", () => voice.stop({ flush: true }));
        await attempt("background", () => running);
        await attempt("speech", () => service.close());
        await attempt("pause-final", () => service.recover());
        await attempt("deliveries", () => adapter.flush());
        if (detached) await attempt("storage", () => {
          store.close();
          storeClosed = true;
        });
        if (failures.length) throw new AggregateError(failures, "Chronicle shutdown did not finish cleanly.");
      })().catch((error) => {
        if (!storeClosed) closingWork = null;
        throw error;
      });
      return closingWork;
    }
  };
}
export {
  ChronicleCommandError,
  ChronicleCommands,
  ChronicleError,
  ChronicleStore,
  SESSION_COMMAND,
  createChronicleRuntimeCore as createChronicleRuntime,
  createChronicleRuntimeCore
};
