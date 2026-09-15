import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { areaMapState, renderAreaMap } from './area-map-renderer.mjs';

const step = (revision = 1) => ({ gameRevision: revision, map: { id: 'saltglass-party-shore' }, action: { type: 'listen' } });
const rescue = () => ({ ...step(18), action: { type: 'help_the_courier' }, notes: { consequence: 'courier rescued; abbey lead opened' } });

test('overview starts with only the known shore and cannot read future receipts', () => {
  const initial = step(), before = structuredClone(initial);
  const view = areaMapState(initial, [rescue()]);
  assert.deepEqual(view.knownLocations, ['saltglass-party-shore']);
  assert.deepEqual(initial, before);
});

test('rescue discovers Abbey without moving party away from authoritative board', () => {
  const event = { ...rescue(), location: { id: 'abbey-archive' } };
  const view = areaMapState(event);
  assert.equal(view.currentLocation, 'Saltglass Shore');
  assert.deepEqual(view.knownLocations, ['saltglass-party-shore', 'abbey-archive']);
  assert.match(view.description, /No route or distance is confirmed/);
  assert.deepEqual(areaMapState(step(19), [event]).knownLocations, view.knownLocations);
  assert.equal(areaMapState({ ...step(20), map: { id: 'abbey-archive' } }, [event]).currentLocation, 'Drowned Abbey Archive');
});

test('uncommitted narrative alone cannot discover a landmark', () => {
  assert.equal(areaMapState({ ...step(), location: { id: 'abbey-archive' }, image: { approvedImage: 'abbey' } }).knownLocations.length, 1);
  assert.equal(areaMapState({ ...step(), map: { id: 'unknown-dungeon' } }), null);
  assert.throws(() => areaMapState(step(NaN)), /revision/);
});

test('undiscovered landmark is covered by opaque pixels; discovery reveals artwork', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'operator-area-map-test-'));
  try {
    const background = createCanvas(1280, 800), ctx = background.getContext('2d');
    ctx.fillStyle = '#b83932'; ctx.fillRect(0, 0, 1280, 800);
    const backgroundPath = join(folder, 'fixture.png'); await writeFile(backgroundPath, background.toBuffer('image/png'));
    await assert.rejects(renderAreaMap(step(), join(folder, 'none.png')), /artwork/);
    const before = join(folder, 'before.png'), after = join(folder, 'after.png');
    await renderAreaMap(step(), before, { backgroundPath });
    await renderAreaMap(rescue(), after, { backgroundPath });
    const pixel = async path => {
      const image = await loadImage(path), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
      assert.equal(image.width, 1280); assert.equal(image.height, 872);
      context.drawImage(image, 0, 0); return Array.from(context.getImageData(380, 160, 1, 1).data);
    };
    assert.deepEqual(await pixel(before), [38, 55, 59, 255]);
    assert.deepEqual(await pixel(after), [184, 57, 50, 255]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
