import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { COUNCIL } from '../game/council.mjs';
import { createDepartureHandler } from './departure-adapter.mjs';
import { createWorldHandler } from './world-adapter.mjs';
import { safeText } from './import-ui.mjs';

const scope = { campaign: 'departure-controls', owner: '123456789012345678' }, other = '123456789012345679';
const config = { campaignId: scope.campaign, guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [scope.owner, other], playerRoleId: null };
const controls = card => card.components.filter(c => c.type === 1).flatMap(c => c.components);
const button = (card, label) => { const found = controls(card).find(c => c.label === label); assert.ok(found, `Missing ${label}`); return found; };
function setup(t) {
  const game = new GameStore(':memory:', { rollDie: n => n === 20 ? 14 : 6 }); t.after(() => game.close());
  const host = { ...scope, owner: 'host' };
  const actor = (id, owner, x, hp, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp, maxHp: 20, ac: 10, speed: 30, vision: 2, initiative, characterVersion: 'fixture', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: scope.campaign, title: 'Departure test', members: [{ owner: scope.owner, role: 'player' }, { owner: other, role: 'player' }, { owner: 'host', role: 'host' }], map: { id: 'first', title: 'First map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('hero', scope.owner, 1, 9, 20), actor('enemy', null, 2, 1, 10)], effects: [] });
  game.configureMission(host, { reviewed: true, tracks: [], mission: { id: 'first-mission', title: 'First mission', briefing: 'An authored mission.', mapId: 'first', successTeam: 'party', success: { summary: 'The crossing is quiet.', changes: [] }, failure: { summary: 'SECRET_OUTCOME', changes: [] } } });
  game.command(scope, { requestId: 'attack', expectedRevision: game.view(scope).revision, actorId: 'hero', type: 'attack', targetId: 'enemy' });
  game.command(scope, { requestId: 'end', expectedRevision: game.view(scope).revision, actorId: 'hero', type: 'end_turn' });
  game.debrief(scope, { requestId: 'debrief', expectedRevision: game.world(scope).revision, notes: 'We returned.' });
  const priorities = Object.fromEntries(COUNCIL.map(r => [r.id, 1]));
  const branches = ['next-mission', 'other-mission'].map(id => ({ id, title: id, summary: 'A reviewed branch.', cost: 'Time', trackIds: [], evidence: [`world:${scope.campaign}:3`], priorities }));
  game.prepareCouncil(host, { reviewed: true, expectedWorldRevision: game.world(scope).revision, branches });
  const round = game.council(scope);
  game.chooseCouncil(scope, { requestId: 'branch-choice', round: round.round, branchId: 'next-mission', expectedWorldRevision: round.worldRevision });
  const input = { requestId: 'host-departure', reviewed: true, expectedRevision: game.view(scope).revision, expectedWorldRevision: game.world(scope).revision,
    destination: { mapId: 'second', map: { id: 'second', title: 'Second map', width: 8, height: 8, blocked: [], difficult: [] }, npcs: [actor('SECRET_DESTINATION_NPC', null, 5, 20, 10)], effects: [] }, placements: [{ actorId: 'hero', x: 1, y: 1 }],
    mission: { id: 'next-mission', title: 'next-mission', briefing: '*🌙* @everyone '.repeat(140), mapId: 'second', successTeam: 'party', success: { summary: 'SECRET_NEXT_OUTCOME', changes: [] }, failure: { summary: 'SECRET_FAILURE', changes: [] } } };
  const offer = game.prepareDeparture(host, input);
  const callbacks = [], cards = [];
  let failNextEdit = false;
  const transport = { respond: async (_id, _token, p) => { callbacks.push(p); if (p.type === 4) cards.push(p.data); }, edit: async (_app, _token, p) => { if (failNextEdit) { failNextEdit = false; throw new Error('Simulated disconnected client'); } cards.push(p); } };
  const handle = createDepartureHandler({ game, config, transport }), world = createWorldHandler({ game, config, transport });
  const dispatch = async event => await handle(event) || world(event);
  const interaction = (custom, extra = {}) => ({ id: 'fixture', token: 'fixture', application_id: '423456789012345678', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner }, roles: [] }, data: { custom_id: custom }, ...extra });
  return { game, host, input, offer, handle, dispatch, interaction, cards, callbacks, failDelivery: () => { failNextEdit = true; } };
}
function savedState(game) { return ['game_campaigns', 'game_events', 'game_receipts', 'game_outbox', 'world_events', 'world_campaigns'].map(table => game.db.prepare(`SELECT * FROM ${table}`).all()); }

async function openFromMission(h) {
  await h.dispatch(h.interaction('rpw:home'));
  const next = button(h.cards.at(-1), 'Next scene');
  assert.equal(next.disabled, false);
  await h.dispatch(h.interaction(next.custom_id));
  return next.custom_id;
}

test('existing Next scene control opens full private preview without changing any game state', async t => {
  const h = setup(t), before = savedState(h.game);
  await openFromMission(h);
  const confirm = button(h.cards.at(-1), 'Confirm party departure').custom_id;
  const pages = [];
  for (let i = 0; i < 20; i++) {
    const card = h.cards.at(-1); pages.push(card.components[0].content);
    assert.equal(card.flags, 32768); assert.deepEqual(card.allowed_mentions, { parse: [] });
    assert.equal(button(card, 'Confirm party departure').custom_id, confirm);
    const next = button(card, 'Next page');
    if (next.disabled) break;
    await h.dispatch(h.interaction(next.custom_id));
  }
  const text = pages.map(page => page.slice(page.indexOf('\n\n') + 2)).join('');
  assert.ok(text.includes(safeText(h.input.mission.briefing)));
  assert.match(text, /whole party/); assert.doesNotMatch(text, /SECRET_/);
  assert.deepEqual(savedState(h.game), before);
  assert.ok(h.callbacks.every(p => p.type === 5 && p.data.flags === 64));
});

test('confirmation uses the shared scene service, preserves injury and retries after failed delivery once', async t => {
  const h = setup(t);
  await openFromMission(h); const confirm = button(h.cards.at(-1), 'Confirm party departure').custom_id;
  h.failDelivery(); await h.dispatch(h.interaction(confirm));
  const after = savedState(h.game);
  assert.equal(h.game.view(scope).map.title, 'Second map');
  assert.equal(h.game.view(scope).actors.find(a => a.id === 'hero').hp, 9);
  await h.dispatch(h.interaction(confirm));
  assert.deepEqual(savedState(h.game), after);
  assert.match(h.cards.at(-1).components[0].content, /departure recorded/);
  assert.equal(h.game.world(scope).mission.id, 'next-mission');
});

test('copied controls, revoked membership and a replaced departure cannot move the party', async t => {
  const h = setup(t); await openFromMission(h);
  const confirm = button(h.cards.at(-1), 'Confirm party departure').custom_id;
  await h.dispatch(h.interaction(confirm, { member: { user: { id: other }, roles: [] } }));
  await h.dispatch(h.interaction(confirm, { channel_id: 'elsewhere' }));
  const replacement = structuredClone(h.input); replacement.requestId = 'replacement'; replacement.mission.briefing = 'The host reviewed a different briefing.';
  h.game.prepareDeparture(h.host, replacement);
  await h.dispatch(h.interaction(confirm)); assert.equal(h.game.view(scope).map.title, 'First map');
  h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(scope.owner);
  await h.dispatch(h.interaction(confirm));
  assert.equal(h.game.load(scope.campaign).map.id, 'first');
});

test('a browser departure invalidates another player’s old confirmation without a second transition', async t => {
  const h = setup(t); await openFromMission(h);
  const confirm = button(h.cards.at(-1), 'Confirm party departure').custom_id;
  h.game.enterDeparture({ ...scope, owner: other }, { departureId: h.offer.id, requestId: 'browser-departure' });
  const after = savedState(h.game);
  await h.dispatch(h.interaction(confirm)); assert.deepEqual(savedState(h.game), after);
  assert.match(h.cards.at(-1).components[0].content, /Refresh the map/);
});

test('private acknowledgement precedes reading departure projections', async t => {
  const h = setup(t), read = h.game.departure.bind(h.game);
  h.game.departure = who => { assert.equal(h.callbacks.at(-1).type, 5); return read(who); };
  await h.handle(h.interaction('rpd:home'));
  assert.ok(button(h.cards.at(-1), 'Confirm party departure'));
});
