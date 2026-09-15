import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const rooms = Object.freeze({ 'intake-hall': [0, 0], 'turbine-gallery': [12, 0], archive: [0, 12], 'lantern-chamber': [12, 12] });
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = () => { throw new Error('HOLLOW_LANTERN_ROOM_ART_INVALID'); };
const oneDrive = path => /(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(path);

/** Reviewed terrain-only PNGs. Room grids are fixed by the signal-dungeon engine layout. */
export function loadHollowLanternRoomArt(manifestPath) {
  try {
    if (typeof manifestPath !== 'string' || !isAbsolute(manifestPath) || /^[\\/]{2}/.test(manifestPath) || oneDrive(manifestPath)) invalid();
    const path = realpathSync(manifestPath), root = dirname(path);
    if (/^[\\/]{2}/.test(path) || oneDrive(path) || !statSync(path).isFile() || statSync(path).size > 65536) invalid();
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!manifest || manifest.version !== 1 || manifest.kind !== 'dungeon-room-terrain' ||
        manifest.coordinateSystem !== 'signal-dungeon-25-v1' || !Array.isArray(manifest.entries) || manifest.entries.length > 4) invalid();
    const output = Object.create(null);
    for (const entry of manifest.entries) {
      if (!entry || entry.sceneId !== 'signal-dungeon' || !Object.hasOwn(rooms, entry.roomId) ||
          Object.hasOwn(output, entry.roomId) || entry.approved !== true || entry.purpose !== 'terrain-only' ||
          typeof entry.file !== 'string' || !entry.file || isAbsolute(entry.file) || /^[\\/]/.test(entry.file) ||
          !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) invalid();
      const image = realpathSync(resolve(root, entry.file)), nested = relative(root, image);
      if (nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested) || oneDrive(image) ||
          !statSync(image).isFile() || statSync(image).size > 8 * 1024 * 1024) invalid();
      const bytes = readFileSync(image);
      if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
          createHash('sha256').update(bytes).digest('hex') !== entry.sha256) invalid();
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width % 13 || height % 13 || width > 3328 || height > 3328) invalid();
      const [x, y] = rooms[entry.roomId];
      output[entry.roomId] = Object.freeze({ sceneId: entry.sceneId, grid: Object.freeze({ x, y, width: 13, height: 13 }), source: Buffer.from(bytes) });
    }
    return Object.freeze(output);
  } catch { invalid(); }
}
