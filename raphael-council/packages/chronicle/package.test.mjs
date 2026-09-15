import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';

const run = promisify(execFile);
const packageDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(packageDir, '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run artifact tests with npm test.');
const expectedPayload = ['README.md', 'dist/index.mjs', 'package.json'];
const cli = (args, cwd = packageDir) => run(process.execPath, [npm, ...args], { cwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });

test('bundle audit has only the explicit core source set, Node built-ins and pinned canvas', async () => {
  const audit = JSON.parse(await readFile(join(packageDir, 'dist/build-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(audit.sources).sort(), [
    'ai/evidence-selection.mjs', 'ai/evidence-upload.mjs', 'ai/host-control.mjs', 'chronicle/commands.mjs', 'chronicle/dispatch.mjs', 'chronicle/music.mjs',
    'chronicle/obus-evidence.mjs', 'chronicle/obus-provider.mjs', 'chronicle/report.mjs', 'chronicle/service.mjs',
    'chronicle/store.mjs', 'chronicle/voice-receiver.mjs', 'discord/chronicle-adapter.mjs', 'discord/chronicle-core.mjs',
    'packages/chronicle/davy-host.mjs', 'auth/discord-policy.mjs', 'packages/chronicle/index.mjs',
  ].sort());
  assert.equal(audit.esbuild, '0.27.3');
  assert.equal(audit.node, '>=22.16.0');
  assert.deepEqual(audit.dependencies, { '@napi-rs/canvas': '1.0.8', '@discordjs/voice': '0.19.2', 'prism-media': '1.3.5' });
  assert.equal(audit.externals.includes('@napi-rs/canvas'), true);
  assert.equal(audit.externals.every(path => Object.hasOwn(audit.dependencies, path) || isBuiltin(path)), true);
  assert.equal(digest(await readFile(join(packageDir, 'dist/index.mjs'))), audit.sha256);
  for (const [path, hash] of Object.entries(audit.sources)) assert.equal(digest(await readFile(join(appDir, path))), hash, `Bundle is stale for ${path}`);
});

test('tarball payload includes only its manifest, README and portable ESM bundle', async () => {
  const { stdout } = await cli(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const packing = JSON.parse(stdout);
  const packed = Array.isArray(packing) ? packing[0] : packing['@operator/chronicle'];
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedPayload);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(packageDir, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.2');
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  for (const [name, version] of Object.entries(manifest.dependencies)) assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `Missing pinned dependency ${name}`);
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.engines, { node: '>=22.16.0' });
  assert.deepEqual(manifest.dependencies, { '@napi-rs/canvas': '1.0.8', '@discordjs/voice': '0.19.2', 'prism-media': '1.3.5' });
  assert.deepEqual(manifest.devDependencies, { esbuild: '0.27.3' });
  assert.deepEqual(manifest.exports, { '.': './dist/index.mjs' });
});

test('packed artifact installs and runs outside the Operator checkout', { timeout: 180000 }, async t => {
  const temporaryRoot = await realpath(tmpdir());
  const consumer = await mkdtemp(join(temporaryRoot, 'operator-chronicle-consumer-'));
  t.after(async () => {
    const resolved = await realpath(consumer);
    assert.equal(dirname(resolved), temporaryRoot);
    assert.equal(basename(resolved).startsWith('operator-chronicle-consumer-'), true);
    await rm(resolved, { recursive: true, force: true });
  });
  await writeFile(join(consumer, 'package.json'), `${JSON.stringify({ name: 'isolated-chronicle-consumer', version: '1.0.0', private: true, type: 'module' })}
`);
  let packed;
  if (process.env.OPERATOR_VERIFY_ARTIFACT === '1') {
    packed = JSON.parse(await readFile(join(packageDir, 'artifacts/manifest-0.1.2.json'), 'utf8'));
    const archive = join(packageDir, 'artifacts', packed.filename);
    assert.equal(digest(await readFile(archive)), packed.sha256);
    await copyFile(archive, join(consumer, packed.filename));
  } else {
    const { stdout: packedOutput } = await cli(['pack', '--json', '--ignore-scripts', '--pack-destination', consumer]);
    const packing = JSON.parse(packedOutput); packed = Array.isArray(packing) ? packing[0] : packing['@operator/chronicle'];
  }
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedPayload);
  await cli(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', '--prefer-offline', join(consumer, packed.filename)], consumer);
  await copyFile(join(packageDir, 'consumer-fixture.mjs'), join(consumer, 'fixture.mjs'));
  const { stdout, stderr } = await run(process.execPath, ['--test', '--test-reporter=spec', 'fixture.mjs'], {
    cwd: consumer, timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, NODE_PATH: '', NODE_TEST_CONTEXT: undefined },
  });
  assert.match(stdout, /tests 11\b/);
  assert.match(stdout, /pass 11\b/);
  assert.doesNotMatch(stdout, /fail [1-9]/);
  assert.doesNotMatch(stderr, /MODULE_NOT_FOUND|Cannot find package/);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/@operator/chronicle/package.json'), 'utf8'));
  assert.deepEqual(installed.dependencies, { '@napi-rs/canvas': '1.0.8', '@discordjs/voice': '0.19.2', 'prism-media': '1.3.5' });
  console.log('Isolated installed artifact: 11 runtime fixtures passed with native canvas resolved from consumer dependencies.');
});
