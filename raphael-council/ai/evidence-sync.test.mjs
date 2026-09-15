import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createObusHostControl, prepareEvidenceSnapshot, EVIDENCE_CONTRACT, EVIDENCE_LIMIT } from './host-control.mjs';

const BOOT = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222';
const NONCE = 'c'.repeat(64), HOST_KEY = 'b'.repeat(64), SERVICE_KEY = 'a'.repeat(64);
const PATH = '/api/game/evidence/snapshot';
function evidence() {
  return {
    contract: EVIDENCE_CONTRACT, campaign: 'harbor', session: 'session1', revision: 3,
    runtime: { contract: 'raph-obus-game-runtime-v1', bootEpoch: BOOT, generation: GENERATION, sessionPolicyRevision: 2 },
    participants: [{ user: 'alice', capture: true, external: true, captureEpoch: 1, externalEpoch: 2 }],
    sources: [{ ref: 'chronicle:session1:E1', revision: 1, audience: 'party', owner: '', text: 'The beacon is blue. Café 🌊', provenance: 'chronicle:session1:typed:E1', deleted: false,
      contributors: [{ user: 'alice', captureEpoch: 1, externalEpoch: 2, exportableAtCapture: true }], derivesFrom: [] }],
  };
}
function receipt(input) {
  return { contract: EVIDENCE_CONTRACT, campaign: input.campaign, session: input.session, revision: input.revision, status: 'saved', sourceCount: input.sources.length, participantCount: input.participants.length };
}
function json(value, options = {}) { return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' }, ...options }); }
function client(fetchImpl) {
  return createObusHostControl({ url: 'http://127.0.0.1:8765', serviceToken: SERVICE_KEY, hostControlToken: HOST_KEY, fetchImpl, now: () => 1770000000123, nonce: () => NONCE });
}
function canonical(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('evidence sync signs the exact complete body and evidence path with the host HMAC', async () => {
  const input = evidence();
  let calls = 0;
  const control = client(async (url, options) => {
    calls++;
    assert.equal(url, `http://127.0.0.1:8765${PATH}`);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.body, canonical(input));
    assert.equal(JSON.parse(options.body).contract, EVIDENCE_CONTRACT);
    const digest = createHash('sha256').update(options.body, 'utf8').digest('hex');
    const signed = ['POST', PATH, '1770000000', NONCE, digest].join('\n');
    const signature = createHmac('sha256', Buffer.from(HOST_KEY, 'hex')).update(signed, 'utf8').digest('hex');
    assert.equal(options.headers['X-Obus-Game-Host-Signature'], signature);
    assert.equal(options.headers['X-Obus-Game-Host-Timestamp'], '1770000000');
    assert.equal(options.headers['X-Obus-Game-Host-Nonce'], NONCE);
    assert.equal(options.headers['X-Obus-Game-Token'], SERVICE_KEY);
    return json(receipt(input));
  });
  const result = await control.syncEvidence(input);
  assert.deepEqual(result, receipt(input));
  assert.ok(Object.isFrozen(result));
  assert.equal(calls, 1);
});

test('signing snapshots data before the first await; caller mutation cannot alter the request', async () => {
  const input = evidence(), original = structuredClone(input), gate = deferred();
  let sent;
  const pending = client(async (_url, options) => { sent = options.body; await gate.promise; return json(receipt(original)); }).syncEvidence(input);
  input.sources[0].text = 'Changed after dispatch';
  input.runtime.generation = BOOT;
  input.participants.length = 0;
  gate.resolve();
  await pending;
  assert.deepEqual(JSON.parse(sent), original);
});

test('complete snapshot preserves tombstones, Unicode, and unknown historical lineage', async () => {
  const input = evidence();
  input.sources.push({ ...structuredClone(input.sources[0]), ref: 'chronicle:session1:E2', revision: 4, text: '', deleted: true,
    contributors: [{ user: 'unknown', captureEpoch: null, externalEpoch: null, exportableAtCapture: false }] });
  const prepared = prepareEvidenceSnapshot(input);
  assert.deepEqual(prepared, input);
  assert.ok(Object.isFrozen(prepared.sources[1].contributors[0]));
  await client(async (_url, options) => { assert.deepEqual(JSON.parse(options.body), input); return json(receipt(input)); }).syncEvidence(input);
});

test('evidence request budget is 512 KiB, independently of the small receipt budget', async () => {
  const input = evidence(); input.sources[0].text = 'x'.repeat(16000);
  let bytes = 0;
  await client(async (_url, options) => { bytes = Buffer.byteLength(options.body); return json(receipt(input)); }).syncEvidence(input);
  assert.ok(bytes > 8192 && bytes < EVIDENCE_LIMIT);
  const large = evidence();
  large.sources = Array.from({ length: 34 }, (_, index) => ({ ...structuredClone(large.sources[0]), ref: `source:${index}`, text: 'x'.repeat(16000) }));
  // Explicit legacy validation retains its cap; the client now pages large documents.
  assert.throws(() => prepareEvidenceSnapshot(large), { code: 'INVALID_HOST_CONTROL_INPUT' });
});

test('invalid or oversized snapshots fail before any transport and are never truncated', async t => {
  const cases = {
    'source cap': x => { x.sources = Array.from({ length: 65537 }, (_, i) => ({ ...x.sources[0], ref: `ref:${i}` })); },
    'participant cap': x => { x.participants = Array.from({ length: 257 }, (_, i) => ({ ...x.participants[0], user: `user${i}` })); },
    'unsafe revision': x => { x.revision = Number.MAX_SAFE_INTEGER + 1; },
    'fractional epoch': x => { x.participants[0].captureEpoch = 1.5; },
    'duplicate source': x => { x.sources.push(structuredClone(x.sources[0])); },
    'duplicate participant': x => { x.participants.push(structuredClone(x.participants[0])); },
    'deleted text': x => { x.sources[0].deleted = true; },
    'unknown exportable epoch': x => { x.sources[0].contributors[0].captureEpoch = null; },
    'source text cap': x => { x.sources[0].text = 'x'.repeat(16001); },
    'lineage cap': x => { x.sources[0].derivesFrom = Array.from({ length: 33 }, (_, i) => ({ ref: `ref:${i}`, revision: 1 })); },
    'inline policy': x => { x.policy = { enabled: true }; },
    'private owner missing': x => { x.sources[0].audience = 'private'; },
    'missing runtime': x => { delete x.runtime; },
    'sparse array': x => { x.sources.length = 2; },
    'cyclic source': x => { x.sources[0].derivesFrom.push(x.sources[0]); },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const input = evidence(); mutate(input);
    let calls = 0;
    await assert.rejects(client(async () => { calls++; }).syncEvidence(input), { code: 'INVALID_HOST_CONTROL_INPUT' });
    assert.equal(calls, 0);
  });
});

test('data getters and toJSON are rejected without executing them', async () => {
  for (const property of ['text', 'toJSON']) {
    const input = evidence(); let executed = false;
    Object.defineProperty(input.sources[0], property, { enumerable: true, get() { executed = true; throw new Error('must not run'); } });
    await assert.rejects(client(async () => assert.fail('transport')).syncEvidence(input), { code: 'INVALID_HOST_CONTROL_INPUT' });
    assert.equal(executed, false);
  }
});

test('only a matching exact receipt can be trusted', async t => {
  for (const [name, mutate] of Object.entries({
    campaign: x => { x.campaign = 'other'; }, session: x => { x.session = 'other'; }, revision: x => { x.revision++; },
    sources: x => { x.sourceCount++; }, participants: x => { x.participantCount++; },
    status: x => { x.status = 'queued'; }, extra: x => { x.sources = []; },
  })) await t.test(name, async () => {
    const input = evidence(), result = receipt(input); mutate(result);
    await assert.rejects(client(async () => json(result)).syncEvidence(input), { code: 'INVALID_OBUS_RUNTIME_RESPONSE', status: 502 });
  });
});

test('redirects, altered origins, malformed JSON, and oversized responses fail without retry', async t => {
  const variants = {
    redirect: () => ({ ...json({}), redirected: true }),
    'changed URL': () => { const response = json({}); Object.defineProperty(response, 'url', { value: 'https://untrusted.invalid/' }); return response; },
    '302 response': () => new Response('', { status: 302, headers: { Location: 'https://untrusted.invalid/' } }),
    'declared oversize': () => json({}, { headers: { 'Content-Type': 'application/json', 'Content-Length': '8193' } }),
    'stream oversize': () => new Response(' '.repeat(8193), { headers: { 'Content-Type': 'application/json' } }),
    'bad JSON': () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    'wrong type': () => new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
    'transport failure': () => { throw new Error('no service'); },
  };
  for (const [name, response] of Object.entries(variants)) await t.test(name, async () => {
    let calls = 0;
    await assert.rejects(client(async () => { calls++; return response(); }).syncEvidence(evidence()), error => error.name === 'ObusHostControlError');
    assert.equal(calls, 1);
  });
});
