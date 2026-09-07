import { createChronicleHttp } from '../../../../chronicle/http.mjs';

export const runtime = 'nodejs';
const http = createChronicleHttp();
export const GET = http.get;
export const POST = http.post;
