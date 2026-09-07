import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { missionAdjudication } from './adjudication.mjs';
import { createGameHttp } from './http.mjs';
import { createAdjudicationHandler } from '../discord/adjudication-adapter.mjs';
import { createWorldHandler } from '../discord/world-adapter.mjs';
import { safeText } from '../discord/import-ui.mjs';

const host = { campaign: 'adjudication-controls', owner: '111111111111111111' };
const player = { ...host, owner: '222222222222222222' }, secondHost = { ...host, owner: '333333333333333333' };
const config = { campaignId: host.campaign, guildId: '444444444444444444', channelId: '555555555555555555', playerIds: [host.owner, player.owner, secondHost.owner] };
const tokens = new Map([['a'.repeat(64), host], ['b'.repeat(64), player], ['c'.repeat(64), secondHost]]);
const buttons = data => data.components.filter(c => c.type === 1).flatMap(c => c.components);
const text = data => data.components.filter(c => c.type === 10).map(c => c.content).join('\n');
function setup(t) {
  let dice = 0, failDelivery = false;
  const game = new GameStore(':memory:', { rollDie: () => { dice++; return 12; } });
  t.after(() => game.close());
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp: 9, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: host.campaign, title: 'Adjudication fixture', members: [{ owner: host.owner, role: 'host' }, { owner: player.owner, role: 'player' }, { owner: secondHost.owner, role: 'host' }], map: { id: 'map', title: 'Negotiation chamber', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('Maren', player.owner, 1, 20), actor('hidden-person', null, 10, 10)], effects: [] });
  const tracks = Array.from({ length: 32 }, (_, i) => ({ id: `track-${i}`, label: `Consequence ${i}`, kind: 'relationship', value: i === 0 ? 95 : 50 }));
  const longSummary = ('Secret *agreement* @everyone 🕯️. ').repeat(45) + ' END-OF-PRIVATE-SUMMARY';
  game.configureMission(host, { reviewed: true, tracks, mission: { id: 'negotiation', title: 'Reviewed negotiation', briefing: 'Public conversation briefing.', mapId: 'map', resolution: 'adjudicated', outcomes: Array.from({ length: 16 }, (_, i) => ({ id: `outcome-${i}`, title: `Private outcome ${i}`, summary: i === 0 ? longSummary : `Private resolution ${i}.`, changes: tracks.map(track => ({ trackId: track.id, delta: i === 0 ? 12 : -5 })) })) } });
  const access = { authenticateAccess: token => { const scope = tokens.get(token); if (!scope) throw new Error('private auth error'); return scope; } };
  const handlers = createGameHttp(() => ({ game, access }));
  const messages = [], callbacks = [];
  const transport = { respond: async (...args) => { callbacks.push(args[2]); if (args[2].type === 4) messages.push(args[2].data); }, edit: async (...args) => { if (failDelivery) { failDelivery = false; throw new Error('lost response'); } messages.push(args[2]); } };
  const handle = createAdjudicationHandler({ game, config, transport });
  const worldHandle = createWorldHandler({ game, config, transport });
  const interaction = (custom_id, scope = host, overrides = {}) => ({ id: 'interaction', application_id: 'application', token: 'token', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner, bot: false }, roles: [] }, data: { custom_id }, ...overrides });
  const snapshot = () => ({ game: game.load(host.campaign), world: game.world(host), dice, receipts: game.db.prepare('SELECT count(*) AS n FROM world_receipts WHERE campaign=?').get(host.campaign).n });
  return { game, handlers, handle, worldHandle, interaction, messages, callbacks, transport, snapshot, longSummary, loseDelivery: () => { failDelivery = true; } };
}
function request({ body, token = 'a'.repeat(64), query = '', origin = 'https://raph.example' } = {}) {
  return new Request(`https://raph.example/api/game/adjudication${query}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `raph_game_access=${token}`, ...(body === undefined ? {} : { origin, 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function decision(view, requestId = 'reviewed-outcome') { return { reviewed: true, requestId, expectedRevision: view.expectedRevision, expectedWorldRevision: view.expectedWorldRevision, outcomeId: view.outcomes[0].id }; }
async function expectPrivateDenial(f, interaction) {
  const messageCount = f.messages.length, callbackCount = f.callbacks.length;
  assert.equal(await f.handle(interaction), true);
  assert.equal(f.messages.length, messageCount + 1, 'A rejected action must emit a new denial, not leave a previous host preview in the test transport.');
  assert.equal(f.callbacks.length, callbackCount + 1, 'The denied interaction must receive exactly one acknowledgement.');
  const callback = f.callbacks[callbackCount], denial = f.messages[messageCount];
  assert.ok([4, 5].includes(callback.type));
  assert.equal(callback.data.flags & 64, 64, 'The denial callback or deferred response must be private.');
  assert.match(text(denial), /Host mission review/);
  assert.doesNotMatch(text(denial), /Private outcome|END-OF-PRIVATE/);
  assert.deepEqual(denial.allowed_mentions, { parse: [] });
  assert.equal(buttons(denial).some(button => button.label === 'Confirm this mission outcome'), false);
}

test('host projection retains all configured outcomes and bounded deltas without revealing them to players or mutating state', t => {
  const f = setup(t), before = f.snapshot(), review = missionAdjudication(f.game, host);
  assert.equal(review.outcomes.length, 16); assert.equal(review.outcomes[0].changes.length, 32);
  assert.equal(review.outcomes[0].summary, f.longSummary);
  assert.deepEqual(review.outcomes[0].changes[0], { trackId: 'track-0', label: 'Consequence 0', delta: 12, before: 95, after: 100 });
  assert.throws(() => missionAdjudication(f.game, player), error => error.code === 'UNAUTHORIZED');
  assert.doesNotMatch(JSON.stringify(f.game.world(player)), /Private outcome|END-OF-PRIVATE/);
  assert.doesNotMatch(JSON.stringify(review), /hidden-person|weapon|characterVersion/);
  assert.deepEqual(f.snapshot(), before);
});

test('HTTP host-only preview and explicit confirmation preserve time, HP and rolls; lost delivery retry is idempotent', async t => {
  const f = setup(t), before = f.snapshot();
  const response = await f.handlers.adjudication(request()); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const { adjudication } = await response.json(); assert.equal(adjudication.outcomes.length, 16);
  const input = decision(adjudication), first = await f.handlers.adjudicateMission(request({ body: input })); assert.equal(first.status, 200);
  const receipt = await first.json(), committed = f.snapshot();
  const retry = await f.handlers.adjudicateMission(request({ body: input })); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), receipt); assert.deepEqual(f.snapshot(), committed);
  assert.equal(committed.game.phase, 'complete'); assert.equal(committed.world.mission.status, 'debrief'); assert.equal(committed.world.tracks[0].value, 100);
  assert.equal(committed.game.turn, before.game.turn); assert.equal(committed.game.round, before.game.round); assert.deepEqual(committed.game.actors, before.game.actors); assert.equal(committed.dice, before.dice);
  assert.equal(committed.receipts, 1); assert.deepEqual((await (await f.handlers.adjudication(request())).json()).adjudication, { available: false });
});

test('HTTP rejects player access, copied identity, false review, stale game/world revision and cross-origin requests', async t => {
  const f = setup(t), input = decision(missionAdjudication(f.game, host)), before = f.snapshot();
  assert.equal((await f.handlers.adjudication(request({ token: 'b'.repeat(64) }))).status, 403);
  assert.equal((await f.handlers.adjudicateMission(request({ token: 'b'.repeat(64), body: input }))).status, 403);
  assert.equal((await f.handlers.adjudication(request({ query: '?owner=host' }))).status, 400);
  for (const body of [{ ...input, owner: host.owner }, { ...input, reviewed: false }, { ...input, changes: [{ trackId: 'track-0', delta: 100 }] }]) assert.equal((await f.handlers.adjudicateMission(request({ body }))).status, 400);
  for (const field of ['expectedRevision', 'expectedWorldRevision']) assert.equal((await f.handlers.adjudicateMission(request({ body: { ...input, [field]: input[field] + 1 } }))).status, 409);
  assert.equal((await f.handlers.adjudicateMission(request({ body: input, origin: 'https://attacker.example' }))).status, 403);
  assert.deepEqual(f.snapshot(), before);
  f.game.db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', host.campaign, host.owner);
  assert.equal((await f.handlers.adjudicateMission(request({ body: input }))).status, 403);
});

test('Discord entry is discoverable only in host full mission record and retains platform button bounds', async t => {
  const f = setup(t);
  for (const scope of [host, player]) {
    await f.worldHandle(f.interaction('rpw:home', scope)); let card = f.messages.at(-1);
    assert.ok(buttons(card).length <= 10);
    await f.worldHandle(f.interaction(buttons(card).find(b => b.label === 'Full mission record').custom_id, scope)); card = f.messages.at(-1);
    assert.equal(buttons(card).some(b => b.custom_id === 'rpj:home'), scope === host); assert.ok(buttons(card).length <= 10);
  }
});

test('Discord private pages preserve full summaries and consequences while preview stays free', async t => {
  const f = setup(t), before = f.snapshot();
  await f.handle(f.interaction('rpj:home'));
  assert.deepEqual(f.callbacks[0], { type: 5, data: { flags: 64 } });
  const confirm = buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id;
  let pages = '', count = 0;
  while (true) {
    const card = f.messages.at(-1); pages += text(card); count++;
    assert.ok(buttons(card).length <= 10); assert.deepEqual(card.allowed_mentions, { parse: [] });
    assert.ok(card.components.filter(c => c.type === 10).every(c => c.content.length < 3000));
    assert.equal(buttons(card).find(b => b.label === 'Confirm this mission outcome').custom_id, confirm);
    const next = buttons(card).find(b => b.label === 'Next page'); if (next.disabled) break;
    assert.ok(count < 30); await f.handle(f.interaction(next.custom_id));
  }
  assert.ok(count > 5); assert.match(pages, /END-OF-PRIVATE-SUMMARY/); assert.match(pages, /Consequence 31/);
  assert.ok(pages.includes(safeText('Secret *agreement* @everyone 🕯️.'))); assert.doesNotMatch(pages, /hidden-person/);
  assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction(buttons(f.messages.at(-1)).find(b => b.label === 'Next outcome').custom_id));
  assert.notEqual(buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id, confirm);
  assert.deepEqual(f.snapshot(), before);
});

test('Discord stable confirmation survives delivery loss and cannot repeat a committed outcome', async t => {
  const f = setup(t); await f.handle(f.interaction('rpj:home'));
  const confirm = buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id;
  f.loseDelivery(); await f.handle(f.interaction(confirm)); const saved = f.snapshot();
  assert.equal(saved.receipts, 1); assert.equal(saved.world.mission.status, 'debrief');
  await f.handle(f.interaction(confirm)); assert.deepEqual(f.snapshot(), saved); assert.match(text(f.messages.at(-1)), /outcome is saved/);
});

test('Discord rejects copied host controls, players, foreign channels, changed revisions and revoked host roles', async t => {
  const f = setup(t); await f.handle(f.interaction('rpj:home'));
  const confirm = buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id, before = f.snapshot();
  for (const scope of [player, secondHost]) { await expectPrivateDenial(f, f.interaction(confirm, scope)); assert.deepEqual(f.snapshot(), before); }
  await expectPrivateDenial(f, f.interaction(confirm, host, { channel_id: 'different-channel' })); assert.deepEqual(f.snapshot(), before);
  f.game.transaction(() => { const state = f.game.load(host.campaign); f.game.record(state, 'test_revision_change', {}); f.game.save(state); });
  const changed = f.snapshot(); await expectPrivateDenial(f, f.interaction(confirm)); assert.deepEqual(f.snapshot(), changed);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, host.owner);
  await expectPrivateDenial(f, f.interaction(confirm)); assert.deepEqual(f.game.load(host.campaign), changed.game);
});

test('host role is rechecked after the private acknowledgement before revealing or committing outcomes', async t => {
  for (const confirm of [false, true]) {
    const f = setup(t); let id = 'rpj:home';
    if (confirm) { await f.handle(f.interaction(id)); id = buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id; }
    const before = f.snapshot(), respond = f.transport.respond;
    f.transport.respond = async (...args) => {
      await respond(...args);
      if (args[2].type === 5) f.game.db.prepare('UPDATE game_members SET role=? WHERE campaign=? AND owner=?').run('player', host.campaign, host.owner);
    };
    await expectPrivateDenial(f, f.interaction(id));
    assert.deepEqual(f.snapshot(), before);
  }
});

test('browser confirmation invalidates another host Discord preview without applying another outcome', async t => {
  const f = setup(t); await f.handle(f.interaction('rpj:home', secondHost));
  const confirm = buttons(f.messages.at(-1)).find(b => b.label === 'Confirm this mission outcome').custom_id;
  const input = decision(missionAdjudication(f.game, host));
  assert.equal((await f.handlers.adjudicateMission(request({ body: input }))).status, 200);
  const committed = f.snapshot(); await f.handle(f.interaction(confirm, secondHost)); assert.deepEqual(f.snapshot(), committed);
});
