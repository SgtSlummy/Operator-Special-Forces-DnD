import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { board } from './adventure-adapter.mjs';

/** Durable, private, expiring response edits. No channel posts or game commands. */
export class BoardDelivery {
  constructor({ game, transport, authorize, secret, now = Date.now, render = board }) {
    if (typeof secret !== 'string' || secret.length < 20) throw new Error('Private map delivery requires a host secret.');
    this.game = game; this.transport = transport; this.authorize = authorize; this.now = now; this.render = render;
    this.key = createHash('sha256').update('raph-private-map-v1\0').update(secret).digest();
    this.running = null;
    game.db.exec(`CREATE TABLE IF NOT EXISTS game_board_delivery(
      id TEXT PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL, context TEXT NOT NULL,
      credential TEXT NOT NULL, expires INTEGER NOT NULL, revision INTEGER NOT NULL,
      lease INTEGER NOT NULL DEFAULT 0, claim TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, UNIQUE(campaign,owner));`);
  }
  seal(value, aad) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify([iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')]);
  }
  open(row) {
    const [iv, tag, encrypted] = JSON.parse(row.credential);
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'hex'));
    cipher.setAAD(Buffer.from(this.aad(row))); cipher.setAuthTag(Buffer.from(tag, 'hex'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted, 'hex')), cipher.final()]).toString('utf8'));
  }
  aad(row) { return JSON.stringify([row.id, row.campaign, row.owner, row.context, row.expires]); }
  watch(scope, context, interaction, revision) {
    this.game.member(scope);
    if (typeof interaction.token !== 'string' || !interaction.token || typeof interaction.application_id !== 'string' || !Number.isSafeInteger(revision)) throw new Error('Invalid private map response.');
    const issued = /^[0-9]{17,20}$/.test(interaction.id ?? '') ? Number(BigInt(interaction.id) >> 22n) + 1420070400000 : this.now();
    const row = { id: randomBytes(12).toString('hex'), ...scope, context: JSON.stringify(context), expires: Math.min(issued, this.now()) + 14 * 60000 };
    const credential = this.seal({ applicationId: interaction.application_id, token: interaction.token }, this.aad(row));
    this.game.db.prepare(`INSERT INTO game_board_delivery(id,campaign,owner,context,credential,expires,revision) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(campaign,owner) DO UPDATE SET id=excluded.id,context=excluded.context,credential=excluded.credential,
      expires=excluded.expires,revision=excluded.revision,lease=0,claim=NULL,attempts=0,next_attempt=0`).run(row.id, scope.campaign, scope.owner, row.context, credential, row.expires, revision);
  }
  tick() {
    if (this.running) return this.running;
    this.running = this.deliver().finally(() => { this.running = null; });
    return this.running;
  }
  async deliver() {
    const db = this.game.db;
    db.prepare('DELETE FROM game_board_delivery WHERE expires<=?').run(this.now());
    db.prepare('DELETE FROM game_controls WHERE expires<=?').run(this.now());
    const rows = db.prepare(`SELECT d.* FROM game_board_delivery d JOIN game_campaigns c ON c.id=d.campaign
      WHERE d.revision<c.revision AND d.lease<=? AND d.next_attempt<=? ORDER BY d.next_attempt,d.id LIMIT 8`).all(this.now(), this.now());
    for (const row of rows) {
      const claim = randomBytes(12).toString('hex');
      if (!db.prepare('UPDATE game_board_delivery SET lease=?,claim=? WHERE id=? AND lease<=?').run(this.now() + 120000, claim, row.id, this.now()).changes) continue;
      try {
        const scope = { campaign: row.campaign, owner: row.owner }, context = JSON.parse(row.context);
        this.game.member(scope);
        if (!await this.authorize(scope, context)) { db.prepare('DELETE FROM game_board_delivery WHERE id=? AND claim=?').run(row.id, claim); continue; }
        this.game.member(scope);
        const credential = this.open(row), view = this.game.view(scope);
        const payload = this.render(this.game, scope, context, 'Map updated automatically. Refresh map renews private updates.', view);
        // A replaced/expired watch cannot publish or acknowledge a newer card.
        const live = db.prepare('SELECT id FROM game_board_delivery WHERE id=? AND claim=? AND expires>?').get(row.id, claim, this.now());
        if (!live) continue;
        await this.transport.edit(credential.applicationId, credential.token, { ...payload, flags: 32768 });
        const saved = db.prepare('UPDATE game_board_delivery SET revision=?,lease=0,claim=NULL,attempts=0,next_attempt=0 WHERE id=? AND claim=?').run(view.revision, row.id, claim);
        if (!saved.changes) db.prepare('UPDATE game_board_delivery SET revision=MIN(revision,?),next_attempt=0 WHERE id=?').run(row.revision, row.id);
      } catch (error) {
        if (error?.code === 'UNAUTHORIZED' || [10015, 10062, 50027].includes(error?.code) || [401, 403, 404].includes(error?.status)) {
          db.prepare('DELETE FROM game_board_delivery WHERE id=? AND claim=?').run(row.id, claim);
        } else {
          // An ambiguous delivery may already have reached Discord. Retrying an
          // edit to the same private response is safe and never repeats gameplay.
          db.prepare('UPDATE game_board_delivery SET lease=0,claim=NULL,attempts=attempts+1,next_attempt=? WHERE id=? AND claim=?').run(this.now() + Math.min(30000, 2000 * 2 ** Math.min(row.attempts, 4)), row.id, claim);
        }
      }
    }
  }
}
