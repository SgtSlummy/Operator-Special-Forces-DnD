import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPortablePack, projectPlayer } from './portable.mjs';

export function parseExportArguments(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const options = {};
  const names = new Map([['--audience','audience'],['--out','output'],['--disclosure','disclosure']]);
  for (let i = 0; i < args.length; i += 2) {
    const key = names.get(args[i]), value = args[i + 1];
    if (!key || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error('Use each documented option once, with a value.');
    options[key] = value;
  }
  if (!['gm','player'].includes(options.audience)) throw new Error('Choose --audience gm or --audience player explicitly.');
  if (!options.output || !isAbsolute(options.output) || !options.output.endsWith(`.${options.audience}.json`))
    throw new Error(`Choose an absolute output filename ending in .${options.audience}.json.`);
  if (options.output.split(/[\\/]/).some(part => /^OneDrive(?: - .*)?$/i.test(part))) throw new Error('Keep campaign exports outside OneDrive.');
  if (options.audience === 'player' && (!options.disclosure || !isAbsolute(options.disclosure)))
    throw new Error('Player export requires an absolute --disclosure file from the GM.');
  if (options.audience === 'gm' && options.disclosure) throw new Error('A disclosure file is only used for player export.');
  return options;
}

/** No network, live state, credentials or automatic grant derivation. Existing exports are preserved. */
export async function exportDocument(options) {
  const checked = parseExportArguments(['--audience', options.audience, '--out', options.output,
    ...(options.disclosure ? ['--disclosure', options.disclosure] : [])]);
  const atlas = await readFile(new URL('../DUNGEON_ATLAS.md', import.meta.url), 'utf8');
  const pack = createPortablePack(atlas);
  let document = pack;
  if (checked.audience === 'player') {
    const info = await stat(checked.disclosure);
    if (!info.isFile() || info.size > 32000) throw new Error('Disclosure must be a JSON file under 32 KB.');
    const content = await readFile(checked.disclosure, 'utf8');
    if (Buffer.byteLength(content) > 32000) throw new Error('Disclosure exceeds 32 KB.');
    document = projectPlayer(pack, JSON.parse(content));
  }
  const content = JSON.stringify(document, null, 2) + '\n';
  await mkdir(dirname(checked.output), { recursive: true });
  await writeFile(checked.output, content, { encoding: 'utf8', flag: 'wx' });
  if (await readFile(checked.output, 'utf8') !== content) throw new Error('Export verification failed.');
  // Deliberately omit GM/private pack totals and paths from a player-facing result.
  return { audience: checked.audience, bytes: Buffer.byteLength(content), verified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseExportArguments(process.argv.slice(2));
  if (!options) console.log('Use --audience gm|player --out ABSOLUTE.gm.json|ABSOLUTE.player.json. Player exports also require --disclosure ABSOLUTE.json. Existing files are never overwritten.');
  else console.log(JSON.stringify(await exportDocument(options)));
}
