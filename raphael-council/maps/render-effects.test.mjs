import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mapEffectLegend, mapEffectCellLabel, renderTacticalMap } from './render.mjs';

function viewWith(effects, { width = 4, height = 4, cells } = {}) {
  return {
    map: { title: 'Visible effects', width, height, cells: cells ?? Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) })), blocked: [], difficult: [] },
    actors: [], effects, round: 1, turn: 2, revision: 3, phase: 'combat', activeActorId: null,
  };
}
function effect(id, cells) {
  return { id, name: `Zone ${id}`, trigger: 'end_turn', expiresAtTurn: 8, cells };
}
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}
function measureAt(size) {
  const ctx = createCanvas(1, 1).getContext('2d');
  ctx.font = `bold ${size}px Arial`;
  return text => ctx.measureText(text).width;
}

test('repeating a cell within one zone gives the same legend and PNG as one occurrence', () => {
  const single = viewWith([effect('fire', [{ x: 1, y: 1 }])]);
  const duplicate = viewWith([effect('fire', [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])]);
  assert.deepEqual(mapEffectLegend(duplicate), mapEffectLegend(single));
  assert.deepEqual(renderTacticalMap(duplicate), renderTacticalMap(single));
});

test('distinct overlapping zones keep their identities and readable legend-number labels', () => {
  const view = viewWith([effect('fire', [{ x: 1, y: 1 }]), effect('frost', [{ x: 1, y: 1 }])]);
  const legend = mapEffectLegend(view);
  assert.deepEqual(legend.map(zone => zone.id), ['fire', 'frost']);
  assert.deepEqual(legend.map(zone => zone.number), [1, 2]);
  const text = mapEffectCellLabel(legend.map(zone => zone.number), 56, measureAt(10));
  assert.equal(text, '#1,2');
  assert.ok(measureAt(10)(text) <= 56);
  assert.notDeepEqual(renderTacticalMap(view), renderTacticalMap(viewWith([view.effects[0]])));
});

test('cell labels preserve visible numbers and indicate additional zones when space runs out', () => {
  const measure = measureAt(10);
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
  const text = mapEffectCellLabel(numbers, 56, measure);
  assert.match(text, /^#1(?:,\d+)* \+\d+$/);
  assert.ok(measure(text) <= 56);
  const [shown, remainder] = text.slice(1).split(' +');
  assert.deepEqual(shown.split(',').map(Number), numbers.slice(0, shown.split(',').length));
  assert.equal(shown.split(',').length + Number(remainder), numbers.length);

  const smallMeasure = measureAt(8);
  const narrow = mapEffectCellLabel([127, 128], 24, smallMeasure);
  assert.equal(narrow, '#127+');
  assert.ok(smallMeasure(narrow) <= 24, 'minimum-size cells keep an identifiable zone and a readable overflow marker');
});

test('legend clips unauthorized cells, removes hidden-only zones, and numbers the remaining zones consecutively', () => {
  const view = viewWith([
    effect('hidden-first', [{ x: 3, y: 3 }]),
    effect('mixed', [{ x: 3, y: 3 }, { x: 0, y: 0 }, { x: 0, y: 0 }]),
    effect('visible', [{ x: 1, y: 0 }]),
    effect('hidden-last', [{ x: 2, y: 2 }]),
  ], { cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
  const legend = mapEffectLegend(view);
  assert.deepEqual(legend.map(zone => ({ id: zone.id, number: zone.number, cells: zone.cells })), [
    { id: 'mixed', number: 1, cells: [{ x: 0, y: 0 }] },
    { id: 'visible', number: 2, cells: [{ x: 1, y: 0 }] },
  ]);
  const sanitized = { ...view, effects: legend };
  assert.deepEqual(renderTacticalMap(view), renderTacticalMap(sanitized), 'hidden geometry and hidden-only names cannot alter the player image');
});

test('legend and PNG rendering do not mutate the authorized projection', () => {
  const view = viewWith([effect('fire', [{ x: 1, y: 1 }, { x: 1, y: 1 }]), effect('frost', [{ x: 1, y: 1 }])]);
  const original = structuredClone(view);
  freezeDeep(view);
  mapEffectLegend(view);
  renderTacticalMap(view);
  assert.deepEqual(view, original);
});

test('64 by 64 map with 128 visible legends remains within the 16-million-pixel limit at requested cell size 96', () => {
  const effects = Array.from({ length: 128 }, (_, index) => effect(`zone-${index + 1}`, [{ x: index % 64, y: Math.floor(index / 64) }]));
  const view = viewWith(effects, { width: 64, height: 64 });
  assert.equal(mapEffectLegend(view).length, 128);
  const png = renderTacticalMap(view, { cellSize: 96 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.ok(width > 0 && height > 0);
  assert.ok(width * height <= 16_000_000, `rendered ${width} by ${height}`);
  assert.ok(height > 64 * 32, 'the PNG includes space beyond the minimum-size board for its complete legend');
});

test('actors cannot obscure coordinate/effect headers and their identity remains visible at 32px and 64px', async () => {
  async function pixels(png) {
    const image = await loadImage(png), ctx = createCanvas(image.width, image.height).getContext('2d');
    ctx.drawImage(image, 0, 0);
    return ctx;
  }
  for (const cellSize of [32, 64]) for (const size of [1, 2]) {
    const effects = Array.from({ length: 8 }, (_, index) => effect(`overlap-${index}`, [{ x: 1, y: 1 }]));
    const view = viewWith(effects);
    const actor = { id: 'mira', name: 'Mira', x: 1, y: 1, size, controlled: true, defeated: false };
    const withActor = { ...view, actors: [actor], activeActorId: actor.id };
    const absent = await pixels(renderTacticalMap(view, { cellSize }));
    const present = await pixels(renderTacticalMap(withActor, { cellSize }));
    const noZones = await pixels(renderTacticalMap({ ...withActor, effects: [] }, { cellSize }));
    const renamed = await pixels(renderTacticalMap({ ...withActor, actors: [{ ...actor, name: 'Nora' }] }, { cellSize }));
    const headerHeight = cellSize === 32 ? 20 : 14;
    const originX = 16 + cellSize, originY = 72 + cellSize;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const region = [originX + dx * cellSize + 2, originY + dy * cellSize + 1, cellSize - 4, headerHeight - 1];
      assert.deepEqual(present.getImageData(...region).data, absent.getImageData(...region).data, `${cellSize}px size-${size} token must not cover a reserved header`);
    }
    assert.notDeepEqual(present.getImageData(originX + 2, originY + 1, cellSize - 4, headerHeight - 1).data, noZones.getImageData(originX + 2, originY + 1, cellSize - 4, headerHeight - 1).data, 'effect IDs remain visible in the header');
    assert.deepEqual([...present.getImageData(originX + 3, originY + 2, 1, 1).data], [21, 17, 26, 255], 'unstriped dark backing provides consistent label contrast');
    assert.notDeepEqual(present.getImageData(originX, originY, cellSize * size, cellSize * size).data, renamed.getImageData(originX, originY, cellSize * size, cellSize * size).data, 'the token identity remains visible outside the reserved headers');
  }
});
