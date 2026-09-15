// Local renderer examples only. These are not Discord captures or campaign acceptance evidence.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderTacticalMap, renderPublicCombatCard } from './renderers.mjs';

const root = process.argv[2];
if (!root) throw new Error('Pass the approved campaign artwork directory containing mara.png, kestrel.png, ash.png and cover.png.');
const portraits = Object.fromEntries(['mara', 'kestrel', 'ash'].map(id => [id, resolve(root, `${id}.png`)]));
const cells = [];
for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
  if (x > 17 || y > 19) continue;
  cells.push({ x, y, terrain: y === 0 || x === 0 || y === 18 ? 'wall' : x > 13 ? 'water' : 'floor', visibility: x > 11 || y < 5 ? 'remembered' : 'visible' });
}
const tokens = [{ characterId: 'mara', displayName: 'Mara', x: 6, y: 12 }, { characterId: 'kestrel', displayName: 'Kestrel', x: 8, y: 10 }, { characterId: 'ash', displayName: 'Ash', x: 5, y: 13 }];
const directory = new URL('./evidence/', import.meta.url); await mkdir(directory, { recursive: true });
await writeFile(new URL('local-tactical-sample.png', directory), await renderTacticalMap({ width: 25, height: 25, cells, tokens, objects: [{ x: 10, y: 12, kind: 'chest' }, { x: 3, y: 8, kind: 'stairs' }] }, { title: 'Local renderer sample · not a live session', portraits }));
await writeFile(new URL('local-public-sample.png', directory), await renderPublicCombatCard({ title: 'Local renderer sample · public party', summary: 'Illustrative composition only; no game action was conducted.', participants: tokens.map(t => ({ characterId: t.characterId, name: t.displayName, publiclyVisible: true })) }, { portraits, sceneArt: resolve(root, 'cover.png') }));
