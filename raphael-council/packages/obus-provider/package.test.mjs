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
const classifiedFixture = String.raw`
import test from 'node:test';
import assert from 'node:assert/strict';
import { ObusTransport, createObusChronicleProvider } from '@operator/obus-chronicle-provider';

test('installed reference provider forwards the server template and retains verified free provenance', async () => {
  const requests = [], receipts = [], owner = '111111111111111111';
  const references = [{ ref: 'chronicle:session1:E1', revision: 3 }];
  const free = { destination: 'free', provider: 'DeepInfra', model: 'meta-llama/llama-3.3-70b-instruct', route_id: 'approved-pin',
    gateway: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', cost: 'zero',
    cost_basis: 'free-variant+zero-price-ceiling+response-usage', status: 'ready', attempt: 1 };
  const runtime = { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true, bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 30000,
    effectivePolicy: { enabled: true, mode: 'local-free', exportable: true, codex: false, tools: false, personalMemory: false, autoMemory: false } };
  const transport = new ObusTransport({ url: 'http://127.0.0.1:38175', serviceToken: 'a'.repeat(64), fetchImpl: async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:38175/api/game/')); assert.equal(options.redirect, 'error');
    if (url.endsWith('/capabilities')) return Response.json({ contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true,
      provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true });
    if (url.includes('/runtime?')) return Response.json(runtime);
    assert.ok(url.endsWith('/route')); requests.push(JSON.parse(options.body));
    return Response.json({ text: 'The synthetic beacon is blue.', routeId: 'fixture-route', model: free.model, trace: [free], sources: references });
  } });
  const provider = createObusChronicleProvider({ transport, campaigns: ['fixture'], authorizeCommand: async () => true,
    evidenceBridge: { async sync(input) { return { contract: 'raph-obus-game-evidence-v1', campaign: input.campaign, session: input.session,
      revision: 7, status: 'unchanged', sourceCount: 1, participantCount: 1 }; } }, onReceipt: async receipt => { receipts.push(receipt); } });
  const context = { campaign: 'fixture', session: 'session1', owner, sourceRevision: 7 };
  assert.equal(await provider.writeReferences('summary', references, context), 'The synthetic beacon is blue.');
  assert.equal(requests.length, 1); assert.equal(requests[0].promptTemplate, 'session-summary-v1'); assert.equal(requests[0].instructions, '');
  assert.deepEqual(requests[0].evidence, { contract: 'raph-obus-game-evidence-refs-v1', revision: 7, references });
  assert.equal(requests[0].policy.mode, 'local-free'); assert.equal(requests[0].policy.exportable, true); assert.equal(requests[0].policy.codex, false);
  assert.deepEqual(receipts[0].trace[0], free); assert.equal(receipts[0].sources[0].id, references[0].ref);
  await assert.rejects(provider.write('final', ['A local prior summary.'], context));
  assert.equal(requests[1].policy.mode, 'local'); assert.equal(requests[1].policy.exportable, false);
  assert.equal(Object.hasOwn(requests[1], 'promptTemplate'), false); assert.equal(receipts.length, 1);
});

test('installed refs-v2 transport preserves its selected baseline and rejects lost consent or unsupported contracts', async () => {
  const owner = '111111111111111111', references = [{ ref: 'chronicle:session1:E1', revision: 3 }];
  const evidence = { contract: 'raph-obus-game-evidence-refs-v2', revision: 7, selectionHash: 'b'.repeat(64), references };
  const context = { campaign: 'fixture', session: 'session1', owner, sourceRevision: 7 };
  for (const scenario of ['append', 'consent-withdrawn', 'missing-capability', 'wrong-baseline']) {
    const requests = [], receipts = [];
    let valid = true, synchronizedRevision = 7, checks = 0;
    const runtime = { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true, bootEpoch: '11111111-1111-4111-8111-111111111111',
      generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 30000,
      effectivePolicy: { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false } };
    const transport = new ObusTransport({ url: 'http://127.0.0.1:38175', serviceToken: 'a'.repeat(64), fetchImpl: async (url, options) => {
      assert.ok(url.startsWith('http://127.0.0.1:38175/api/game/')); assert.equal(options.redirect, 'error');
      if (url.endsWith('/capabilities')) return Response.json({ contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true,
        provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true,
        evidence_reference_contracts: scenario === 'missing-capability' ? ['raph-obus-game-evidence-refs-v1'] : [evidence.contract] });
      if (url.includes('/runtime?')) return Response.json(runtime);
      assert.ok(url.endsWith('/route')); requests.push(JSON.parse(options.body));
      if (scenario === 'consent-withdrawn') valid = false;
      return Response.json({ text: 'The selected synthetic beacon remains blue.', routeId: 'fixture-selection', model: 'fixture-local',
        trace: [{ destination: 'local', provider: 'ollama', model: 'fixture-local' }], sources: references,
        evidenceRevision: scenario === 'wrong-baseline' ? 8 : 7 });
    } });
    const check = () => { checks++; if (!valid) throw Object.assign(new Error('Selected consent changed.'), { code: 'EVIDENCE_CHANGED_DURING_SYNC' }); };
    // The installed provider accepts this private host capability; it never accepts caller-supplied transcript text.
    const bridge = { async sync() { throw new Error('refs-v2 must use the captured selection.'); }, captureSelection(input) {
      assert.equal(input.sourceRevision, 7); assert.deepEqual(input.references, references);
      return { evidence, references, check, async sync() { check(); return { contract: 'raph-obus-game-evidence-v1', campaign: 'fixture', session: 'session1',
        revision: ++synchronizedRevision, status: 'unchanged', sourceCount: synchronizedRevision, participantCount: 1 }; } };
    } };
    const provider = createObusChronicleProvider({ transport, campaigns: ['fixture'], authorizeCommand: async () => true, evidenceBridge: bridge,
      onReceipt: async receipt => { receipts.push(receipt); } });
    if (scenario === 'append') {
      assert.equal(await provider.writeReferences('summary', references, context), 'The selected synthetic beacon remains blue.');
      assert.ok(synchronizedRevision > evidence.revision); assert.ok(checks > 0); assert.equal(receipts.length, 1);
      assert.deepEqual(requests[0].evidence, evidence); assert.equal(requests[0].promptTemplate, 'session-summary-v1'); assert.equal(requests[0].instructions, '');
    } else {
      await assert.rejects(provider.writeReferences('summary', references, context), scenario);
      assert.equal(receipts.length, 0, scenario);
      assert.equal(requests.length, scenario === 'missing-capability' ? 0 : 1, scenario);
    }
  }
});
`;
const cli = (args, cwd = packageDir) => run(process.execPath, [npm, ...args], { cwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });

test('provider bundle contains the exact seven reference-aware sources and only Node built-ins', async () => {
  const audit = JSON.parse(await readFile(join(packageDir, 'dist/audit.json'), 'utf8'));
  assert.deepEqual(Object.keys(audit.sources).sort(), ['ai/evidence-selection.mjs', 'ai/evidence-upload.mjs', 'ai/host-control.mjs', 'ai/obus.mjs', 'chronicle/obus-evidence.mjs', 'chronicle/obus-provider.mjs', 'packages/obus-provider/index.mjs']);
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
  const lock = JSON.parse(await readFile(join(packageDir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, manifest.version); assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies ?? {}, manifest.dependencies ?? {});
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.equal(manifest.version, '0.1.1'); assert.equal(manifest.private, true); assert.deepEqual(manifest.engines, { node: '>=22.16.0' });
  assert.deepEqual(manifest.dependencies ?? {}, {}); assert.deepEqual(manifest.devDependencies, { esbuild: '0.27.3' }); assert.deepEqual(manifest.exports, { '.': './dist/index.mjs' });
});

test('provider tarball installs and executes actual exported transport outside the checkout', { timeout: 180000 }, async t => {
  const temporaryRoot = await realpath(tmpdir()), consumer = await mkdtemp(join(temporaryRoot, 'operator-obus-provider-consumer-'));
  t.after(async () => { const resolved = await realpath(consumer); assert.equal(dirname(resolved), temporaryRoot); assert.equal(basename(resolved).startsWith('operator-obus-provider-consumer-'), true); await rm(resolved, { recursive: true, force: true }); });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-obus-provider-consumer', version: '1.0.0', private: true, type: 'module' }) + '\n');
  let packed;
  if (process.env.OPERATOR_VERIFY_ARTIFACT === '1') {
    packed = JSON.parse(await readFile(join(packageDir, 'artifacts/manifest-0.1.1.json'), 'utf8'));
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
    chroniclePacked = JSON.parse(await readFile(join(artifacts, 'manifest-0.1.2.json'), 'utf8'));
    const archive = join(artifacts, chroniclePacked.filename); assert.equal(digest(await readFile(archive)), chroniclePacked.sha256);
    await copyFile(archive, join(consumer, chroniclePacked.filename));
  } else {
    const { stdout: chronicleOutput } = await cli(['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], join(appDir, 'packages/chronicle'));
    const chroniclePacking = JSON.parse(chronicleOutput); chroniclePacked = Array.isArray(chroniclePacking) ? chroniclePacking[0] : chroniclePacking['@operator/chronicle'];
  }
  assert.equal(chroniclePacked.version, '0.1.2');
  await cli(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', '--prefer-offline', join(consumer, packed.filename), join(consumer, chroniclePacked.filename)], consumer);
  await copyFile(join(packageDir, 'consumer-fixture.mjs'), join(consumer, 'fixture.mjs'));
  await writeFile(join(consumer, 'classified-fixture.mjs'), classifiedFixture);
  const { stdout, stderr } = await run(process.execPath, ['--test', '--test-reporter=spec', 'fixture.mjs', 'classified-fixture.mjs'], { cwd: consumer, timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_TEST_CONTEXT: undefined } }).catch(error => { throw new Error(`Isolated fixture failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`); });
  assert.match(stdout, /tests 12\b/); assert.match(stdout, /pass 12\b/); assert.doesNotMatch(stdout, /fail [1-9]/); assert.doesNotMatch(stderr, /MODULE_NOT_FOUND|Cannot find package/);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/@operator/obus-chronicle-provider/package.json'), 'utf8'));
  assert.deepEqual(installed.dependencies ?? {}, {});
  console.log('Isolated installed provider: 12 actual-transport fixtures passed, including refs-v2 append continuity, consent withdrawal, and co-installed chronicle 0.1.2; no live endpoint was used.');
});
