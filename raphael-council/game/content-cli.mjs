import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { gameConfig } from './storage.mjs';
let game;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' }, action: { type: 'string' }, campaign: { type: 'string' }, host: { type: 'string' }, request: { type: 'string' } } });
  if (!['install', 'council', 'departure'].includes(values.action) || !values.campaign || !values.host) throw new Error();
  game = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  const scope = { campaign: values.campaign, owner: values.host };
  let result;
  if (values.action === 'install') {
    const bytes = readFileSync(values.file); if (bytes.length > 1048576) throw new Error();
    result = game.installContent(scope, JSON.parse(bytes.toString('utf8')));
  } else if (values.action === 'council') result = game.prepareContentCouncil(scope);
  else result = game.prepareContentDeparture(scope, values.request);
  console.log(JSON.stringify({ status: 'content_' + values.action, result }));
} catch { console.error('Campaign content operation failed. Check the reviewed pack, host membership, current mission and chosen branch.'); process.exitCode = 1; }
finally { game?.close(); }
