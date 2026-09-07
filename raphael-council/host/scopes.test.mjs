import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHostScopeSource } from './scopes.mjs';

const HOST = '12345678901234567';
const OTHER = '22345678901234567';
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function withDb(path, action) { const db = new DatabaseSync(path); try { return action(db); } finally { db.close(); } }
function makeGame(path, campaigns = ['camp-1', 'camp-2']) {
  mkdirSync(join(path, '..'), { recursive: true });
  withDb(path, db => {
    db.exec('CREATE TABLE game_schema(version INTEGER PRIMARY KEY); INSERT INTO game_schema VALUES(1); CREATE TABLE game_campaigns(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL); CREATE TABLE game_members(campaign TEXT NOT NULL REFERENCES game_campaigns(id),owner TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(campaign,owner));');
    for (const campaign of campaigns) {
      db.prepare('INSERT INTO game_campaigns VALUES(?,?,?)').run(campaign, 0, JSON.stringify({ id: campaign }));
      db.prepare('INSERT INTO game_members VALUES(?,?,?)').run(campaign, HOST, 'host');
      db.prepare('INSERT INTO game_members VALUES(?,?,?)').run(campaign, OTHER, 'player');
    }
  });
}
function makeChronicle(path) { mkdirSync(join(path, '..'), { recursive: true }); withDb(path, db => db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,body TEXT NOT NULL)')); }
function session(path, { id = ID, campaign = 'camp-1', status = 'active', host = HOST, ...extra } = {}) {
  const body = { id, campaign, title: 'Private title', mode: 'human', minutes: 10, host, channel: 'channel', sourceChannel: 'source', autoImages: false, requestId: `start-${id}`, status, started: 1000, nextDue: 61000, watermark: 0, scene: null, ended: status === 'ended' ? 2000 : null, recap: null, ...extra };
  withDb(path, db => db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(id, campaign, JSON.stringify(body)));
}
function fixture(t) {
  const temp = realpathSync(tmpdir()), root = mkdtempSync(join(temp, 'operator-host-scopes-'));
  const game = join(root, 'game.sqlite'), chronicle = join(root, 'chronicle.sqlite');
  makeGame(game); makeChronicle(chronicle);
  const sources = [];
  t.after(() => {
    for (const source of sources) source.close();
    const actual = realpathSync(root), contained = relative(temp, actual);
    assert.ok(contained && !contained.startsWith('..') && !isAbsolute(contained));
    rmSync(actual, { recursive: true, force: true });
  });
  return { root, game, chronicle,
    open(options = {}) {
      const source = createHostScopeSource({ gameDatabasePath: game, chronicleFiles: { 'camp-1': chronicle }, campaigns: ['camp-1'], env: {}, ...options });
      sources.push(source); return source;
    },
  };
}

test('masters precede authorized active, paused and ending scopes; ended sessions never reactivate', t => {
  const f = fixture(t);
  session(f.chronicle, { id: ID, status: 'active', privateEvidence: 'must never leave storage' });
  session(f.chronicle, { id: ID2, campaign: 'camp-2', status: 'paused' });
  session(f.chronicle, { id: ID3, status: 'ending' });
  session(f.chronicle, { id: '44444444-4444-4444-8444-444444444444', status: 'ended', pendingFinalDelivery: true });
  const source = f.open({ campaigns: ['camp-1', 'camp-2'], chronicleFiles: { 'camp-1': f.chronicle, 'camp-2': f.chronicle } });
  assert.deepEqual(source.listScopes(), [
    { campaign: 'camp-1', session: 'campaign' }, { campaign: 'camp-2', session: 'campaign' },
    { campaign: 'camp-1', session: ID }, { campaign: 'camp-1', session: ID3 }, { campaign: 'camp-2', session: ID2 },
  ]);
  assert.equal(source.status().chronicle, 'ready'); assert.equal(source.status().initializedCampaigns, 2);
  assert.equal(JSON.stringify(source.status()).includes(f.root), false);
  assert.equal(JSON.stringify(source.listScopes()).includes('must never leave storage'), false);
});

test('reads preserve database bytes and schema and create no migration or backup files', t => {
  const f = fixture(t); session(f.chronicle);
  const before = { game: digest(f.game), chronicle: digest(f.chronicle), files: readdirSync(f.root).sort() };
  const source = f.open(); source.listScopes(); source.close(); source.close();
  assert.equal(digest(f.game), before.game); assert.equal(digest(f.chronicle), before.chronicle);
  assert.deepEqual(readdirSync(f.root).sort(), before.files);
  assert.deepEqual(withDb(f.chronicle, db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name)), ['sessions']);
  assert.equal(source.status().closed, true); awaitClosed(source);
});
function awaitClosed(source) { assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_CLOSED' }); }

test('missing game file is never created and noncanonical existing schemas are never migrated', t => {
  const f = fixture(t); const missing = join(f.root, 'missing-game.sqlite');
  assert.throws(() => f.open({ gameDatabasePath: missing }), { code: 'SCOPE_SOURCE_PATH' });
  assert.equal(existsSync(missing), false);
  const old = join(f.root, 'old-game.sqlite'); withDb(old, db => db.exec('CREATE TABLE old_schema(id INTEGER)'));
  const before = digest(old);
  assert.throws(() => f.open({ gameDatabasePath: old }), { code: 'SCOPE_SOURCE_SCHEMA' });
  assert.equal(digest(old), before);
  assert.deepEqual(withDb(old, db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name)), ['old_schema']);
});

test('disabled chronicles and not-yet-created per-campaign files are explicit and do not create paths', t => {
  const f = fixture(t); const disabled = f.open({ chronicleFiles: {} });
  assert.deepEqual(disabled.listScopes(), [{ campaign: 'camp-1', session: 'campaign' }]);
  assert.equal(disabled.status().chronicle, 'disabled'); assert.equal(disabled.status().disabledCampaigns, 1);
  const missing = join(f.root, 'not-created', 'camp-1', 'chronicle.sqlite');
  const source = f.open({ chronicleFiles: { 'camp-1': missing } });
  assert.deepEqual(source.listScopes(), [{ campaign: 'camp-1', session: 'campaign' }]);
  assert.equal(source.status().chronicle, 'not-initialized'); assert.equal(existsSync(join(f.root, 'not-created')), false);
  makeChronicle(missing); session(missing);
  assert.deepEqual(source.listScopes(), [{ campaign: 'camp-1', session: 'campaign' }, { campaign: 'camp-1', session: ID }]);
  assert.equal(source.status().chronicle, 'ready');
});

test('new sessions and ending transitions are fresh, and revoked host membership removes session authority', t => {
  const f = fixture(t); const source = f.open();
  assert.equal(source.listScopes().length, 1);
  session(f.chronicle); assert.equal(source.listScopes().length, 2);
  session(f.chronicle, { status: 'paused' }); assert.equal(source.listScopes().length, 2);
  session(f.chronicle, { status: 'ending' }); assert.equal(source.listScopes().length, 2);
  withDb(f.game, db => db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', 'camp-1', HOST));
  assert.deepEqual(source.listScopes(), [{ campaign: 'camp-1', session: 'campaign' }]);
  withDb(f.game, db => db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('host', 'camp-1', HOST));
  assert.equal(source.listScopes().length, 2);
  session(f.chronicle, { status: 'ended' }); assert.equal(source.listScopes().length, 1);
});

test('allowlist callback revocation is fresh and an unknown canonical campaign fails closed', t => {
  const f = fixture(t); session(f.chronicle); session(f.chronicle, { id: ID2, campaign: 'camp-2' });
  let campaigns = ['camp-1', 'camp-2'];
  const source = f.open({ campaigns: () => campaigns, chronicleFiles: () => ({ 'camp-1': f.chronicle, 'camp-2': f.chronicle }) });
  assert.equal(source.listScopes().length, 4);
  campaigns = ['camp-2']; assert.deepEqual(source.listScopes(), [{ campaign: 'camp-2', session: 'campaign' }, { campaign: 'camp-2', session: ID2 }]);
  campaigns = ['unknown']; assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_UNKNOWN_CAMPAIGN' });
  assert.equal(source.status().ready, false); assert.equal(source.status().scopeCount, 0);
});

test('unallowlisted sessions never enter scopes and a JSON host role cannot replace current membership', t => {
  const f = fixture(t);
  session(f.chronicle, { campaign: 'camp-2', privateEvidence: 'other campaign secret' });
  session(f.chronicle, { id: ID2, host: OTHER, role: 'host', status: 'ending' });
  const source = f.open();
  assert.deepEqual(source.listScopes(), [{ campaign: 'camp-1', session: 'campaign' }]);
  withDb(f.game, db => db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run('camp-1', OTHER));
  assert.equal(source.listScopes().length, 1);
});

test('OneDrive names and custom configured sync roots deny both game and chronicle files', t => {
  const f = fixture(t); const synced = join(f.root, 'OneDrive - test', 'game.sqlite'); makeGame(synced);
  assert.throws(() => f.open({ gameDatabasePath: synced }), { code: 'SCOPE_SOURCE_PATH' });
  const custom = join(f.root, 'custom-sync', 'game.sqlite'); makeGame(custom);
  assert.throws(() => f.open({ gameDatabasePath: custom, env: { OneDrive: join(f.root, 'custom-sync') } }), { code: 'SCOPE_SOURCE_PATH' });
  const chronicle = join(f.root, 'OneDrive', 'chronicle.sqlite'); makeChronicle(chronicle);
  const source = f.open({ chronicleFiles: { 'camp-1': chronicle } });
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_PATH' });
  const missing = f.open({ chronicleFiles: { 'camp-1': join(f.root, 'OneDrive', 'later', 'chronicle.sqlite') } });
  assert.throws(() => missing.listScopes(), { code: 'SCOPE_SOURCE_PATH' });
});

test('dot-prefixed child names remain inside an excluded custom OneDrive root', t => {
  const f = fixture(t), syncRoot = join(f.root, 'custom-sync'), child = join(syncRoot, '..campaign');
  const game = join(child, 'game.sqlite'), chronicle = join(child, 'chronicle.sqlite'); makeGame(game); makeChronicle(chronicle);
  assert.throws(() => f.open({ gameDatabasePath: game, env: { OneDrive: syncRoot } }), { code: 'SCOPE_SOURCE_PATH' });
  const source = f.open({ chronicleFiles: { 'camp-1': chronicle }, env: { OneDrive: syncRoot } });
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_PATH' });
});

test('junction aliases cannot hide a OneDrive target and safe shared aliases still yield separate campaign scopes', t => {
  const f = fixture(t); const target = join(f.root, 'OneDrive', 'private'); mkdirSync(target, { recursive: true });
  makeGame(join(target, 'game.sqlite')); makeChronicle(join(target, 'chronicle.sqlite'));
  const alias = join(f.root, 'hidden-alias'); symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.open({ gameDatabasePath: join(alias, 'game.sqlite') }), { code: 'SCOPE_SOURCE_PATH' });
  const source = f.open({ chronicleFiles: { 'camp-1': join(alias, 'chronicle.sqlite') } });
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_PATH' });
  const safeAlias = join(f.root, 'safe-alias'); symlinkSync(f.root, safeAlias, process.platform === 'win32' ? 'junction' : 'dir');
  session(f.chronicle); session(f.chronicle, { id: ID2, campaign: 'camp-2' });
  const shared = f.open({ campaigns: ['camp-1', 'camp-2'], chronicleFiles: { 'camp-1': f.chronicle, 'camp-2': join(safeAlias, 'chronicle.sqlite') } });
  assert.equal(shared.listScopes().length, 4);
  assert.equal(shared.status().openChronicleFiles, 1);
  shared.close(); assert.equal(shared.status().openChronicleFiles, 0);
});

test('malformed current session metadata and unsupported statuses fail closed without exposing data', t => {
  for (const body of ['not JSON private transcript', JSON.stringify({ id: ID, campaign: 'camp-1', status: 'draining', host: HOST }), JSON.stringify({ id: ID2, campaign: 'camp-1', status: 'active', host: HOST })]) {
    const f = fixture(t); withDb(f.chronicle, db => db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(ID, 'camp-1', body));
    const source = f.open();
    assert.throws(() => source.listScopes(), error => { assert.equal(error.name, 'HostScopeSourceError'); assert.equal(error.message.includes('private transcript'), false); assert.equal(error.message.includes(f.root), false); return true; });
    assert.equal(source.status().ready, false); assert.equal(source.status().scopeCount, 0);
  }
});

test('data/schema outages fail closed instead of returning cached authorizations', t => {
  const f = fixture(t); session(f.chronicle); const source = f.open(); assert.equal(source.listScopes().length, 2);
  withDb(f.game, db => db.exec('DROP TABLE game_members'));
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_SCHEMA' });
  assert.equal(source.status().ready, false); assert.equal(source.status().chronicle, 'unavailable');
  assert.equal(source.status().openChronicleFiles, 0);
});

test('master-only operation still rejects a changed canonical game schema', t => {
  const f = fixture(t); const source = f.open({ chronicleFiles: {} }); source.listScopes();
  withDb(f.game, db => db.exec('UPDATE game_schema SET version=2'));
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_SCHEMA' });
  assert.equal(source.status().ready, false);
});

test('allowlist callback errors are sanitized during construction and subsequent reads', t => {
  const f = fixture(t);
  const privateFailure = () => { throw Object.assign(Error(`private ${f.root}`), { name: 'HostScopeSourceError', code: 'private-key' }); };
  assert.throws(() => f.open({ campaigns: privateFailure }), error => { assert.equal(error.code, 'SCOPE_SOURCE_UNAVAILABLE'); assert.equal(error.message.includes(f.root), false); return true; });
  let broken = false;
  const source = f.open({ campaigns: () => broken ? privateFailure() : ['camp-1'] }); source.listScopes(); broken = true;
  assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_UNAVAILABLE' });
  assert.equal(JSON.stringify(source.status()).includes('private-key'), false);
  assert.equal(source.status().openChronicleFiles, 0);
});

test('scope count includes campaign masters and invalid allowlists are rejected before any scope result', t => {
  const f = fixture(t);
  for (let index = 0; index < 100; index++) session(f.chronicle, { id: `session-${index}` });
  const source = f.open(); assert.throws(() => source.listScopes(), { code: 'SCOPE_SOURCE_LIMIT' });
  for (const campaigns of [[], ['camp-1', 'camp-1'], ['../private'], Array(101).fill('camp-1')]) assert.throws(() => f.open({ campaigns }), { code: 'INVALID_SCOPE_CONFIGURATION' });
  const nonSqlite = join(f.root, 'bad.sqlite'); writeFileSync(nonSqlite, 'not a sqlite database');
  assert.throws(() => f.open({ gameDatabasePath: nonSqlite }), { code: 'SCOPE_SOURCE_PATH' });
});
