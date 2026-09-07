import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { GameStore } from '../game/store.mjs';
import { createMembershipClient } from './client.mjs';
import { startMembershipBridge } from './server.mjs';
import { membershipHostConfig, runMembershipHost, startMembershipHost } from './host.mjs';

const run = promisify(execFile);
const token = 'fixture-private-membership-token-0123456789';
const hostOwner = '11111111111111111', playerOwner = '22222222222222222';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(t) {
  const root = realpathSync(tmpdir()), dir = mkdtempSync(join(root, 'membership-host-')), path = join(dir, 'game.sqlite'), closers = [];
  const setup = new GameStore(path);
  // Only fixture seeding uses SQL; authorization always exercises GameStore.member.
  setup.db.prepare('INSERT INTO game_campaigns VALUES(?,?,?)').run('campaign', 0, '{}');
  setup.db.prepare('INSERT INTO game_members VALUES(?,?,?)').run('campaign', hostOwner, 'host');
  setup.db.prepare('INSERT INTO game_members VALUES(?,?,?)').run('campaign', playerOwner, 'player');
  setup.close();
  t.after(async () => {
    for (const close of closers.reverse()) await close();
    const actual = realpathSync(dir);
    assert.equal(dirname(actual), root); assert.equal(basename(actual).startsWith('membership-host-'), true);
    rmSync(actual, { recursive: true, force: true });
  });
  return { dir, path, env: { RAPHAEL_GAME_DATA_DIR: dir, RAPHAEL_MEMBERSHIP_TOKEN: token, RAPHAEL_MEMBERSHIP_CAMPAIGNS: 'campaign' }, own(close) { closers.push(close); } };
}

for (const [field, value] of [
  ['RAPHAEL_MEMBERSHIP_PORT', '0'], ['RAPHAEL_MEMBERSHIP_PORT', '65536'], ['RAPHAEL_MEMBERSHIP_PORT', '3x'], ['RAPHAEL_MEMBERSHIP_PORT', ''],
  ['RAPHAEL_MEMBERSHIP_CAMPAIGNS', ''], ['RAPHAEL_MEMBERSHIP_CAMPAIGNS', 'campaign,'], ['RAPHAEL_MEMBERSHIP_CAMPAIGNS', 'campaign,campaign'],
  ['RAPHAEL_MEMBERSHIP_CAMPAIGNS', 'has space'], ['RAPHAEL_MEMBERSHIP_CAMPAIGNS', Array.from({ length: 101 }, (_, i) => `campaign-${i}`).join(',')],
  ['RAPHAEL_MEMBERSHIP_TOKEN', 'x'.repeat(31)], ['RAPHAEL_MEMBERSHIP_TOKEN', 'x'.repeat(513)], ['RAPHAEL_MEMBERSHIP_TOKEN', `${'x'.repeat(32)} value`],
  ['RAPHAEL_MEMBERSHIP_TOKEN', `${'x'.repeat(32)}\n`], ['RAPHAEL_MEMBERSHIP_TOKEN', `${'x'.repeat(32)}é`],
]) {
  test(`invalid ${field} input fails before opening or creating a database (${String(value).length} chars)`, async t => {
    const f = fixture(t), records = []; let opened = 0;
    const env = { ...f.env, [field]: value };
    await assert.rejects(startMembershipHost({ env, openGame() { opened += 1; throw new Error(token); } }), /configuration is invalid/);
    assert.equal(opened, 0);
    const result = await runMembershipHost({ args: ['--check'], env, write: record => records.push(record) });
    assert.equal(result.code, 1);
    assert.equal(records[0].ready, false);
    assert.equal(JSON.stringify(records).includes(token), false);
    if (String(value).length) assert.equal(JSON.stringify(records).includes(String(value)), false);
  });
}

test('missing or empty game database never creates an empty game store', async t => {
  const f = fixture(t), missing = join(f.dir, 'missing-private-data');
  assert.throws(() => membershipHostConfig({ ...f.env, RAPHAEL_GAME_DATA_DIR: missing }), /configuration is invalid/);
  assert.equal(existsSync(missing), false);
  const empty = join(f.dir, 'empty'); mkdirSync(empty); writeFileSync(join(empty, 'game.sqlite'), '');
  assert.throws(() => membershipHostConfig({ ...f.env, RAPHAEL_GAME_DATA_DIR: empty }), /configuration is invalid/);
  assert.equal(readFileSync(join(empty, 'game.sqlite')).length, 0);
  const junk = join(f.dir, 'junk'); mkdirSync(junk); writeFileSync(join(junk, 'game.sqlite'), 'This is not an existing SQLite database.');
  assert.throws(() => membershipHostConfig({ ...f.env, RAPHAEL_GAME_DATA_DIR: junk }), /configuration is invalid/);
  assert.deepEqual(readdirSync(junk), ['game.sqlite']);
});

test('token sources are exclusive, bounded and absolute, and token values are not enumerable', t => {
  const f = fixture(t), file = join(f.dir, 'membership-token');
  writeFileSync(file, `${token}\r\n`);
  const env = { ...f.env, RAPHAEL_MEMBERSHIP_TOKEN_FILE: file }; delete env.RAPHAEL_MEMBERSHIP_TOKEN;
  const config = membershipHostConfig(env);
  assert.equal(config.token, token);
  assert.equal(config.port, 38176);
  assert.deepEqual(config.campaigns, ['campaign']);
  assert.equal(config.databasePath, realpathSync(f.path));
  assert.equal(JSON.stringify(config).includes(token), false);
  assert.throws(() => membershipHostConfig({ ...env, RAPHAEL_MEMBERSHIP_TOKEN: token }), /configuration is invalid/);
  assert.throws(() => membershipHostConfig({ ...env, RAPHAEL_MEMBERSHIP_TOKEN_FILE: 'relative-token' }), /configuration is invalid/);
  writeFileSync(file, `${token}\n\n`);
  assert.throws(() => membershipHostConfig(env), /configuration is invalid/);
  writeFileSync(file, 'x'.repeat(100000));
  assert.throws(() => membershipHostConfig(env), /configuration is invalid/);
});

test('OneDrive data and resolved directory junctions into it are refused', t => {
  const f = fixture(t), synced = join(f.dir, 'OneDrive - Example', 'game'), alias = join(f.dir, 'alias');
  mkdirSync(synced, { recursive: true }); copyFileSync(f.path, join(synced, 'game.sqlite'));
  assert.throws(() => membershipHostConfig({ ...f.env, RAPHAEL_GAME_DATA_DIR: synced }), /configuration is invalid/);
  symlinkSync(synced, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => membershipHostConfig({ ...f.env, RAPHAEL_GAME_DATA_DIR: alias }), /configuration is invalid/);
  assert.throws(() => membershipHostConfig({ ...f.env, OneDriveCommercial: f.dir }), /configuration is invalid/);
});

test('custom OneDrive roots reject dot-prefixed child names before opening SQLite', async t => {
  const f = fixture(t), syncRoot = join(f.dir, 'custom-sync-root'), synced = join(syncRoot, '..campaign');
  mkdirSync(synced, { recursive: true }); copyFileSync(f.path, join(synced, 'game.sqlite'));
  const before = readFileSync(join(synced, 'game.sqlite'));
  for (const rootKey of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const env = { ...f.env, RAPHAEL_GAME_DATA_DIR: synced, [rootKey]: syncRoot };
    assert.throws(() => membershipHostConfig(env), /configuration is invalid/);
    let opened = 0;
    await assert.rejects(startMembershipHost({ env, openGame() { opened += 1; throw new Error('Must not open synchronized data.'); } }), /configuration is invalid/);
    assert.equal(opened, 0);
  }
  assert.deepEqual(readFileSync(join(synced, 'game.sqlite')), before);
  assert.deepEqual(readdirSync(synced), ['game.sqlite']);
  assert.equal(membershipHostConfig({ ...f.env, OneDrive: syncRoot }).databasePath, realpathSync(f.path), 'a database outside the configured sync root remains eligible');
});

test('--check returns secret-safe readiness without opening SQLite or starting a listener', async t => {
  const f = fixture(t), before = readFileSync(f.path), beforeFiles = readdirSync(f.dir).sort(), records = [];
  const result = await runMembershipHost({ args: ['--check'], env: f.env, write: record => records.push(record), start() { throw new Error('Check must never start.'); } });
  assert.equal(result.code, 0);
  assert.deepEqual(records, [{ ready: true, service: 'operator-membership', version: 1, mode: 'check', listening: false, campaigns: 1, port: 38176 }]);
  assert.equal(JSON.stringify(records).includes(token), false);
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(readdirSync(f.dir).sort(), beforeFiles);
});

test('the actual --check CLI succeeds with its configured port already occupied', async t => {
  const f = fixture(t), listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  f.own(() => new Promise(resolve => listener.close(resolve)));
  const env = { ...process.env, ...f.env, RAPHAEL_MEMBERSHIP_PORT: String(listener.address().port), NODE_TEST_CONTEXT: undefined };
  delete env.RAPHAEL_MEMBERSHIP_TOKEN_FILE;
  const { stdout, stderr } = await run(process.execPath, [fileURLToPath(new URL('./host.mjs', import.meta.url)), '--check'], { env, timeout: 15000, windowsHide: true });
  const result = JSON.parse(stdout);
  assert.equal(result.ready, true); assert.equal(result.listening, false);
  assert.equal(`${stdout}${stderr}`.includes(token), false);
  assert.equal(existsSync(join(f.dir, 'game.sqlite-wal')), false);
  assert.equal(existsSync(join(f.dir, 'game.sqlite-shm')), false);
});

test('bridge startup failure closes only the newly opened GameStore and sanitizes errors', async t => {
  const f = fixture(t); let closed = 0;
  await assert.rejects(startMembershipHost({ env: f.env, openGame: path => {
    assert.equal(path, realpathSync(f.path)); return { close() { closed += 1; } };
  }, startBridge: async () => { throw new Error(`Driver failure ${token}`); } }), error => error.message === 'Membership bridge could not start.');
  assert.equal(closed, 1);
});

test('actual disposable GameStore bridge checks current host membership and closes cleanly', async t => {
  const f = fixture(t);
  const host = await startMembershipHost({ env: f.env, startBridge: options => startMembershipBridge({ ...options, port: 0 }) });
  f.own(() => host.close());
  const client = createMembershipClient({ url: host.url, token });
  assert.equal(await client.status(), true);
  assert.equal(await client.authorizeCommand({ campaign: 'campaign', owner: hostOwner }), true);
  assert.equal(await client.authorizeCommand({ campaign: 'campaign', owner: playerOwner }), false);
  assert.equal(await client.authorizeCommand({ campaign: 'other-campaign', owner: hostOwner }), false);
  const changed = new GameStore(f.path);
  try { changed.db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', 'campaign', hostOwner); }
  finally { changed.close(); }
  assert.equal(await client.authorizeCommand({ campaign: 'campaign', owner: hostOwner }), false, 'the bridge rechecks the authoritative role on every request');
  const first = host.close(), second = host.close();
  assert.equal(first, second); await first;
  assert.equal(await client.status(), false);
});

test('shared shutdown waits for the bridge drain before closing its owned store', async t => {
  const f = fixture(t), drain = deferred(); let bridgeCloses = 0, gameCloses = 0;
  const host = await startMembershipHost({ env: f.env, openGame: () => ({ close() { gameCloses += 1; } }), startBridge: async () => ({ url: 'http://127.0.0.1:38176', close() { bridgeCloses += 1; return drain.promise; } }) });
  const first = host.close(), second = host.close();
  assert.equal(first, second); assert.equal(bridgeCloses, 1); assert.equal(gameCloses, 0);
  drain.resolve(); await first; assert.equal(gameCloses, 1);
});

test('CLI setup failure after startup closes the owned host and removes partial hooks', async t => {
  const f = fixture(t), signals = new EventEmitter(), records = []; let closed = 0;
  const originalOn = signals.on.bind(signals);
  signals.on = (event, handler) => { if (event === 'SIGTERM') throw new Error(token); return originalOn(event, handler); };
  const result = await runMembershipHost({ args: [], env: f.env, signals, write: value => records.push(value), start: async () => ({ url: 'http://127.0.0.1:38176', close() { closed += 1; } }) });
  assert.equal(result.code, 1); assert.equal(closed, 1); assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(JSON.stringify(records).includes(token), false);
});

test('SIGINT and SIGTERM share one shutdown and remove only the host signal hooks', async t => {
  const f = fixture(t), signals = new EventEmitter(), drain = deferred(), records = []; let closed = 0;
  const other = () => {}; signals.on('SIGINT', other);
  const running = await runMembershipHost({ args: [], env: f.env, signals, write: value => records.push(value), start: async () => ({ url: 'http://127.0.0.1:38176', close() { closed += 1; return drain.promise; } }) });
  signals.emit('SIGINT'); signals.emit('SIGTERM');
  assert.equal(closed, 1); assert.equal(records.length, 1);
  const closing = running.close(); drain.resolve(); assert.equal(await closing, 0);
  assert.equal(records.filter(value => value.stopped).length, 1);
  assert.deepEqual(signals.listeners('SIGINT'), [other]); assert.equal(signals.listenerCount('SIGTERM'), 0);
});
