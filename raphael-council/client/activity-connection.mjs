const experiences = new Set(['hollow-lantern', 'legacy']);
const recoveryTypes = new Set(['host_configuration', 'account_access', 'relaunch', 'retry']);

export class ActivityConnectionError extends Error {
  constructor(message, code, recovery) {
    super(message);
    this.name = 'ActivityConnectionError';
    this.code = code;
    this.recovery = recovery;
  }
}

export function connectionProblem(error) {
  if (error instanceof ActivityConnectionError) return error;
  // SDK failures may contain provider data. Only display our own bounded text.
  return new ActivityConnectionError('Discord could not finish connecting this Activity.', 'connection_failed', 'retry');
}

function serverProblem(body, status) {
  const code = typeof body?.code === 'string' && /^[a-z_]{1,40}$/.test(body.code) ? body.code : 'service_unavailable';
  const recovery = recoveryTypes.has(body?.recovery) ? body.recovery : status === 403 ? 'account_access' : 'retry';
  const knownMessages = {
    origin_not_allowed: 'Discord’s sign-in request did not come through the expected game connection. The host needs to check the Activity setup.',
    activity_origin_required: 'Launch Davy Jones from Discord to authorize this Activity.',
    campaign_unavailable: 'Your campaign is temporarily unavailable. Try connecting again shortly.',
    campaign_not_enrolled: 'This account does not have a seat in this campaign. Switch to the enrolled Discord account or ask the DM to enroll this account.',
    campaign_ineligible: 'This account is not currently eligible for this campaign. Ask the DM to check its server access.',
    gm_access_revoked: 'This account no longer has DM access. Ask the campaign host to check its permissions.',
    discord_identity_unverified: 'Discord could not confirm this sign-in. Close the Activity and launch it again.',
    discord_membership_unverified: 'Discord could not verify your server access. Try again shortly; if it continues, the host needs to check the bot’s server connection.',
  };
  const message = Object.hasOwn(knownMessages, code) ? knownMessages[code] : {
    host_configuration: 'Davy’s sign-in configuration needs a host repair before this Activity can connect.',
    account_access: 'This Discord account cannot open the campaign table. Use the enrolled account, or ask the DM to enroll this account.',
    relaunch: 'This authorization is no longer valid. A fresh Activity launch will request a new authorization.',
    retry: 'The game connection is temporarily unavailable. You can try connecting again.',
  }[recovery];
  const viewerCodes = new Set(['campaign_not_enrolled', 'campaign_ineligible', 'gm_access_revoked', 'discord_membership_unverified', 'campaign_unavailable', 'account_access', 'service_unavailable']);
  const viewer = body?.viewer;
  let identity = '';
  if (viewerCodes.has(code) && viewer && typeof viewer === 'object' && !Array.isArray(viewer)
      && Object.hasOwn(viewer, 'id') && typeof viewer.id === 'string' && /^\d{17,20}$/.test(viewer.id)) {
    const username = Object.hasOwn(viewer, 'username') && typeof viewer.username === 'string'
      && /^[A-Za-z0-9_.]{1,32}$/.test(viewer.username) ? viewer.username : null;
    identity = username ? `Signed in as @${username} (${viewer.id}). ` : `Signed in as Discord account ${viewer.id}. `;
  }
  return new ActivityConnectionError(identity + message, code, recovery);
}

/** Connect only to the experience chosen by the server. Credentials stay inside
 * this call; they are never returned, logged, or stored in browser storage.
 * @param {{fetchImpl: Function, createSDK: Function, signal: AbortSignal,
 * onProgress?: Function, timeoutMs?: number, state?: Function}} options */
export async function connectActivity({ fetchImpl, createSDK, signal, onProgress = () => {}, timeoutMs = 20000, state = () => crypto.randomUUID() }) {
  const check = () => signal.throwIfAborted();
  const advance = message => { check(); onProgress(message); };
  // Cancellation stops subsequent steps, including an old consent result after
  // unmount. Consent itself has no timer: the person may take time to read it.
  async function wait(work, timed = true) {
    check();
    let timer, abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (timed) timer = setTimeout(() => reject(new ActivityConnectionError('The connection took too long to respond.', 'connection_timeout', 'retry')), timeoutMs);
    });
    try { const result = await Promise.race([Promise.resolve().then(() => { check(); return work(); }), interrupted]); check(); return result; }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await wait(async () => {
        const response = await fetchImpl(path, { cache: 'no-store', credentials: 'include', ...options, signal: controller.signal });
        let body;
        try { body = await response.json(); } catch { throw new ActivityConnectionError('The game host returned an unreadable connection response.', 'invalid_response', 'host_configuration'); }
        if (!response.ok) throw serverProblem(body, response.status);
        return body;
      });
    } finally { controller.abort(); signal.removeEventListener('abort', abort); }
  }

  advance('Checking the game connection…');
  const config = await request('/api/auth/config');
  if (!/^\d{17,20}$/.test(config?.clientId ?? '') || !experiences.has(config?.experience) || typeof config?.campaignId !== 'string' || !config.campaignId) {
    throw new ActivityConnectionError('The host has not configured a supported campaign for this Activity.', 'invalid_configuration', 'host_configuration');
  }
  advance('Connecting to Discord…');
  const sdk = await wait(() => createSDK(config.clientId));
  await wait(() => sdk.ready());
  advance('Waiting for your Discord authorization…');
  const authorization = await wait(() => sdk.commands.authorize({ client_id: config.clientId, response_type: 'code', state: state(), prompt: 'none', scope: ['identify'] }), false);
  if (typeof authorization?.code !== 'string' || !authorization.code) throw new ActivityConnectionError('Discord did not grant authorization to this Activity.', 'authorization_missing', 'relaunch');
  advance('Checking your campaign access…');
  const exchange = await request('/api/auth/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: authorization.code }) });
  const sameCampaign = value => value?.experience === config.experience && value?.scope?.campaign === config.campaignId && /^\d{17,20}$/.test(value?.scope?.owner ?? '') && typeof value?.scope?.role === 'string' && value.scope.role.length > 0;
  if (!sameCampaign(exchange) || typeof exchange?.access_token !== 'string' || !exchange.access_token) throw new ActivityConnectionError('The campaign connection changed while signing in. The host needs to check the Activity binding.', 'campaign_mismatch', 'host_configuration');
  advance('Confirming your private game session…');
  await wait(() => sdk.commands.authenticate({ access_token: exchange.access_token }));
  const session = await request('/api/auth/session');
  if (!sameCampaign(session) || session.scope.owner !== exchange.scope.owner) throw new ActivityConnectionError('The private session does not match this Discord sign-in.', 'session_mismatch', 'host_configuration');
  return { experience: session.experience, scope: session.scope };
}
