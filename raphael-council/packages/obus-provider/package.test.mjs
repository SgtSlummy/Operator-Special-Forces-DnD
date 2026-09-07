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

const run = promisify(execFile), packageDir = dirname(fileURLToPath(import.meta.url)), appDir = resolve(packageDir, '../..');
const digest = value => createHash('sha256').update(value).digest('hex'), npm = process.env.npm_execpath;
if (!npm) throw new Error('Run artifact tests with npm test.');
const expectedPayload = ['README.md', 'dist/index.mjs', 'package.json'];
const cli = (args, cwd = packageDir) => run(process.execPath, [npm, ...args], { cwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });

test('provider bundle contains exactly three allowed sources and only Node built-ins', async () => {
  const audit = JSON.parse(await readFile(join(packageDir, 'dist/audit.json'), 'utf8'));
  assert.deepEqual(Object.keys(audit.sources).sort(), ['ai/obus.mjs', 'chronicle/obus-provider.mjs', 'packages/obus-provider/index.mjs']);
  assert.equal(audit.esbuild, '0.27.3'); assert.equal(audit.node, '>=22.16.0'); assert.deepEqual(audit.dependencies, {});
  assert.deepEqual(audit.exports, ['ObusTransport', 'createObusChronicleProvider']); assert.ok(audit.externalImports.every(isBuiltin));
  assert.equal(digest(await readFile(join(packageDir, 'dist/index.mjs'))), audit.sha256);
  for (const [path, hash] of Object.entries(audit.sources)) assert.equal(digest(await readFile(join(appDir, path))), hash, `Stale bundle input ${path}`);
});

test('provider payload has no runtime dependencies, secrets, host signer or sibling imports', async () => {
  const { stdout } = await cli(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const packing = JSON.parse(stdout), packed = Array.isArray(packing) ? packing[0] : packing['@operator/obus-chronicle-provider'];
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedPayload);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0'); assert.equal(manifest.private, true); assert.deepEqual(manifest.engines, { node: '>=22.16.0' });
  assert.deepEqual(manifest.dependencies ?? {}, {}); assert.deepEqual(manifest.devDependencies, { esbuild: '0.27.3' }); assert.deepEqual(manifest.exports, { '.': './dist/index.mjs' });
});

test('provider tarball installs and executes actual exported transport outside the checkout', { timeout: 180000 }, async t => {
  const temporaryRoot = await realpath(tmpdir()), consumer = await mkdtemp(join(temporaryRoot, 'operator-obus-provider-consumer-'));
  t.after(async () => { const resolved = await realpath(consumer); assert.equal(dirname(resolved), temporaryRoot); assert.equal(basename(resolved).startsWith('operator-obus-provider-consumer-'), true); await rm(resolved, { recursive: true, force: true }); });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-obus-provider-consumer', version: '1.0.0', private: true, type: 'module' }) + '\n');
  let packed;
  if (process.env.OPERATOR_VERIFY_ARTIFACT === '1') {
    packed = JSON.parse(await readFile(join(packageDir, 'artifacts/manifest-0.1.0.json'), 'utf8'));
    const archive = join(packageDir, 'artifacts', packed.filename); assert.equal(digest(await readFile(archive)), packed.sha256);
    await copyFile(archive, join(consumer, packed.filename));
  } else {
    const { stdout: packedOutput } = await cli(['pack', '--json', '--ignore-scripts', '--pack-destination', consumer]);
    const packing = JSON.parse(packedOutput); packed = Array.isArray(packing) ? packing[0] : packing['@operator/obus-chronicle-provider'];
  }
  assert.deepEqual(packed.files.map(file => file.path).sort(), expectedPayload);
  let chroniclePacked;
  if (process.env.OPERATOR_VERIFY_ARTIFACT === '1') {
    const artifacts = join(appDir, 'packages/chronicle/artifacts');
    chroniclePacked = JSON.parse(await readFile(join(artifacts, 'manifest-0.1.1.json'), 'utf8'));
    const archive = join(artifacts, chroniclePacked.filename); assert.equal(digest(await readFile(archive)), chroniclePacked.sha256);
    await copyFile(archive, join(consumer, chroniclePacked.filename));
  } else {
    const { stdout: chronicleOutput } = await cli(['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], join(appDir, 'packages/chronicle'));
    const chroniclePacking = JSON.parse(chronicleOutput); chroniclePacked = Array.isArray(chroniclePacking) ? chroniclePacking[0] : chroniclePacking['@operator/chronicle'];
  }
  assert.equal(chroniclePacked.version, '0.1.1');
  await cli(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', '--prefer-offline', join(consumer, packed.filename), join(consumer, chroniclePacked.filename)], consumer);
  await copyFile(join(packageDir, 'consumer-fixture.mjs'), join(consumer, 'fixture.mjs'));
  const { stdout, stderr } = await run(process.execPath, ['--test', '--test-reporter=spec', 'fixture.mjs'], { cwd: consumer, timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_TEST_CONTEXT: undefined } }).catch(error => { throw new Error(`Isolated fixture failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); });
  assert.match(stdout, /tests 10\b/); assert.match(stdout, /pass 10\b/); assert.doesNotMatch(stdout, /fail [1-9]/); assert.doesNotMatch(stderr, /MODULE_NOT_FOUND|Cannot find package/);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/@operator/obus-chronicle-provider/package.json'), 'utf8'));
  assert.deepEqual(installed.dependencies ?? {}, {});
  console.log('Isolated installed provider: 10 actual-transport fixtures passed, including the co-installed chronicle 0.1.1; no live endpoint was used.');
});
