import { randomBytes, createHash } from 'node:crypto';
export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
const hash = value => createHash('sha256').update(value).digest('hex');
const snowflake = value => /^\d{17,20}$/.test(value || '');
const API = 'https://discord.com/api/v10';
export function authConfig(env = process.env) {
  return { clientId: env.DISCORD_CLIENT_ID, secret: env.DISCORD_CLIENT_SECRET, token: env.DISCORD_TOKEN,
    guild: env.RAPHAEL_GUILD_ID, campaign: env.RAPHAEL_CAMPAIGN_ID,
    publicOrigin: env.RAPHAEL_PUBLIC_ORIGIN?.replace(/\/$/, ''),
    activityOrigin: snowflake(env.DISCORD_CLIENT_ID) ? `https://${env.DISCORD_CLIENT_ID}.discordsays.com` : null,
    playerIds: (env.RAPHAEL_PLAYER_IDS || '').split(',').filter(Boolean), playerRole: env.RAPHAEL_PLAYER_ROLE_ID,
    dmIds: (env.RAPHAEL_DM_IDS || '').split(',').filter(Boolean), dmRole: env.RAPHAEL_DM_ROLE_ID };
}
export function guardOrigin(request, config = authConfig()) {
  const origin = request.headers.get('origin'), own = new URL(request.url).origin;
  const allowed = [config.publicOrigin, config.activityOrigin, ...(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(own) ? [own] : [])].filter(Boolean);
  if (!origin || !allowed.includes(origin)) throw new AuthError('Open the authorized game before changing it.', 403);
  return origin;
}
export function sessionCookie(config, token, activity = false) {
  const name = activity ? 'raph_activity_session' : 'raph_web_session';
  const base = `${name}=${token}; Path=${activity ? '/' : '/api'}; HttpOnly; Max-Age=${token ? 43200 : 0}`;
  return activity ? `${base}; Secure; SameSite=None; Partitioned; Domain=${new URL(config.activityOrigin).hostname}` : `${base}; SameSite=Lax${config.publicOrigin?.startsWith('https:') ? '; Secure' : ''}`;
}
export function readCookie(request, name) {
  const values = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1); return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export class DiscordAuth {
  constructor({ db, game, config = authConfig(), fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { db, game, config, fetch: fetchImpl, now });
    db.exec(`CREATE TABLE IF NOT EXISTS browser_sessions(hash TEXT PRIMARY KEY,owner TEXT,campaign TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,expires INTEGER);`);
  }
  async discord(path, bearer) {
    const response = await this.fetch(`${API}${path}`, { headers: { Authorization: bearer }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new AuthError('Discord identity or membership could not be verified.');
    return response.json();
  }
  async member(owner) {
    const c = this.config;
    if (!snowflake(owner) || !snowflake(c.guild) || !c.token || !c.campaign) throw new AuthError('Discord sign-in is not configured.', 503);
    const member = await this.discord(`/guilds/${c.guild}/members/${owner}`, `Bot ${c.token}`);
    const roles = member.roles || [];
    // Bot permission calculation for a fetched member requires guild role data.
    const guild = await this.discord(`/guilds/${c.guild}`, `Bot ${c.token}`);
    const guildRoles = await this.discord(`/guilds/${c.guild}/roles`, `Bot ${c.token}`);
    let permissions = 0n;
    for (const r of guildRoles) if (r.id === c.guild || roles.includes(r.id)) permissions |= BigInt(r.permissions || '0');
    const host = guild.owner_id === owner || c.dmIds.includes(owner) || (c.dmRole && roles.includes(c.dmRole)) || Boolean(permissions & (8n | 32n));
    if (!host && !c.playerIds.includes(owner) && !(c.playerRole && roles.includes(c.playerRole))) throw new AuthError('You are not a current campaign member.', 403);
    const scope = { campaign: c.campaign, owner }; const role = this.game.member(scope);
    // A saved host role cannot outlive current Discord host authorization.
    if (role === 'host' && !host) throw new AuthError('Your GM access has been revoked.', 403);
    return { ...scope, role };
  }
  async authenticate(request) {
    const token = readCookie(request, 'raph_activity_session') || readCookie(request, 'raph_web_session');
    if (!token) return null;
    const row = this.db.prepare('SELECT * FROM browser_sessions WHERE hash=?').get(hash(token));
    if (!row || row.expires <= this.now() || row.campaign !== this.config.campaign) throw new AuthError('Sign in again.');
    return this.member(row.owner);
  }
  start() {
    const c = this.config;
    if (!snowflake(c.clientId) || !c.secret || !c.publicOrigin?.startsWith('https://')) throw new AuthError('Configure the Discord application and public HTTPS address.', 503);
    const state = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO oauth_states VALUES(?,?)').run(hash(state), this.now() + 300000);
    const params = new URLSearchParams({ client_id: c.clientId, response_type: 'code', redirect_uri: `${c.publicOrigin}/api/auth/discord/callback`, scope: 'identify', state });
    return { url: `https://discord.com/oauth2/authorize?${params}`, state };
  }
  async exchange(code, { activity = false, state, cookieState } = {}) {
    const c = this.config;
    if (typeof code !== 'string' || !code || code.length > 2048 || !c.secret || !snowflake(c.clientId)) throw new AuthError('Invalid Discord authorization.');
    if (!activity) {
      if (!state || state !== cookieState || !/^[a-f0-9]{64}$/.test(state)) throw new AuthError('Sign-in state did not match.');
      const row = this.db.prepare('DELETE FROM oauth_states WHERE hash=? RETURNING expires').get(hash(state));
      if (!row || row.expires <= this.now()) throw new AuthError('Sign-in request expired.');
    }
    const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, grant_type: 'authorization_code', code });
    if (!activity) body.set('redirect_uri', `${c.publicOrigin}/api/auth/discord/callback`);
    const response = await this.fetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new AuthError('Discord sign-in failed.');
    const tokens = await response.json();
    if (!tokens.access_token || !(tokens.scope || '').split(' ').includes('identify')) throw new AuthError('Discord identity permission is required.');
    const user = await this.discord('/users/@me', `Bearer ${tokens.access_token}`), scope = await this.member(user.id);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM browser_sessions WHERE expires<?').run(this.now());
    this.db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?)').run(hash(token), scope.owner, scope.campaign, this.now() + 43200000);
    return { token, scope, ...(activity ? { accessToken: tokens.access_token } : {}) };
  }
  logout(request) {
    for (const name of ['raph_activity_session', 'raph_web_session']) { const t = readCookie(request, name); if (t) this.db.prepare('DELETE FROM browser_sessions WHERE hash=?').run(hash(t)); }
  }
}
