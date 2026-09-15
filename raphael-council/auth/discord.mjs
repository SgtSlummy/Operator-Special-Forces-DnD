import { randomBytes, createHash } from 'node:crypto';
import { discordCampaignAuthority, discordCampaignBindings } from './discord-policy.mjs';
const recoveries = Object.freeze({ invalid_client:'host_configuration', invalid_request:'host_configuration', unauthorized_client:'host_configuration', unsupported_grant_type:'host_configuration', invalid_scope:'host_configuration', host_configuration:'host_configuration', origin_not_allowed:'host_configuration', activity_origin_required:'relaunch', campaign_unavailable:'retry', campaign_not_enrolled:'account_access', campaign_ineligible:'account_access', gm_access_revoked:'account_access', discord_identity_unverified:'relaunch', discord_membership_unverified:'retry', invalid_grant:'relaunch', session_expired:'relaunch', access_denied:'account_access', account_access:'account_access', temporarily_unavailable:'retry', server_error:'retry', service_unavailable:'retry', authorization_failed:'retry', invalid_input:'relaunch' });
export class AuthError extends Error { constructor(message, status = 401, code) { super(message); this.status = status; this.code = Object.hasOwn(recoveries,code) ? code : status===403?'account_access':status>=500?'service_unavailable':status===401?'session_expired':'invalid_input'; this.recovery = recoveries[this.code]; } }
const hash = value => createHash('sha256').update(value).digest('hex');
const snowflake = value => /^\d{17,20}$/.test(value || '');
const API = 'https://discord.com/api/v10';
const verifiedViewers = new WeakMap();
export function authErrorViewer(error) { const viewer=verifiedViewers.get(error);return viewer?{...viewer}:undefined; }
function withViewer(error, user) {
  if (error instanceof AuthError && typeof user?.id==='string' && snowflake(user.id)) verifiedViewers.set(error,Object.freeze({id:user.id,...(typeof user.username==='string'&&/^[A-Za-z0-9_.]{1,32}$/.test(user.username)?{username:user.username}:{})}));
  return error;
}
const tokenErrors = Object.freeze({
  invalid_client: 'Discord could not verify the application configuration (invalid_client). The host needs to check the OAuth application credentials.',
  invalid_grant: 'This Discord authorization has expired or cannot be used (invalid_grant). Close the Activity and launch it again for fresh consent.',
  invalid_request: 'Discord rejected the sign-in request (invalid_request). The host needs to check the OAuth exchange configuration.',
  unauthorized_client: 'This application is not permitted to use the sign-in flow (unauthorized_client). The host needs to check its OAuth settings.',
  unsupported_grant_type: 'Discord does not support the configured sign-in flow (unsupported_grant_type). The host needs to check the OAuth exchange configuration.',
  invalid_scope: 'Discord rejected the requested sign-in permissions (invalid_scope). The host needs to check the requested scopes.',
  access_denied: 'Discord authorization was denied (access_denied). Close the Activity and launch it again if you want to authorize it.',
  temporarily_unavailable: 'Discord sign-in is temporarily unavailable (temporarily_unavailable). Try again shortly.',
  server_error: 'Discord could not finish sign-in (server_error). Try again shortly.',
});
// Inspect only a bounded JSON error name. Never reflect descriptions or payloads:
// invalid_grant alone does not establish a PKCE failure.
async function tokenFailure(response) {
  const fallback = {message:'Discord sign-in failed. Close the Activity and try a fresh launch; if it continues, ask the host to check the OAuth configuration.',code:response.status>=500||response.status===429?'service_unavailable':'authorization_failed'};
  const reader = response.body?.getReader();
  if (!reader) return fallback;
  try {
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)return fallback;chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const value=JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value.error==='string' && Object.hasOwn(tokenErrors,value.error) ? {message:tokenErrors[value.error],code:value.error} : fallback;
  } catch { return fallback; }
  finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
export function authConfig(env = process.env) {
  return { clientId: env.DISCORD_CLIENT_ID, secret: env.DISCORD_CLIENT_SECRET, token: env.DISCORD_TOKEN,
    ...discordCampaignBindings(env),
    publicOrigin: env.RAPHAEL_PUBLIC_ORIGIN?.replace(/\/$/, ''),
    activityOrigin: snowflake(env.DISCORD_CLIENT_ID) ? `https://${env.DISCORD_CLIENT_ID}.discordsays.com` : null };
}
export function guardOrigin(request, config = authConfig()) {
  const origin = request.headers.get('origin'), own = new URL(request.url).origin;
  const allowed = [config.publicOrigin, config.activityOrigin, ...(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(own) ? [own] : [])].filter(Boolean);
  if (!origin || !allowed.includes(origin)) throw new AuthError('Open the authorized game before changing it.', 403, 'origin_not_allowed');
  return origin;
}
export function authCookieName(config, base) {
  if(config.cookieNamespace===undefined)return base;
  if(!/^[a-f0-9]{24}$/.test(config.cookieNamespace))throw new AuthError('Invalid campaign cookie configuration.',503,'host_configuration');
  return `${base}_${config.cookieNamespace}`;
}
export function sessionCookie(config, token, activity = false) {
  const name = authCookieName(config, activity ? 'raph_activity_session' : 'raph_web_session');
  const base = `${name}=${token}; Path=${activity ? '/' : '/api'}; HttpOnly; Max-Age=${token ? 43200 : 0}`;
  return activity ? `${base}; Secure; SameSite=None; Partitioned; Domain=${new URL(config.activityOrigin).hostname}` : `${base}; SameSite=Lax${config.publicOrigin?.startsWith('https:') ? '; Secure' : ''}`;
}
export function readCookie(request, name) {
  const values = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1); return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export class DiscordAuth {
  #memberFlights = new Map();
  constructor({ db, game, config = authConfig(), fetchImpl = fetch, now = Date.now, verifyMember }) {
    Object.assign(this, { db, game, config, fetch: fetchImpl, now, verifyMember });
    db.exec(`CREATE TABLE IF NOT EXISTS browser_sessions(hash TEXT PRIMARY KEY,owner TEXT,campaign TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,expires INTEGER);`);
  }
  async discord(path, bearer) {
    const identity=path==='/users/@me', failure=()=>new AuthError('Discord identity or membership could not be verified.',identity?401:503,identity?'discord_identity_unverified':'discord_membership_unverified');
    let response;
    try { response = await this.fetch(`${API}${path}`, { headers: { Authorization: bearer }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw failure(); }
    if (!response.ok) {
      if(response.status>=500||response.status===429)throw new AuthError('Discord is temporarily unavailable.',503,'service_unavailable');
      const memberPrefix=`/guilds/${this.config.guild}/members/`;
      if(response.status===404&&path.startsWith(memberPrefix)&&snowflake(path.slice(memberPrefix.length)))throw new AuthError('You are not a current campaign member.',401,'campaign_ineligible');
      throw failure();
    }
    try { return await response.json(); } catch { throw failure(); }
  }
  async member(owner) {
    const configuration = this.config, signature = JSON.stringify(configuration);
    let entry = this.#memberFlights.get(owner);
    if (!entry || entry.configuration !== configuration || entry.signature !== signature) {
      entry = {configuration,signature,promise:this.#readMember(owner)};
      this.#memberFlights.set(owner,entry);
    }
    try { return structuredClone(await entry.promise); }
    catch(error) {
      // Callers attach verified-viewer metadata to errors; never share that object.
      if (error instanceof AuthError) throw new AuthError(error.message,error.status,error.code);
      throw error;
    }
    finally {
      // No resolved authorization cache, even for the next call in this turn.
      if (this.#memberFlights.get(owner) === entry) this.#memberFlights.delete(owner);
    }
  }
  async #readMember(owner) {
    const c = structuredClone(this.config);
    if (!snowflake(owner) || !snowflake(c.guild) || !c.token || !c.campaign) throw new AuthError('Discord sign-in is not configured.', 503, 'host_configuration');
    if(c.admissionEnabled===true&&typeof this.verifyMember==='function'){
      if(!await this.verifyMember({campaignId:c.campaign,userId:owner}))throw new AuthError('Current campaign membership could not be verified.',503,'discord_membership_unverified');
      return this.campaignRole(owner,c,c.dmIds.includes(owner));
    }
    const member = await this.discord(`/guilds/${c.guild}/members/${owner}`, `Bot ${c.token}`);
    const roles = member.roles || [];
    // Bot permission calculation for a fetched member requires guild role data.
    const guild = await this.discord(`/guilds/${c.guild}`, `Bot ${c.token}`);
    const guildRoles = await this.discord(`/guilds/${c.guild}/roles`, `Bot ${c.token}`);
    let permissions = 0n;
    for (const r of guildRoles) if (r.id === c.guild || roles.includes(r.id)) permissions |= BigInt(r.permissions || '0');
    if(c.admissionEnabled===true){
      if(member.user?.bot===true||member.pending===true||!snowflake(c.admissionChannel))throw new AuthError('Current campaign membership is required.',403,'campaign_ineligible');
      const channel=await this.discord(`/channels/${c.admissionChannel}`,`Bot ${c.token}`);
      if(channel.guild_id!==c.guild||channel.id!==c.admissionChannel||!Array.isArray(channel.permission_overwrites))throw new AuthError('Campaign channel verification unavailable.',503,'campaign_unavailable');
      if(guild.owner_id!==owner&&!(permissions&8n)){
        const everyone=channel.permission_overwrites.find(r=>r.id===c.guild&&r.type===0);if(everyone)permissions=(permissions&~BigInt(everyone.deny))|BigInt(everyone.allow);
        let allow=0n,deny=0n;for(const r of channel.permission_overwrites)if(r.type===0&&roles.includes(r.id)){allow|=BigInt(r.allow);deny|=BigInt(r.deny);}permissions=(permissions&~deny)|allow;
        const personal=channel.permission_overwrites.find(r=>r.type===1&&r.id===owner);if(personal)permissions=(permissions&~BigInt(personal.deny))|BigInt(personal.allow);
        if(!(permissions&1024n))throw new AuthError('This campaign channel is unavailable to your account.',403,'campaign_ineligible');
      }
    }
    const { host, eligible } = discordCampaignAuthority({ owner, member, config: c, permissions, guildOwnerId: guild.owner_id });
    if (!eligible) throw new AuthError('You are not a current campaign member.', 403,'campaign_ineligible');
    return this.campaignRole(owner,c,host);
  }
  async campaignRole(owner,c,host){
    const scope = { campaign: c.campaign, owner }; let role;
    try { role = await (typeof this.game.readMember === 'function' ? this.game.readMember(scope) : this.game.member(scope)); }
    catch { throw new AuthError('The campaign membership source is temporarily unavailable.',503,'campaign_unavailable'); }
    if (!role && c.admissionEnabled===true) role='prospective';
    if (!role) throw new AuthError('You do not have a campaign seat yet. Ask the DM to enroll this Discord account.',403,'campaign_not_enrolled');
    // A saved host role cannot outlive current Discord host authorization.
    if (role === 'host' && !host) throw new AuthError('Your GM access has been revoked.', 403,'gm_access_revoked');
    return { ...scope, role };
  }
  async authenticate(request) {
    const token = readCookie(request, authCookieName(this.config,'raph_activity_session')) || readCookie(request, authCookieName(this.config,'raph_web_session'));
    if (!token) return null;
    const row = this.db.prepare('SELECT * FROM browser_sessions WHERE hash=?').get(hash(token));
    if (!row || row.expires <= this.now() || row.campaign !== this.config.campaign) throw new AuthError('Sign in again.');
    try { return await this.member(row.owner); } catch(error) { throw withViewer(error,{id:row.owner}); }
  }
  start() {
    const c = this.config;
    if (!snowflake(c.clientId) || !c.secret || !c.publicOrigin?.startsWith('https://')) throw new AuthError('Configure the Discord application and public HTTPS address.', 503, 'host_configuration');
    const state = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO oauth_states VALUES(?,?)').run(hash(state), this.now() + 300000);
    const params = new URLSearchParams({ client_id: c.clientId, response_type: 'code', redirect_uri: `${c.publicOrigin}/api/auth/discord/callback`, scope: 'identify', state });
    return { url: `https://discord.com/oauth2/authorize?${params}`, state };
  }
  async exchange(code, { activity = false, state, cookieState } = {}) {
    const c = this.config;
    if (!c.secret || !snowflake(c.clientId)) throw new AuthError('Discord sign-in is not configured.',503,'host_configuration');
    if (typeof code !== 'string' || !code || code.length > 2048) throw new AuthError('Invalid Discord authorization.');
    if (!activity) {
      if (!state || state !== cookieState || !/^[a-f0-9]{64}$/.test(state)) throw new AuthError('Sign-in state did not match.');
      const row = this.db.prepare('DELETE FROM oauth_states WHERE hash=? RETURNING expires').get(hash(state));
      if (!row || row.expires <= this.now()) throw new AuthError('Sign-in request expired.');
    }
    const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, grant_type: 'authorization_code', code });
    if (!activity) body.set('redirect_uri', `${c.publicOrigin}/api/auth/discord/callback`);
    const response = await this.fetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) { const failure=await tokenFailure(response); throw new AuthError(failure.message,401,failure.code); }
    const tokens = await response.json();
    if (!tokens.access_token || !(tokens.scope || '').split(' ').includes('identify')) throw new AuthError('Discord identity permission is required.');
    const user = await this.discord('/users/@me', `Bearer ${tokens.access_token}`);
    if(typeof user?.id!=='string'||!snowflake(user.id))throw new AuthError('Discord identity could not be verified.',401,'discord_identity_unverified');
    let scope;try { scope=await this.member(user.id); } catch(error) { throw withViewer(error,user); }
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM browser_sessions WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?)').run(hash(token), scope.owner, scope.campaign, this.now() + 43200000);
    return { token, scope, ...(activity ? { accessToken: tokens.access_token } : {}) };
  }
  logout(request) {
    for (const name of ['raph_activity_session', 'raph_web_session']) { const t = readCookie(request, authCookieName(this.config,name)); if (t) this.db.prepare('DELETE FROM browser_sessions WHERE hash=?').run(hash(t)); }
  }
}
