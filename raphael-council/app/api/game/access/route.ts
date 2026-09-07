import { createGameHttp } from '../../../../game/http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createGameHttp(getGameServices);
export const POST = handlers.connect;
export const DELETE = handlers.disconnect;
