import { createGameHttp } from '../../../../../game/http.mjs';
import { getGameServices } from '../../../../../game/runtime.mjs';
import { getCharacterStore } from '../../../../../characters/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createGameHttp(getGameServices, { getCharacters: getCharacterStore });
export const GET = handlers.checkRequestOptions;
export const POST = handlers.requestCheck;
