import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CharacterStore } from './store.mjs';

export function characterConfig(env = process.env) {
  const base = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return { dataDir: resolve(env.RAPHAEL_DATA_DIR || join(base, 'Raphael', 'character-importer')) };
}

const singleton = Symbol.for('raphael.characterStore');
export function getCharacterStore() {
  if (!globalThis[singleton] || globalThis[singleton].closed) {
    const store = new CharacterStore(join(characterConfig().dataDir, 'characters.sqlite'));
    const close = store.close.bind(store);
    store.close = () => { if (!store.closed) { close(); store.closed = true; } };
    globalThis[singleton] = store;
  }
  return globalThis[singleton];
}
