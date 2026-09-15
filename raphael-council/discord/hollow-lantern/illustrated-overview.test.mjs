import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderOverview, renderIllustratedOverview } from './renderers.mjs';
import { createHollowLanternAdapter } from './adapter.mjs';
const room = (id, extra = {}) => ({ id, name: id, discovered: true, ...extra });
const map = { level: 'dungeon', title: 'Known rooms', currentId: 'entry', nodes: [room('entry'), room('hall')], edges: [{ from: 'entry', to: 'hall', discovered: true }] };
function artwork() { const c = createCanvas(180, 90), ctx = c.getContext('2d'); ctx.fillStyle = '#cc3355'; ctx.fillRect(0, 0, 180, 90); ctx.fillStyle = '#11aacc'; ctx.fillRect(0, 0, 20, 90); return c.toBuffer('image/png'); }

test('hidden nodes, edges, markers and artwork never affect player PNG', async () => {
  let hiddenReads = 0;
  const assets = { entry: artwork() };
  Object.defineProperty(assets, 'secret', { enumerable: true, get() { hiddenReads++; throw Error('secret asset read'); } });
  const expected = await renderIllustratedOverview(map, { roomVignettes: assets });
  const hidden = { ...map, nodes: [room('secret', { discovered: false, x: .5, y: .5 }), ...map.nodes], edges: [...map.edges, { from: 'hall', to: 'secret', discovered: true }, { from: 'entry', to: 'hall', discovered: false, minutes: 99 }] };
  assert.deepEqual(await renderIllustratedOverview(hidden, { roomVignettes: assets }), expected);
  assert.equal(hiddenReads, 0);
  assert.deepEqual(await renderIllustratedOverview({ ...hidden, currentId: 'secret' }), await renderIllustratedOverview({ ...map, currentId: undefined }));
});

test('approved vignette retains its edge landmarks without cropping', async () => {
  const bytes = await renderIllustratedOverview(map, { roomVignettes: { entry: artwork() } });
  assert.notDeepEqual(bytes, await renderIllustratedOverview(map));
  const image = await loadImage(bytes), c = createCanvas(image.width, image.height), ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
  assert.equal(image.width, 780);
  assert.deepEqual([...ctx.getImageData(66, 195, 1, 1).data], [17, 170, 204, 255]);
  assert.deepEqual([...ctx.getImageData(320, 195, 1, 1).data], [204, 51, 85, 255]);
});

test('missing, invalid and remote artwork leave known-room fallback usable', async () => {
  const expected = await renderIllustratedOverview(map);
  for (const source of [Buffer.from('invalid image'), 'https://example.invalid/secret.png', 'relative.png']) assert.deepEqual(await renderIllustratedOverview(map, { roomVignettes: { entry: source } }), expected);
});

test('regional PNG remains identical and skips all vignette lookup', async () => {
  const regional = { ...map, level: 'regional', edges: [{ ...map.edges[0], directed: true, minutes: 12 }] };
  const assets = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('regional asset lookup'); } });
  assert.deepEqual(await renderIllustratedOverview(regional, { roomVignettes: assets }), renderOverview(regional));
});

test('discoveries and route metadata change rendering without mutating state', async () => {
  const original = JSON.stringify(map), before = await renderIllustratedOverview(map);
  assert.notDeepEqual(await renderIllustratedOverview({ ...map, nodes: [...map.nodes, room('stairs')] }), before);
  assert.notDeepEqual(await renderIllustratedOverview({ ...map, edges: [{ ...map.edges[0], directed: true, minutes: 4 }] }), before);
  assert.equal(JSON.stringify(map), original);
  assert.ok(Buffer.isBuffer(await renderIllustratedOverview({ level: 'dungeon', nodes: [], edges: [] })));
});

test('Discord adapter rechecks membership after awaited artwork loads', async () => {
  let authorized = true, reads = 0;
  const assets = {};
  Object.defineProperty(assets, 'entry', { get() { reads++; authorized = false; return artwork(); } });
  const adapter = createHollowLanternAdapter({ campaignId: 'test-campaign', engine: { project: async () => ({ audience: 'player', revision: 0, title: 'Known rooms', map, actions: [] }), command: async () => { throw Error('Map navigation must not issue a command'); } }, authorize: async () => authorized, resolveActor: async () => 'fighter', renderAssets: { dungeonVignettes: assets } });
  await assert.rejects(adapter.panel({ userId: 'player', actorId: 'fighter', mapLevel: 'dungeon' }), /Access changed/);
  assert.equal(reads, 1);
});
