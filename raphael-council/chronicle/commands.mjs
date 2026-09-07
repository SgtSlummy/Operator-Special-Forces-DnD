import { createHash, randomUUID } from 'node:crypto';

const MAX_ATTEMPTS = 3;
const CAMPAIGN_CAPACITY = 100;
const OWNER_CAPACITY = 20;
const MAX_JSON_BYTES = 32768;
const ERROR_MESSAGES = Object.freeze({
  FORBIDDEN: 'Access is no longer authorized.',
  NOT_FOUND: 'The requested session is unavailable.',
  STALE_REVISION: 'The session changed before the command could run.',
  INVALID_COMMAND: 'The command is no longer valid.',
  CAPTURE_UNAVAILABLE: 'Voice capture is currently unavailable.',
  PROVIDER_UNAVAILABLE: 'The required service is currently unavailable.',
  WORKER_EXHAUSTED: 'The command could not finish after three worker attempts.',
  COMMAND_FAILED: 'The command could not be completed.',
});

export class ChronicleCommandError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function fail(status, code, message) { throw new ChronicleCommandError(status, code, message); }
function identifier(value, name, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    fail(400, 'INVALID_COMMAND', `Invalid ${name}.`);
  }
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 8) fail(400, 'INVALID_COMMAND', 'Command data is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key], depth + 1);
    return out;
  }
  fail(400, 'INVALID_COMMAND', 'Command data must contain only JSON values.');
}
function json(value) {
  const encoded = JSON.stringify(canonical(value));
  if (Buffer.byteLength(encoded) > MAX_JSON_BYTES) fail(400, 'INVALID_COMMAND', 'Command data is too large.');
  return encoded;
}
function validateScope(scope) {
  if (!scope || typeof scope !== 'object') fail(400, 'INVALID_COMMAND', 'A trusted scope is required.');
  identifier(scope.campaign, 'campaign', 128); identifier(scope.owner, 'owner', 128);
  if (!['host', 'player'].includes(scope.role)) fail(400, 'INVALID_COMMAND', 'Invalid role.');
}
function commandData(scope, input) {
  validateScope(scope);
  if (!input || typeof input !== 'object') fail(400, 'INVALID_COMMAND', 'A command is required.');
  identifier(input.requestId, 'request ID'); identifier(input.type, 'command type', 64);
  if (!(input.type === 'start' && input.sessionId === null)) identifier(input.sessionId, 'session ID', 128);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, 'INVALID_COMMAND', 'A valid expected revision is required.');
  return { scopeJson: json(scope), inputJson: json(input),
    fingerprint: createHash('sha256').update(json({ scope, input })).digest('hex') };
}
function sanitizedError(error) {
  const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'COMMAND_FAILED';
  return { code, message: ERROR_MESSAGES[code], status: Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500 };
}
function receipt(row) {
  return { id: row.id, requestId: row.request_id, sessionId: row.session_id || null, type: row.type,
    status: row.status, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at,
    result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error_json ? JSON.parse(row.error_json) : null };
}
function leased(row) {
  return { ...receipt(row), leaseToken: row.lease_token, leaseUntil: row.lease_until,
    worker: row.worker, scope: JSON.parse(row.scope_json), input: JSON.parse(row.input_json) };
}

/** Durable execution is at least once: dispatchers must also use requestId for side-effect receipts. */
export class ChronicleCommands {
  constructor(store, { now = Date.now, leaseMs = 30000 } = {}) {
    if (!store?.db?.prepare || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300000) {
      fail(400, 'INVALID_COMMAND', 'A store and a bounded lease duration are required.');
    }
    this.db = store.db; this.now = now; this.leaseMs = leaseMs;
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
    // An HTTP mutation may already hold the same database lock for its revision check.
    if (this.db.isTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid queue clock.');
    return value;
  }
  expire(campaign, at) {
    this.db.prepare(`UPDATE chronicle_commands SET status='failed', updated_at=?, error_json=?,
      worker=NULL, lease_token=NULL, lease_until=NULL WHERE campaign=? AND status='running'
      AND lease_until<=? AND attempts>=?`).run(at, JSON.stringify(sanitizedError({ code: 'WORKER_EXHAUSTED' })), campaign, at, MAX_ATTEMPTS);
  }
  replay(scope, input) {
    const { fingerprint } = commandData(scope, input);
    const existing = this.db.prepare('SELECT * FROM chronicle_commands WHERE campaign=? AND request_id=?').get(scope.campaign, input.requestId);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) fail(409, 'REQUEST_CONFLICT', 'This request ID was already used for another command.');
    return receipt(existing);
  }
  enqueue(scope, input) {
    const { scopeJson, inputJson, fingerprint } = commandData(scope, input);
    return this.transaction(() => {
      const existing = this.replay(scope, input);
      if (existing) return existing;
      const at = this.time(); this.expire(scope.campaign, at);
      const counts = this.db.prepare(`SELECT COUNT(*) AS campaign_count,
        COALESCE(SUM(CASE WHEN owner=? THEN 1 ELSE 0 END),0) AS owner_count
        FROM chronicle_commands WHERE campaign=? AND status IN ('queued','running')`).get(scope.owner, scope.campaign);
      if (counts.campaign_count >= CAMPAIGN_CAPACITY || counts.owner_count >= OWNER_CAPACITY) fail(429, 'QUEUE_FULL', 'The session command queue is full. Try again after pending commands finish.');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO chronicle_commands
        (id,campaign,owner,request_id,session_id,type,fingerprint,scope_json,input_json,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(id, scope.campaign, scope.owner, input.requestId, input.sessionId ?? '', input.type, fingerprint, scopeJson, inputJson, at, at);
      return receipt(this.db.prepare('SELECT * FROM chronicle_commands WHERE id=?').get(id));
    });
  }
  list(scope) {
    validateScope(scope);
    return this.db.prepare(`SELECT * FROM chronicle_commands WHERE campaign=? AND owner=?
      ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(scope.campaign, scope.owner).map(receipt);
  }
  claim(worker, { campaign } = {}) {
    identifier(worker, 'worker', 128); identifier(campaign, 'campaign', 128);
    return this.transaction(() => {
      const at = this.time(); this.expire(campaign, at);
      const row = this.db.prepare(`SELECT * FROM chronicle_commands WHERE campaign=? AND attempts<?
        AND (status='queued' OR (status='running' AND lease_until<=?)) ORDER BY created_at,rowid LIMIT 1`).get(campaign, MAX_ATTEMPTS, at);
      if (!row) return null;
      this.db.prepare(`UPDATE chronicle_commands SET status='running', attempts=attempts+1,
        worker=?,lease_token=?,lease_until=?,updated_at=? WHERE id=?`).run(worker, randomUUID(), at + this.leaseMs, at, row.id);
      return leased(this.db.prepare('SELECT * FROM chronicle_commands WHERE id=?').get(row.id));
    });
  }
  renew(claim) {
    identifier(claim?.id, 'command ID'); identifier(claim?.leaseToken, 'lease token');
    return this.transaction(() => {
      const at = this.time();
      const update = this.db.prepare(`UPDATE chronicle_commands SET lease_until=?,updated_at=?
        WHERE id=? AND status='running' AND lease_token=? AND lease_until>?`).run(at + this.leaseMs, at, claim.id, claim.leaseToken, at);
      if (!update.changes) fail(409, 'STALE_LEASE', 'This worker no longer owns the command lease.');
      return leased(this.db.prepare('SELECT * FROM chronicle_commands WHERE id=?').get(claim.id));
    });
  }
  complete(claim, { result = null, error = null } = {}) {
    identifier(claim?.id, 'command ID'); identifier(claim?.leaseToken, 'lease token');
    const resultJson = error ? null : json(result), errorJson = error ? JSON.stringify(sanitizedError(error)) : null;
    return this.transaction(() => {
      const at = this.time();
      const update = this.db.prepare(`UPDATE chronicle_commands SET status=?,result_json=?,error_json=?,updated_at=?,
        worker=NULL,lease_token=NULL,lease_until=NULL
        WHERE id=? AND status='running' AND lease_token=? AND lease_until>?`).run(error ? 'failed' : 'done', resultJson, errorJson, at, claim.id, claim.leaseToken, at);
      if (!update.changes) fail(409, 'STALE_LEASE', 'This worker no longer owns the command lease.');
      return receipt(this.db.prepare('SELECT * FROM chronicle_commands WHERE id=?').get(claim.id));
    });
  }
}
