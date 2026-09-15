import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ChronicleStore } from './store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-migration-'));
  const path = join(directory, 'chronicle.sqlite'), handles = new Set();
  t.after(() => {
    for (const handle of handles) { try { handle.close(); } catch { /* Explicitly closed by the fixture. */ } }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  return { path, directory, handles,
    open(file = path, options = {}) { const db = new DatabaseSync(file, options); handles.add(db); return db; },
    store() { const store = new ChronicleStore(path); handles.add(store.db); return store; },
    backups() { return readdirSync(directory).filter(name => name.startsWith(`${basename(path)}.before-chronicle-`)).sort().map(name => join(directory, name)); },
  };
}
function legacy(f, { older = false, liveWal = false } = {}) {
  const db = f.open();
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE sessions(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(session,source));
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,session TEXT NOT NULL,body TEXT NOT NULL,sent TEXT);
    CREATE TABLE delivery_attempts(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,next_at INTEGER NOT NULL);
    ${older ? '' : 'CREATE TABLE delivery_uncertain(id TEXT PRIMARY KEY);'}
    CREATE TABLE consent(session TEXT,user TEXT,enabled INTEGER NOT NULL,PRIMARY KEY(session,user));
    CREATE TABLE chronicle_privacy(session TEXT,user TEXT,external INTEGER NOT NULL DEFAULT 0,capture_epoch INTEGER NOT NULL DEFAULT 0,external_epoch INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session,user));
    CREATE TABLE chronicle_mutations(campaign TEXT,user TEXT,request TEXT,fingerprint TEXT,result TEXT,PRIMARY KEY(campaign,user,request));`);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('legacy-session', 'synthetic-migration', JSON.stringify({ id: 'legacy-session', campaign: 'synthetic-migration', status: 'active', title: 'Before migration' }));
  db.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run('legacy-session', 'before', 'note', JSON.stringify({ text: 'Before the WAL commit.', at: 1 }));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  if (!liveWal) db.close();
  return db;
}
function hasTable(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function texts(db) { return db.prepare('SELECT body FROM entries ORDER BY seq').all().map(row => JSON.parse(row.body).text); }

test('an existing v4 database is backed up before adding projection state and reopening does not repeat backup', t => {
  const f = fixture(t); legacy(f);
  const store = f.store();
  const backups = f.backups();
  assert.equal(backups.length, 1);
  assert.match(basename(backups[0]), /\.before-chronicle-v5-\d+-[0-9a-f-]{36}\.sqlite$/);
  const backup = f.open(backups[0], { readOnly: true });
  assert.equal(hasTable(backup, 'delivery_uncertain'), true);
  assert.equal(hasTable(backup, 'chronicle_projection'), false);
  assert.deepEqual(texts(backup), ['Before the WAL commit.']);
  assert.equal(hasTable(store.db, 'chronicle_projection'), true);
  assert.ok(store.evidenceProjection('legacy-session').revision > 0);
  backup.close(); store.close();
  f.store().close();
  assert.deepEqual(f.backups(), backups);
});

test('a pre-v4 database takes one backup before either delivery or evidence DDL is applied', t => {
  const f = fixture(t); legacy(f, { older: true });
  const store = f.store(), backups = f.backups();
  assert.equal(backups.length, 1);
  assert.match(basename(backups[0]), /\.before-chronicle-v4-/);
  const backup = f.open(backups[0], { readOnly: true });
  assert.equal(hasTable(backup, 'delivery_uncertain'), false);
  assert.equal(hasTable(backup, 'chronicle_projection'), false);
  assert.equal(hasTable(store.db, 'delivery_uncertain'), true);
  assert.equal(hasTable(store.db, 'chronicle_projection'), true);
  assert.deepEqual(texts(store.db), texts(backup));
});

test('VACUUM backup includes committed rows still present only in an open WAL', t => {
  const f = fixture(t), writer = legacy(f, { liveWal: true });
  writer.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run('legacy-session', 'wal-only', 'note', JSON.stringify({ text: 'Committed only in the live WAL.', at: 2 }));
  assert.ok(statSync(`${f.path}-wal`).size > 0);
  const mainOnlyPath = join(f.directory, 'main-only.sqlite');
  copyFileSync(f.path, mainOnlyPath);
  const mainOnly = f.open(mainOnlyPath, { readOnly: true });
  assert.deepEqual(texts(mainOnly), ['Before the WAL commit.']);
  mainOnly.close();
  const store = f.store(), backups = f.backups();
  assert.equal(backups.length, 1);
  const backup = f.open(backups[0], { readOnly: true });
  assert.deepEqual(texts(backup), ['Before the WAL commit.', 'Committed only in the live WAL.']);
  assert.equal(hasTable(backup, 'chronicle_projection'), false);
  assert.deepEqual(texts(store.db), texts(backup));
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('brand-new, zero-byte and schema-empty databases do not create unnecessary backups', t => {
  const fresh = fixture(t); fresh.store().close(); assert.deepEqual(fresh.backups(), []);
  const emptyFile = fixture(t); writeFileSync(emptyFile.path, ''); emptyFile.store().close(); assert.deepEqual(emptyFile.backups(), []);
  const emptySqlite = fixture(t); emptySqlite.open().close(); emptySqlite.store().close(); assert.deepEqual(emptySqlite.backups(), []);
});

test('any missing schema table triggers a unique backup without overwriting an earlier snapshot', t => {
  const f = fixture(t); legacy(f);
  t.mock.method(Date, 'now', () => 1700000000000);
  const first = f.store(), firstPath = f.backups()[0];
  first.db.prepare('INSERT INTO entries(session,source,kind,body) VALUES(?,?,?,?)').run('legacy-session', 'later', 'note', JSON.stringify({ text: 'Written after the first migration.', at: 2 }));
  first.db.exec('DROP TABLE chronicle_privacy');
  first.close();
  const second = f.store(), backups = f.backups();
  assert.equal(backups.length, 2);
  assert.equal(new Set(backups).size, 2);
  const oldBackup = f.open(firstPath, { readOnly: true });
  const nextBackup = f.open(backups.find(path => path !== firstPath), { readOnly: true });
  assert.deepEqual(texts(oldBackup), ['Before the WAL commit.']);
  assert.deepEqual(texts(nextBackup), ['Before the WAL commit.', 'Written after the first migration.']);
  assert.equal(hasTable(nextBackup, 'chronicle_privacy'), false);
  assert.equal(hasTable(second.db, 'chronicle_privacy'), true);
  second.close(); f.store().close();
  assert.deepEqual(f.backups(), backups);
});

test('backup failure aborts before schema creation and closes the opened database handle', t => {
  const f = fixture(t); legacy(f, { older: true });
  const originalPrepare = DatabaseSync.prototype.prepare;
  let failedHandle;
  const guard = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql, ...args) {
    if (sql === 'VACUUM INTO ?') {
      failedHandle = this; f.handles.add(this);
      return { run() { throw new Error('Synthetic backup destination failure.'); } };
    }
    return originalPrepare.call(this, sql, ...args);
  });
  try { assert.throws(() => new ChronicleStore(f.path), /Synthetic backup destination failure/); }
  finally { guard.mock.restore(); }
  assert.ok(failedHandle);
  assert.throws(() => failedHandle.prepare('SELECT 1'), /not open|closed/i);
  const unchanged = f.open();
  assert.equal(hasTable(unchanged, 'delivery_uncertain'), false);
  assert.equal(hasTable(unchanged, 'chronicle_projection'), false);
  assert.deepEqual(texts(unchanged), ['Before the WAL commit.']);
  assert.deepEqual(f.backups(), []);
});

test('a later initialization failure also closes its handle and retains the pre-migration backup', t => {
  const f = fixture(t); legacy(f);
  const originalExec = DatabaseSync.prototype.exec;
  let failedHandle;
  const guard = t.mock.method(DatabaseSync.prototype, 'exec', function (sql, ...args) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS')) {
      failedHandle = this; f.handles.add(this);
      throw new Error('Synthetic DDL failure.');
    }
    return originalExec.call(this, sql, ...args);
  });
  try { assert.throws(() => new ChronicleStore(f.path), /Synthetic DDL failure/); }
  finally { guard.mock.restore(); }
  assert.ok(failedHandle);
  assert.throws(() => failedHandle.prepare('SELECT 1'), /not open|closed/i);
  assert.equal(f.backups().length, 1);
  const unchanged = f.open();
  assert.equal(hasTable(unchanged, 'chronicle_projection'), false);
  assert.deepEqual(texts(unchanged), ['Before the WAL commit.']);
});

test('an existing projection database backs up before the new synchronization table is added', t => {
  const f = fixture(t), original = f.store();
  original.db.exec('DROP TABLE chronicle_evidence_sync');
  original.close();
  assert.deepEqual(f.backups(), []);
  const migrated = f.store(), backups = f.backups();
  assert.equal(backups.length, 1);
  const backup = f.open(backups[0], { readOnly: true });
  assert.equal(hasTable(backup, 'chronicle_projection'), true);
  assert.equal(hasTable(backup, 'chronicle_evidence_sync'), false);
  assert.equal(hasTable(migrated.db, 'chronicle_evidence_sync'), true);
  migrated.close(); f.store().close();
  assert.deepEqual(f.backups(), backups);
});

test('synchronization acknowledgements and backoff survive restart without changing source projection', t => {
  const f = fixture(t); legacy(f);
  const store = f.store(), id = 'legacy-session';
  assert.deepEqual(store.evidenceSync(id), { revision: -1, lastSuccess: 0, attempts: 0, nextAttempt: 0, lastError: null });
  const projection = store.evidenceProjection(id);
  const acknowledged = { revision: projection.revision, lastSuccess: 1700000000000, attempts: 0, nextAttempt: 0, lastError: null };
  assert.deepEqual(store.saveEvidenceSync(id, acknowledged), acknowledged);
  assert.deepEqual(store.evidenceProjection(id), projection);
  store.append(id, 'after-ack', 'note', { text: 'A new unsynchronized fact.' });
  const newer = store.evidenceProjection(id);
  const deferred = { revision: acknowledged.revision, lastSuccess: acknowledged.lastSuccess, attempts: 2, nextAttempt: 1700000030000, lastError: 'unavailable' };
  assert.deepEqual(store.saveEvidenceSync(id, deferred), deferred);
  assert.ok(store.evidenceSync(id).revision < newer.revision);
  assert.deepEqual(store.evidenceProjection(id), newer);
  store.close();
  const reopened = f.store();
  assert.deepEqual(reopened.evidenceSync(id), deferred);
  assert.deepEqual(reopened.evidenceProjection(id), newer);
  const stale = { ...deferred, lastError: 'stale' };
  assert.deepEqual(reopened.saveEvidenceSync(id, stale), stale);
  assert.throws(() => reopened.transaction(() => {
    reopened.saveEvidenceSync(id, { ...stale, revision: newer.revision, attempts: 0, lastError: null });
    throw new Error('Rollback synchronization fixture.');
  }), /Rollback synchronization fixture/);
  assert.deepEqual(reopened.evidenceSync(id), stale);
  assert.deepEqual(reopened.evidenceProjection(id), newer);
});

test('synchronization state rejects future acknowledgements, unsafe integers and unsanitized data atomically', t => {
  const f = fixture(t); legacy(f);
  const store = f.store(), id = 'legacy-session', projection = store.evidenceProjection(id);
  const base = { revision: -1, lastSuccess: 0, attempts: 1, nextAttempt: 1, lastError: 'unavailable' };
  store.saveEvidenceSync(id, base);
  const invalid = [
    { ...base, revision: projection.revision + 1 }, { ...base, revision: -2 }, { ...base, revision: 0.5 },
    { ...base, lastSuccess: -1 }, { ...base, attempts: -1 }, { ...base, attempts: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, nextAttempt: NaN }, { ...base, nextAttempt: '1' }, { ...base, lastError: 'Raw transcript or secret.' },
    { ...base, credentials: 'Never persisted.' }, { ...base, text: 'Never persisted.' }, {}, null,
  ];
  for (const state of invalid) {
    assert.throws(() => store.saveEvidenceSync(id, state), /Invalid evidence synchronization state/);
    assert.deepEqual(store.evidenceSync(id), base);
    assert.deepEqual(store.evidenceProjection(id), projection);
  }
  assert.throws(() => store.saveEvidenceSync('missing-session', base), /Session not found/);
  assert.throws(() => store.evidenceSync('missing-session'), /Session not found/);
  assert.deepEqual(store.db.prepare('PRAGMA table_info(chronicle_evidence_sync)').all().map(row => row.name),
    ['session', 'revision', 'last_success', 'attempts', 'next_attempt', 'last_error']);
});
