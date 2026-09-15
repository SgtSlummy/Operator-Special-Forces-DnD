import { createSceneImageHttp } from '../../../../images/http.mjs';
import { getImageService } from '../../../../images/runtime.mjs';

export const runtime = 'nodejs';
const handlers = createSceneImageHttp(getImageService);
export const GET = handlers.history;
