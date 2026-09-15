import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createObusHostControl, prepareEvidenceDocument, prepareEvidenceSnapshot } from './host-control.mjs';
import { planEvidenceUpload, canonicalEvidence, validateUploadStatus, UPLOAD_CONTRACT, UPLOAD_ROOT, UPLOAD_LIMIT, PAGE_LIMIT } from './evidence-upload.mjs';

function document(count = 2050) {
  return { contract: 'raph-obus-game-evidence-v1', campaign: 'fixture', session: 'session', revision: 2,
    runtime: { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 1 },
    participants: [{ user: 'player', capture: true, external: true, captureEpoch: 1, externalEpoch: 1 }],
    sources: Array.from({ length: count }, (_, i) => ({ ref: `entry:${String(i).padStart(5, '0')}`, revision: 1, audience: 'party', owner: '', text: `Harbor fact ${i}.`, provenance: `chronicle:${i}`, deleted: false,
      contributors: [{ user: 'player', captureEpoch: 1, externalEpoch: 1, exportableAtCapture: true }], derivesFrom: [] })) };
}
function receipt(doc) { return { contract: doc.contract, campaign: doc.campaign, session: doc.session, revision: doc.revision, status: 'saved', sourceCount: doc.sources.length, participantCount: doc.participants.length }; }
function ack(plan, received = [], status = 'pending', doc = null) { return { contract: UPLOAD_CONTRACT, campaign: plan.begin.campaign, session: plan.begin.session, uploadId: plan.begin.uploadId, revision: plan.begin.revision, status, pageCount: plan.pages.length, sourceCount: plan.begin.sourceCount, participantCount: plan.begin.participants.length, received, ...(status === 'complete' ? { receipt: receipt(doc) } : {}) }; }
function json(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function fixture(doc = document(), initiallyReceived = []) {
  const state = { doc, plan: planEvidenceUpload(prepareEvidenceDocument(doc)), received: new Set(initiallyReceived), commands: [], complete: false, onCommand: null, nonces: [] };
  let nonce = 0;
  state.client = createObusHostControl({ url: 'http://127.0.0.1:8765', serviceToken: 'a'.repeat(64), hostControlToken: 'b'.repeat(64),
    now: () => 1770000000123, nonce: () => (++nonce).toString(16).padStart(64, '0'), fetchImpl: async (url, options) => {
      assert.equal(url, `http://127.0.0.1:8765${UPLOAD_ROOT}`);
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.ok(Buffer.byteLength(options.body) <= UPLOAD_LIMIT);
      const headers = options.headers, requestNonce = headers['X-Obus-Game-Host-Nonce']; state.nonces.push(requestNonce);
      const payload = ['POST', UPLOAD_ROOT, headers['X-Obus-Game-Host-Timestamp'], requestNonce, createHash('sha256').update(options.body).digest('hex')].join('\n');
      assert.equal(headers['X-Obus-Game-Host-Signature'], createHmac('sha256', Buffer.from('b'.repeat(64), 'hex')).update(payload).digest('hex'));
      const command = JSON.parse(options.body); state.commands.push(command);
      assert.equal(command.contract, UPLOAD_CONTRACT);
      assert.deepEqual(command.runtime, state.plan.begin.runtime);
      if (state.onCommand) { const custom = await state.onCommand(command); if (custom) return custom; }
      if (command.operation === 'page') state.received.add(command.index);
      if (command.operation === 'commit') { assert.equal(state.received.size, state.plan.pages.length); state.complete = true; }
      return json(ack(state.plan, state.complete ? [] : [...state.received].sort((a, b) => a - b), state.complete ? 'complete' : 'pending', doc));
    } });
  return state;
}

test('large document uses bounded pages and signed commands then one exact receipt', async () => {
  const f = fixture();
  assert.throws(() => prepareEvidenceSnapshot(f.doc));
  const result = await f.client.syncEvidence(f.doc);
  assert.deepEqual(result, receipt(f.doc));
  assert.equal(f.commands.length, f.plan.pages.length + 2);
  assert.equal(new Set(f.nonces).size, f.nonces.length);
  assert.equal(f.commands[0].operation, 'begin'); assert.equal(f.commands.at(-1).operation, 'commit');
  assert.equal(f.commands.filter(x => x.operation === 'page').flatMap(x => x.sources).length, 2050);
});

test('page sizing uses UTF-8 bytes and all command overhead, not character count', async () => {
  const doc = document(40); doc.sources.forEach(source => { source.text = '海'.repeat(12000); });
  const f = fixture(doc);
  for (const descriptor of f.plan.begin.pages) assert.ok(descriptor.bytes <= PAGE_LIMIT);
  assert.ok(f.plan.pages.length > 1);
  await f.client.syncEvidence(doc);
  const small = document(0), plan = planEvidenceUpload(prepareEvidenceDocument(small));
  assert.deepEqual(plan.begin.pages, [{ bytes: 2, count: 0, sha256: createHash('sha256').update('[]').digest('hex') }]);
});

test('reordering participants, source IDs and lineage does not change the upload identity', () => {
  const doc = document(3), second = structuredClone(doc);
  doc.sources[0].ref = 'ref:' + String.fromCodePoint(0x10000);
  doc.sources[1].ref = 'ref:' + String.fromCodePoint(0xE000);
  doc.participants.push({ ...doc.participants[0], user: 'zebra' });
  doc.sources[0].contributors.push({ ...doc.sources[0].contributors[0], user: 'zebra' });
  Object.assign(second, structuredClone(doc)); second.participants.reverse(); second.sources.reverse(); second.sources.at(-1).contributors.reverse();
  const a = planEvidenceUpload(prepareEvidenceDocument(doc)), b = planEvidenceUpload(prepareEvidenceDocument(second));
  assert.equal(a.begin.uploadId, b.begin.uploadId);
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a.pages[0].sources[0].contributors));
});

test('invalid Unicode, duplicate lineage and non-JSON data fail before transport', async () => {
  for (const change of [d => { d.sources[0].text = String.fromCharCode(0xD800); }, d => { d.sources[0].contributors.push({ ...d.sources[0].contributors[0] }); }, d => { d.sources[0].contributors = [null]; }, d => { Object.defineProperty(d.sources[0], 'text', { get() { assert.fail('getter ran'); } }); }]) {
    const doc = document(1); change(doc);
    assert.throws(() => prepareEvidenceDocument(doc), { code: 'INVALID_HOST_CONTROL_INPUT' });
  }
});

test('resume skips acknowledged pages and a completed replay sends no page text', async () => {
  const f = fixture(document(), [0, 2]); await f.client.syncEvidence(f.doc);
  assert.ok(!f.commands.some(x => x.operation === 'page' && [0, 2].includes(x.index)));
  f.commands.length = 0;
  const result = await f.client.syncEvidence(f.doc);
  assert.deepEqual(result, receipt(f.doc)); assert.deepEqual(f.commands.map(x => x.operation), ['begin']);
});

test('interrupted transfer is not retried automatically and resumes on the next worker attempt', async () => {
  const f = fixture();
  f.onCommand = command => { if (command.operation === 'page' && command.index === 1) throw new Error('fixture outage'); };
  await assert.rejects(f.client.syncEvidence(f.doc), { code: 'OBUS_HOST_CONTROL_UNAVAILABLE' });
  assert.deepEqual(f.commands.map(x => [x.operation, x.index]), [['begin', undefined], ['page', 0], ['page', 1]]);
  f.onCommand = null; f.commands.length = 0;
  await f.client.syncEvidence(f.doc);
  assert.ok(!f.commands.some(x => x.operation === 'page' && x.index === 0));
});

test('capacity deferral sends no pages and exposes only a bounded retryable error', async () => {
  const f = fixture(); f.onCommand = () => json(ack(f.plan, [], 'deferred'));
  await assert.rejects(f.client.syncEvidence(f.doc), { code: 'OBUS_EVIDENCE_DEFERRED', status: 503 });
  assert.equal(f.commands.length, 1);
});

test('scope, revision, page acknowledgments and final receipts must all match', async t => {
  const mutations = { campaign: x => { x.campaign = 'other'; }, revision: x => { x.revision++; }, identity: x => { x.uploadId = '0'.repeat(64); }, duplicates: x => { x.received = [0, 0]; }, range: x => { x.received = [512]; }, extra: x => { x.secret = 'fixture'; } };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture(); f.onCommand = () => { const value = ack(f.plan); mutate(value); return json(value); };
    await assert.rejects(f.client.syncEvidence(f.doc), { code: 'INVALID_OBUS_RUNTIME_RESPONSE' }); assert.equal(f.commands.length, 1);
  });
  const f = fixture(); f.onCommand = () => { const value = ack(f.plan, [], 'complete', f.doc); value.receipt.sourceCount--; return json(value); };
  await assert.rejects(f.client.syncEvidence(f.doc), { code: 'INVALID_OBUS_RUNTIME_RESPONSE' });
});

test('missing or regressing page acknowledgments cannot reach commit', async () => {
  const f = fixture();
  f.onCommand = command => command.operation === 'page' ? json(ack(f.plan, [])) : null;
  await assert.rejects(f.client.syncEvidence(f.doc), { code: 'INVALID_OBUS_RUNTIME_RESPONSE' });
  assert.equal(f.commands.at(-1).operation, 'page'); assert.equal(f.complete, false);
});

test('current-store guard stops a transfer before sending another page or commit', async () => {
  for (const point of ['begin', 'page']) {
    const f = fixture(); let changed = false;
    f.onCommand = command => { if (command.operation === point) changed = true; };
    await assert.rejects(f.client.syncEvidence(f.doc, () => { if (changed) throw Object.assign(new Error('changed'), { code: 'EVIDENCE_CHANGED_DURING_SYNC' }); }), { code: 'EVIDENCE_CHANGED_DURING_SYNC' });
    assert.equal(f.commands.at(-1).operation, point); assert.equal(f.complete, false);
  }
});

test('caller mutation after begin cannot change signed pages or manifest', async () => {
  const f = fixture(), original = structuredClone(f.doc);
  f.onCommand = command => { if (command.operation === 'begin') { f.doc.sources[0].text = 'tamper'; f.doc.participants[0].external = false; } };
  await f.client.syncEvidence(f.doc);
  assert.equal(f.commands.find(x => x.operation === 'page').sources[0].text, original.sources[0].text);
  assert.equal(f.commands[0].participants[0].external, true);
});

test('Python promotes the exact JavaScript manifest and verifies Unicode and replay', { skip: !process.env.OBUS_EVIDENCE_TEST_ROOT }, () => {
  const root = process.env.OBUS_EVIDENCE_TEST_ROOT, doc = document();
  doc.sources[0].text = 'Harbor ' + String.fromCodePoint(0, 1, 9, 10, 13, 27, 127, 0x1F30A, 0x6D77);
  doc.sources[0].ref = 'unicode:' + String.fromCodePoint(0x10000); doc.sources[1].ref = 'unicode:' + String.fromCodePoint(0xE000);
  const plan = planEvidenceUpload(prepareEvidenceDocument(doc));
  const program = `import json,sys,sqlite3,tempfile\nfrom pathlib import Path\nfrom backend import game_evidence as e, game_evidence_uploads as u\ncommands=json.loads(sys.stdin.buffer.read().decode('utf-8'))\nwith tempfile.TemporaryDirectory(prefix='evidence-wire-') as folder:\n root=Path(folder).resolve()\n assert root.parent==Path(tempfile.gettempdir()).resolve() and root.name.startswith('evidence-wire-')\n path=root/'game.sqlite'\n u.prepare_store(path)\n db=sqlite3.connect(path)\n try:\n  e.initialize_schema(db); db.commit()\n  results=[]\n  for command in commands:\n   with db:\n    db.execute('BEGIN IMMEDIATE')\n    results.append(u.apply_command(db,command,10000000))\n  print(json.dumps(results))\n finally:\n  db.close()\n`;
  const result = spawnSync(join(root, '.venv', 'Scripts', 'python.exe'), ['-c', program], { cwd: root, input: JSON.stringify([plan.begin, ...plan.pages, plan.commit, plan.commit]), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const responses = JSON.parse(result.stdout);
  responses.forEach(response => validateUploadStatus(response, plan));
  assert.deepEqual(responses.at(-2).receipt, receipt(doc));
  assert.equal(responses.at(-1).receipt.status, 'unchanged');
  assert.equal(responses.at(-1).receipt.sourceCount, 2050);
});
