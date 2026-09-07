import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { COUNCIL } from '../game/council.mjs';
import { createCouncilHandler } from './council-adapter.mjs';
import { councilPages } from './world-information.mjs';
import { safeText } from './import-ui.mjs';

const scope = { campaign: 'council-test', owner: '123456789012345678' }, other = '123456789012345679';
const config = { campaignId: scope.campaign, guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [scope.owner, other], playerRoleId: null };
const controls = card => card.components.filter(c => c.type === 1).flatMap(c => c.components);
const find = (card, label) => { const button = controls(card).find(c => c.label === label); assert.ok(button, label); return button.custom_id; };
function setup(t) {
  const game = new GameStore(':memory:', { rollDie: n => n === 20 ? 14 : 6 }); t.after(() => game.close());
  const host = { ...scope, owner: 'host' };
  const actor = (id, owner, x, hp, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp, maxHp: 20, ac: 10, speed: 30, vision: 2, initiative, characterVersion: 'fixture', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: scope.campaign, title: 'Council test', members: [{ owner: scope.owner, role: 'player' }, { owner: other, role: 'player' }, { owner: 'host', role: 'host' }], map: { id: 'map', title: 'Courtyard', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('hero', scope.owner, 1, 20, 20), actor('enemy', null, 2, 1, 10)], effects: [] });
  game.configureMission(host, { reviewed: true, tracks: [], mission: { id: 'first', title: 'First mission', briefing: 'An authored mission.', mapId: 'map', successTeam: 'party', success: { summary: 'The crossing is quiet.', changes: [] }, failure: { summary: 'UNRESOLVED_SECRET', changes: [] } } });
  game.command(scope, { requestId: 'attack', expectedRevision: game.view(scope).revision, actorId: 'hero', type: 'attack', targetId: 'enemy' });
  game.command(scope, { requestId: 'end', expectedRevision: game.view(scope).revision, actorId: 'hero', type: 'end_turn' });
  game.debrief(scope, { requestId: 'debrief', expectedRevision: game.world(scope).revision, notes: 'We returned.' });
  const branches = Array.from({ length: 5 }, (_, i) => ({ id: `branch-${i}`, title: `Branch ${i} ${'_'.repeat(120)}`, summary: (`Moonlight ${i} *🌙* @everyone `).repeat(70), cost: `Cost ${i} ` + '*'.repeat(400), trackIds: [], evidence: [`world:${scope.campaign}:3`], priorities: Object.fromEntries(COUNCIL.map(r => [r.id, i === 0 ? 3 : 1])) }));
  game.prepareCouncil(host, { reviewed: true, expectedWorldRevision: game.world(scope).revision, branches });
  const callbacks = [], cards = [];
  const handle = createCouncilHandler({ game, config, transport: { respond: async (_id, _token, p) => { callbacks.push(p); if (p.type === 4) cards.push(p.data); }, edit: async (_app, _token, p) => cards.push(p) } });
  const interaction = (custom, extra = {}) => ({ id: 'fixture', token: 'fixture', application_id: '423456789012345678', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner }, roles: [] }, data: { custom_id: custom }, ...extra });
  return { game, handle, interaction, callbacks, cards };
}
async function choose(h, branchId = 'branch-4') {
  await h.handle(h.interaction('rpq:home'));
  const picker = controls(h.cards.at(-1)).find(c => c.type === 3);
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: [branchId] } }));
  return find(h.cards.at(-1), 'Confirm party branch');
}

test('Discord pages include all branches, costs, totals, five assessments and source evidence', async t => {
  const h = setup(t), before = JSON.stringify(h.game.world(scope)), revision = h.game.view(scope).revision;
  const round = h.game.council(scope), expected = councilPages(round);
  const read = h.game.council.bind(h.game);
  h.game.council = who => { assert.equal(h.callbacks.at(-1).type, 5); return read(who); };
  await h.handle(h.interaction('rpq:home'));
  for (let i = 0; i < expected.length; i++) {
    const card = h.cards.at(-1);
    assert.ok(card.components[0].content.endsWith(safeText(expected[i].text)));
    assert.ok(card.components[0].content.length < 3000);
    assert.deepEqual(card.allowed_mentions, { parse: [] });
    assert.equal(card.flags, 32768);
    if (i + 1 < expected.length) await h.handle(h.interaction(find(card, 'Next page')));
  }
  assert.equal(JSON.stringify(h.game.world(scope)), before); assert.equal(h.game.view(scope).revision, revision);
  assert.equal(h.game.counsel(scope).remaining, 3);
  assert.doesNotMatch(JSON.stringify(h.cards), /UNRESOLVED_SECRET/);
  assert.ok(h.callbacks.every(p => p.type === 5 && p.data.flags === 64));
});

test('explicit confirmation can choose a non-leading branch; retry does not choose twice', async t => {
  const h = setup(t), before = h.game.world(scope), revision = h.game.view(scope).revision;
  const confirm = await choose(h);
  assert.equal(h.game.council(scope).selection, null);
  await h.handle(h.interaction(find(h.cards.at(-1), 'Next page')));
  assert.equal(find(h.cards.at(-1), 'Confirm party branch'), confirm);
  await h.handle(h.interaction(confirm)); await h.handle(h.interaction(confirm));
  assert.equal(h.game.council(scope).selection.branchId, 'branch-4');
  assert.equal(h.game.world(scope).revision, before.revision + 1);
  assert.equal(h.game.world(scope).nextMission.status, 'selected-awaiting-scene');
  assert.equal(h.game.view(scope).revision, revision);
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM council_receipts').get().n, 1);
});

test('copied, foreign-channel, forged and revoked controls cannot select a branch', async t => {
  const h = setup(t), confirm = await choose(h);
  await h.handle(h.interaction(confirm, { member: { user: { id: other }, roles: [] } }));
  await h.handle(h.interaction(confirm, { channel_id: 'elsewhere' }));
  await h.handle(h.interaction('rpq:home'));
  const picker = controls(h.cards.at(-1)).find(c => c.type === 3);
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: ['forged'] } }));
  assert.equal(h.game.council(scope).selection, null);
  h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(scope.owner);
  await h.handle(h.interaction(confirm));
  assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM council_receipts').get().n, 0);
});

test('a competing browser choice rejects a different pending Discord confirmation', async t => {
  const h = setup(t), confirm = await choose(h);
  const round = h.game.council(scope);
  h.game.chooseCouncil({ ...scope, owner: other }, { requestId: 'browser-choice', round: round.round, branchId: 'branch-1', expectedWorldRevision: round.worldRevision });
  await h.handle(h.interaction(confirm));
  assert.equal(h.game.council(scope).selection.branchId, 'branch-1');
  assert.match(h.cards.at(-1).components[0].content, /Refresh the council/);
});
