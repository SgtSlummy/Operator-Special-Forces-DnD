import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ChronicleError extends Error {}
export function bounded(value, max = 6000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ChronicleError(`Enter text between 1 and ${max} characters.`);
  return value.trim();
}
export function interval(value) {
  if (!Number.isInteger(value) || value < 1 || value > 180) throw new ChronicleError('Choose a summary interval from 1 to 180 minutes.');
  return value;
}
export class ChronicleStore {
  constructor(path, { now = Date.now } = {}) {
    mkdirSync(dirname(path), { recursive: true }); this.now = now;
    const existing = path !== ':memory:' && existsSync(path);
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000');
    if (existing && !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_uncertain'").get()) {
      try { this.db.prepare('VACUUM INTO ?').run(`${path}.before-chronicle-v4-${Date.now()}-${randomUUID()}.sqlite`); }
      catch (error) { this.db.close(); throw error; }
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
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  save(session) { this.db.prepare('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(session.id, session.campaign, JSON.stringify(session)); return session; }
  get(id) { const row = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id); if (!row) throw new ChronicleError('Session not found.'); return JSON.parse(row.body); }
  all() { return this.db.prepare('SELECT body FROM sessions ORDER BY rowid').all().map(row => JSON.parse(row.body)); }
  current(campaign) { return this.all().reverse().find(s => s.campaign === campaign && s.status !== 'ended') ?? null; }
  latest(campaign) { return this.all().reverse().find(s => s.campaign === campaign) ?? null; }
  start({ campaign, title, mode, minutes = 10, host, channel, sourceChannel, autoImages = false, requestId }) {
    bounded(campaign, 64); bounded(host, 96); bounded(channel, 96); bounded(sourceChannel, 96); bounded(requestId, 96);
    if (!['human', 'arcade'].includes(mode)) throw new ChronicleError('Choose human or arcade mode.');
    title = bounded(title, 100); interval(minutes);
    return this.transaction(() => {
      const previous = this.all().find(s => s.campaign === campaign && s.requestId === requestId);
      if (previous) return previous;
      if (this.current(campaign)) throw new ChronicleError('End the current session before starting another.');
      const session = this.save({ id: randomUUID(), campaign, title, mode, minutes, host, channel, sourceChannel,
        autoImages: Boolean(autoImages), requestId, status: 'active', started: this.now(), nextDue: this.now() + minutes * 60000,
        watermark: 0, scene: null, ended: null, recap: null });
      this.append(session.id, `start:${requestId}`, 'session', { text: `${title} · ${mode} DM · summaries every ${minutes} minutes. Capture is opt-in: /session consent enabled:true. Speech is processed locally through Obus; text and summaries are saved in this channel. /session pause stops capture.`, at: this.now() });
      return session;
    });
  }
  consent(id, user, enabled) {
    const work = () => {
      const previous = this.privacy(id, user);
      this.db.prepare('INSERT INTO consent VALUES(?,?,?) ON CONFLICT(session,user) DO UPDATE SET enabled=excluded.enabled').run(id, user, enabled ? 1 : 0);
      this.db.prepare('INSERT INTO chronicle_privacy VALUES(?,?,?,?,?) ON CONFLICT(session,user) DO UPDATE SET capture_epoch=excluded.capture_epoch').run(id, user, previous.external ? 1 : 0, previous.captureEpoch + (previous.capture !== Boolean(enabled) ? 1 : 0), previous.externalEpoch);
    };
    return this.db.isTransaction ? work() : this.transaction(work);
  }
  privacy(id, user) {
    const value = this.db.prepare('SELECT * FROM chronicle_privacy WHERE session=? AND user=?').get(id, user);
    return { capture: this.hasConsent(id, user), external: value?.external === 1, captureEpoch: value?.capture_epoch ?? 0, externalEpoch: value?.external_epoch ?? 0 };
  }
  externalConsent(id, user, enabled) {
    const work = () => {
      const previous = this.privacy(id, user);
      this.db.prepare('INSERT INTO chronicle_privacy VALUES(?,?,?,?,?) ON CONFLICT(session,user) DO UPDATE SET external=excluded.external,external_epoch=excluded.external_epoch').run(id, user, enabled ? 1 : 0, previous.captureEpoch, previous.externalEpoch + (previous.external !== Boolean(enabled) ? 1 : 0));
    };
    return this.db.isTransaction ? work() : this.transaction(work);
  }
  revision(id) { return this.db.prepare('SELECT MAX(seq) AS revision FROM entries WHERE session=?').get(id)?.revision ?? 0; }
  hasConsent(id, user) { return this.db.prepare('SELECT enabled FROM consent WHERE session=? AND user=?').get(id, user)?.enabled === 1; }
  find(id, source) { const row = this.db.prepare('SELECT * FROM entries WHERE session=? AND source=?').get(id, source); return row ? this.decode(row) : null; }
  decode(row) { return { ...JSON.parse(row.body), seq: row.seq, source: row.source, kind: row.kind }; }
  entries(id, after = 0) { return this.db.prepare('SELECT * FROM entries WHERE session=? AND seq>? ORDER BY seq').all(id, after).map(row => this.decode(row)); }
  append(id, source, kind, body, publish = true) {
    const existing = this.find(id, source); if (existing) return existing;
    const entry = { ...body, at: body.at ?? this.now() };
    const result = this.db.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run(id, source, kind, JSON.stringify(entry));
    const saved = { ...entry, seq: Number(result.lastInsertRowid), source, kind };
    if (publish) this.enqueue(id, `event:${saved.seq}`, { type: 'entry', entry: saved });
    return saved;
  }
  record(id, source, { user, speaker, text, medium = 'text', at, scene, captureEpoch }, { finishing = false } = {}) {
    return this.transaction(() => {
      const s = this.get(id);
      if (!(s.status === 'active' || (finishing && s.status === 'ending')) || !this.hasConsent(id, user)) return null;
      const privacy = this.privacy(id, user);
      if (captureEpoch !== undefined && captureEpoch !== privacy.captureEpoch) return null;
      return this.append(id, source, 'transcript', { user, speaker: bounded(speaker, 100), text: bounded(text), medium, at: at ?? this.now(), scene: scene ?? s.scene?.seq ?? null, unverified: medium !== 'text', exportableAtCapture: privacy.external, externalEpoch: privacy.externalEpoch });
    });
  }
  control(id, action, requestId, value) {
    return this.transaction(() => {
      const s = this.get(id); if (this.find(id, `control:${requestId}`)) return s;
      if (['ended', 'ending'].includes(s.status)) throw new ChronicleError('The session is closing or ended. Use /session end to finish its recap.');
      if (action === 'pause') s.status = 'paused';
      else if (action === 'resume') { s.status = 'active'; s.nextDue = this.now() + s.minutes * 60000; }
      else if (action === 'minutes') { s.minutes = interval(value); s.nextDue = this.now() + s.minutes * 60000; }
      else throw new ChronicleError('Unknown session control.');
      this.save(s); this.append(id, `control:${requestId}`, 'session', { text: action === 'minutes' ? `Summary interval changed to ${s.minutes} minutes.` : `Session ${s.status}.` }); return s;
    });
  }
  correct(id, seq, text, user, isHost, requestId) {
    return this.transaction(() => {
      if (['ended', 'ending'].includes(this.get(id).status)) throw new ChronicleError('Correct the record before ending the session.');
      const entries = this.entries(id), entry = entries.find(e => e.seq === seq);
      const deleted = entries.filter(e => e.kind === 'correction' && e.target === seq).at(-1)?.deleted;
      if (!entry || deleted || !['transcript', 'note', 'scene'].includes(entry.kind) || (!isHost && (entry.kind !== 'transcript' || entry.user !== user))) throw new ChronicleError('You can correct your own transcript; the DM can correct public story records.');
      const result = this.append(id, `correction:${requestId}`, 'correction', { target: seq, text: bounded(text), user });
      // Rebuild subsequent summaries from corrected evidence rather than continuing stale prose.
      const s = this.get(id); s.watermark = 0; s.nextDue = this.now(); this.save(s); return result;
    });
  }
  reviseMessage(id, messageId, { text, deleted = false, requestId }) {
    return this.transaction(() => {
      const session = this.get(id), entry = this.find(id, `discord:${messageId}`);
      if (!entry || !['active', 'paused'].includes(session.status)) return null;
      const omitted = deleted || !this.hasConsent(id, entry.user);
      const result = this.append(id, `message-revision:${requestId}`, 'correction', {
        target: entry.seq, user: entry.user, deleted: omitted,
        text: omitted ? 'Discord message removed from active story evidence.' : bounded(text),
      });
      session.watermark = 0; session.nextDue = this.now(); this.save(session);
      return result;
    });
  }
  sharedEntries(id) {
    const entries = this.entries(id), corrections = new Map();
    for (const entry of entries) if (entry.kind === 'correction') corrections.set(entry.target, entry);
    return entries.map(entry => {
      const correction = corrections.get(entry.kind === 'correction' ? entry.target : entry.seq);
      if (correction?.deleted) return { ...entry, text: 'Discord message removed from active story evidence.', deleted: true, corrected: true };
      if (entry.kind === 'summary' && [...corrections.values()].some(value => value.seq > (entry.correctionVersion ?? 0) && (!Number.isInteger(entry.from) || value.target >= entry.from && value.target <= entry.through))) {
        return { ...entry, text: 'This summary is awaiting regeneration after a source correction.', invalidated: true };
      }
      return correction && entry.kind !== 'correction' ? { ...entry, text: correction.text, corrected: true } : entry;
    });
  }
  evidence(id, after = 0) {
    const entries = this.entries(id), corrections = new Map();
    for (const e of entries) if (e.kind === 'correction') corrections.set(e.target, e);
    return entries.filter(e => e.seq > after && ['transcript', 'scene', 'note'].includes(e.kind) && !corrections.get(e.seq)?.deleted).map(e => ({ ...e, text: corrections.get(e.seq)?.text ?? e.text, corrected: corrections.has(e.seq) }));
  }
  enqueue(session, id, body) { this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES(?,?,?,NULL)').run(id, session, JSON.stringify(body)); }
  pending() { return this.db.prepare('SELECT * FROM deliveries WHERE sent IS NULL ORDER BY rowid').all().map(row => ({ ...row, body: JSON.parse(row.body) })); }
  readyDeliveries() {
    return this.db.prepare('SELECT d.* FROM deliveries d LEFT JOIN delivery_attempts a ON a.id=d.id WHERE d.sent IS NULL AND d.id NOT IN (SELECT id FROM delivery_uncertain) AND COALESCE(a.attempts,0)<5 AND COALESCE(a.next_at,0)<=? ORDER BY d.rowid').all(this.now()).map(row => ({ ...row, body: JSON.parse(row.body) }));
  }
  deliverySending(id) { this.db.prepare('INSERT OR IGNORE INTO delivery_uncertain SELECT id FROM deliveries WHERE id=? AND sent IS NULL').run(id); }
  clearDeliveryUncertain(id) { this.db.prepare('DELETE FROM delivery_uncertain WHERE id=?').run(id); }
  deferDelivery(id, { uncertain = false } = {}) {
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM deliveries WHERE id=? AND sent IS NULL').get(id)) return;
      if (uncertain) this.db.prepare('INSERT OR IGNORE INTO delivery_uncertain VALUES(?)').run(id);
      else this.clearDeliveryUncertain(id);
      const previous = this.db.prepare('SELECT attempts FROM delivery_attempts WHERE id=?').get(id);
      const attempts = Math.min(5, (previous?.attempts ?? 0) + 1), nextAt = this.now() + Math.min(900000, 60000 * 2 ** (attempts - 1));
      this.db.prepare('INSERT INTO delivery_attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts,next_at=excluded.next_at').run(id, attempts, nextAt);
      return { attempts, nextAt, failed: attempts >= 5 };
    });
  }
  deliveryState(id) {
    const rows = this.db.prepare('SELECT d.id IN (SELECT id FROM delivery_uncertain) AS uncertain,COALESCE(a.attempts,0) AS attempts,COALESCE(a.next_at,0) AS next_at FROM deliveries d LEFT JOIN delivery_attempts a ON a.id=d.id WHERE d.session=? AND d.sent IS NULL').all(id);
    const retrying = rows.filter(row => !row.uncertain && row.attempts > 0 && row.attempts < 5);
    return { pending: rows.length, uncertain: rows.filter(row => row.uncertain).length, failed: rows.filter(row => !row.uncertain && row.attempts >= 5).length, retrying: retrying.length, nextAttemptAt: retrying.length ? Math.min(...retrying.map(row => row.next_at)) : null };
  }
  retryDeliveries(id, requestId) {
    bounded(requestId, 96);
    return this.transaction(() => {
      const previous = this.find(id, `delivery-retry:${requestId}`); if (previous) return previous.count;
      const result = this.db.prepare('UPDATE delivery_attempts SET attempts=0,next_at=0 WHERE id NOT IN (SELECT id FROM delivery_uncertain) AND id IN (SELECT id FROM deliveries WHERE session=? AND sent IS NULL)').run(id);
      const count = Number(result.changes);
      this.append(id, `delivery-retry:${requestId}`, 'delivery-retry', { count, text: `Delivery retry requested for ${count} saved entries.` }, false);
      return count;
    });
  }
  delivered(id, receipt) { this.db.prepare('UPDATE deliveries SET sent=? WHERE id=?').run(String(receipt), id); }
  close() { this.db.close(); }
}
