import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { gameConfig } from './storage.mjs';
let game;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' }, prepare: { type: 'boolean', default: false } } });
  if (!values.file) throw new Error();
  const bytes = readFileSync(values.file); if (bytes.length > 262144) throw new Error();
  const { campaign, reviewedBy, ...input } = JSON.parse(bytes.toString('utf8'));
  game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  const receipt = game[values.prepare ? 'prepareDeparture' : 'transitionScene']({ campaign, owner: reviewedBy }, input);
  console.log(JSON.stringify({ status: values.prepare ? 'departure_prepared' : 'scene_activated', ...receipt }));
} catch { console.error('Scene activation failed. Check host membership, the selected council branch, current revisions, destination profiles and party placements.'); process.exitCode = 1; }
finally { game?.close(); }
