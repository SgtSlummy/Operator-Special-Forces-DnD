import { createSceneImageHttp } from '../../../../images/http.mjs';
import { getImageService } from '../../../../images/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createSceneImageHttp(getImageService);
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlers.job(request, id);
}
