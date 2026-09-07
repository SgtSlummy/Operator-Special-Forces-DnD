import { createGameHttp } from '../../../../game/http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';
export const runtime = 'nodejs';
export const GET = createGameHttp(getGameServices).aiStatus;
export const PATCH = createGameHttp(getGameServices).aiConfigure;
export const POST = createGameHttp(getGameServices).aiAsk;
