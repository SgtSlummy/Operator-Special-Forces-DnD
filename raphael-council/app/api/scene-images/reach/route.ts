import { createSceneImageHttp } from '../../../../images/http.mjs';
import { getImageService } from '../../../../images/runtime.mjs';
import { getGameStore } from '../../../../game/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createSceneImageHttp(getImageService, { getGame: getGameStore });
export const GET = handlers.reachOptions;
export const POST = handlers.reach;
