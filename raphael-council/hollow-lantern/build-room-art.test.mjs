import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderRoomTerrain } from './build-room-art.mjs';
import { renderIllustratedOverview } from '../discord/hollow-lantern/renderers.mjs';
import { presentProjection } from './service.mjs';

function material() { const canvas = createCanvas(32, 32), ctx = canvas.getContext('2d'); ctx.fillStyle = '#99bbaa'; ctx.fillRect(0, 0, 32, 32); return canvas.toBuffer('image/png'); }
function projection() { return { audience: 'gm', map: { id: 'signal-dungeon', level: 'tactical', width: 25, height: 25, scaleFeet: 5, cells: Array.from({ length: 625 }, (_, i) => ({ x: i % 25, y: Math.floor(i / 25), terrain: i % 7 === 0 ? 'wall' : 'floor' })) } }; }

test('every room terrain tile follows the supplied engine geometry at exact grid pixels', async () => {
 const source = projection(), result = await renderRoomTerrain(source, material());
 assert.equal(result.files.size, 4); assert.ok(result.manifest.entries.every(e => e.approved === false));
 for (const [id, ox, oy] of [['intake-hall',0,0],['turbine-gallery',12,0],['archive',0,12],['lantern-chamber',12,12]]) {
  const img = await loadImage(result.files.get(id + '.png')); assert.equal(img.width, 832); assert.equal(img.height, 832);
  const canvas = createCanvas(832, 832), ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
   const pixel = [...ctx.getImageData(x * 64 + 32, y * 64 + 32, 1, 1).data];
   const floor = source.map.cells[(y + oy) * 25 + x + ox].terrain === 'floor';
   assert.equal(JSON.stringify(pixel) === JSON.stringify([153,187,170,255]), floor, `${id} tile ${x},${y}`);
  }
 }
});

test('actors, objects, hidden notes and input ordering cannot affect terrain artwork', async () => {
 const source = projection(), first = await renderRoomTerrain(source, material());
 source.objects = [{ label: 'Secret cache', x: 7, y: 7 }]; source.map.tokens = [{ label: 'Hidden enemy' }]; source.privateHistory = ['Secret clue']; source.map.cells.reverse();
 const next = await renderRoomTerrain(source, material());
 assert.equal(first.manifest.layoutSha256, next.manifest.layoutSha256);
 for (const [name, bytes] of first.files) assert.deepEqual(next.files.get(name), bytes);
});

test('private, incomplete, duplicate, wrong-scene and out-of-bounds geometry cannot be baked', async () => {
 for (const alter of [p => p.audience = 'private', p => p.map.id = 'rescue', p => p.map.cells.pop(), p => p.map.cells[1] = p.map.cells[0], p => p.map.cells[0].x = 25, p => p.map.cells[0].terrain = 'secret-door', p => p.map.scaleFeet = 10]) {
  const source = projection(); alter(source); await assert.rejects(renderRoomTerrain(source, material()));
 }
 await assert.rejects(renderRoomTerrain(projection(), Buffer.from('not a PNG')));
});

if (process.env.LANTERN_ROOM_ART_FIXTURE) test('actual C# fixture survives presentation and masks remembered room terrain in the PNG', async () => {
 const fixture = JSON.parse(await readFile(process.env.LANTERN_ROOM_ART_FIXTURE, 'utf8'));
 assert.equal(fixture.kind, 'lantern-room-art-fixture-v1');
 const result = await renderRoomTerrain(fixture.gmProjection, material());
 const assets = Object.fromEntries([['intake-hall',0,0],['turbine-gallery',12,0],['archive',0,12],['lantern-chamber',12,12]].map(([id,x,y]) => [id, { sceneId: 'signal-dungeon', grid: { x,y,width:13,height:13 }, source: result.files.get(id + '.png') }]));
 const view = presentProjection(fixture.playerProjection), other = presentProjection(fixture.otherProjection);
 assert.equal(view.map.nodes.find(n => n.id === 'turbine-gallery').knownCells.length, 2);
 assert.ok(!other.map.nodes.some(n => n.id === 'turbine-gallery'));
 const first = await renderIllustratedOverview(view.map, { roomVignettes: assets });
 // Change a genuinely unknown interior square of the remote room in the rendered source image.
 const original = await loadImage(assets['turbine-gallery'].source), canvas = createCanvas(832,832), ctx = canvas.getContext('2d'); ctx.drawImage(original,0,0);
 ctx.fillStyle = '#ff00ff'; ctx.fillRect((23-12)*64,7*64,64,64);
 assets['turbine-gallery'] = { ...assets['turbine-gallery'], source: canvas.toBuffer('image/png') };
 assert.deepEqual(await renderIllustratedOverview(view.map,{roomVignettes:assets}), first);
 view.map.nodes.find(n=>n.id==='turbine-gallery').knownCells.push({x:23,y:7});
 assert.notDeepEqual(await renderIllustratedOverview(view.map,{roomVignettes:assets}), first);
});
