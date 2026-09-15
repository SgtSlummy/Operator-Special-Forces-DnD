import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { discordCampaignAuthority, discordCampaignBindings } from './discord-policy.mjs';
import { authConfig, DiscordAuth } from './discord.mjs';

const owner = '100000000000000001', other = '100000000000000002';
const guildId = '200000000000000001', gmRole = '300000000000000001', playerRole = '300000000000000002';
const base = () => ({ guild: guildId, campaign: 'policy-fixture', dmIds: [], playerIds: [], dmRole: gmRole, playerRole });
function evaluate(overrides = {}) {
  return discordCampaignAuthority({ owner, member: { user: { id: owner }, roles: [] }, config: base(), permissions: 0n, guildOwnerId: other, ...overrides });
}

test('each existing Discord host route qualifies without requiring administrator status', () => {
  const cases = [
    { guildOwnerId: owner },
    { config: { ...base(), dmIds: [owner] } },
    { member: { roles: [gmRole] } },
    { permissions: 8n },
    { permissions: '32' },
  ];
  for (const entry of cases) assert.deepEqual(evaluate(entry), { host: true, player: false, eligible: true });
});

test('ordinary player eligibility and unrelated permissions never create host authority', () => {
  assert.deepEqual(evaluate(), { host: false, player: false, eligible: false });
  for (const entry of [
    { config: { ...base(), playerIds: [owner] } },
    { member: { roles: [playerRole] } },
  ]) assert.deepEqual(evaluate(entry), { host: false, player: true, eligible: true });
  for (const permissions of [1n, 2n, 4n, 16n, 64n, 1024n]) {
    assert.deepEqual(evaluate({ permissions }), { host: false, player: false, eligible: false });
  }
  assert.deepEqual(evaluate({ member: { roles: ['unrelated-role'] } }), { host: false, player: false, eligible: false });
});

test('removing a configured GM role revokes host authority while ordinary membership can remain', () => {
  const config = { ...base(), playerIds: [owner] };
  assert.deepEqual(evaluate({ config, member: { roles: [gmRole] } }), { host: true, player: true, eligible: true });
  assert.deepEqual(evaluate({ config, member: { roles: [] } }), { host: false, player: true, eligible: true });
  assert.deepEqual(evaluate({ config: base(), member: { roles: [] } }), { host: false, player: false, eligible: false });
  assert.equal(evaluate({ config: { ...config, dmIds: [owner] }, member: { roles: [] } }).host, true);
});

test('policy consumes an explicit trusted snapshot without mutating it or manufacturing game roles', () => {
  const config = Object.freeze({ ...base(), dmIds: Object.freeze([owner]), playerIds: Object.freeze([]) });
  const member = Object.freeze({ user: Object.freeze({ id: owner }), roles: Object.freeze([]) });
  const answer = evaluate({ config, member });
  assert.equal(Object.isFrozen(answer), true);
  assert.deepEqual(Object.keys(answer).sort(), ['eligible', 'host', 'player']);
  assert.deepEqual(member.roles, []);
  assert.deepEqual(config.dmIds, [owner]);
  for (const value of [undefined, null, '', 0]) assert.throws(() => evaluate({ owner: value, guildOwnerId: value }), TypeError);
  assert.throws(() => evaluate({ permissions: 'not-permission-bits' }));
});

test('shared environment bindings preserve the existing web interpretation and exclude credentials', () => {
  const env = {
    RAPHAEL_GUILD_ID: guildId, RAPHAEL_CAMPAIGN_ID: 'policy-fixture',
    RAPHAEL_PLAYER_IDS: `${owner},,${other}`, RAPHAEL_PLAYER_ROLE_ID: playerRole,
    RAPHAEL_DM_IDS: `${other},,`, RAPHAEL_DM_ROLE_ID: gmRole,
    DISCORD_TOKEN: 'synthetic-secret', DISCORD_CLIENT_SECRET: 'synthetic-oauth-secret',
    DISCORD_CLIENT_ID: '400000000000000001', RAPHAEL_PUBLIC_ORIGIN: 'https://fixture.example/',
  };
  const expected = { guild: guildId, campaign: 'policy-fixture', playerIds: [owner, other], playerRole, dmIds: [other], dmRole: gmRole };
  assert.deepEqual(discordCampaignBindings(env), expected);
  const web = authConfig(env);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(web[key], value);
  assert.equal(web.publicOrigin, 'https://fixture.example');
  assert.equal(web.activityOrigin, 'https://400000000000000001.discordsays.com');
  assert.equal(JSON.stringify(discordCampaignBindings(env)).includes('synthetic-secret'), false);
  assert.deepEqual(discordCampaignBindings({}), { guild: undefined, campaign: undefined, playerIds: [], playerRole: undefined, dmIds: [], dmRole: undefined });
  // Preserve existing CSV behavior; extraction must not silently trim or rewrite bindings.
  assert.deepEqual(discordCampaignBindings({ RAPHAEL_DM_IDS: ` ${owner},${other} ` }).dmIds, [` ${owner}`, `${other} `]);
});

test('DiscordAuth retains REST fetch order and never upgrades a persisted player for Discord administrator permissions', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const calls = [], scopes = [];
  const config = { ...base(), token: 'synthetic-token' };
  const auth = new DiscordAuth({ db, game: { member(scope) { scopes.push(scope); return 'player'; } }, config,
    fetchImpl: async (url, init) => {
      calls.push(new URL(url).pathname);
      assert.equal(init.headers.Authorization, 'Bot synthetic-token');
      if (url.endsWith(`/members/${owner}`)) return Response.json({ user: { id: owner }, roles: [gmRole] });
      if (url.endsWith('/roles')) return Response.json([{ id: guildId, permissions: '0' }, { id: gmRole, permissions: '8' }]);
      if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ owner_id: other });
      throw new Error('Unexpected synthetic REST call.');
    },
  });
  assert.deepEqual(await auth.member(owner), { campaign: 'policy-fixture', owner, role: 'player' });
  assert.deepEqual(scopes, [{ campaign: 'policy-fixture', owner }]);
  assert.deepEqual(calls, [`/api/v10/guilds/${guildId}/members/${owner}`, `/api/v10/guilds/${guildId}`, `/api/v10/guilds/${guildId}/roles`]);
});

test('DiscordAuth keeps current host-role revocation separate from ordinary guild membership', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let roles = [gmRole], reads = 0;
  const auth = new DiscordAuth({ db, game: { member() { reads += 1; return 'host'; } },
    config: { ...base(), playerIds: [owner], token: 'synthetic-token' },
    fetchImpl: async url => {
      if (url.endsWith(`/members/${owner}`)) return Response.json({ user: { id: owner }, roles });
      if (url.endsWith('/roles')) return Response.json([{ id: guildId, permissions: '0' }, { id: gmRole, permissions: '0' }]);
      return Response.json({ owner_id: other });
    },
  });
  assert.equal((await auth.member(owner)).role, 'host');
  roles = [];
  await assert.rejects(auth.member(owner), error => error.status === 403 && error.message === 'Your GM access has been revoked.');
  assert.equal(reads, 2, 'Saved membership stays host and is still checked on both requests.');
});
