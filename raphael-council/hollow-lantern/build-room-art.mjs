import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rooms = [['intake-hall', 0, 0], ['turbine-gallery', 12, 0], ['archive', 0, 12], ['lantern-chamber', 12, 12]];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('A complete signal-dungeon GM terrain projection and a local PNG material are required.'); };

/** Authoring only. Geometry comes from the engine; no actors, objects, clues or labels are painted into terrain. */
export async function renderRoomTerrain(projection, materialBytes) {
  const map = projection?.map;
  if (projection?.audience !== 'gm' || map?.id !== 'signal-dungeon' || map.level !== 'tactical' ||
      map.width !== 25 || map.height !== 25 || map.scaleFeet !== 5 || !Array.isArray(map.cells) || map.cells.length !== 625) fail();
  const cells = new Map();
  for (const c of map.cells) {
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x > 24 || c.y > 24 || !['wall', 'floor'].includes(c.terrain)) fail();
    const key = `${c.x},${c.y}`; if (cells.has(key)) fail(); cells.set(key, c.terrain);
  }
  if (!Buffer.isBuffer(materialBytes) || materialBytes.length < 33 || materialBytes.length > 8 * 1024 * 1024 ||
      !materialBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      materialBytes.toString('ascii', 12, 16) !== 'IHDR' || materialBytes.readUInt32BE(16) > 4096 || materialBytes.readUInt32BE(20) > 4096) fail();
  const material = await loadImage(materialBytes), full = createCanvas(1600, 1600), ctx = full.getContext('2d');
  ctx.drawImage(material, 0, 0, 1600, 1600);
  const layout = [];
  for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
    const terrain = cells.get(`${x},${y}`); layout.push([x, y, terrain]);
    if (terrain !== 'wall') continue;
    const px = x * 64, py = y * 64;
    ctx.fillStyle = '#283737'; ctx.fillRect(px, py, 64, 64);
    // Each wall square is self-contained, so known tiles cannot imply an unseen neighbour's geometry.
    for (let row = 0; row < 3; row++) {
      const inset = row === 1 ? 7 : 4;
      ctx.fillStyle = ['#536261', '#4b5958', '#5e6b66'][(x + y + row) % 3];
      ctx.fillRect(px + inset, py + 4 + row * 19, 64 - inset * 2, 16);
      ctx.strokeStyle = '#9b9b7e'; ctx.lineWidth = 1;
      ctx.strokeRect(px + inset + .5, py + 4.5 + row * 19, 63 - inset * 2, 15);
    }
  }
  const files = new Map(), entries = [];
  for (const [roomId, x, y] of rooms) {
    const canvas = createCanvas(832, 832), room = canvas.getContext('2d');
    room.imageSmoothingEnabled = false; room.drawImage(full, x * 64, y * 64, 832, 832, 0, 0, 832, 832);
    const bytes = canvas.toBuffer('image/png'), file = `${roomId}.png`;
    files.set(file, bytes);
    entries.push({ sceneId: 'signal-dungeon', roomId, approved: false, purpose: 'terrain-only', file, sha256: hash(bytes) });
  }
  return { files, manifest: { version: 1, kind: 'dungeon-room-terrain', coordinateSystem: 'signal-dungeon-25-v1', materialSha256: hash(materialBytes), layoutSha256: hash(JSON.stringify(layout)), entries } };
}

async function main([fixturePath, materialPath, output]) {
  const local = path => typeof path === 'string' && isAbsolute(path) && !/^[\\/]{2}/.test(path) && !/(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(path);
  if (![fixturePath, materialPath, output].every(local)) throw Error('Use three absolute local paths outside OneDrive: fixture, material, new output directory.');
  if (![await realpath(fixturePath), await realpath(materialPath), await realpath(dirname(output))].every(local)) fail();
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (fixture.kind !== 'lantern-room-art-fixture-v1') fail();
  const material = await readFile(materialPath), result = await renderRoomTerrain(fixture.gmProjection, material);
  await mkdir(output); // Deliberately refuses to overwrite an existing review batch.
  for (const [file, bytes] of result.files) await writeFile(join(output, file), bytes, { flag: 'wx' });
  await writeFile(join(output, 'floor-material.png'), material, { flag: 'wx' });
  await writeFile(join(output, 'rooms.json'), JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory: output, rooms: result.files.size, approved: false, layoutSha256: result.manifest.layoutSha256 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
