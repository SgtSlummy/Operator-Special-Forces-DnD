import { createConcentrationHttp } from '../../../../game/concentration-http.mjs';
import { getGameServices } from '../../../../game/runtime.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = createConcentrationHttp(getGameServices);
export const GET = handlers.concentration;
export const POST = handlers.resolveConcentration;
