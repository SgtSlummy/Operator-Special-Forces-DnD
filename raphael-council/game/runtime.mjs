import { getGameStore } from './storage.mjs';
import { getImageService } from '../images/runtime.mjs';
import { getPlatform } from '../auth/runtime.mjs';
export { gameConfig, getGameStore } from './storage.mjs';
export function getGameServices() {
  return { game: getGameStore(), access: getImageService(), ...getPlatform() };
}
