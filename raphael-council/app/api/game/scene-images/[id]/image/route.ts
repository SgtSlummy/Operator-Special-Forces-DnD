import { createGameHttp } from '../../../../../../game/http.mjs';
import { getGameServices } from '../../../../../../game/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createGameHttp(getGameServices);
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.imageContent(request, (await context.params).id);
}
