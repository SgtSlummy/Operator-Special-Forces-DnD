import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore, GameError } from './store.mjs';
import { createGameHttp } from './http.mjs';

const host = { campaign: 'reaction-http', owner: 'host' };
const first = { ...host, owner: 'first' }, second = { ...host, owner: 'second' };
const tokens = new Map([['a'.repeat(64), host], ['b'.repeat(64), first], ['c'.repeat(64), second]]);
function setup(t) {
  let dice = 0;
  const game = new GameStore(':memory:', { rollDie: sides => { dice++; return sides === 20 ? 12 : 4; } });
  t.after(() => game.close());
  const actor = (id, owner, team, x, y, initiative) => ({ id, name: id, owner, team, x, y, initiative, size: 1, hp: 40, maxHp: 40, ac: 14, speed: 30, vision: 12, characterVersion: 'fixture-v1',
    weapon: { name: `${id} blade`, abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 }, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } });
  game.createCampaign({ campaign: host.campaign, title: 'HTTP reactions', members: [{ owner: host.owner, role: 'host' }, { owner: first.owner, role: 'player' }, { owner: second.owner, role: 'player' }],
    map: { id: 'map', title: 'Reaction fixture', width: 12, height: 12, blocked: [], difficult: [] }, effects: [],
    actors: [actor('mover', null, 'opposition', 2, 2, 30), actor('reactor-one', first.owner, 'party', 1, 2, 20), actor('reactor-two', second.owner, 'party', 2, 1, 10)] });
  game.command(host, { type: 'move', actorId: 'mover', requestId: 'move-to-reaction', expectedRevision: game.view(host).revision, path: [{ x: 3, y: 3 }] });
  const access = { authenticateAccess: token => { const scope = tokens.get(token); if (!scope) throw new Error('SECRET access failure'); return scope; } };
  const handlers = createGameHttp(() => ({ game, access }));
  const snapshot = () => ({ state: game.load(host.campaign), events: game.events(host), dice, receipts: game.db.prepare('SELECT * FROM game_receipts ORDER BY body').all() });
  const input = (scope, decision, requestId = `decision-${scope.owner}`) => { const state = game.reactions(scope); return { requestId, expectedRevision: state.revision, pendingId: state.pending.id, decision, ...(decision === 'attack' || decision === 'decline' ? { optionId: state.pending.offers[0].optionId } : {}) }; };
  return { game, handlers, snapshot, input, dice: () => dice };
}
function request({ body, token = 'a'.repeat(64), query = '', origin = 'https://raph.example', contentType = 'application/json' } = {}) {
  return new Request(`https://raph.example/api/game/reactions${query}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `raph_game_access=${token}`, ...(body === undefined ? {} : { origin, 'content-type': contentType }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('GET reactions is private, scoped and read-only for every caller', async t => {
  const f = setup(t), before = f.snapshot();
  for (const [token, scope] of tokens) {
    const response = await f.handlers.reactions(request({ token })); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
    const body = await response.json(); assert.deepEqual(body, { reactions: f.game.reactions(scope) });
    if (scope === first) { assert.equal(body.reactions.pending.offers.length, 1); assert.equal(body.reactions.pending.offers[0].actorId, 'reactor-one'); assert.doesNotMatch(JSON.stringify(body), /reactor-two blade/); }
  }
  assert.deepEqual(f.snapshot(), before); assert.equal(f.dice(), 0);
});

test('POST uses stable decisions and exposes actual attack rolls only to their owner', async t => {
  const f = setup(t), input = f.input(first, 'attack');
  const response = await f.handlers.resolveReaction(request({ token: 'b'.repeat(64), body: input })); assert.equal(response.status, 200);
  const firstReply = await response.json(), saved = f.snapshot(); assert.equal(f.dice(), 0);
  const retry = await f.handlers.resolveReaction(request({ token: 'b'.repeat(64), body: input })); assert.equal(retry.status, 200); assert.deepEqual((await retry.json()).receipt, firstReply.receipt); assert.deepEqual(f.snapshot(), saved);
  assert.equal((await f.handlers.resolveReaction(request({ token: 'c'.repeat(64), body: f.input(second, 'decline') }))).status, 200);
  const own = (await (await f.handlers.reactions(request({ token: 'b'.repeat(64) }))).json()).reactions;
  assert.equal(own.pending, null); assert.equal(own.recentResults.length, 1); assert.equal(own.recentResults[0].result.reaction, true); assert.equal(own.recentResults[0].result.actorId, 'reactor-one');
  assert.equal(f.game.reactions(second).recentResults.length, 0); assert.equal(f.game.reactions(host).recentResults.length, 0);
  assert.equal(f.dice(), 2); assert.deepEqual(f.game.load(host.campaign).actors.find(actor => actor.id === 'mover').x, 3);
});

test('both HTTP boundaries reject forged scope, bad origin, unsupported bodies and query fields', async t => {
  const f = setup(t), input = f.input(first, 'attack'), before = f.snapshot();
  for (const handler of [f.handlers.reactions, f.handlers.resolveReaction]) assert.equal((await handler(request({ token: 'd'.repeat(64), ...(handler === f.handlers.resolveReaction ? { body: input } : {}) }))).status, 401);
  assert.equal((await f.handlers.reactions(request({ query: '?owner=first' }))).status, 400);
  assert.equal((await f.handlers.resolveReaction(request({ body: input, query: '?campaign=other' }))).status, 400);
  for (const extra of [{ owner: first.owner }, { campaign: host.campaign }, { dice: [20] }, { damage: 999 }]) assert.equal((await f.handlers.resolveReaction(request({ body: { ...input, ...extra } }))).status, 400);
  assert.equal((await f.handlers.resolveReaction(request({ body: input, origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await f.handlers.resolveReaction(request({ body: input, contentType: 'text/plain' }))).status, 415);
  assert.equal((await f.handlers.resolveReaction(request({ body: { ...input, requestId: 'x'.repeat(9000) } }))).status, 413);
  assert.deepEqual(f.snapshot(), before);
});

test('copied options, stale revisions and revoked membership cannot resolve a reaction', async t => {
  const f = setup(t), input = f.input(first, 'attack'), before = f.snapshot();
  assert.equal((await f.handlers.resolveReaction(request({ token: 'b'.repeat(64), body: { ...input, expectedRevision: input.expectedRevision + 1 } }))).status, 409);
  const copied = await f.handlers.resolveReaction(request({ token: 'c'.repeat(64), body: input })); assert.ok([403, 409].includes(copied.status));
  assert.deepEqual(f.snapshot(), before);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, first.owner);
  for (const handler of [f.handlers.reactions, f.handlers.resolveReaction]) assert.equal((await handler(request({ token: 'b'.repeat(64), ...(handler === f.handlers.resolveReaction ? { body: input } : {}) }))).status, 403);
  assert.equal(f.dice(), 0);
});

test('paused reactions remain readable but cannot be resolved', async t => {
  const f = setup(t);
  f.game.command(host, { type: 'pause', actorId: 'mover', requestId: 'pause-reactions', expectedRevision: f.game.view(host).revision });
  const before = f.snapshot();
  const state = (await (await f.handlers.reactions(request({ token: 'b'.repeat(64) }))).json()).reactions;
  assert.equal(state.pending.paused, true);
  assert.equal((await f.handlers.resolveReaction(request({ token: 'b'.repeat(64), body: f.input(first, 'attack') }))).status, 409);
  assert.deepEqual(f.snapshot(), before);
});

test('explicit controller ordering resolves all declared attacks once in the chosen order', async t => {
  const f = setup(t);
  for (const [scope, token] of [[first, 'b'.repeat(64)], [second, 'c'.repeat(64)]]) assert.equal((await f.handlers.resolveReaction(request({ token, body: f.input(scope, 'attack') }))).status, 200);
  const state = f.game.reactions(host); assert.equal(state.pending.stage, 'order'); assert.equal(f.dice(), 0);
  const order = state.pending.orderChoices.map(choice => choice.optionId).reverse();
  const input = { ...f.input(host, 'order'), order };
  const response = await f.handlers.resolveReaction(request({ body: input })); assert.equal(response.status, 200); const firstReply = await response.json();
  assert.equal(firstReply.reactions.pending, null); assert.equal(f.dice(), 4);
  const saved = f.snapshot(); assert.equal((await f.handlers.resolveReaction(request({ body: input }))).status, 200); assert.deepEqual(f.snapshot(), saved);
});

test('HTTP maps pending and unavailable reactions without exposing internal errors', async t => {
  const f = setup(t), input = f.input(first, 'attack');
  for (const code of ['PENDING', 'REACTION']) {
    f.game.resolveReaction = () => { throw new GameError(code, 'SECRET internal state'); };
    const response = await f.handlers.resolveReaction(request({ token: 'b'.repeat(64), body: input })); assert.equal(response.status, 409);
    const body = await response.json(); assert.equal(body.code, code); assert.doesNotMatch(body.error, /SECRET/);
  }
});
