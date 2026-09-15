import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mapView, renderTacticalMap } from './map-renderer.mjs';

const snapshot = () => ({
  gameRevision: 3,
  map: { id: 'shore', width: 8, height: 7, blocked: [{ x: 3, y: 2 }], difficult: [{ x: 2, y: 3 }] },
  actors: [{ id: 'branna', name: 'Branna', x: 1, y: 1, hp: 12, maxHp: 12 }],
  mapScene: { title: 'Saltglass Shore' },
});

test('host snapshot preserves exact positions and does not mutate input', () => {
  const step = snapshot(), before = structuredClone(step);
  assert.deepEqual(mapView(step), { map: step.map, actors: step.actors });
  assert.deepEqual(step, before);
});

test('player map fails closed instead of returning the host board', () => {
  assert.throws(() => mapView(snapshot(), 'branna'), /visibility-scoped/);
});

test('player map uses only its own same-revision snapshot', () => {
  const step = snapshot();
  step.actors.push({ id: 'hidden-enemy', x: 5, y: 3, hp: 9 });
  step.viewerSnapshots = { branna: { ...snapshot(), actors: [] } };
  assert.equal(mapView(step, 'branna').actors.length, 0);
  step.viewerSnapshots.branna.gameRevision--;
  assert.throws(() => mapView(step, 'branna'), /revision/);
});

test('invalid dimensions and out-of-board positions are refused', () => {
  for (const width of [0, -1, 2.5, 10000, NaN]) {
    const step = snapshot(); step.map.width = width;
    assert.throws(() => mapView(step), /dimensions/);
  }
  const step = snapshot(); step.actors[0].x = 8;
  assert.throws(() => mapView(step), /outside/);
});

test('missing art cannot silently become a blank generic board', async () => {
  await assert.rejects(renderTacticalMap(snapshot(), 'unused.png'), /approved top-down artwork/);
});

test('registered art, portrait movement and optional terrain outlines render correctly', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'operator-map-render-test-'));
  try {
    const solid = (color, width, height) => {
      const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      return canvas.toBuffer('image/png');
    };
    const backgroundPath = join(folder, 'background.png'), portraitPath = join(folder, 'portrait.png');
    await writeFile(backgroundPath, solid('#567856', 160, 140));
    await writeFile(portraitPath, solid('#b83932', 64, 64));
    const options = { backgroundPath, portraits: { branna: portraitPath } };
    const step = snapshot();
    await assert.rejects(renderTacticalMap(step, join(folder, 'missing.png'), { backgroundPath }), /portrait missing/);
    const before = join(folder, 'before.png'), after = join(folder, 'after.png'), tactical = join(folder, 'tactical.png');
    await renderTacticalMap(step, before, options);
    const moved = structuredClone(step); moved.gameRevision++; moved.actors[0].x++;
    await renderTacticalMap(moved, after, options);
    await renderTacticalMap(moved, tactical, { ...options, showTactics: true });
    const pixels = async path => {
      const image = await loadImage(path), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      assert.equal(image.width, 960); assert.equal(image.height, 916);
      return (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    };
    const first = await pixels(before), second = await pixels(after), overlay = await pixels(tactical);
    assert.deepEqual(first(229, 226), [184, 57, 50]);
    assert.deepEqual(first(200, 200), [86, 120, 86], 'cell center stays unobstructed');
    assert.deepEqual(second(200, 200), [86, 120, 86]);
    assert.deepEqual(second(341, 226), [184, 57, 50]);
    assert.deepEqual(second(229, 226), [86, 120, 86], 'old portrait moves off the previous cell');
    assert.deepEqual(second(500, 500), [86, 120, 86]);
    assert.notDeepEqual(overlay(380, 300), second(380, 300));
    await renderTacticalMap(step, join(folder, 'repeat.png'), options);
    assert.deepEqual(await readFile(before), await readFile(join(folder, 'repeat.png')));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('25 by 25 tactical boards stay within a Discord-friendly image size', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'operator-large-map-render-test-'));
  try {
    const solid = (color, width, height) => {
      const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      return canvas.toBuffer('image/png');
    };
    const backgroundPath = join(folder, 'background.png'), portraitPath = join(folder, 'portrait.png'), output = join(folder, 'large.png');
    await writeFile(backgroundPath, solid('#567856', 400, 400));
    await writeFile(portraitPath, solid('#b83932', 64, 64));
    const step = {
      gameRevision: 9,
      map: { id: 'shore', width: 25, height: 25, blocked: [{ x: 10, y: 10 }], difficult: [{ x: 6, y: 12 }] },
      actors: [{ id: 'branna', name: 'Branna', x: 3, y: 5, hp: 12, maxHp: 12 }],
      mapScene: { title: 'Saltglass Shore' },
    };
    await renderTacticalMap(step, output, { backgroundPath, portraits: { branna: portraitPath } });
    const image = await loadImage(output);
    assert.equal(image.width, 1864);
    assert.equal(image.height, 1932);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
