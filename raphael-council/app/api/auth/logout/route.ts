import { authHttp } from '../../../../auth/http.mjs';
export const runtime = 'nodejs';
export const POST = authHttp('logout');
