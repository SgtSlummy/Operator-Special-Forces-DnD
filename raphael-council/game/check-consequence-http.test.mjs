import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { getCheckRequestOptions } from './check-authoring.mjs';
import { renderTacticalMap } from '../maps/render.mjs';

const origin = 'http://raph.test';
const host = { campaign: 'save-http', owner: 'host' };
const player = { campaign: 'save-http', owner: 'alice' };
const outsider = { campaign: 'save-http', owner: 'bob' };
function fixture(t, { persistent = false } = {}) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'raph-save-http-')) : null;
  const path = directory ? join(directory, 'game.sqlite') : ':memory:';
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, proficiencyBonus: { value: 3 } } };
  const saved = { revision: 2, snapshot };
  const pin = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, owner, x, initiative) => ({ id, owner, name: id, team: owner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative, characterVersion: pin, weapon: { name: 'Sword', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
  const draws = [], renderViews = [];
  let game = new GameStore(path, { rollDie: sides => { draws.push(sides); return [3, 5, 6][draws.length - 1]; } });
  game.createCampaign({ campaign: player.campaign, title: 'Save HTTP fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1, 20), actor('foe', null, 4, 10)], effects: [] });
  const sessions = new Map([['Bearer host', host], ['Bearer alice', player], ['Bearer bob', outsider]]);
  let characterLoads = 0;
  const handlers = createGameHttp(async () => ({ game, auth: { authenticate: async request => sessions.get(request.headers.get('authorization')) ?? null }, access: { authenticateAccess: async () => null } }), {
    getCharacters: async () => { characterLoads++; return { character: () => saved }; },
    render: view => { renderViews.push(structuredClone(view)); return renderTacticalMap(view); },
  });
  const intent = { id: 'reviewed-fire', reviewed: true, expectedRevision: 1, actorId: 'scout', label: 'Avoid the fire hazard', kind: 'save', ability: 'dexterity', proficiencyMultiplier: 0, proficiencyReason: 'Reviewed: no saving throw proficiency applies', advantage: [], disadvantage: [], adjustments: [], dc: 15, cost: 'none', consequence: { type: 'single_target_damage', dice: { count: 2, sides: 6, bonus: 2 }, damageType: 'fire', onSuccess: 'half', mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: 'Private host defense note 438' } } };
  t.after(() => {
    game.close();
    if (directory) {
      const resolved = realpathSync(directory);
      assert.equal(dirname(resolved), realpathSync(tmpdir()));
      assert.ok(basename(resolved).startsWith('raph-save-http-'));
      rmSync(resolved, { recursive: true, force: true });
    }
  });
  return { handlers, intent, draws, renderViews, saved, sessions, get game() { return game; }, get characterLoads() { return characterLoads; }, reopen() { assert.ok(directory); game.close(); game = new GameStore(path, { rollDie: () => { throw new Error('A persisted receipt must not roll again'); } }); } };
}
function request(path, who = 'alice', body, headers = {}) {
  return new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who}`, ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const prepare = (h, input = h.intent, who = 'host', headers) => h.handlers.requestCheck(request('/api/game/checks/request', who, input, headers));
const resolve = (h, body = { checkId: h.intent.id, requestId: 'resolve-fire' }, who = 'alice') => h.handlers.resolveCheck(request('/api/game/checks', who, body));
const noSecrets = value => { const text = JSON.stringify(value); assert.equal(text.includes('Private host defense note 438'), false); assert.equal(text.includes('"dc"'), false); };

test('host prepares without rolling; player resolves once and receives the final HP map revision across restart', async t => {
  const h = fixture(t, { persistent: true });
  const before = h.game.view(player);
  const prepared = await prepare(h);
  assert.equal(prepared.status, 200);
  const approved = await prepared.json();
  assert.deepEqual(approved.check.consequence, { type: 'single_target_damage', damageType: 'fire', onSuccess: 'half' });
  noSecrets(approved); assert.deepEqual(h.draws, []); assert.deepEqual(h.game.view(player), before);
  assert.deepEqual(await (await prepare(h)).json(), approved);
  const pending = await (await h.handlers.checks(request('/api/game/checks'))).json();
  assert.equal(pending.pending.length, 1); assert.deepEqual(pending.pending[0].consequence, approved.check.consequence); noSecrets(pending);
  assert.deepEqual((await (await h.handlers.checks(request('/api/game/checks', 'bob'))).json()).pending, []);
  const response = await resolve(h);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(h.draws, [20, 6, 6]); assert.equal(body.receipt.result.total, 6);
  assert.equal(body.receipt.result.consequence.appliedDamage, 13); assert.equal(body.receipt.result.consequence.hpAfter, 7);
  assert.equal(body.view.actors.find(actor => actor.id === 'scout').hp, 7);
  assert.equal(body.receipt.revision, body.view.revision); assert.equal(body.view.revision, before.revision + 2); noSecrets(body);
  const staleMap = await h.handlers.map(request(`/api/game/map?revision=${before.revision}`));
  assert.equal(staleMap.status, 409);
  const map = await h.handlers.map(request(`/api/game/map?revision=${body.receipt.revision}`));
  assert.equal(map.status, 200); assert.equal(map.headers.get('X-Raph-Revision'), String(body.receipt.revision));
  assert.equal(h.renderViews.at(-1).actors.find(actor => actor.id === 'scout').hp, 7);
  assert.ok((await map.arrayBuffer()).byteLength > 0);
  h.reopen();
  const replay = await resolve(h);
  assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), body);
  const history = await (await h.handlers.checks(request('/api/game/checks'))).json();
  assert.deepEqual(history.receipts, [body.receipt]); assert.deepEqual(history.pending, []); noSecrets(history);
  assert.deepEqual((await (await h.handlers.checks(request('/api/game/checks', 'bob'))).json()).receipts, []);
  assert.deepEqual(h.draws, [20, 6, 6]);
});

test('host review rejects unauthorized authors and cross-origin requests before loading character data', async t => {
  const h = fixture(t), before = h.game.view(host);
  for (const who of ['alice', 'bob', 'unknown']) {
    const response = await prepare(h, h.intent, who);
    assert.ok([401, 403].includes(response.status)); noSecrets(await response.json());
  }
  for (const headers of [{ origin: 'https://foreign.example' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
    const response = await prepare(h, h.intent, 'host', headers);
    assert.ok(response.status >= 400 && response.status < 500);
  }
  assert.equal(h.characterLoads, 0); assert.deepEqual(h.draws, []); assert.deepEqual(h.game.view(host), before);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS count FROM game_checks').get().count, 0);
});

test('reviewed HTTP authoring rejects identity, rolled-value, query and unsupported consequence overrides', async t => {
  const h = fixture(t), before = h.game.view(host);
  for (const extra of [{ owner: 'alice' }, { campaign: 'elsewhere' }, { role: 'host' }, { profile: {} }, { dice: [20] }, { actionAvailable: true }]) {
    const response = await prepare(h, { ...h.intent, ...extra }); assert.equal(response.status, 400);
  }
  const query = await h.handlers.requestCheck(request('/api/game/checks/request?owner=alice', 'host', h.intent));
  assert.equal(query.status, 400);
  for (const consequence of [null, { ...h.intent.consequence, targets: ['scout', 'foe'] }, { ...h.intent.consequence, type: 'multi_target_damage' }, { ...h.intent.consequence, mitigation: { ...h.intent.consequence.mitigation, temporaryHp: 8 } }]) {
    const response = await prepare(h, { ...h.intent, consequence }); assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID');
  }
  assert.deepEqual(h.draws, []); assert.deepEqual(h.game.view(host), before); assert.equal(h.game.db.prepare('SELECT COUNT(*) AS count FROM game_checks').get().count, 0);
});

test('bounded JSON parsing refuses oversized or malformed host requests without changing play', async t => {
  const h = fixture(t), before = h.game.view(host);
  const oversized = await prepare(h, { ...h.intent, label: 'x'.repeat(9000) });
  assert.equal(oversized.status, 413);
  const malformed = await h.handlers.requestCheck(new Request(origin + '/api/game/checks/request', { method: 'POST', headers: { authorization: 'Bearer host', origin, 'content-type': 'application/json' }, body: '{' }));
  assert.equal(malformed.status, 400);
  const wrongMedia = await prepare(h, h.intent, 'host', { 'content-type': 'text/plain' });
  assert.ok(wrongMedia.status >= 400 && wrongMedia.status < 500);
  assert.equal(h.characterLoads, 0); assert.deepEqual(h.draws, []); assert.deepEqual(h.game.view(host), before);
});

test('stale, conflicting and changed-profile authoring returns review errors without damage', async t => {
  const h = fixture(t);
  let response = await prepare(h, { ...h.intent, expectedRevision: 2 });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'STALE');
  h.saved.revision++;
  response = await prepare(h);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'PROFILE');
  h.saved.revision--;
  assert.equal((await prepare(h)).status, 200);
  response = await prepare(h, { ...h.intent, consequence: { ...h.intent.consequence, onSuccess: 'none' } });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONFLICT');
  assert.deepEqual(h.draws, []); assert.equal(h.game.view(host).actors.find(actor => actor.id === 'scout').hp, 20);
});

test('a player can submit only an owned prepared check ID, never replacement damage or stats', async t => {
  const h = fixture(t);
  assert.equal((await prepare(h)).status, 200);
  let response = await resolve(h, undefined, 'bob');
  assert.equal(response.status, 403);
  for (const extra of [{ consequence: h.intent.consequence }, { total: 20 }, { actorId: 'foe' }, { owner: 'alice' }, { dc: 0 }]) {
    response = await resolve(h, { checkId: h.intent.id, requestId: 'resolve-fire', ...extra });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(h.draws, []); assert.equal(h.game.pendingChecks(player).length, 1);
  h.game.command(player, { type: 'pause', actorId: 'scout', expectedRevision: 1, requestId: 'pause-for-review' });
  response = await resolve(h);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'PAUSED'); assert.deepEqual(h.draws, []);
});

test('GET authoring options derives host visibility and eligible characters from authenticated server state', async t => {
  const h = fixture(t), before = h.game.view(host);
  for (const who of ['alice', 'bob', 'unknown']) {
    const response = await h.handlers.checkRequestOptions(request('/api/game/checks/request', who));
    assert.ok([401, 403].includes(response.status)); assert.equal((await response.json()).options, undefined);
  }
  assert.equal(h.characterLoads, 0);
  const extra = await h.handlers.checkRequestOptions(request('/api/game/checks/request?owner=alice', 'host'));
  assert.equal(extra.status, 400); assert.equal(h.characterLoads, 0);
  const response = await h.handlers.checkRequestOptions(request('/api/game/checks/request', 'host'));
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private/);
  const body = await response.json();
  assert.deepEqual(body, { options: { gameRevision: 1, phase: 'combat', canRequest: true, actors: [{ id: 'scout', name: 'scout' }] } });
  noSecrets(body); assert.deepEqual(h.game.view(host), before); assert.deepEqual(h.draws, []);
  h.saved.revision++;
  assert.deepEqual((await (await h.handlers.checkRequestOptions(request('/api/game/checks/request', 'host'))).json()).options.actors, []);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS count FROM game_checks').get().count, 0);
});

test('removed actor owner is not eligible for options, new requests, or resolution even if its token remains', async t => {
  const h = fixture(t);
  assert.equal((await prepare(h)).status, 200);
  const before = h.game.view(host), checks = h.game.db.prepare('SELECT * FROM game_checks').all();
  h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(player.campaign, player.owner);
  assert.equal(h.game.load(player.campaign).actors.some(actor => actor.id === 'scout'), true);
  const options = await h.handlers.checkRequestOptions(request('/api/game/checks/request', 'host'));
  assert.equal(options.status, 200); assert.deepEqual((await options.json()).options.actors, []);
  const reviewed = await prepare(h, { ...h.intent, id: 'removed-player-save' });
  assert.equal(reviewed.status, 422); assert.equal((await reviewed.json()).code, 'TARGET');
  assert.equal((await resolve(h)).status, 403);
  assert.deepEqual(h.game.view(host), before); assert.deepEqual(h.game.db.prepare('SELECT * FROM game_checks').all(), checks); assert.deepEqual(h.draws, []);
});

test('host options expose only living player actors with the current approved snapshot pin', t => {
  const h = fixture(t), queries = [];
  const characters = { character: scope => { queries.push(scope); return h.saved; } };
  const before = h.game.view(host);
  assert.deepEqual(getCheckRequestOptions(h.game, characters, host), { gameRevision: 1, phase: 'combat', canRequest: true, actors: [{ id: 'scout', name: 'scout' }] });
  assert.deepEqual(queries, [{ campaign: player.campaign, owner: player.owner }]);
  h.saved.revision++;
  assert.deepEqual(getCheckRequestOptions(h.game, characters, host).actors, []);
  h.saved.revision--;
  h.saved.snapshot.fields.dexterity.value++;
  assert.deepEqual(getCheckRequestOptions(h.game, characters, host).actors, []);
  h.saved.snapshot.fields.dexterity.value--;
  const state = h.game.load(player.campaign); state.actors[0].hp = 0; h.game.save(state);
  assert.deepEqual(getCheckRequestOptions(h.game, characters, host).actors, []);
  state.actors[0].hp = 20; h.game.save(state);
  assert.deepEqual(h.game.view(host), before); assert.deepEqual(h.draws, []);
});

test('options and authoring honor a pending concentration lock without rolling or changing state', async t => {
  const h = fixture(t), state = h.game.load(player.campaign);
  // Internal lock fixture only: this is not a valid public concentration record.
  state.pendingConcentration = { id: 'fixture-concentration-lock' };
  delete state.pendingReaction;
  h.game.save(state);
  const before = h.game.load(player.campaign);
  const response = await h.handlers.checkRequestOptions(request('/api/game/checks/request', 'host'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).options.canRequest, false);
  const reviewed = await prepare(h);
  assert.equal(reviewed.status, 409); assert.equal((await reviewed.json()).code, 'PENDING');
  assert.deepEqual(h.game.load(player.campaign), before);
  assert.deepEqual(h.draws, []);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS count FROM game_checks').get().count, 0);
});

test('options recheck host authority before character lookup and report blocked play without changing it', t => {
  const h = fixture(t), characters = { character: () => h.saved };
  for (const scope of [player, outsider]) assert.throws(() => getCheckRequestOptions(h.game, { character: () => { throw new Error('Unauthorized lookup'); } }, scope), { code: 'UNAUTHORIZED' });
  assert.throws(() => getCheckRequestOptions(h.game, null, host), { code: 'PROFILE' });
  const state = h.game.load(player.campaign); state.pendingReaction = { id: 'fixture-lock' }; h.game.save(state);
  const before = h.game.load(player.campaign);
  assert.equal(getCheckRequestOptions(h.game, characters, host).canRequest, false);
  assert.deepEqual(h.game.load(player.campaign), before);
  delete state.pendingReaction; state.phase = 'complete'; h.game.save(state);
  assert.equal(getCheckRequestOptions(h.game, characters, host).canRequest, false);
  assert.deepEqual(h.draws, []); assert.equal(h.game.db.prepare('SELECT COUNT(*) AS count FROM game_checks').get().count, 0);
});

test('revoked sessions cannot retrieve prepared checks or saved damaging receipts', async t => {
  const h = fixture(t);
  assert.equal((await prepare(h)).status, 200); assert.equal((await resolve(h)).status, 200);
  h.sessions.delete('Bearer alice');
  const history = await h.handlers.checks(request('/api/game/checks'));
  assert.equal(history.status, 401);
  const replay = await resolve(h);
  assert.equal(replay.status, 401); assert.deepEqual(h.draws, [20, 6, 6]);
});
