import {appHealth} from '../../../hollow-lantern/app-health.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = () => appHealth();
