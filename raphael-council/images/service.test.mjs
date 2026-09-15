import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { SceneImageService } from './service.mjs';

const png = createCanvas(2, 2).toBuffer('image/png');
const player = { campaign: 'greyharbor', owner: 'player1' };
const other = { campaign: 'greyharbor', owner: 'player2' };
const opening = { campaign: player.campaign, audience: 'party', id: 'hearth', title: 'Last Hearth', sourceEventId: 'event-1',
  description: 'A candle lights the visible table. The door is closed.', references: ['lamp'],
  subjects: [{ id: 'candle', label: 'The candle', description: 'A single ordinary wax candle.', subjectType: 'item', reference: 'lamp' }] };
function fixture(t, provider = async () => png) {
  const root = mkdtempSync(join(tmpdir(), 'raphael-images-'));
  const artRoot = join(root, 'art'), dataDir = join(root, 'data'); mkdirSync(artRoot);
  writeFileSync(join(artRoot, 'lamp.png'), png);
  for (const path of ['', 'world', 'people', 'lore']) {
    mkdirSync(join(artRoot, path), { recursive: true });
    writeFileSync(join(artRoot, path, 'manifest.json'), JSON.stringify({ assets: path ? [] : [{ id: 'lamp', status: 'generated', file: 'lamp.png' }] }));
  }
  const instances = [];
  const create = () => { const service = new SceneImageService({ dataDir, artRoot, provider }); instances.push(service); return service; };
  t.after(async () => { for (const instance of instances) if (!instance.closed) await instance.close(); rmSync(root, { recursive: true, force: true }); });
  return { service: create(), create, root, dataDir };
}
test('requests at any phase are read-only, privately delivered, and idempotent', async t => {
  let calls = 0; const { service } = fixture(t, async () => { calls++; return png; });
  service.publishScene({ ...opening, phase: 'paused', turnOwner: 'someone-else' });
  const before = service.scene(player);
  const first = await service.requestImage(player, { requestId: 'request-1' });
  const duplicate = await service.requestImage(player, { requestId: 'request-1' });
  assert.equal(first.id, duplicate.id);
  assert.equal((await service.waitForJob(player, first.id)).status, 'ready');
  const cached = await service.requestImage(player, { requestId: 'another-click' });
  assert.equal(cached.id, first.id); assert.equal(calls, 1);
  assert.deepEqual(service.scene(player), before);
  assert.throws(() => service.getJob(other, first.id), { code: 'NOT_FOUND' });
  await assert.rejects(service.image(other, first.id), { code: 'NOT_FOUND' });
  assert.deepEqual((await service.image(player, first.id)).bytes, png);
});
test('only observable host projection and visible subject enter generation', async t => {
  const prompts = []; const { service } = fixture(t, async spec => { prompts.push(spec); return png; });
  assert.throws(() => service.scene(player), { code: 'SCENE_UNAVAILABLE' });
  service.publishScene({ ...opening, hiddenSecret: 'A spy hides behind the door.' });
  await assert.rejects(service.requestImage(player, { requestId: 'bad', focusId: 'spy' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.requestImage(player, { requestId: 'bad2', focusId: '../gm-file' }), { code: 'INVALID_REQUEST' });
  const job = await service.requestImage(player, { requestId: 'good', focusId: 'candle' });
  await service.waitForJob(player, job.id);
  assert.equal(prompts.length, 1); assert.match(prompts[0].prompt, /ordinary wax candle/);
  assert.equal(prompts[0].subjectType, 'item'); assert.equal(prompts[0].aspectRatio, '1:1');
  assert.doesNotMatch(prompts[0].prompt, /spy/); assert.equal(prompts[0].references.length, 1);
  assert.deepEqual(service.scene(player).subjects, [{ id: 'candle', label: 'The candle' }]);
});
test('personal viewpoints take precedence and cannot cross campaign/player boundaries', async t => {
  const { service } = fixture(t);
  service.publishScene(opening);
  service.publishScene({ ...opening, audience: player.owner, id: 'cellar', title: 'Cellar', description: 'Only this hero sees a dark cellar.', sourceEventId: 'event-2', references: [], subjects: [] });
  assert.equal(service.scene(player).id, 'cellar'); assert.equal(service.scene(other).id, 'hearth');
  assert.throws(() => service.scene({ ...player, campaign: 'different' }), { code: 'SCENE_UNAVAILABLE' });
  const code = service.issueBrowserAccess(player);
  assert.deepEqual(service.authenticateAccess(code), player);
  assert.throws(() => service.authenticateAccess('guess'), { code: 'UNAUTHORIZED' });
  service.revokeAccess(player); assert.throws(() => service.authenticateAccess(code), { code: 'UNAUTHORIZED' });
  service.clearPrivateScene(player); assert.equal(service.scene(player).id, 'hearth');
});
test('changed view creates a fresh image and marks the saved snapshot as older', async t => {
  const { service, dataDir } = fixture(t); service.publishScene(opening);
  const first = await service.requestImage(player, { requestId: 'before' }); await service.waitForJob(player, first.id);
  service.publishScene({ ...opening, description: 'The candle has burned out.', sourceEventId: 'event-2' });
  assert.equal(service.getJob(player, first.id).stale, true);
  assert.equal((await service.requestImage(player, { requestId: 'before' })).id, first.id);
  const after = await service.requestImage(player, { requestId: 'after' }); await service.waitForJob(player, after.id);
  assert.notEqual(after.id, first.id); assert.equal(service.getJob(player, after.id).stale, false);
  const audit = JSON.parse(readFileSync(join(dataDir, 'renders', `${first.id}.json`), 'utf8'));
  assert.equal(audit.snapshot.sourceEventId, 'event-1'); assert.match(audit.prompt, /candle lights/);
});
test('private image history retains each scene revision without exposing prompts or paths', async t => {
  const { service } = fixture(t); service.publishScene(opening);
  const first = await service.requestImage(player, { requestId: 'history-before' }); await service.waitForJob(player, first.id);
  service.publishScene({ ...opening, description: 'The candle has burned out.', sourceEventId: 'event-2' });
  const second = await service.requestImage(player, { requestId: 'history-after' }); await service.waitForJob(player, second.id);
  const history = service.history(player);
  assert.deepEqual(history.map(item => item.sceneRevision), [2, 1]);
  assert.equal(history[0].sourceEventId, 'event-2');
  assert.equal(Object.hasOwn(history[0], 'prompt'), false);
  assert.equal(Object.hasOwn(history[0], 'refs'), false);
});
test('two host processes share a durable job and do not duplicate provider work', async t => {
  let calls = 0; const { service, create } = fixture(t, async () => { calls++; await new Promise(r => setTimeout(r, 30)); return png; });
  service.publishScene(opening); const second = create();
  const [a, b] = await Promise.all([service.requestImage(player, { requestId: 'same' }), second.requestImage(player, { requestId: 'same' })]);
  assert.equal(a.id, b.id); await second.waitForJob(player, a.id); assert.equal(calls, 1);
  await service.close(); const restarted = create();
  assert.equal(restarted.getJob(player, a.id).status, 'ready'); assert.deepEqual((await restarted.image(player, a.id)).bytes, png);
});
test('views are persistent, owner-bound and expire', async t => {
  const { service, create } = fixture(t);
  const record = { kind: 'focus', sceneId: 'hearth', sceneRevision: 3, subjects: [{ id: 'candle', label: 'Candle' }] };
  const id = service.createView(player, record);
  assert.deepEqual(service.resolveView(player, id), record);
  assert.throws(() => service.resolveView(other, id), { code: 'NOT_FOUND' });
  await service.close(); const restarted = create(); assert.deepEqual(restarted.resolveView(player, id), record);
  restarted.db.prepare('UPDATE image_views SET expires=0 WHERE id=?').run(id);
  assert.throws(() => restarted.resolveView(player, id), { code: 'NOT_FOUND' });
});
test('missing provider is explicit; host-approved art still works with no API call', async t => {
  let calls = 0; const { service } = fixture(t, async () => { calls++; throw Object.assign(new Error('secret-provider-config'), { code: 'PROVIDER_UNAVAILABLE' }); });
  service.publishScene(opening);
  const first = await service.requestImage(player, { requestId: 'no-provider' });
  const failed = await service.waitForJob(player, first.id);
  assert.equal(failed.status, 'failed'); assert.match(failed.message, /host needs to connect/); assert.doesNotMatch(failed.message, /secret/);
  service.publishScene({ ...opening, approvedImage: 'lamp' });
  const cached = await service.requestImage(player, { requestId: 'approved' });
  assert.equal((await service.waitForJob(player, cached.id)).status, 'ready'); assert.equal(calls, 1);
});
test('tactical refresh preserves the host-approved location image', t => {
  const { service } = fixture(t);
  let revision = 1;
  service.resolveScene = () => ({ ...opening, audience: player.owner, gameRevision: revision, approvedImage: undefined });
  service.publishScene({ ...opening, audience: player.owner, approvedImage: 'lamp', gameRevision: revision });
  service.refreshScene(player);
  assert.equal(service.projection(player).approvedImage, 'lamp');
  revision = 2;
  service.refreshScene(player);
  assert.equal(service.projection(player).approvedImage, 'lamp');
  assert.equal(service.projection(player).gameRevision, 2);
});
test('interrupted leases fail without an automatic paid retry', async t => {
  let calls = 0; const { service } = fixture(t, async () => { calls++; return png; });
  service.publishScene(opening);
  // Hold the worker while constructing the crash state.
  service.running = Promise.resolve();
  const job = await service.requestImage(player, { requestId: 'interrupted' });
  service.db.prepare("UPDATE jobs SET status='running',lease=1 WHERE id=?").run(job.id); service.running = null;
  const result = await service.waitForJob(player, job.id);
  assert.equal(result.status, 'failed'); assert.equal(calls, 0);
});
test('invalid image bytes never become a ready result', async t => {
  const { service } = fixture(t, async () => Buffer.from('<html>provider error</html>')); service.publishScene(opening);
  const job = await service.requestImage(player, { requestId: 'bad-image' });
  assert.equal((await service.waitForJob(player, job.id)).status, 'failed');
  await assert.rejects(service.image(player, job.id), { code: 'NOT_READY' });
});

test('null reference IDs are rejected at publication rather than breaking later renders', t => {
  const { service } = fixture(t);
  assert.throws(() => service.publishScene({ ...opening, references: [null] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => service.scene(player), { code: 'SCENE_UNAVAILABLE' });
});

test('an expired worker cannot overwrite the failure recorded by another host', async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const { service, create } = fixture(t, async () => pending);
  service.publishScene(opening);
  const job = await service.requestImage(player, { requestId: 'slow-host' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(service.getJob(player, job.id).status, 'running');
  const second = create();
  second.db.prepare('UPDATE jobs SET lease=1 WHERE id=?').run(job.id);
  assert.equal((await second.waitForJob(player, job.id)).status, 'failed');
  finish(png); await service.running;
  assert.equal(service.getJob(player, job.id).status, 'failed');
  await assert.rejects(service.image(player, job.id), { code: 'NOT_READY' });
});
