import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createWorldHandler } from './world-adapter.mjs';
import { missionPages } from './world-information.mjs';
import { safeText } from './import-ui.mjs';
const scope = { campaign: 'crossing', owner: '123456789012345678' }, other = '123456789012345679';
const config = { campaignId: scope.campaign, guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [scope.owner, other], playerRoleId: null };
function fixture(mutate = () => {}) {
  const game = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 14 : 6 });
  const actor = (id, owner, x, hp, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp, maxHp: 20, ac: 10, speed: 30, vision: 2, initiative, characterVersion: 'fixture', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: scope.campaign, title: 'Crossing', members: [{ owner: scope.owner, role: 'player' }, { owner: other, role: 'player' }, { owner: 'host', role: 'host' }], map: { id: 'map', title: 'Crossing', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', scope.owner, 1, 20, 20), actor('enemy', null, 2, 1, 10)], effects: [{ id: 'secret', name: 'SECRET_TRAP', visible: false, cells: [{ x: 2, y: 2 }], trigger: 'enter', damage: 1, expiresAtTurn: 8 }] });
  const mission = { reviewed: true, tracks: [{ id: 'trust', label: 'Trust', kind: 'location', value: 50 }], mission: { id: 'watch', title: 'Watch', briefing: 'Watch the crossing.', mapId: 'map', successTeam: 'party', success: { summary: 'Trust grows.', changes: [{ trackId: 'trust', delta: 10 }] }, failure: { summary: 'Trust fades.', changes: [] } } };
  mutate(mission); game.configureMission({ ...scope, owner: 'host' }, mission);
  const responses = [], edits = [];
  const handle = createWorldHandler({ game, config, transport: { respond: async (_id, _token, p) => responses.push(p), edit: async (_app, _token, p) => edits.push(p) } });
  const interaction = (custom, type = 3, extra = {}) => ({ id: 'fixture', token: 'fixture', application_id: '423456789012345678', type, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner }, roles: [] }, data: { custom_id: custom }, ...extra });
  return { game, handle, interaction, responses, edits };
}
const find = (data, label) => data.components.filter(c => c.type === 1).flatMap(c => c.components).find(c => c.label === label).custom_id;
function finish(game) {
  game.command(scope, { requestId: 'attack', expectedRevision: game.view(scope).revision, actorId: 'scout', type: 'attack', targetId: 'enemy' });
  game.command(scope, { requestId: 'end', expectedRevision: game.view(scope).revision, actorId: 'scout', type: 'end_turn' });
}
test('mission desk and saved counsel are private; repeated advice spends once', async () => {
  const h = fixture();
  try {
    await h.handle(h.interaction('rpw:home'));
    assert.equal(h.responses[0].data.flags, 64); assert.deepEqual(h.edits[0].allowed_mentions, { parse: [] });
    const desk = h.edits[0], ask = find(desk, 'Ask · surroundings');
    assert.ok(!JSON.stringify(desk).includes('SECRET_TRAP')); assert.ok(!JSON.stringify(desk).includes('Trust grows.'));
    await h.handle(h.interaction(ask)); await h.handle(h.interaction(ask));
    assert.equal(h.game.counsel(scope).remaining, 2); assert.equal(h.game.counsel(scope).records.length, 1);
    assert.match(h.edits.at(-1).components[0].content, /Evidence/);
    await h.handle(h.interaction(find(desk, 'Saved counsel')));
    const saved = h.edits.at(-1);
    await h.handle(h.interaction(find(saved, 'Read advice 1')));
    assert.equal(h.game.counsel(scope).remaining, 2);
  } finally { h.game.close(); }
});
test('shared debrief requires preview and confirmation; repeats do not reapply consequences', async () => {
  const h = fixture();
  try {
    finish(h.game); await h.handle(h.interaction('rpw:home'));
    await h.handle(h.interaction(find(h.edits.at(-1), 'Record party debrief')));
    const modal = h.responses.at(-1); assert.equal(modal.type, 9);
    await h.handle(h.interaction(modal.data.custom_id, 5, { data: { custom_id: modal.data.custom_id, components: [{ type: 18, component: { type: 4, custom_id: 'notes', value: 'We returned. @everyone' } }] } }));
    const preview = h.edits.at(-1);
    assert.match(preview.components[0].content, /visible to your campaign/);
    assert.ok(!preview.components[0].content.includes('@everyone'));
    assert.equal(h.game.world(scope).mission.status, 'debrief');
    const confirm = find(preview, 'Confirm shared debrief');
    await h.handle(h.interaction(confirm)); await h.handle(h.interaction(confirm));
    assert.equal(h.game.world(scope).mission.status, 'complete'); assert.equal(h.game.world(scope).tracks[0].value, 60);
    assert.equal(h.game.world(scope).events.length, 3);
  } finally { h.game.close(); }
});
test('stolen, foreign-channel and stale world controls cannot consume counsel', async () => {
  const h = fixture();
  try {
    await h.handle(h.interaction('rpw:home')); const ask = find(h.edits[0], 'Ask · readiness');
    await h.handle(h.interaction(ask, 3, { member: { user: { id: other }, roles: [] } }));
    await h.handle(h.interaction(ask, 3, { channel_id: 'elsewhere' }));
    finish(h.game); await h.handle(h.interaction(ask));
    assert.equal(h.game.counsel(scope).remaining, 3);
    h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(scope.owner);
    await h.handle(h.interaction('rpw:home'));
    assert.match(h.responses.at(-1).data.components[0].content, /membership/);
  } finally { h.game.close(); }
});

test('Discord retains the full long briefing, all 32 tracks, outcome and 2000-character debrief', async () => {
  const h = fixture(input => {
    input.mission.briefing = '*🌙*@everyone'.repeat(160);
    input.mission.success.summary = 'Consequences '.repeat(150);
    input.tracks.push(...Array.from({ length: 31 }, (_, i) => ({ id: `track-${i}`, label: `Track ${i} ${'_'.repeat(60)}`, kind: 'faction', value: i })));
  });
  try {
    finish(h.game); await h.handle(h.interaction('rpw:home'));
    await h.handle(h.interaction(find(h.edits.at(-1), 'Record party debrief')));
    const modal = h.responses.at(-1);
    assert.equal(modal.data.components[0].component.max_length, 2000);
    const notes = '*'.repeat(1997) + 'END';
    await h.handle(h.interaction(modal.data.custom_id, 5, { data: { custom_id: modal.data.custom_id, components: [{ type: 18, component: { type: 4, custom_id: 'notes', value: notes } }] } }));
    const confirm = find(h.edits.at(-1), 'Confirm shared debrief');
    assert.equal(h.game.world(scope).mission.status, 'debrief');
    await h.handle(h.interaction(confirm));
    assert.equal(h.game.world(scope).debrief.notes, notes);
    const world = h.game.world(scope), before = JSON.stringify(world), revision = h.game.view(scope).revision;
    await h.handle(h.interaction(find(h.edits.at(-1), 'Full mission record')));
    const pages = missionPages(world);
    for (let i = 0; i < pages.length; i++) {
      const card = h.edits.at(-1);
      assert.ok(card.components[0].content.endsWith(safeText(pages[i].text)));
      assert.ok(card.components[0].content.length < 3000);
      assert.deepEqual(card.allowed_mentions, { parse: [] });
      if (i + 1 < pages.length) await h.handle(h.interaction(find(card, 'Next page')));
    }
    assert.equal(JSON.stringify(h.game.world(scope)), before);
    assert.equal(h.game.view(scope).revision, revision); assert.equal(h.game.counsel(scope).remaining, 3);
    assert.ok(!JSON.stringify(pages).includes('SECRET_TRAP'));
  } finally { h.game.close(); }
});

test('mission pagination rechecks owner and world revision, and defers before reading the world', async () => {
  const h = fixture();
  try {
    const read = h.game.world.bind(h.game);
    h.game.world = requested => { assert.equal(h.responses.at(-1).type, 5); return read(requested); };
    await h.handle(h.interaction('rpw:home'));
    await h.handle(h.interaction(find(h.edits.at(-1), 'Full mission record')));
    const next = find(h.edits.at(-1), 'Next page');
    await h.handle(h.interaction(next, 3, { member: { user: { id: other }, roles: [] } }));
    assert.match(h.responses.at(-1).data.components[0].content, /current private control|control|player/i);
    finish(h.game); await h.handle(h.interaction(next));
    assert.match(h.edits.at(-1).components[0].content, /Open Mission/);
  } finally { h.game.close(); }
});

test('prepared departure requires owner-bound preview and confirms the party transition once', async () => {
  const h = fixture();
  try {
    const game = h.game, host = { ...scope, owner: 'host' };
    finish(game); game.debrief(scope, { requestId: 'travel-debrief', expectedRevision: 2, notes: '' });
    const branches = ['library', 'harbor'].map(id => ({ id, title: id, summary: 'Reviewed destination.', cost: 'None.', trackIds: ['trust'], evidence: ['world:crossing:3'], priorities: { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 } }));
    game.prepareCouncil(host, { reviewed: true, expectedWorldRevision: 3, branches });
    game.chooseCouncil(scope, { requestId: 'travel-choice', round: 1, branchId: 'library', expectedWorldRevision: 3 });
    const current = game.load(scope.campaign);
    game.prepareDeparture(host, { requestId: 'host-departure', reviewed: true, expectedRevision: current.revision, expectedWorldRevision: 4,
      destination: { mapId: 'library', map: { ...current.map, id: 'library' }, npcs: [], effects: [] }, placements: [{ actorId: 'scout', x: 1, y: 1 }],
      mission: { id: 'library', title: 'library', briefing: 'Enter the library.', mapId: 'library', successTeam: 'party', success: { summary: 'Complete.', changes: [] }, failure: { summary: 'Return.', changes: [] } } });
    await h.handle(h.interaction('rpw:home'));
    await h.handle(h.interaction(find(h.edits.at(-1), 'Next scene')));
    const confirmation = find(h.edits.at(-1), 'Enter with the party');
    assert.equal(game.view(scope).map.id, 'map');
    await h.handle(h.interaction(confirmation, 3, { member: { user: { id: other }, roles: [] } }));
    assert.equal(game.view(scope).map.id, 'map');
    await h.handle(h.interaction(confirmation));
    const revision = game.view(scope).revision;
    assert.equal(game.view(scope).map.id, 'library');
    await h.handle(h.interaction(confirmation));
    assert.equal(game.view(scope).revision, revision); assert.equal(game.world(scope).revision, 5);
  } finally { h.game.close(); }
});
