import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { gameConfig } from './storage.mjs';
let game;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('A reviewed file is required.');
  const bytes = readFileSync(values.file);
  if (bytes.length > 65536) throw new Error('Mission file is too large.');
  const { campaign, reviewedBy, ...input } = JSON.parse(bytes.toString('utf8'));
  game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  const result = game.configureMission({ campaign, owner: reviewedBy }, input);
  console.log(JSON.stringify({ status: 'mission_linked', revision: result.revision, missionId: result.mission.id }));
} catch { console.error('Mission setup failed. Check the reviewed file, host membership, current encounter and data directory. Existing mission records are never replaced.'); process.exitCode = 1; }
finally { game?.close(); }
