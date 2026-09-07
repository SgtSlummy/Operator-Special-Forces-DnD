import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DiscordAuth } from './discord.mjs';
import { authHttp } from './http.mjs';
import { GameStore } from '../game/store.mjs';
import { createGameHttp } from '../game/http.mjs';
import { apiPath } from '../client/api.mjs';

const alice = '100000000000000001', bob = '100000000000000002', host = '100000000000000003', clientId = '200000000000000001', guild = '300000000000000001';
const origin = 'https://game.example', activityOrigin = `https://${clientId}.discordsays.com`;
function setup(t) {
  const game = new GameStore(':memory:'); const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); game.close(); });
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: 'party', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 6, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Sword', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } });
  game.createCampaign({ campaign: 'shared', title: 'Shared mission', members: [{ owner: host, role: 'host' }, { owner: alice, role: 'player' }, { owner: bob, role: 'player' }], map: { id: 'harbor', title: 'Harbor', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('alice-actor', alice, 1, 20), actor('bob-actor', bob, 3, 10)], effects: [] });
  const revoked = new Set();
  const config = { clientId, secret: 'fixture', token: 'fixture', guild, campaign: 'shared', publicOrigin: origin, activityOrigin, playerIds: [alice, bob], dmIds: [host] };
  const auth = new DiscordAuth({ db, game, config, fetchImpl: async (url, init) => {
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: init.body.get('code'), scope: 'identify' });
    if (url.endsWith('/users/@me')) return Response.json({ id: init.headers.Authorization.slice('Bearer '.length) });
    if (url.includes('/members/')) { const id = url.split('/').at(-1); return revoked.has(id) ? new Response('', { status: 404 }) : Response.json({ user: { id }, roles: [] }); }
    if (url.endsWith('/roles')) return Response.json([]);
    return Response.json({ owner_id: host });
  } });
  const services = () => ({ game, auth, access: { authenticateAccess: () => null } });
  const handlers = createGameHttp(services);
  const savedEnv = { DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID, RAPHAEL_PUBLIC_ORIGIN: process.env.RAPHAEL_PUBLIC_ORIGIN };
  process.env.DISCORD_CLIENT_ID = clientId; process.env.RAPHAEL_PUBLIC_ORIGIN = origin;
  t.after(() => { for (const [key, value] of Object.entries(savedEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  async function login(user, embedded) {
    let response;
    if (embedded) {
      response = await authHttp('activity', services)(new Request(`${origin}/api/auth/activity`, { method: 'POST', headers: { origin: activityOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ code: user }) }));
      assert.equal(response.status, 200);
    } else {
      const start = await authHttp('start', services)(new Request(`${origin}/api/auth/discord/start`));
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      response = await authHttp('callback', services)(new Request(`${origin}/api/auth/discord/callback?code=${user}&state=${state}`, { headers: { cookie: start.headers.getSetCookie()[0].split(';')[0] } }));
      assert.equal(response.status, 302);
    }
    const cookie = response.headers.getSetCookie().find(value => value.startsWith(embedded ? 'raph_activity_session=' : 'raph_web_session=')).split(';')[0];
    return { embedded, cookie };
  }
  function request(session, path = '/api/game', body) {
    const localPath = apiPath(path, new URL(session.embedded ? activityOrigin : origin));
    const upstreamPath = localPath.startsWith('/.proxy/') ? localPath.slice('/.proxy'.length) : localPath;
    return new Request(`${origin}${upstreamPath}`, { method: body ? 'POST' : 'GET', headers: { cookie: session.cookie, origin: session.embedded ? activityOrigin : origin, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  return { game, services, handlers, revoked, login, request };
}

test('real auth and game handlers share actions across two players and interchangeable sessions', async t => {
  const f = setup(t), browserAlice = await f.login(alice, false), activityBob = await f.login(bob, true);
  const before = await (await f.handlers.state(f.request(browserAlice))).json();
  const observer = await (await f.handlers.state(f.request(activityBob))).json();
  assert.equal(before.view.revision, observer.view.revision);
  const command = { type: 'move', actorId: 'alice-actor', path: [{ x: 1, y: 2 }], expectedRevision: before.view.revision, requestId: 'shared-command-receipt' };
  const committed = await f.handlers.command(f.request(browserAlice, '/api/game', command));
  assert.equal(committed.status, 200); const saved = await committed.json();
  const bobView = await (await f.handlers.state(f.request(activityBob))).json();
  assert.equal(bobView.view.revision, saved.view.revision);
  assert.equal(bobView.view.actors.find(actor => actor.id === 'alice-actor').y, 2);
  const activityAlice = await f.login(alice, true);
  const repeated = await f.handlers.command(f.request(activityAlice, '/api/game', command));
  assert.equal(repeated.status, 200); assert.deepEqual((await repeated.json()).receipt, saved.receipt);
  assert.equal(f.game.view({ campaign: 'shared', owner: alice }).revision, saved.view.revision);
  const stale = await f.handlers.command(f.request(activityAlice, '/api/game', { ...command, requestId: 'stale-request' }));
  assert.equal(stale.status, 409);
  const stolen = await f.handlers.command(f.request(activityBob, '/api/game', { ...command, expectedRevision: saved.view.revision, requestId: 'stolen-request' }));
  assert.equal(stolen.status, 403);
  const browserBob = await f.login(bob, false);
  assert.equal((await (await f.handlers.state(f.request(browserBob))).json()).view.revision, saved.view.revision);
  f.revoked.add(alice);
  assert.equal((await f.handlers.state(f.request(browserAlice))).status, 401);
  assert.equal((await f.handlers.state(f.request(activityAlice))).status, 401);
  assert.equal((await f.handlers.state(f.request(activityBob))).status, 200);
});

test('Activity authorization rejects malformed and oversized bodies before token exchange', async t => {
  const f = setup(t);
  for (const [body, status] of [['null', 400], ['{', 400], [JSON.stringify({ code: alice, owner: host }), 400], [JSON.stringify({ code: 'x'.repeat(5000) }), 413]]) {
    const response = await authHttp('activity', f.services)(new Request(`${origin}/api/auth/activity`, { method: 'POST', headers: { origin: activityOrigin, 'content-type': 'application/json' }, body }));
    assert.equal(response.status, status);
  }
});
