import { getPlatform } from './runtime.mjs';
import { AuthError, guardOrigin, readCookie, sessionCookie } from './discord.mjs';
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
async function authorizationBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('Supply an authorization code.', 400);
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new AuthError('Request too large.', 413);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthError('Invalid authorization JSON.', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'code') || typeof input.code !== 'string') throw new AuthError('Invalid authorization fields.', 400);
  return input;
}
export function authHttp(action, getServices = getPlatform) {
  return async request => {
    try {
      const { auth } = await getServices(), c = auth.config;
      if (action === 'config') return json({ clientId: c.clientId || null });
      if (action === 'session') return json({ scope: await auth.authenticate(request) });
      if (action === 'start') { const { url, state } = auth.start(); return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Set-Cookie': `raph_oauth_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=300` } }); }
      if (action === 'callback') {
        const p = new URL(request.url).searchParams;
        const result = await auth.exchange(p.get('code'), { state: p.get('state'), cookieState: readCookie(request, 'raph_oauth_state') });
        const headers = new Headers({ Location: `${c.publicOrigin}/play`, 'Cache-Control': 'no-store' });
        headers.append('Set-Cookie', sessionCookie(c, result.token)); headers.append('Set-Cookie', 'raph_oauth_state=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
        return new Response(null, { status: 302, headers });
      }
      const origin = guardOrigin(request, c);
      if (action === 'activity') {
        if (origin !== c.activityOrigin) throw new AuthError('Use Discord to authorize this Activity.', 403);
        const input = await authorizationBody(request);
        const result = await auth.exchange(input.code, { activity: true });
        return json({ access_token: result.accessToken, scope: result.scope }, 200, { 'Set-Cookie': sessionCookie(c, result.token, true) });
      }
      if (action === 'logout') {
        auth.logout(request); const response = json({ connected: false });
        response.headers.append('Set-Cookie', sessionCookie(c, '', false)); if (c.activityOrigin) response.headers.append('Set-Cookie', sessionCookie(c, '', true)); return response;
      }
      throw new AuthError('Unknown authentication route.', 404);
    } catch (error) { return json({ error: error instanceof AuthError ? error.message : 'Authentication service unavailable.' }, error instanceof AuthError ? error.status : 503); }
  };
}
