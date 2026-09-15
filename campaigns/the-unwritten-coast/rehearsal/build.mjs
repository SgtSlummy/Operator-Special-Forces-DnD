import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseAtlas } from './model.mjs';

export function compileFragment({ atlas, base, modelSource, interfaceSource }) {
  const revision = createHash('sha256').update(atlas).digest('hex');
  const pack = parseAtlas(atlas, revision);
  if (!base.includes('id="undertow-room-scale"') || !base.includes('id="undertow-room-choice"'))
    throw new Error('The room-scale source no longer exposes the expected room controls.');
  if (/<(?:html|head|body)\b|<!doctype/i.test(base)) throw new Error('Expected an inline room-scale fragment.');
  const data = JSON.stringify(pack).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const shapes = { R01:'rect',R02:'slot',R03:'rect',R04:'rect',R05:'ell',R06:'dock',R07:'bent',R08:'rect',R09:'circle',R10:'circle',R11:'rect',R12:'saw',R13:'pentagon',R14:'rect',R15:'cavern',R16:'hex',R17:'rect',R18:'circle' };
  const dimensions = pack.rooms.map(room => [room.width, room.depth, Number(room.vertical.match(/\d+/)[0]), shapes[room.id], room.vertical.replace(/^\d+ ft /, '')]);
  if (!/const rooms=\[[\s\S]*?\];/.test(base)) throw new Error('The room drawing no longer exposes its dimensions.');
  base = base.replace(/const rooms=\[[\s\S]*?\];/, `const rooms=${JSON.stringify(dimensions)};`);
  const escapeHtml = value => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  base = base.replace(/(<select[^>]+id="undertow-room-choice"[^>]*>)[\s\S]*?(<\/select>)/, (_, open, close) => open + pack.rooms.map((room, index) => `<option value="${index}">${escapeHtml(room.id + ' · ' + room.name)}</option>`).join('') + close);
  const source = [modelSource, interfaceSource].join('\n').replace(/^export /gm, '');
  if (/<\/script/i.test(source)) throw new Error('Unexpected script terminator in rehearsal source.');
  const css = `\n<style>
#undertow-room-scale [hidden]{display:none!important}
#undertow-room-scale .undertow-arrival{max-width:70ch}
#undertow-room-scale .undertow-routes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px}
#undertow-room-scale .undertow-route p{margin:6px 0 0;overflow-wrap:anywhere}
#undertow-room-scale details{margin-top:20px}
#undertow-room-scale summary{cursor:pointer}
@media(max-width:520px){#undertow-room-scale .undertow-routes{grid-template-columns:1fr}}
</style>`;
  const fragment = `${base}${css}\n<script>\n(function(){\n${source}\nmountRehearsal(${data}, {newSession, restoreSession, exits, travel, inspectRoom});\n})();\n</script>\n`;
  if (Buffer.byteLength(fragment) >= 1_000_000) throw new Error('Rehearsal exceeds the inline size limit.');
  return { fragment, pack };
}

export async function build(outputPath) {
  if (!isAbsolute(outputPath) || !outputPath.endsWith('.html')) throw new Error('Choose an absolute .html output path.');
  const [atlas, base, modelSource, interfaceSource] = await Promise.all([
    readFile(new URL('../DUNGEON_ATLAS.md', import.meta.url), 'utf8'),
    readFile(new URL('../room-scale.html', import.meta.url), 'utf8'),
    readFile(new URL('./model.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./interface.mjs', import.meta.url), 'utf8')
  ]);
  const { fragment, pack } = compileFragment({ atlas, base, modelSource, interfaceSource });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, fragment, 'utf8');
  const actual = await readFile(outputPath, 'utf8');
  if (actual !== fragment) throw new Error('Output verification failed.');
  return { output: outputPath, rooms: pack.rooms.length, routes: pack.routes.length,
    specialBoundaries: pack.boundaries.length, revision: pack.revision, bytes: Buffer.byteLength(fragment) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--out');
  if (index === -1 || !process.argv[index + 1]) throw new Error('Use --out followed by an absolute .html output path.');
  console.log(JSON.stringify(await build(process.argv[index + 1])));
}
