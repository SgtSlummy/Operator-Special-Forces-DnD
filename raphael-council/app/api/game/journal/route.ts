import { createGameHttp } from '../../../../game/http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';

export const runtime = 'nodejs';
export const GET = createGameHttp(getGameServices).journal;
