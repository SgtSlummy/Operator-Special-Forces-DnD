import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SceneImageService } from './service.mjs';
import { createImageProvider } from './provider.mjs';
import { createComfyUiProvider } from './comfyui-provider.mjs';
import { createNanoBananaProvider } from './nano-banana-provider.mjs';
import { getGameStore } from '../game/storage.mjs';
import { resolveTacticalImageScene } from '../game/image-scene.mjs';
import { characterConfig, getCharacterStore } from '../characters/runtime.mjs';

export function imageConfig(env = process.env) {
  const localBase = env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return { dataDir: resolve(env.RAPHAEL_IMAGE_DATA_DIR || join(localBase, 'Raphael', 'scene-images')),
    // All host launchers set cwd to raphael-council; this also survives bundling.
    artRoot: resolve(env.RAPHAEL_ART_ROOT || '../campaign-art/witnesslight'),
    backend: env.RAPHAEL_IMAGE_BACKEND || 'obus',
    comfyUiUrl: env.RAPHAEL_COMFYUI_URL || 'http://127.0.0.1:8188',
    comfyUiWorkflow: env.RAPHAEL_COMFYUI_WORKFLOW ? resolve(env.RAPHAEL_COMFYUI_WORKFLOW) : null,
    nanoBananaUrl: env.RAPHAEL_NANO_BANANA_URL || 'http://127.0.0.1:8000/api/v1' };
}
export function createConfiguredImageProvider(env = process.env) {
  const config = imageConfig(env);
  if (config.backend === 'nano-banana') return createNanoBananaProvider({ baseUrl: config.nanoBananaUrl });
  if (config.backend !== 'comfyui') return createImageProvider();
  if (!config.comfyUiWorkflow) throw new Error('RAPHAEL_COMFYUI_WORKFLOW is required when RAPHAEL_IMAGE_BACKEND=comfyui.');
  const workflow = JSON.parse(readFileSync(config.comfyUiWorkflow, 'utf8').replace(/^\uFEFF/, ''));
  return createComfyUiProvider({ baseUrl: config.comfyUiUrl, workflow });
}
const singleton = Symbol.for('raphael.sceneImageService');
export function getImageService(env = process.env) {
  const portraits = characterConfig(env);
  if (!globalThis[singleton] || globalThis[singleton].closed) globalThis[singleton] = new SceneImageService({ ...imageConfig(env), portraitRoot: portraits.portraitDir,
    provider: createConfiguredImageProvider(env), resolveScene: scope => resolveTacticalImageScene(getGameStore(), scope, {
      resolvePortrait: owner => /^\d{1,20}$/.test(String(owner))
        ? getCharacterStore().portrait({ campaign: scope.campaign, owner: String(owner) })?.path ?? null
        : null,
    }) });
  return globalThis[singleton];
}
