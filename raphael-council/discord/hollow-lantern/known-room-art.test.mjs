import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderIllustratedOverview } from './renderers.mjs';
import { presentProjection } from '../../hollow-lantern/service.mjs';

const grid = { x: 4, y: 6, width: 2, height: 2 };
const mapFor = knownCells => ({ level: 'dungeon', nodes: [{ id: 'archive', name: 'Archive', discovered: true, knownCells }], edges: [] });
function terrain(hidden = '#ef2244', width = 20) {
  const canvas = createCanvas(width, 20), ctx = canvas.getContext('2d');
  ctx.fillStyle = hidden; ctx.fillRect(0, 0, width, 20);
  ctx.fillStyle = '#22aa77'; ctx.fillRect(0, 0, 10, 10);
  return canvas.toBuffer('image/png');
}
const render = (known, source = terrain(), selectedGrid = grid) => renderIllustratedOverview(mapFor(known), { roomVignettes: { archive: { source, grid: selectedGrid } } });
async function pixel(bytes, x, y) {
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data];
}

test('unknown terrain pixels cannot influence the delivered PNG, including scaled edges', async () => {
  const known = [{ x: 4, y: 6 }];
  const first = await render(known, terrain('#ef2244'));
  assert.deepEqual(first, await render(known, terrain('#1020ff')));
  const center = (await loadImage(first)).width / 2;
  assert.deepEqual(await pixel(first, center - 45, 150), [34, 170, 119, 255]);
  assert.deepEqual(await pixel(first, center + 45, 220), [222, 209, 180, 255]);
});

test('revealing another square changes the image and only then exposes that terrain', async () => {
  const first = await render([{ x: 4, y: 6 }]);
  const revealed = await render([{ x: 4, y: 6 }, { x: 5, y: 7 }]);
  assert.notDeepEqual(first, revealed);
  const center = (await loadImage(revealed)).width / 2;
  assert.deepEqual(await pixel(revealed, center + 45, 220), [239, 34, 68, 255]);
});

test('one discovered room has a compact canvas and an exactly centered vignette', async () => {
  const bytes = await renderIllustratedOverview(mapFor([]));
  const image = await loadImage(bytes);
  assert.equal(image.width, 520);
  assert.equal(image.height, 500);
  const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const row = ctx.getImageData(0, 130, image.width, 1).data;
  const inside = [];
  for (let x = 0; x < image.width; x++) {
    if (row[x * 4] === 222 && row[x * 4 + 1] === 209 && row[x * 4 + 2] === 180) inside.push(x);
  }
  assert.equal(inside.length, 292);
  assert.equal(inside[0] + inside.at(-1), image.width - 1);
});

test('only discovered room counts determine empty, single and multi-room dimensions', async () => {
  for (const [count, width, height] of [[0, 520, 500], [1, 520, 500], [2, 780, 500], [3, 780, 700]]) {
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `room-${i}`, name: `Room ${i + 1}`, discovered: true }));
    const map = { level: 'dungeon', nodes, edges: [] };
    const expected = await renderIllustratedOverview(map);
    const image = await loadImage(expected);
    assert.deepEqual([image.width, image.height], [width, height]);
    let reads = 0;
    const roomVignettes = { get hidden() { reads++; throw new Error('Hidden artwork was read'); } };
    const hidden = { id: 'hidden', discovered: false, x: 999, y: 999 };
    const withSecrets = { ...map, nodes: [hidden, ...nodes], edges: [{ from: 'hidden', to: 'room-0', discovered: true }] };
    assert.deepEqual(await renderIllustratedOverview(withSecrets, { roomVignettes }), expected);
    assert.equal(reads, 0);
  }
});

test('missing or empty masks do not even read the source asset', async () => {
  let reads = 0;
  const asset = { grid, get source() { reads++; return terrain(); } };
  for (const known of [undefined, [], [{ x: 0, y: 0 }], [{ x: 4.5, y: 6 }], [null]]) {
    const map = mapFor(known);
    assert.deepEqual(await renderIllustratedOverview(map, { roomVignettes: { archive: asset } }), await renderIllustratedOverview(map));
  }
  assert.equal(reads, 0);
});

test('invalid grid bounds and nonintegral source tiles fail closed to the text fallback', async () => {
  const known = [{ x: 4, y: 6 }], fallback = await renderIllustratedOverview(mapFor(known));
  for (const invalid of [undefined, { ...grid, x: -1 }, { ...grid, width: 0 }, { ...grid, height: 1.5 }, { ...grid, x: 24 }]) {
    const bytes = await renderIllustratedOverview(mapFor(known), { roomVignettes: { archive: { grid: invalid, source: terrain() } } });
    assert.deepEqual(bytes, fallback);
  }
  assert.deepEqual(await render(known, terrain('#ef2244', 21)), fallback);
});

test('duplicates, invalid coordinates and known-cell ordering do not alter authorized pixels', async () => {
  const known = [{ x: 4, y: 6 }, { x: 5, y: 7 }];
  const noisy = [known[1], known[0], known[0], { x: -1, y: 6 }, { x: '4', y: 6 }, null];
  const before = JSON.stringify(noisy);
  assert.deepEqual(await render(known), await render(noisy));
  assert.equal(JSON.stringify(noisy), before);
});

test('undiscovered nodes cannot trigger a grid artwork lookup or affect layout', async () => {
  const map = mapFor([{ x: 4, y: 6 }]);
  const expected = await renderIllustratedOverview(map);
  map.nodes.push({ id: 'secret', discovered: false, knownCells: [{ x: 4, y: 6 }] });
  let reads = 0;
  const assets = { get secret() { reads++; return { grid, source: terrain() }; } };
  assert.deepEqual(await renderIllustratedOverview(map, { roomVignettes: assets }), expected);
  assert.equal(reads, 0);
});

test('real presentation adapter preserves authoritative cell coordinates and omits public maps', async () => {
  const knownCells = [{ x: 4, y: 6 }];
  const projection = { projectionVersion: 2, audience: 'private', decisionOpen: false, characters: [], map: { level: 'dungeon', nodes: [{ id: 'archive', label: 'Archive', x: 6, y: 18, knownCells }], edges: [] } };
  const presented = presentProjection(projection);
  assert.deepEqual(presented.map.nodes[0].knownCells, knownCells);
  const options = source => ({ roomVignettes: { archive: { source, grid } } });
  assert.deepEqual(await renderIllustratedOverview(presented.map, options(terrain('#ff0000'))), await renderIllustratedOverview(presented.map, options(terrain('#0000ff'))));
  assert.equal(presentProjection({ ...projection, audience: 'public' }).map, undefined);
});
