import { createGameHttp } from '../../../../../game/http.mjs';
import { getGameServices } from '../../../../../game/runtime.mjs';
import { getCharacterStore } from '../../../../../characters/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createGameHttp(getGameServices, { getCharacters: getCharacterStore });
export async function GET(request: Request, context: { params: Promise<{ actorId: string }> }) {
  return handlers.characterInfo(request, (await context.params).actorId);
}
