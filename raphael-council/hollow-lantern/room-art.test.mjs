import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { loadHollowLanternRoomArt } from './room-art.mjs';
import { renderIllustratedOverview } from '../discord/hollow-lantern/renderers.mjs';

function png(color = '#af2233', width = 26) {
  const canvas = createCanvas(width, 26), ctx = canvas.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, width, 26);
  ctx.fillStyle = '#33aa77'; ctx.fillRect(2, 2, 2, 2);
  return canvas.toBuffer('image/png');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'room-art-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = png(); writeFileSync(join(root, 'room.png'), bytes);
  const manifest = { version: 1, kind: 'dungeon-room-terrain', coordinateSystem: 'signal-dungeon-25-v1', entries: [{ sceneId: 'signal-dungeon', roomId: 'intake-hall', approved: true, purpose: 'terrain-only', file: 'room.png', sha256: hash(bytes) }] };
  const path = join(root, 'rooms.json');
  const load = (value = manifest) => { writeFileSync(path, JSON.stringify(value)); return loadHollowLanternRoomArt(path); };
  return { root, bytes, manifest, path, load };
}

test('reviewed room IDs map to the four canonical engine grids with immutable bindings', t => {
  const f = fixture(t), ids = ['intake-hall', 'turbine-gallery', 'archive', 'lantern-chamber'];
  f.manifest.entries = ids.map(roomId => ({ ...f.manifest.entries[0], roomId }));
  const assets = f.load();
  assert.deepEqual(ids.map(id => assets[id].grid), [{ x: 0, y: 0, width: 13, height: 13 }, { x: 12, y: 0, width: 13, height: 13 }, { x: 0, y: 12, width: 13, height: 13 }, { x: 12, y: 12, width: 13, height: 13 }]);
  assert.ok(Object.isFrozen(assets) && Object.isFrozen(assets.archive) && Object.isFrozen(assets.archive.grid));
  writeFileSync(join(f.root, 'room.png'), png('#0000ff'));
  assert.deepEqual(assets.archive.source, f.bytes);
  assert.throws(() => f.load(), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
});

test('unreviewed, object-bearing, duplicate, foreign-scene and unknown-room entries are rejected', t => {
  const f = fixture(t);
  for (const patch of [{ approved: false }, { purpose: 'scene-art' }, { roomId: 'secret-room' }, { roomId: '__proto__' }, { sceneId: 'rescue' }, { sha256: '0'.repeat(64) }]) {
    assert.throws(() => f.load({ ...f.manifest, entries: [{ ...f.manifest.entries[0], ...patch }] }), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
  }
  assert.throws(() => f.load({ ...f.manifest, entries: [f.manifest.entries[0], f.manifest.entries[0]] }), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
  for (const bad of [null, { ...f.manifest, version: 2 }, { ...f.manifest, coordinateSystem: 'other-layout' }, { ...f.manifest, entries: {} }]) assert.throws(() => f.load(bad), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
});

test('manifest and image paths cannot escape the approved local directory', t => {
  const f = fixture(t), other = fixture(t);
  for (const path of ['relative.json', 'https://example.com/rooms.json', '\\\\server\\rooms.json', join(f.root, 'OneDrive', 'rooms.json')]) assert.throws(() => loadHollowLanternRoomArt(path), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
  for (const file of [join(other.root, 'room.png'), relative(f.root, join(other.root, 'room.png'))]) assert.throws(() => f.load({ ...f.manifest, entries: [{ ...f.manifest.entries[0], file }] }), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
});

test('grid-incompatible, invalid and oversized images are rejected before rendering', t => {
  const f = fixture(t);
  for (const bytes of [png('#af2233', 27), Buffer.from('not an image'), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    writeFileSync(join(f.root, 'room.png'), bytes);
    assert.throws(() => f.load({ ...f.manifest, entries: [{ ...f.manifest.entries[0], sha256: hash(bytes) }] }), /HOLLOW_LANTERN_ROOM_ART_INVALID/);
  }
});

test('loaded approved artwork still masks hidden terrain all the way to the PNG', async t => {
  const f = fixture(t), map = { id: 'signal-dungeon', level: 'dungeon', nodes: [{ id: 'intake-hall', discovered: true, knownCells: [{ x: 1, y: 1 }] }], edges: [] };
  const first = await renderIllustratedOverview(map, { roomVignettes: f.load() });
  const changed = png('#0000ff'); writeFileSync(join(f.root, 'room.png'), changed); f.manifest.entries[0].sha256 = hash(changed);
  const assets = f.load();
  assert.deepEqual(first, await renderIllustratedOverview(map, { roomVignettes: assets }));
  assert.notDeepEqual(first, await renderIllustratedOverview(map));
  const revealed = structuredClone(map); revealed.nodes[0].knownCells.push({ x: 2, y: 2 });
  assert.notDeepEqual(first, await renderIllustratedOverview(revealed, { roomVignettes: assets }));
});

test('a same-named room in another scene cannot read or reveal bound art', async t => {
  const f = fixture(t), bound = f.load()['intake-hall']; let reads = 0;
  const assets = { 'intake-hall': { sceneId: bound.sceneId, grid: bound.grid, get source() { reads++; return bound.source; } } };
  const map = { id: 'rescue', level: 'dungeon', nodes: [{ id: 'intake-hall', discovered: true, knownCells: [{ x: 1, y: 1 }] }], edges: [] };
  assert.deepEqual(await renderIllustratedOverview(map, { roomVignettes: assets }), await renderIllustratedOverview(map));
  assert.equal(reads, 0);
});
