import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gameConfig, getGameStore } from '../game/storage.mjs';
import { DiscordAuth } from './discord.mjs';
import { GameAi } from '../ai/service.mjs';
import { ObusTransport } from '../ai/obus.mjs';
import { createLocalObusHostControl } from '../ai/host-config.mjs';
const key = Symbol.for('raph.platform');
export function getPlatform() {
  if (!globalThis[key]) {
    const { dataDir } = gameConfig(); mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, 'platform.sqlite')); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    const game = getGameStore(), transport = new ObusTransport();
    let control;
    globalThis[key] = { db, auth: new DiscordAuth({ db, game }), ai: new GameAi({ db, transport,
      authorize: scope => game.member(scope),
      configureRuntime: input => (control ??= createLocalObusHostControl({ transport })).configure(input),
    }) }; 
  }
  return globalThis[key];
}
