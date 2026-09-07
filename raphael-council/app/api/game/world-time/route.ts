import { createWorldTimeHttp } from '../../../../game/world-time-http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = createWorldTimeHttp(getGameServices);
export const GET = handlers.worldTime;
export const POST = handlers.changeWorldTime;
