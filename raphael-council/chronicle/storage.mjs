import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ChronicleStore } from './store.mjs';

export function chronicleConfig(campaign, env = process.env) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaign)) throw new Error('Invalid chronicle campaign');
  const localBase = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return { enabled: env.RAPHAEL_CHRONICLE_ENABLED === '1',
    dataDir: resolve(env.RAPHAEL_CHRONICLE_DATA_DIR || join(localBase, 'Raphael', 'chronicle', campaign)) };
}
const key = Symbol.for('raphael.chronicle.readers');
export function getChronicleStore(campaign) {
  const { dataDir } = chronicleConfig(campaign);
  const stores = globalThis[key] ||= new Map();
  if (!stores.has(dataDir)) stores.set(dataDir, new ChronicleStore(join(dataDir, 'chronicle.sqlite')));
  return stores.get(dataDir);
}
