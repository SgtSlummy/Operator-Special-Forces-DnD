import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { resolveTacticalImageScene } from './image-scene.mjs';

/** A transport acceptance test for the exact handlers used by /play.
 * This server deliberately does not pretend to render the /play application. */
test('real local HTTP authenticates departure, commits one scene/world transition and serves matching map/reach', async () => {
  const game = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 20 : 6 });
  const player = { campaign: 'http-travel', owner: 'alice' }, host = { ...player, owner: 'host' };
  const actor = (id, owner, x) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp: owner ? 13 : 1, maxHp: 20, ac: 12, speed: 30, vision: 6, initiative: owner ? 20 : 10, characterVersion: 'reviewed-fixture', weapon: { name: 'Bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  const map = { id: 'bridge', title: 'Bridge', width: 8, height: 8, blocked: [], difficult: [] };
  game.createCampaign({ campaign: player.campaign, title: 'Transport fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }], map, actors: [actor('scout', 'alice', 1), actor('guard', null, 3)], effects: [] });
  const mission = { id: 'watch', title: 'Watch', briefing: 'Watch the bridge.', mapId: 'bridge', successTeam: 'party', success: { summary: 'Secure.', changes: [] }, failure: { summary: 'Withdraw.', changes: [] } };
  game.configureMission(host, { reviewed: true, tracks: [], mission });
  for (const type of ['attack', 'end_turn']) game.command(player, { requestId: type, expectedRevision: game.view(player).revision, actorId: 'scout', type, ...(type === 'attack' ? { targetId: 'guard' } : {}) });
  game.debrief(player, { requestId: 'debrief', expectedRevision: 2, notes: '' });
  const branches = ['library', 'harbor'].map(id => ({ id, title: id, summary: 'Public option.', cost: 'No automatic cost.', trackIds: [], evidence: ['world:http-travel:3'], priorities: { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 } }));
  game.prepareCouncil(host, { reviewed: true, expectedWorldRevision: 3, branches });
  game.chooseCouncil(player, { requestId: 'choice', round: 1, branchId: 'library', expectedWorldRevision: 3 });
  const transition = { requestId: 'prepare', expectedRevision: game.view(player).revision, expectedWorldRevision: 4, reviewed: true, placements: [{ actorId: 'scout', x: 1, y: 1 }], destination: { mapId: 'library', map: { ...map, id: 'library', title: 'Library' }, npcs: [actor('sentinel', null, 3)], effects: [] }, mission: { ...mission, id: 'library', title: 'library', briefing: 'Enter the library.', mapId: 'library' } };
  const first = game.prepareDeparture(host, transition);
  const token = 'a'.repeat(64);
  const handlers = createGameHttp(() => ({ game, access: { authenticateAccess: value => { if (value !== token) throw new Error(); return player; } } }));
  const routes = { 'POST /api/game/access': handlers.connect, 'GET /api/game/departure': handlers.departure, 'POST /api/game/departure': handlers.enterDeparture, 'GET /api/game': handlers.state, 'GET /api/game/world': handlers.world, 'POST /api/game/reach': handlers.reach, 'GET /api/game/map': handlers.map };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`), handle = routes[`${req.method} ${url.pathname}`];
      if (!handle) { res.writeHead(404); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await handle(new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`; let cookie = '';
    const call = (path, body, extra = {}) => fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { cookie, origin, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await call('/api/game/departure')).status, 401);
    const login = await call('/api/game/access', { token }); assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    const offered = (await (await call('/api/game/departure')).json()).departure;
    assert.equal(offered.id, first.id); assert.equal(offered.title, 'library'); assert.equal(offered.npcs, undefined);
    const replacement = game.prepareDeparture(host, { ...transition, requestId: 'replacement' });
    assert.equal((await call('/api/game/departure', { departureId: first.id, requestId: 'stale-enter' })).status, 409);
    const entry = { departureId: replacement.id, requestId: 'enter-library' };
    assert.equal((await call('/api/game/departure', { ...entry, owner: 'host' })).status, 400);
    const response = await call('/api/game/departure', entry); assert.equal(response.status, 200);
    const entered = await response.json(); assert.equal(entered.view.map.id, 'library'); assert.equal(entered.world.mission.id, 'library'); assert.equal(entered.world.mission.status, 'active');
    assert.deepEqual((await (await call('/api/game/departure', entry)).json()).receipt, entered.receipt);
    const state = (await (await call('/api/game')).json()).view;
    assert.equal(state.revision, entered.receipt.revision); assert.equal(state.actors.find(a => a.id === 'scout').hp, 13);
    assert.equal((await (await call('/api/game/world')).json()).world.revision, 5);
    assert.equal((await (await call('/api/game/departure')).json()).departure, null);
    assert.equal((await call('/api/game/reach', { expectedRevision: transition.expectedRevision, actorId: 'scout', targetId: 'sentinel' })).status, 409);
    assert.equal((await call('/api/game/reach', { expectedRevision: state.revision, actorId: 'scout', targetId: 'sentinel' })).status, 200);
    const png = await call(`/api/game/map?revision=${state.revision}`); assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png'); assert.equal(png.headers.get('x-raph-revision'), String(state.revision));
    const bytes = new Uint8Array(await png.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(JSON.stringify(resolveTacticalImageScene(game, player)).includes('Library'));
    game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(player.campaign, player.owner);
    assert.equal((await call('/api/game/departure')).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); game.close(); }
});
