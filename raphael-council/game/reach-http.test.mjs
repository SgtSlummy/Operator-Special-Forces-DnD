import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { createSceneImageHttp } from '../images/http.mjs';

const ORIGIN = 'https://raph.example';
const TOKEN = 'a'.repeat(64);
const SCOPE = { campaign: 'distance-table', owner: 'alice' };

function setup(kind, t) {
  const game = new GameStore(':memory:', { rollDie() { throw new Error('A question must never roll dice.'); } });
  t.after(() => game.close());
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, x, y: 1, team: owner ? 'party' : 'opposition', size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 4, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Spear', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
  game.createCampaign({ campaign: SCOPE.campaign, title: 'Distance table', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'room', title: 'Visible courtyard', width: 14, height: 8, blocked: [], difficult: [{ x: 2, y: 1 }] }, actors: [actor('scout', 'alice', 1, 20), actor('guard', null, 4, 15), actor('friend', 'bob', 2, 10), actor('SECRET_UNSEEN_ACTOR', null, 12, 5)], effects: [] });
  let revoked = false;
  const access = {
    authenticateAccess(token) { return token === TOKEN && !revoked ? SCOPE : null; },
    requestImage() { throw new Error('A distance question must not generate an image.'); },
  };
  const handlers = kind === 'game' ? createGameHttp(() => ({ game, access })) : createSceneImageHttp(() => access, { getGame: () => game });
  const base = kind === 'game' ? '/api/game' : '/api/scene-images';
  const cookieName = kind === 'game' ? 'raph_game_access' : 'witnesslight_access';
  const request = ({ body, cookie = `${cookieName}=${TOKEN}`, origin = ORIGIN, query = '', headers = {} } = {}) => new Request(`${ORIGIN}${base}/reach${query}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const input = { expectedRevision: 1, actorId: 'scout', targetId: 'guard' };
  return { game, handlers, request, input, revoke: () => { revoked = true; } };
}

for (const kind of ['game', 'images']) {
  test(`${kind}: a private question returns map distance without dice, images or state changes`, async t => {
    const { game, handlers, request, input } = setup(kind, t);
    const before = JSON.stringify(game.load(SCOPE.campaign));
    const events = game.db.prepare('SELECT count(*) AS n FROM game_events').get().n;
    const choicesResponse = await handlers.reachOptions(request());
    assert.equal(choicesResponse.status, 200);
    assert.equal(choicesResponse.headers.get('cache-control'), 'private, no-store');
    const choices = await choicesResponse.json();
    assert.deepEqual(choices.options.actors, [{ id: 'scout', label: 'scout' }]);
    assert.ok(choices.options.targets.some(a => a.id === 'guard'));
    assert.doesNotMatch(JSON.stringify(choices), /SECRET|weapon|abilityScore|ac"/);
    const response = await handlers.reach(request({ body: input }));
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.distanceFeet, 15);
    assert.equal(result.weapon.rangeFeet, 5);
    assert.equal(result.weapon.inRange, false);
    assert.ok(result.summary.length >= 2);
    assert.equal(JSON.stringify(game.load(SCOPE.campaign)), before);
    assert.equal(game.db.prepare('SELECT count(*) AS n FROM game_events').get().n, events);
    assert.equal(game.receipts(SCOPE).length, 0);
  });

  test(`${kind}: questions work while paused and outside the requesting character's turn`, async t => {
    const { game, handlers, request, input } = setup(kind, t);
    game.command(SCOPE, { requestId: 'end', expectedRevision: 1, actorId: 'scout', type: 'end_turn' });
    let revision = game.view(SCOPE).revision;
    let response = await handlers.reach(request({ body: { ...input, expectedRevision: revision } }));
    assert.equal(response.status, 200);
    let result = (await response.json()).result;
    assert.equal(result.weapon.canAttackNow, false);
    assert.equal(result.movement.budgetFeet, 30);
    game.command(SCOPE, { requestId: 'pause', expectedRevision: revision, actorId: 'scout', type: 'pause' });
    revision = game.view(SCOPE).revision;
    response = await handlers.reach(request({ body: { ...input, expectedRevision: revision } }));
    assert.equal(response.status, 200);
    result = (await response.json()).result;
    assert.equal(result.weapon.canAttackNow, false);
    assert.match(result.summary.join(' '), /paused/i);
    assert.equal(game.view(SCOPE).revision, revision);
  });

  test(`${kind}: hidden targets, unowned characters, stale state and scope overrides fail safely`, async t => {
    const { handlers, request, input } = setup(kind, t);
    for (const [body, status] of [
      [{ ...input, targetId: 'SECRET_UNSEEN_ACTOR' }, 422],
      [{ ...input, actorId: 'friend' }, 403],
      [{ ...input, expectedRevision: 0 }, 409],
      [{ ...input, campaign: 'other', owner: 'host' }, 400],
      [{ ...input, rangeFeet: 600 }, 400],
      [{ ...input, coordinate: 'C3' }, 400],
      [{ expectedRevision: 1, actorId: 'scout', coordinate: 'N8' }, 422],
    ]) {
      const response = await handlers.reach(request({ body }));
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /SECRET|abilityScore|C:\\|private credential/);
    }
    assert.equal((await handlers.reachOptions(request({ query: '?owner=host' }))).status, 400);
  });

  test(`${kind}: both question endpoints enforce authentication and code revocation`, async t => {
    const { handlers, request, input, revoke } = setup(kind, t);
    for (const cookie of ['', 'witnesslight_access=bad; raph_game_access=bad']) {
      assert.equal((await handlers.reachOptions(request({ cookie }))).status, 401);
      assert.equal((await handlers.reach(request({ cookie, body: input }))).status, 401);
    }
    revoke();
    assert.equal((await handlers.reachOptions(request())).status, 401);
    assert.equal((await handlers.reach(request({ body: input }))).status, 401);
  });

  test(`${kind}: request Origin, bounds and content type cannot bypass the question boundary`, async t => {
    const { handlers, request, input } = setup(kind, t);
    assert.equal((await handlers.reach(request({ body: input, origin: 'https://elsewhere.example' }))).status, 403);
    assert.equal((await handlers.reach(request({ body: input, headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
    assert.equal((await handlers.reach(request({ body: '{' }))).status, 400);
    assert.equal((await handlers.reach(request({ body: 'x'.repeat(9000) }))).status, 413);
    assert.equal((await handlers.reach(request({ body: input, headers: { 'content-type': 'text/plain' } }))).status, 415);
  });
}

test('image questions explain missing tactical setup without needing an image provider', async () => {
  const http = createSceneImageHttp(() => ({ authenticateAccess: () => SCOPE }));
  const response = await http.reachOptions(new Request(`${ORIGIN}/api/scene-images/reach`, { headers: { cookie: `witnesslight_access=${TOKEN}` } }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /tactical map/);
});
