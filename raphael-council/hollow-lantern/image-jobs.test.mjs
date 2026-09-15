import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { createImageJobs } from './image-jobs.mjs';
const scope = { campaign: 'c', owner: 'u', audience: 'private', characterId: 'a', sceneId: 's', revision: 1 };
const runtime = { contract: 'raph-obus-game-runtime-v1', bootEpoch: 'b', generation: 'g', sessionPolicyRevision: 1 };
function setup() {
  let revision = 1, allowed = true, busy = false, failure = false, gate; const applied = [], sent = [];
  const image = createCanvas(512, 512).toBuffer('image/png');
  const queue = createImageJobs({ token: 'fixture', hostHeaders: async () => ({ 'X-Obus-Game-Host-Signature': 'fixture' }), authorize: async () => allowed, current: async () => ({ sceneId: 's', revision }),
    prepare: async () => ({ approved: true, prompt: 'Approved visible stone floor only' }), hasPendingGameplay: async () => busy,
    commit: async job => { if (job.scope.revision !== revision) return false; applied.push(job); return true; },
    fetchImpl: async (_url, options) => {
      const job = JSON.parse(options.body); sent.push(job); if (gate) await gate; if (failure) throw new Error('private provider error');
      return Response.json({ contract: job.contract, requestId: job.requestId, session: job.session, runtime: job.runtime, scope: job.scope, status: 'completed', mime_type: 'image/png', image_base64: image.toString('base64'), receipt: { sha256: createHash('sha256').update(image).digest('hex') } });
    } });
  return { queue, applied, sent, setRevision: v => revision = v, setAllowed: v => allowed = v, setBusy: v => busy = v, setFailure: v => failure = v, setGate: v => gate = v };
}
const request = { scope, runtime, session: 'session', requestId: 'image-one' };
test('only approved scoped artwork reaches local endpoint and commits checked bytes', async () => {
  const s = setup(); assert.equal((await s.queue.request(request)).status, 'applied');
  assert.equal(s.sent[0].scope.characterId, 'a'); assert.equal(s.applied.length, 1); assert.ok(Buffer.isBuffer(s.applied[0].image));
  assert.equal(s.sent[0].tools, undefined); assert.equal(s.sent[0].providerUrl, undefined);
});
test('pending gameplay and generation failures retain approved art', async () => {
  const s = setup(); s.setBusy(true); assert.equal((await s.queue.request(request)).reason, 'gameplay-priority'); assert.equal(s.sent.length, 0);
  s.setBusy(false); s.setFailure(true); assert.equal((await s.queue.request(request)).status, 'retained'); assert.equal(s.applied.length, 0);
});
test('late revision and ownership changes prevent attachment replacement', async () => {
  for (const revoke of [false, true]) {
    const s = setup(); let release; s.setGate(new Promise(resolve => release = resolve)); const pending = s.queue.request(request);
    while (!s.sent.length) await new Promise(resolve => setImmediate(resolve));
    if (revoke) s.setAllowed(false); else s.setRevision(2); release();
    assert.equal((await pending).reason, 'scope-changed'); assert.equal(s.applied.length, 0);
  }
});
test('simultaneous jobs never queue ahead of gameplay or generate in parallel', async () => {
  const s = setup(); let release; s.setGate(new Promise(resolve => release = resolve)); const pending = s.queue.request(request);
  while (!s.sent.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await s.queue.request({ ...request, scope: { ...scope, owner: 'another' } })).reason, 'gameplay-priority'); release(); await pending; assert.equal(s.sent.length, 1);
});
