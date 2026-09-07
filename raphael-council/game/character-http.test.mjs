import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';

const token = 'b'.repeat(64), scope = { campaign: 'companions', owner: '12345678901234567' };
function fixture(t) {
  const game = new GameStore(':memory:', { rollDie() { throw new Error('Inspection must not roll.'); } });
  t.after(() => game.close());
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, x, y: 1, team: owner ? 'party' : 'opposition', size: 1, hp: 17, maxHp: 20, ac: 14, speed: 30, vision: 4, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Spear', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
  game.createCampaign({ campaign: scope.campaign, title: 'Companion fixture', members: [{ owner: 'host', role: 'host' }, { owner: scope.owner, role: 'player' }], map: { id: 'map', title: 'Courtyard', width: 15, height: 6, blocked: [], difficult: [] }, actors: [actor('hero', scope.owner, 1, 20), actor('guard', null, 4, 10), actor('SECRET_ACTOR', null, 13, 5)], effects: [] });
  let revoked = false, sheetReads = 0;
  const handlers = createGameHttp(() => ({ game, access: { authenticateAccess(value) { return value === token && !revoked ? scope : null; } } }), { getCharacters: () => ({ character(requestScope) { assert.deepEqual(requestScope, scope); sheetReads++; return null; } }) });
  const request = (query = '', cookie = `raph_game_access=${token}`) => new Request(`https://game.example/api/game/characters${query}`, { headers: { cookie } });
  return { game, handlers, request, revoke: () => { revoked = true; }, sheetReads: () => sheetReads };
}

test('character options and details are private, authorized and use live game values', async t => {
  const { game, handlers, request } = fixture(t);
  const before = JSON.stringify(game.load(scope.campaign));
  const choices = await handlers.characterOptions(request());
  assert.equal(choices.status, 200); assert.equal(choices.headers.get('cache-control'), 'private, no-store');
  assert.doesNotMatch(await choices.text(), /SECRET_ACTOR|abilityScore|weapon/);
  const response = await handlers.characterInfo(request('?revision=1'), 'hero');
  assert.equal(response.status, 200);
  const { info } = await response.json();
  assert.equal(info.actor.hp, 17); assert.equal(info.actor.maxHp, 20);
  assert.equal(info.actor.armorClass, 14); assert.equal(info.actor.position.coordinate, 'B2');
  assert.equal(info.sheet.status, 'unavailable');
  assert.ok(info.groups.length); assert.equal(info.revision, 1);
  assert.equal(JSON.stringify(game.load(scope.campaign)), before);
  assert.equal(game.receipts(scope).length, 0);
});

test('clicking visible non-owned tokens exposes public details only and never opens a private sheet', async t => {
  const { handlers, request, sheetReads } = fixture(t);
  const response = await handlers.characterInfo(request(), 'guard');
  assert.equal(response.status, 200);
  const { info } = await response.json();
  assert.equal(info.actor.name, 'guard'); assert.equal(info.actor.controlled, false);
  assert.equal(info.actor.hp, undefined); assert.equal(info.sheet.status, 'private');
  assert.doesNotMatch(JSON.stringify(info.groups), /Spear|armorClass|abilityScore|maxHp/);
  assert.equal(sheetReads(), 0);
});

test('hidden, stale, malformed and forged character requests are rejected without disclosure', async t => {
  const { handlers, request } = fixture(t);
  for (const [query, id, status] of [['', 'SECRET_ACTOR', 422], ['?revision=0', 'hero', 409], ['?owner=host', 'hero', 400], ['?revision=1&revision=2', 'hero', 400], ['?revision=abc', 'hero', 400], ['', '../secret', 400]]) {
    const response = await handlers.characterInfo(request(query), id);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /SECRET_ACTOR|private|Spear/);
  }
  assert.equal((await handlers.characterOptions(request('?campaign=elsewhere'))).status, 400);
});

test('both character endpoints recheck access and membership after revocation', async t => {
  const { game, handlers, request, revoke } = fixture(t);
  assert.equal((await handlers.characterOptions(request('', ''))).status, 401);
  assert.equal((await handlers.characterInfo(request('', ''), 'hero')).status, 401);
  game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(scope.campaign, scope.owner);
  assert.equal((await handlers.characterInfo(request(), 'hero')).status, 403);
  revoke();
  assert.equal((await handlers.characterOptions(request())).status, 401);
  assert.equal((await handlers.characterInfo(request(), 'hero')).status, 401);
});
