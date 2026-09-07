import { createGameHttp } from '../../../../game/http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';
export const runtime = 'nodejs';
const handlers = createGameHttp(getGameServices);
export const GET = handlers.checks;
export const POST = handlers.resolveCheck;
