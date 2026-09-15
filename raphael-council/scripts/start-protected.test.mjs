import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { launchProtected, protectedLaunchConfig } from './start-protected.mjs';

async function fixture(t, source = 'process.exit(0)') {
  const projectRoot = await mkdtemp(join(tmpdir(), 'Raphael launcher with spaces '));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, 'node_modules/vinext/dist'), { recursive: true });
  await writeFile(join(projectRoot, 'node_modules/vinext/dist/cli.js'), source);
  const protectedFile = join(projectRoot, 'protected.env');
  await writeFile(protectedFile, 'DISCORD_TOKEN=fixture\nDISCORD_APPLICATION_ID=123\nDISCORD_CLIENT_SECRET=fixture\nDISCORD_TEST_GUILD_ID=456\nRAPHAEL_PLAYER_ROLE_ID=789\nORDER=protected\n');
  await writeFile(join(projectRoot, '.env.local'), 'ORDER=local\nLOCAL_ONLY=present\n');
  return { projectRoot, inheritedEnv: { RAPHAEL_DAVY_ENV_FILE: protectedFile, ORDER: 'inherited' } };
}

test('import is inert; config preserves precedence, aliases and defaults', async t => {
  const options = await fixture(t);
  const { env, cli } = protectedLaunchConfig(options);
  assert.equal(env.ORDER, 'protected');
  assert.equal(env.LOCAL_ONLY, 'present');
  assert.equal(env.DISCORD_CLIENT_ID, '123');
  assert.equal(env.RAPHAEL_GUILD_ID, '456');
  assert.equal(env.RAPHAEL_CAMPAIGN_ID, 'greyharbor');
  assert.ok(cli.endsWith(join('vinext', 'dist', 'cli.js')));
});

test('real Node child in space-containing path receives literal arguments and nonzero exit', async t => {
  const options = await fixture(t, 'console.log(JSON.stringify(process.argv.slice(2)));process.exit(7);');
  const lifecycle = new EventEmitter();
  const { child, completion } = launchProtected({ ...options, lifecycle, stdio: ['ignore', 'pipe', 'pipe'], args: ['--hostname', 'a b', '&literal'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  assert.equal((await completion).exitCode, 7);
  assert.deepEqual(JSON.parse(stdout), ['start', '--hostname', 'a b', '&literal']);
  assert.equal(lifecycle.exitCode, 7);
  assert.equal(lifecycle.listenerCount('SIGINT'), 0);
  assert.equal(lifecycle.listenerCount('SIGTERM'), 0);
});

test('missing protected file, required values and CLI reject before spawning', async t => {
  const options = await fixture(t);
  assert.throws(() => protectedLaunchConfig({ ...options, inheritedEnv: { RAPHAEL_DAVY_ENV_FILE: join(options.projectRoot, 'missing') } }), /environment was not found/);
  await rm(join(options.projectRoot, 'node_modules/vinext/dist/cli.js'));
  assert.throws(() => protectedLaunchConfig(options), /launcher is missing/);
  await writeFile(options.inheritedEnv.RAPHAEL_DAVY_ENV_FILE, 'DISCORD_TOKEN=fixture\n');
  assert.throws(() => protectedLaunchConfig(options), /configuration is incomplete/);
});

for (const [signal, expected] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`forwards ${signal}, disables shell, and cleans lifecycle listeners`, async t => {
    const options = await fixture(t);
    const lifecycle = new EventEmitter(), child = new EventEmitter();
    const calls = [];
    child.kill = received => { calls.push(received); child.emit('exit', null, received); return true; };
    const { completion } = launchProtected({ ...options, lifecycle, spawnImpl(command, args, config) {
      assert.equal(command, process.execPath);
      assert.equal(config.shell, false);
      assert.equal(config.windowsHide, true);
      assert.equal(args[1], 'start');
      return child;
    } });
    lifecycle.emit(signal);
    assert.equal((await completion).exitCode, expected);
    assert.deepEqual(calls, [signal]);
    assert.equal(lifecycle.listenerCount('SIGINT'), 0);
    assert.equal(lifecycle.listenerCount('SIGTERM'), 0);
    assert.equal(child.listenerCount('exit'), 0);
  });
}

test('spawn error resolves failure without exposing details and removes signal listeners', async t => {
  const options = await fixture(t), lifecycle = new EventEmitter(), child = new EventEmitter();
  const { completion } = launchProtected({ ...options, lifecycle, spawnImpl: () => child });
  child.emit('error', new Error('sensitive fixture detail'));
  assert.deepEqual(await completion, { exitCode: 1, signal: null, failed: true });
  assert.equal(lifecycle.listenerCount('SIGINT'), 0);
  assert.equal(lifecycle.listenerCount('SIGTERM'), 0);
});
