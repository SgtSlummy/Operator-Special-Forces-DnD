const campaignIdValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
export function selectEntryCampaign(selection,catalog){
 const id=selection===undefined?catalog.defaultCampaignId:selection;
 if(!campaignIdValid(id))throw new TypeError('Invalid campaign selection');
 const descriptor=catalog.get(id);
 if(!descriptor||descriptor.campaignId!==id)throw new TypeError('Unknown campaign');
 return descriptor;
}
export function campaignPath(path,campaignId){
 if(!campaignIdValid(campaignId)||!['/','/hollow-lantern','/api/auth/config','/api/auth/session','/api/auth/discord/start','/api/auth/logout','/api/hollow-lantern/view'].includes(path))throw new TypeError('Invalid campaign entry path');
 return `${path}?campaignId=${encodeURIComponent(campaignId)}`;
}
const knownProblems = new Set(['host_configuration', 'account_access', 'relaunch', 'retry']);

export function entryProblem(recovery) {
  return knownProblems.has(recovery) ? recovery : 'retry';
}

/** Read existing authorization and engine endpoints. Opening the app never
 * enrolls a character, creates a save, or submits a gameplay command. */
export async function inspectCampaign({ fetchImpl, campaignId, signal, timeoutMs = 12000 }) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let signedIn = false;
  const problem = status => ({ status, signedIn });
  async function request(path) {
    requestSignal.throwIfAborted();
    const response = await fetchImpl(campaignPath(path,campaignId), { cache: 'no-store', credentials: 'include', signal: requestSignal });
    let body;
    try { body = await response.json(); } catch { return { response, body: null }; }
    requestSignal.throwIfAborted();
    return { response, body };
  }
  function failed(response, body) {
    if (response.status === 401) { signedIn = false; return problem('sign_in'); }
    if (response.status === 403) return problem('account_access');
    return problem(body?.recovery === 'host_configuration' ? 'host_configuration' : 'retry');
  }
  try {
    const config = await request('/api/auth/config');
    if (!config.response.ok) return failed(config.response, config.body);
    if (config.body?.experience !== 'hollow-lantern' || config.body?.campaignId !== campaignId || !/^\d{17,20}$/.test(config.body?.clientId ?? '')) return problem('host_configuration');
    const session = await request('/api/auth/session');
    if (!session.response.ok) return failed(session.response, session.body);
    // The real session endpoint returns 200 with scope:null for a browser that
    // has never signed in. This is an ordinary entry state, not broken setup.
    if (session.body?.experience === 'hollow-lantern' && session.body.scope === null) return problem('sign_in');
    if (session.body?.experience !== 'hollow-lantern' || session.body?.scope?.campaign !== campaignId || !/^\d{17,20}$/.test(session.body?.scope?.owner ?? '') || !['host', 'player'].includes(session.body?.scope?.role)) return problem('host_configuration');
    signedIn = true;
    const table = await request('/api/hollow-lantern/view');
    if (!table.response.ok) return failed(table.response, table.body);
    if (table.body?.campaignId !== campaignId || !Number.isSafeInteger(table.body?.revision) || table.body.revision < 0) return problem('host_configuration');
    // No character information, credentials, or controls leave this check.
    return { status: 'ready', signedIn, revision: table.body.revision };
  } catch {
    signal.throwIfAborted();
    return problem('retry');
  }
}
