import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const artifact = join(root, 'artifacts', 'operator-membership-client-0.1.1.tgz');
const oldArtifact = join(root, 'artifacts', 'operator-membership-client-0.1.0.tgz');
const oldSha = 'c66521b47fd1fb36c284d0a131205376dda16b31d93887e8fd96e03416ed7791';
const sourceSha = '27342136945aa2e41c0fcfda0ff35eadc8afcb7e69a3ee00aec4d29aa58899d9';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('previously handed-off 0.1.0 archive stays byte-identical', async () => {
  assert.equal(sha256(await readFile(oldArtifact)), oldSha);
});

test('0.1.1 contains the reviewed bridge client without runtime dependencies', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@operator/membership-client');
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.engines.node, '>=22.16.0');
  assert.deepEqual(manifest.exports, { '.': './dist/client.mjs' });
  assert.deepEqual(manifest.files, ['dist/client.mjs', 'README.md']);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
  assert.equal(sha256(await readFile(join(root, 'dist', 'client.mjs'))), sourceSha);
  assert.ok((await stat(artifact)).size > 0);
});

const probe = String.raw`
import assert from 'node:assert/strict';
import * as api from '@operator/membership-client';
assert.deepEqual(Object.keys(api), ['createMembershipClient']);
const owner = '12345678901234567';
const campaign = 'camp-1';
let savedRole = 'player';
let invalidResponse = false;
let unavailable = false;
const calls = [];
const access = api.createMembershipClient({
  url: 'http://127.0.0.1:38176',
  token: 'isolated-test-credential-32-characters-minimum',
  fetchImpl: async (url, options) => {
    if (unavailable) throw Error('private upstream detail');
    const body = JSON.parse(options.body);
    calls.push({ path: new URL(url).pathname, body, method: options.method, redirect: options.redirect });
    const participant = new URL(url).pathname === '/v1/authorize-participant';
    const allowed = participant ? ['host', 'player'].includes(savedRole) : savedRole === 'host';
    return new Response(JSON.stringify(invalidResponse ? { allowed: true, extra: 'private' } : { allowed }), { headers: { 'content-type': 'application/json' } });
  },
});
assert.deepEqual(Object.keys(access).sort(), ['authorizeCommand', 'authorizeParticipant', 'status']);
assert.equal(Object.isFrozen(access), true);
assert.equal(calls.length, 0);
assert.equal(await access.authorizeCommand({ campaign, owner, role: 'host' }), false);
assert.equal(calls.at(-1).path, '/v1/authorize-command');
assert.equal(await access.authorizeParticipant({ campaign, owner, role: 'host' }), true);
assert.equal(calls.at(-1).path, '/v1/authorize-participant');
savedRole = undefined;
assert.equal(await access.authorizeParticipant({ campaign, owner, role: 'host' }), false);
savedRole = 'host';
assert.equal(await access.authorizeCommand({ campaign, owner, role: 'player' }), true);
assert.equal(await access.authorizeParticipant({ campaign, owner, role: 'player' }), true);
assert.equal(calls.length, 5);
for (const call of calls) {
  assert.deepEqual(call.body, { campaign, owner });
  assert.equal(call.method, 'POST');
  assert.ok(['error', 'manual'].includes(call.redirect));
}
invalidResponse = true;
assert.equal(await access.authorizeParticipant({ campaign, owner }), false);
const beforeInvalidScope = calls.length;
assert.equal(await access.authorizeParticipant({ campaign: '../secret', owner }), false);
assert.equal(calls.length, beforeInvalidScope);
unavailable = true;
assert.equal(await access.authorizeParticipant({ campaign, owner }), false);
assert.equal(await access.authorizeCommand({ campaign, owner }), false);
console.log(JSON.stringify({ exports: Object.keys(api), methods: Object.keys(access).sort(), freshAuthorizationRequests: calls.length, participantSeparated: true, offlineInstall: true }));
`;

test('offline tarball install outside the checkout exposes fresh, separate authorization methods', async t => {
  const tempRoot = await realpath(tmpdir());
  const fixture = await mkdtemp(join(tempRoot, 'operator-membership-011-'));
  const resolvedFixture = await realpath(fixture);
  const containment = relative(tempRoot, resolvedFixture);
  assert.ok(containment && !containment.startsWith('..') && !isAbsolute(containment));
  assert.ok(!resolvedFixture.toLowerCase().startsWith(resolve(root).toLowerCase()));
  t.after(async () => {
    // Only delete the exact temporary directory created and resolved by this test.
    assert.equal(await realpath(fixture), resolvedFixture);
    const currentContainment = relative(tempRoot, resolvedFixture);
    assert.ok(currentContainment && !currentContainment.startsWith('..') && !isAbsolute(currentContainment));
    await rm(resolvedFixture, { recursive: true, force: true });
  });
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const output = execFileSync(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', artifact], {
    cwd: fixture, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, npm_config_cache: join(fixture, 'npm-cache'), npm_config_update_notifier: 'false' },
  });
  assert.match(output, /added 1 package/);
  const installedRoot = join(fixture, 'node_modules', '@operator', 'membership-client');
  const installedManifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installedManifest.version, '0.1.1');
  assert.deepEqual(installedManifest.dependencies ?? {}, {});
  assert.equal(sha256(await readFile(join(installedRoot, 'dist', 'client.mjs'))), sourceSha);
  const probePath = join(fixture, 'probe.mjs');
  await writeFile(probePath, probe);
  const result = JSON.parse(execFileSync(process.execPath, [probePath], { cwd: fixture, encoding: 'utf8', timeout: 10000, windowsHide: true }));
  assert.deepEqual(result.exports, ['createMembershipClient']);
  assert.deepEqual(result.methods, ['authorizeCommand', 'authorizeParticipant', 'status']);
  assert.equal(result.freshAuthorizationRequests, 6);
  assert.equal(result.participantSeparated, true);
  t.diagnostic(JSON.stringify({ artifact, bytes: (await stat(artifact)).size, sha256: sha256(await readFile(artifact)), ...result }));
});
