import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { GameStore } from './store.mjs';

export function gameConfig(env = process.env) {
  const base = env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return { dataDir: resolve(env.RAPHAEL_GAME_DATA_DIR || join(base, 'Raphael', 'game')) };
}
const singleton = Symbol.for('raphael.gameStore');
export function getGameStore() {
  if (!globalThis[singleton] || globalThis[singleton].closed) globalThis[singleton] = new GameStore(join(gameConfig().dataDir, 'game.sqlite'));
  return globalThis[singleton];
}
