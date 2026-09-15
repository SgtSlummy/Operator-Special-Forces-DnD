import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CharacterStore } from './store.mjs';
import { CharacterPortraitService } from './portrait-service.mjs';
import { createConfiguredImageProvider } from '../images/runtime.mjs';

export function characterConfig(env = process.env) {
  const base = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  const dataDir = resolve(env.RAPHAEL_DATA_DIR || join(base, 'Raphael', 'character-importer'));
  return { dataDir, portraitDir: resolve(env.RAPHAEL_PORTRAIT_DATA_DIR || join(dataDir, 'portraits')),
    portraitEnabled: env.RAPHAEL_PORTRAIT_ENABLED === '1' };
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

export function getCharacterPortraitService(env = process.env) {
  const config = characterConfig(env);
  if (!config.portraitEnabled) return null;
  const singleton = Symbol.for('raphael.characterPortraitService');
  if (!globalThis[singleton]) globalThis[singleton] = new CharacterPortraitService({
    store: getCharacterStore(), provider: createConfiguredImageProvider(env), dataDir: config.portraitDir,
  });
  return globalThis[singleton];
}
