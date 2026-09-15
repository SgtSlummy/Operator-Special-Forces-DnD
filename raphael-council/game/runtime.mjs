import { getGameStore } from './storage.mjs';
import { getImageService } from '../images/runtime.mjs';
import { getPlatform } from '../auth/runtime.mjs';
import {usesHollowAuthority} from '../hollow-lantern/activity-runtime.mjs';
export { gameConfig, getGameStore } from './storage.mjs';
export function getGameServices() {
  if(usesHollowAuthority())throw Object.assign(new Error('Open the Hollow Lantern Unity table for this campaign.'),{status:409});
  return { game: getGameStore(), access: getImageService(), ...getPlatform() };
}
