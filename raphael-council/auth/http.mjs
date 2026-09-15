import { getPlatform, authCampaignRequest } from './runtime.mjs';
import { AuthError, authErrorViewer, authCookieName, guardOrigin, readCookie, sessionCookie } from './discord.mjs';
import { usesHollowAuthority } from '../hollow-lantern/activity-runtime.mjs';
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
    let browserCampaign = ['start', 'callback'].includes(action) && usesHollowAuthority();
    let stateCookie='raph_oauth_state',campaignSuffix='';
    try {
      const normalized=authCampaignRequest(request);
      const platform = await getServices(normalized.request), { auth } = platform, c = auth.config;
      stateCookie=authCookieName(c,'raph_oauth_state');
      if(c.cookieNamespace!==undefined){
        if(!/^[A-Za-z0-9_-]{1,64}$/.test(c.campaign??''))throw new AuthError('Invalid campaign configuration.',503,'host_configuration');
        const selected=new URL(normalized.request.url).searchParams.get('campaignId');
        if(selected&&selected!==c.campaign)throw new AuthError('Campaign selection did not match.',403);
        campaignSuffix=`?campaignId=${encodeURIComponent(c.campaign)}`;
      }
      const experience = platform.experience === 'hollow-lantern' ? 'hollow-lantern' : 'legacy';
      browserCampaign = experience === 'hollow-lantern' && ['start', 'callback'].includes(action);
      if (action === 'config') return json({ clientId: c.clientId || null, experience, campaignId:c.campaign || null });
      if (action === 'session') return json({ scope: await auth.authenticate(request), experience });
      if (action === 'start') { const { url, state } = auth.start();const destination=new URL(url);if(c.cookieNamespace!==undefined)destination.searchParams.set('state',`hl.${Buffer.from(c.campaign).toString('base64url')}.${state}`); return new Response(null, { status: 302, headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Set-Cookie': `${stateCookie}=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=300` } }); }
      if (action === 'callback') {
        const p = new URL(request.url).searchParams;
        if(c.cookieNamespace!==undefined&&!p.get('state')?.startsWith('hl.'))throw new AuthError('Sign-in campaign state is required.',400);
        const result = await auth.exchange(p.get('code'), { state: normalized.state, cookieState: readCookie(request, stateCookie) });
        const headers = new Headers({ Location: `${c.publicOrigin}${experience === 'hollow-lantern' ? (result.scope.role==='prospective'?'/hollow-lantern/join':'/hollow-lantern') : '/play'}${campaignSuffix}`, 'Cache-Control': 'no-store' });
        headers.append('Set-Cookie', sessionCookie(c, result.token)); headers.append('Set-Cookie', `${stateCookie}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
        return new Response(null, { status: 302, headers });
      }
      const origin = guardOrigin(request, c);
      if (action === 'activity') {
        if (origin !== c.activityOrigin) throw new AuthError('Use Discord to authorize this Activity.', 403, 'activity_origin_required');
        const input = await authorizationBody(request);
        const result = await auth.exchange(input.code, { activity: true });
        return json({ access_token: result.accessToken, scope: result.scope, experience }, 200, { 'Set-Cookie': sessionCookie(c, result.token, true) });
      }
      if (action === 'logout') {
        auth.logout(request); const response = json({ connected: false });
        response.headers.append('Set-Cookie', sessionCookie(c, '', false)); if (c.activityOrigin) response.headers.append('Set-Cookie', sessionCookie(c, '', true)); return response;
      }
      throw new AuthError('Unknown authentication route.', 404);
    } catch (error) {
      if (browserCampaign) {
        const recovery = error instanceof AuthError && ['host_configuration','account_access','relaunch','retry'].includes(error.recovery) ? error.recovery : 'retry';
        return new Response(null, {status:303, headers:{Location:`/?connection=${recovery}${campaignSuffix?`&${campaignSuffix.slice(1)}`:''}`, 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'Set-Cookie':`${stateCookie}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
      }
      const viewer=error instanceof AuthError?authErrorViewer(error):undefined;
      return json({ error: error instanceof AuthError ? error.message : 'Authentication service unavailable.',code:error instanceof AuthError?error.code:'service_unavailable',recovery:error instanceof AuthError?error.recovery:'retry',...(viewer?{viewer}:{}) }, error instanceof AuthError ? error.status : 503);
    }
  };
}
