import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CharacterStore } from '../characters/store.mjs';
import { GameStore } from './store.mjs';
import { gameConfig } from './storage.mjs';
let game, characters;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error();
  const bytes = readFileSync(values.file); if (bytes.length > 16384) throw new Error();
  const { campaign, reviewedBy, ...input } = JSON.parse(bytes.toString('utf8'));
  const base = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const path = join(resolve(process.env.RAPHAEL_DATA_DIR || join(base, 'Raphael', 'character-importer')), 'characters.sqlite');
  if (!existsSync(path)) throw new Error();
  characters = new CharacterStore(path); game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  console.log(JSON.stringify({ status: 'check_requested', check: game.requestCheck(characters, { campaign, owner: reviewedBy }, input) }));
} catch { console.error('Check request failed. Confirm host membership, current scene revision, matching approved sheet and explicit check mechanics.'); process.exitCode = 1; }
finally { game?.close(); characters?.close(); }
