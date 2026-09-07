import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { gameConfig } from './storage.mjs';
let game;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error();
  const bytes = readFileSync(values.file); if (bytes.length > 65536) throw new Error();
  const { campaign, reviewedBy, ...input } = JSON.parse(bytes.toString('utf8'));
  game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  const round = game.prepareCouncil({ campaign, owner: reviewedBy }, input);
  console.log(JSON.stringify({ status: 'council_prepared', round: round.round, packetHash: round.packetHash }));
} catch { console.error('Council setup failed. Review current host membership, the completed debrief, branch evidence and all five mandate ratings.'); process.exitCode = 1; }
finally { game?.close(); }
