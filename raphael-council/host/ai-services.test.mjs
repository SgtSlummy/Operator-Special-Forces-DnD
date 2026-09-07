import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gameAiHostConfig, openGameAiHostServices } from './ai-services.mjs';

const env = { LOCALAPPDATA: join(tmpdir(), 'raphael-host-config-test'), RAPHAEL_MEMBERSHIP_CAMPAIGNS: 'harbor,veil', RAPHAEL_CHRONICLE_ENABLED: '1' };
function fixture(overrides = {}) {
  const calls = [];
  const source = { listScopes() { calls.push('scopes'); return [{ campaign: 'harbor', session: 'campaign' }]; }, close() { calls.push('source-close'); } };
  const lifecycle = { async start() { calls.push('start'); }, async close() { calls.push('lease-close'); }, status() { return { state: 'running' }; } };
  return { calls, source, lifecycle, options: { env, createScopeSource(config) { calls.push('source'); assert.equal(config.campaigns[0], 'harbor'); return source; }, createControl() { calls.push('control'); return {}; }, createLifecycle({ listScopes }) { calls.push('lifecycle'); listScopes(); return lifecycle; }, ...overrides } };
}

test('canonical config preserves separate chronicle defaults and an explicit shared override', () => {
  const config = gameAiHostConfig(env);
  assert.equal(config.gameDatabasePath, join(env.LOCALAPPDATA, 'Raphael', 'game', 'game.sqlite'));
  assert.equal(config.chronicleFiles.harbor, join(env.LOCALAPPDATA, 'Raphael', 'chronicle', 'harbor', 'chronicle.sqlite'));
  assert.notEqual(config.chronicleFiles.harbor, config.chronicleFiles.veil);
  const shared = gameAiHostConfig({ ...env, RAPHAEL_CHRONICLE_DATA_DIR: join(env.LOCALAPPDATA, 'shared') });
  assert.equal(shared.chronicleFiles.harbor, shared.chronicleFiles.veil);
  assert.equal(Object.keys(gameAiHostConfig({ ...env, RAPHAEL_CHRONICLE_ENABLED: '0' }).chronicleFiles).length, 0);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.campaigns) && Object.isFrozen(config.chronicleFiles));
});

test('invalid campaign allowlists fail before any scope or credential factory', async () => {
  for (const raw of [undefined, '', 'harbor,', 'harbor,harbor', '../harbor', 'harbor\nveil']) {
    const f = fixture({ env: { ...env, RAPHAEL_MEMBERSHIP_CAMPAIGNS: raw } });
    const host = await openGameAiHostServices(f.options);
    assert.equal(host.status().state, 'unavailable');
    assert.equal(host.status().lastError, 'INVALID_HOST_CONFIGURATION');
    assert.deepEqual(f.calls, []);
    await host.close();
  }
});

test('canonical scopes are validated before signing; close drains leases before metadata', async () => {
  const f = fixture(), host = await openGameAiHostServices(f.options);
  assert.deepEqual(f.calls, ['source', 'scopes', 'control', 'lifecycle', 'scopes', 'start']);
  assert.equal(host.status().state, 'running');
  const first = host.close(), second = host.close();
  assert.equal(first, second);
  assert.equal((await first).state, 'closed');
  await host.close();
  assert.deepEqual(f.calls.slice(-2), ['lease-close', 'source-close']);
});

test('Obus key or endpoint failure preserves manual play and sanitizes status', async () => {
  const f = fixture({ createControl() { throw new Error('secret-token and C:/private/path'); } });
  const host = await openGameAiHostServices(f.options);
  assert.deepEqual(host.status(), { state: 'unavailable', lastError: 'OBUS_HOST_UNAVAILABLE', runtime: null });
  assert.ok(!JSON.stringify(host.status()).includes('secret-token'));
  await host.close();
  assert.deepEqual(f.calls, ['source', 'scopes', 'source-close']);
});

test('scope failure prevents control creation and retains its handle for cleanup', async () => {
  const f = fixture(); f.source.listScopes = () => { throw new Error('invalid canonical membership'); };
  const host = await openGameAiHostServices(f.options);
  assert.equal(host.status().state, 'unavailable');
  assert.deepEqual(f.calls, ['source']);
  await host.close(); assert.deepEqual(f.calls, ['source', 'source-close']);
});

test('failed lease shutdown keeps metadata owned and permits cleanup retry', async () => {
  const f = fixture(); let attempts = 0;
  f.lifecycle.close = async () => { f.calls.push('lease-close'); if (++attempts === 1) throw new Error('offline'); };
  const host = await openGameAiHostServices(f.options);
  await assert.rejects(host.close(), { code: 'HOST_CLOSE_FAILED' });
  assert.equal(host.status().state, 'shutdown-incomplete');
  assert.ok(!f.calls.includes('source-close'));
  assert.equal((await host.close()).state, 'closed');
  assert.deepEqual(f.calls.slice(-3), ['lease-close', 'lease-close', 'source-close']);
});

test('failed metadata close retries only the still-owned metadata handle', async () => {
  const f = fixture(); let attempts = 0;
  f.source.close = () => { f.calls.push('source-close'); if (++attempts === 1) throw new Error('busy'); };
  const host = await openGameAiHostServices(f.options);
  await assert.rejects(host.close(), { code: 'HOST_CLOSE_FAILED' });
  assert.equal((await host.close()).state, 'closed');
  assert.deepEqual(f.calls.slice(-3), ['lease-close', 'source-close', 'source-close']);
});

test('an already cancelled opener allocates nothing', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture({ signal: controller.signal });
  const host = await openGameAiHostServices(f.options);
  assert.deepEqual(f.calls, []); assert.equal(host.status().state, 'closed');
  assert.equal(host.status().lastError, 'HOST_START_ABORTED');
});

test('cancellation during startup retains late ownership and drains it before returning', async () => {
  const controller = new AbortController(), f = fixture({ signal: controller.signal });
  let release; const blocked = new Promise(resolve => { release = resolve; });
  f.lifecycle.start = async () => { f.calls.push('start'); await blocked; };
  const opening = openGameAiHostServices(f.options);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); assert.ok(!f.calls.includes('source-close'));
  release(); const host = await opening;
  assert.equal(host.status().state, 'closed');
  assert.deepEqual(f.calls.slice(-2), ['lease-close', 'source-close']);
});

test('the real source opens existing stores read-only and sees current host revocation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'raphael-host-composition-'));
  let game, chronicle, host;
  t.after(async () => { await host?.close(); chronicle?.close(); game?.close(); rmSync(root, { recursive: true, force: true }); });
  const gameDir = join(root, 'game'), chronicleDir = join(root, 'chronicle'); mkdirSync(gameDir); mkdirSync(chronicleDir);
  const localEnv = { RAPHAEL_GAME_DATA_DIR: gameDir, RAPHAEL_CHRONICLE_DATA_DIR: chronicleDir, RAPHAEL_CHRONICLE_ENABLED: '1', RAPHAEL_MEMBERSHIP_CAMPAIGNS: 'harbor' };
  game = new DatabaseSync(join(gameDir, 'game.sqlite'));
  game.exec("CREATE TABLE game_schema(version INTEGER); INSERT INTO game_schema VALUES(1); CREATE TABLE game_campaigns(id TEXT, revision INTEGER, body TEXT); INSERT INTO game_campaigns VALUES('harbor',1,'{}'); CREATE TABLE game_members(campaign TEXT,owner TEXT,role TEXT); INSERT INTO game_members VALUES('harbor','gm','host');");
  chronicle = new DatabaseSync(join(chronicleDir, 'chronicle.sqlite'));
  chronicle.exec('CREATE TABLE sessions(id TEXT, campaign TEXT, body TEXT)');
  chronicle.prepare('INSERT INTO sessions VALUES(?,?,?)').run('session1', 'harbor', JSON.stringify({ id: 'session1', campaign: 'harbor', host: 'gm', status: 'active' }));
  let list;
  host = await openGameAiHostServices({ env: localEnv, createControl: () => ({}), createLifecycle({ listScopes }) { list = listScopes; return { async start() {}, async close() {}, status: () => ({ state: 'running' }) }; } });
  assert.deepEqual(list(), [{ campaign: 'harbor', session: 'campaign' }, { campaign: 'harbor', session: 'session1' }]);
  game.prepare('DELETE FROM game_members WHERE owner=?').run('gm');
  assert.deepEqual(list(), [{ campaign: 'harbor', session: 'campaign' }]);
  assert.equal(game.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE type=?').get('table').n, 3);
});

test('the real opener never creates an absent campaign database', async t => {
  const root = mkdtempSync(join(tmpdir(), 'raphael-host-absent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let controls = 0;
  const host = await openGameAiHostServices({ env: { ...env, RAPHAEL_GAME_DATA_DIR: root }, createControl() { controls++; return {}; } });
  assert.equal(host.status().state, 'unavailable'); assert.equal(controls, 0);
  assert.equal(existsSync(join(root, 'game.sqlite')), false); await host.close();
});
