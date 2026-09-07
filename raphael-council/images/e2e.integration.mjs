import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { SceneImageService } from './service.mjs';
import { createImageProvider } from './provider.mjs';
import { GameStore } from '../game/store.mjs';

// Explicit opt-in: run after build:game. This test never uses a paid image provider.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART_ROOT = realpathSync(resolve(APP_ROOT, '../campaign-art/witnesslight'));
const CLI = join(APP_ROOT, 'node_modules/vinext/dist/cli.js');

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('built browser game authenticates, queues and serves a real private campaign PNG', { timeout: 90000 }, async t => {
  assert.ok(existsSync(join(APP_ROOT, 'dist/server/index.js')), 'Run npm run build:game before this integration test.');
  const temporaryParent = realpathSync(tmpdir());
  const temporaryRoot = mkdtempSync(join(temporaryParent, 'raphael-images-http-'));
  const dataDir = join(temporaryRoot, 'data');
  const gameDataDir = join(temporaryRoot, 'game');
  const environment = {
    ...process.env,
    NODE_ENV: 'production', RAPHAEL_LOCAL_HOST: '1',
    RAPHAEL_IMAGE_DATA_DIR: dataDir, RAPHAEL_ART_ROOT: ART_ROOT,
    RAPHAEL_GAME_DATA_DIR: gameDataDir,
    RAPHAEL_DATA_DIR: join(temporaryRoot, 'characters'),
    OPENAI_API_KEY: '',
  };
  let child;
  let closed;
  let service;
  let output = '';
  let processError;
  let accessToken = '';
  let otherToken = '';
  let reachToken = '';

  t.after(async () => {
    if (service && !service.closed) await service.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([closed, delay(3000)]);
      }
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'The test server did not stop.');
    }
    const checkedRoot = realpathSync(temporaryRoot);
    assert.equal(dirname(checkedRoot), temporaryParent, 'Temporary cleanup must remain inside the OS temp directory.');
    assert.match(basename(checkedRoot), /^raphael-images-http-[A-Za-z0-9]+$/);
    rmSync(checkedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  service = new SceneImageService({ dataDir, artRoot: ART_ROOT, provider: createImageProvider({ transport: { capabilities: async () => ({ image_routes: false }) } }) });
  service.publishScene({
    campaign: 'integration-image-preview', audience: 'party', id: 'opening-table',
    title: 'The opening lantern', sourceEventId: 'integration-opening',
    description: 'A dark paper lantern with a crooked painted bird rests beside three sealed requests and a candle.',
    subjects: [], references: [], approvedImage: '66-opening-lantern',
  });
  accessToken = service.issueBrowserAccess({ campaign: 'integration-image-preview', owner: 'preview-player' });
  otherToken = service.issueBrowserAccess({ campaign: 'integration-image-preview', owner: 'other-player' });
  reachToken = service.issueBrowserAccess({ campaign: 'integration-preview', owner: 'preview-player' });
  const expectedImage = readFileSync(service.asset('66-opening-lantern'));
  await service.close();

  const game = new GameStore(join(gameDataDir, 'game.sqlite'));
  try {
    const actor = (id, owner, x, initiative) => ({ id, name: id, owner, x, y: 1, team: owner ? 'party' : 'opposition', size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative, characterVersion: 'integration-fixture', weapon: { name: 'Spear', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
    game.createCampaign({ campaign: 'integration-preview', title: 'Integration courtyard', members: [{ owner: 'host', role: 'host' }, { owner: 'preview-player', role: 'player' }], map: { id: 'courtyard', title: 'Courtyard', width: 14, height: 8, blocked: [], difficult: [] }, actors: [actor('hero', 'preview-player', 1, 20), actor('visible-guard', null, 4, 10), actor('secret-unseen', null, 12, 5)], effects: [] });
  } finally { game.close(); }

  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [CLI, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: APP_ROOT, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  closed = new Promise(resolve => child.once('close', resolve));
  child.once('error', error => { processError = error; });
  const capture = bytes => {
    const sanitized = bytes.toString().replaceAll(accessToken, '[private code]').replaceAll(otherToken, '[private code]').replaceAll(reachToken, '[private code]');
    output = (output + sanitized).slice(-6000);
  };
  child.stdout.on('data', capture); child.stderr.on('data', capture);

  let homepage;
  const startupDeadline = Date.now() + 45000;
  while (Date.now() < startupDeadline) {
    if (processError || child.exitCode !== null) throw new Error(`The production test server exited before startup. ${processError?.message ?? ''}\n${output}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { homepage = await response.text(); break; }
    } catch { /* The local server is still starting. */ }
    await delay(200);
  }
  assert.ok(homepage, `The production test server did not become ready.\n${output}`);
  assert.match(homepage, /Show what I see/);
  assert.match(homepage, /How far\? Can I reach it\?/);
  assert.match(homepage, /Join your campaign/);
  assert.doesNotMatch(homepage, /Resolve chosen path|Roll the omen|Reset local campaign/);
  const standalone = await fetch(`${origin}/illustrations`, { signal: AbortSignal.timeout(5000) });
  assert.equal(standalone.status, 200);
  const standaloneHtml = await standalone.text();
  assert.match(standaloneHtml, /Your view of the world/);
  assert.match(standaloneHtml, /Show what I see/);
  assert.match(standaloneHtml, /How far\? Can I reach it\?/);

  async function http(path = '', options = {}) {
    return fetch(`${origin}/api/scene-images${path}`, { ...options, signal: AbortSignal.timeout(5000) });
  }
  async function connect(token) {
    const response = await http('/access', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(response.status, 200, 'Private player connection succeeds in the production server.');
    assert.deepEqual(await response.json(), { connected: true });
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    return setCookie.split(';')[0];
  }

  const unauthorized = await http();
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('cache-control'), 'private, no-store');
  const cookie = await connect(accessToken);
  const sceneResponse = await http('', { headers: { Cookie: cookie } });
  assert.equal(sceneResponse.status, 200);
  const { scene } = await sceneResponse.json();
  assert.equal(scene.id, 'opening-table'); assert.equal(scene.sourceEventId, 'integration-opening');
  assert.equal(scene.approvedImage, undefined);

  // The image and tactical interfaces share the exact read-only measurement.
  // This also proves real Next routes use their own scoped authentication cookie.
  // Keep the approved-image fixture in an image-only campaign: tactical scenes
  // now refresh automatically and would correctly supersede a hand-authored view.
  const reachCookie = await connect(reachToken);
  assert.equal((await http('/reach')).status, 401);
  const optionsResponse = await http('/reach', { headers: { Cookie: reachCookie } });
  assert.equal(optionsResponse.status, 200);
  const { options: reachOptions } = await optionsResponse.json();
  assert.deepEqual(reachOptions.actors, [{ id: 'hero', label: 'hero' }]);
  assert.doesNotMatch(JSON.stringify(reachOptions), /secret-unseen/);
  const reachBody = JSON.stringify({ expectedRevision: reachOptions.revision, actorId: 'hero', targetId: 'visible-guard' });
  const reachResponse = await http('/reach', { method: 'POST', headers: { Cookie: reachCookie, Origin: origin, 'Content-Type': 'application/json' }, body: reachBody });
  assert.equal(reachResponse.status, 200);
  const reachResult = (await reachResponse.json()).result;
  assert.equal(reachResult.distanceFeet, 15);
  assert.equal(reachResult.movement.costFeet, 10);
  assert.equal(reachResult.weapon.inRange, false);
  const gameConnection = await fetch(`${origin}/api/game/access`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: reachToken }), signal: AbortSignal.timeout(5000) });
  assert.equal(gameConnection.status, 200);
  const gameCookie = gameConnection.headers.get('set-cookie').split(';')[0];
  const gameReach = await fetch(`${origin}/api/game/reach`, { method: 'POST', headers: { Cookie: gameCookie, Origin: origin, 'Content-Type': 'application/json' }, body: reachBody, signal: AbortSignal.timeout(5000) });
  assert.equal(gameReach.status, 200);
  assert.deepEqual((await gameReach.json()).result, reachResult);
  const gameState = await fetch(`${origin}/api/game`, { headers: { Cookie: gameCookie }, signal: AbortSignal.timeout(5000) });
  const current = await gameState.json();
  assert.equal(current.view.revision, reachOptions.revision);
  assert.equal(current.receipts.length, 0);
  const characterChoices = await fetch(`${origin}/api/game/characters`, { headers: { Cookie: gameCookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(characterChoices.status, 200);
  assert.doesNotMatch(await characterChoices.text(), /secret-unseen/);
  const heroInfo = await fetch(`${origin}/api/game/characters/hero?revision=${reachOptions.revision}`, { headers: { Cookie: gameCookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(heroInfo.status, 200);
  const { info } = await heroInfo.json();
  assert.equal(info.actor.hp, 20); assert.equal(info.actor.position.coordinate, 'B2');
  assert.ok(info.groups.length);
  const guardInfo = await fetch(`${origin}/api/game/characters/visible-guard`, { headers: { Cookie: gameCookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(guardInfo.status, 200);
  assert.equal((await guardInfo.json()).info.actor.hp, undefined);

  const requestBody = JSON.stringify({ requestId: randomUUID(), focusId: 'scene' });
  const queuedResponse = await http('', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: requestBody,
  });
  assert.equal(queuedResponse.status, 202);
  let { job } = await queuedResponse.json();
  assert.ok(['queued', 'running', 'ready'].includes(job.status));
  const jobId = job.id;
  const renderDeadline = Date.now() + 15000;
  while (job.status !== 'ready' && Date.now() < renderDeadline) {
    assert.notEqual(job.status, 'failed', 'The approved campaign image must render without a provider key.');
    await delay(100);
    const response = await http(`/${jobId}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    ({ job } = await response.json());
  }
  assert.equal(job.status, 'ready');
  assert.equal(job.stale, false); assert.equal(job.sceneRevision, scene.revision);

  const imageResponse = await http(`/${jobId}/image`, { headers: { Cookie: cookie } });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.equal(imageResponse.headers.get('cache-control'), 'private, no-store');
  const actualImage = Buffer.from(await imageResponse.arrayBuffer());
  assert.equal(sha(actualImage), sha(expectedImage), 'The HTTP download must exactly match the approved real campaign PNG.');

  const otherCookie = await connect(otherToken);
  for (const path of [`/${jobId}`, `/${jobId}/image`]) {
    const response = await http(path, { headers: { Cookie: otherCookie } });
    assert.equal(response.status, 404, 'A different authenticated player cannot read this private request.');
    assert.doesNotMatch(await response.text(), /opening-table|integration-opening/);
  }
  const repeated = await http('', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: requestBody,
  });
  assert.equal(repeated.status, 202);
  assert.equal((await repeated.json()).job.id, jobId, 'Safe retries retain the original production image job.');
});
