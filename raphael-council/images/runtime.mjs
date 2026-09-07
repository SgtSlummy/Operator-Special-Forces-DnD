import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { SceneImageService } from './service.mjs';
import { createImageProvider } from './provider.mjs';
import { getGameStore } from '../game/storage.mjs';
import { resolveTacticalImageScene } from '../game/image-scene.mjs';

export function imageConfig(env = process.env) {
  const localBase = env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return { dataDir: resolve(env.RAPHAEL_IMAGE_DATA_DIR || join(localBase, 'Raphael', 'scene-images')),
    // All host launchers set cwd to raphael-council; this also survives bundling.
    artRoot: resolve(env.RAPHAEL_ART_ROOT || '../campaign-art/witnesslight') };
}
const singleton = Symbol.for('raphael.sceneImageService');
export function getImageService() {
  if (!globalThis[singleton] || globalThis[singleton].closed) globalThis[singleton] = new SceneImageService({ ...imageConfig(), provider: createImageProvider(), resolveScene: scope => resolveTacticalImageScene(getGameStore(), scope) });
  return globalThis[singleton];
}
