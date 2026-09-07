import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { CharacterStore } from '../characters/store.mjs';
import { GameStore } from './store.mjs';
import { gameConfig } from './runtime.mjs';
import { bootstrapCampaign } from './bootstrap.mjs';

let game, characters;
try {
  const { values } = parseArgs({ options: { seed: { type: 'string' } } });
  if (!values.seed) throw new Error('Use --seed HOST_REVIEWED_ENCOUNTER.json. Existing campaigns are never overwritten.');
  const file = resolve(values.seed), raw = readFileSync(file);
  if (raw.length > 1048576) throw new Error('Encounter record is too large.');
  const seed = JSON.parse(raw.toString('utf8'));
  const base = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const characterFile = join(resolve(process.env.RAPHAEL_DATA_DIR || join(base, 'Raphael', 'character-importer')), 'characters.sqlite');
  if (!existsSync(characterFile)) throw new Error('Approve player character sheets before starting an encounter.');
  characters = new CharacterStore(characterFile);
  game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  console.log(JSON.stringify({ ...bootstrapCampaign(game, characters, seed), status: 'created_locally' }));
} catch (error) {
  console.error(error?.code === 'PROFILE' || error?.code === 'EXISTS' ? error.message : 'Encounter setup failed. Check the local input, approved characters and data-directory configuration.');
  process.exitCode = 1;
} finally { game?.close(); characters?.close(); }
