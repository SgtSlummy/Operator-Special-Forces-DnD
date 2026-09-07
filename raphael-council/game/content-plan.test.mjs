import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createGreyharborProposal } from './packs/greyharbor.mjs';

const priorities = { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 };
const weapon = { name: 'Staff', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 4, addAbilityToDamage: true, rangeFeet: 30 };
const profile = { size: 1, hp: 9, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 10, characterVersion: 'profile1', weapon };
const combatPlan = (id, mapId) => ({ id, title: `Mission ${id}`, briefing: 'The host reviewed this briefing.', mapId, successTeam: 'party', success: { summary: 'The party succeeded.', changes: [{ trackId: 'trust', delta: 10 }] }, failure: { summary: 'The party withdrew.', changes: [{ trackId: 'trust', delta: -10 }] } });
function setup(t, { combat = false } = {}) {
  const game = new GameStore(':memory:'); t.after(() => game.close());
  const campaign = 'root-plan-review', host = { campaign, owner: 'host' }, player = { campaign, owner: 'player' };
  const map = { id: 'room', title: 'Room', width: 4, height: 4, blocked: [], difficult: [] };
  const witness = { ...profile, id: 'witness', name: 'Witness', owner: null, team: 'witnesses', x: 3, y: 3 };
  game.createCampaign({ campaign, title: 'Pack plan fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }], map, actors: [{ ...profile, id: 'hero', name: 'Hero', owner: 'player', team: 'party', x: 0, y: 0 }, witness], effects: [] });
  const mission = combat ? combatPlan('opening', 'room') : { id: 'opening', title: 'Mission opening', briefing: 'The host reviewed this briefing.', mapId: 'room', resolution: 'adjudicated', outcomes: [{ id: 'agreed', title: 'Agreement', summary: 'The agreement was reached.', changes: [{ trackId: 'trust', delta: 10 }] }, { id: 'withheld', title: 'No agreement', summary: 'The agreement remains open.', changes: [{ trackId: 'trust', delta: -10 }] }] };
  game.configureMission(host, { reviewed: true, tracks: [{ id: 'trust', label: 'Trust', kind: 'relationship', value: 40 }, { id: 'attention', label: 'Attention', kind: 'attention', value: 30 }], mission });
  const pack = {
    schemaVersion: 1, id: 'root-pack', title: 'Reviewed continuation', world: { id: 'world', title: 'World' }, regions: [{ id: 'region', title: 'Region' }], locations: [{ id: 'location', title: 'Location', regionId: 'region' }],
    scenes: [{ map, locationId: 'location', npcs: [witness], effects: [], entrances: [{ x: 0, y: 0 }] }, ...['north', 'south'].map(id => ({ map: { ...map, id, title: id }, locationId: 'location', npcs: [], effects: [], entrances: [{ x: 0, y: 0 }] }))],
    missions: [{ mission: structuredClone(mission), summary: 'The first mission.', cost: 'A conversation.', trackIds: ['trust'], priorities, next: ['north', 'south'], ...(combat ? {} : { nextByOutcome: { agreed: ['north', 'south'], withheld: [] } }) }, ...['north', 'south'].map(id => ({ mission: combatPlan(id, id), summary: `Explore ${id}.`, cost: 'A journey.', trackIds: ['trust'], priorities, next: [] }))],
  };
  return { game, host, player, pack };
}
function snapshot(f) {
  return { game: f.game.view(f.host), world: f.game.world(f.host), council: f.game.council(f.host), content: f.game.db.prepare('SELECT * FROM game_content').all(), receipts: f.game.db.prepare('SELECT * FROM world_receipts ORDER BY rowid').all() };
}
const mismatches = [
  ['outcome identity', root => { root.mission.outcomes[0].id = 'other-agreement'; root.nextByOutcome['other-agreement'] = root.nextByOutcome.agreed; delete root.nextByOutcome.agreed; }],
  ['outcome title', root => { root.mission.outcomes[0].title = 'A different title'; }],
  ['outcome summary', root => { root.mission.outcomes[0].summary = 'A different private consequence.'; }],
  ['outcome delta', root => { root.mission.outcomes[0].changes[0].delta = -30; }],
  ['outcome track', root => { root.mission.outcomes[0].changes[0].trackId = 'attention'; }],
  ['unselected outcome', root => { root.mission.outcomes[1].changes[0].delta = -40; }],
  ['current briefing', root => { root.mission.briefing = 'An unreviewed replacement briefing.'; }],
  ['resolution method', root => { root.mission = combatPlan('opening', 'room'); delete root.nextByOutcome; }],
];
for (const [name, change] of mismatches) test(`pack installation rejects mismatched ${name} without changing campaign or council`, t => {
  const f = setup(t), before = snapshot(f); change(f.pack.missions[0]);
  assert.throws(() => f.game.installContent(f.host, { reviewed: true, pack: f.pack }), error => error.code === 'INVALID' && /reviewed mission plan/i.test(error.message));
  assert.deepEqual(snapshot(f), before);
});

test('mismatched root plan leaves an already prepared council and explicit debrief unchanged', t => {
  const f = setup(t);
  f.game.adjudicateMission(f.host, { reviewed: true, requestId: 'decision', expectedRevision: f.game.view(f.host).revision, expectedWorldRevision: f.game.world(f.host).revision, outcomeId: 'agreed' });
  f.game.debrief(f.player, { requestId: 'debrief', expectedRevision: f.game.world(f.player).revision, notes: 'The players recorded the agreement.' });
  f.game.prepareCouncil(f.host, { reviewed: true, expectedWorldRevision: f.game.world(f.host).revision, branches: f.pack.missions.slice(1).map(node => ({ id: node.mission.id, title: node.mission.title, summary: node.summary, cost: node.cost, trackIds: node.trackIds, priorities: node.priorities, evidence: [`world:${f.host.campaign}:${f.game.world(f.host).revision}`] })) });
  const before = snapshot(f); f.pack.missions[0].mission.outcomes[0].changes[0].delta = 1;
  assert.throws(() => f.game.installContent(f.host, { reviewed: true, pack: f.pack }), { code: 'INVALID' });
  assert.deepEqual(snapshot(f), before);
});

for (const field of ['success', 'failure']) test(`legacy combat pack cannot replace reviewed ${field} consequences`, t => {
  const f = setup(t, { combat: true }), before = snapshot(f);
  f.pack.missions[0].mission[field].changes[0].delta = 30;
  assert.throws(() => f.game.installContent(f.host, { reviewed: true, pack: f.pack }), { code: 'INVALID' });
  assert.deepEqual(snapshot(f), before);
});

test('legacy combat pack cannot change the reviewed successful team', t => {
  const f = setup(t, { combat: true }), before = snapshot(f); f.pack.missions[0].mission.successTeam = 'witnesses';
  assert.throws(() => f.game.installContent(f.host, { reviewed: true, pack: f.pack }), { code: 'INVALID' });
  assert.deepEqual(snapshot(f), before);
});

test('matching adjudicated plan installs and exposes only the saved outcome branches', t => {
  const f = setup(t), root = f.pack.missions[0].mission;
  // Equivalent object insertion order is not an authored change.
  f.pack.missions[0].mission = Object.fromEntries(Object.entries(root).reverse());
  const result = f.game.installContent(f.host, { reviewed: true, pack: f.pack });
  assert.equal(result.packId, 'root-pack');
  assert.deepEqual(f.game.installContent(f.host, { reviewed: true, pack: f.pack }), result);
  f.game.adjudicateMission(f.host, { reviewed: true, requestId: 'decision', expectedRevision: f.game.view(f.host).revision, expectedWorldRevision: f.game.world(f.host).revision, outcomeId: 'agreed' });
  f.game.debrief(f.player, { requestId: 'debrief', expectedRevision: f.game.world(f.player).revision, notes: 'The agreement is recorded.' });
  f.game.prepareContentCouncil(f.host);
  assert.deepEqual(f.game.council(f.player).branches.map(branch => branch.id).sort(), ['north', 'south']);
});

for (const [name, configuredExplicit, packExplicit] of [['both omitted', false, false], ['configured omitted', false, true], ['pack omitted', true, false]]) test(`legacy combat resolution compatibility: ${name}`, t => {
  const f = setup(t, { combat: true });
  if (configuredExplicit) {
    const row = f.game.db.prepare('SELECT plan FROM world_campaigns WHERE campaign=?').get(f.host.campaign);
    f.game.db.prepare('UPDATE world_campaigns SET plan=? WHERE campaign=?').run(JSON.stringify({ ...JSON.parse(row.plan), resolution: 'combat' }), f.host.campaign);
  }
  if (packExplicit) f.pack.missions[0].mission.resolution = 'combat';
  assert.equal(f.game.installContent(f.host, { reviewed: true, pack: f.pack }).packId, 'root-pack');
});

test('matching Greyharbor opening plan remains installable', t => {
  const proposal = createGreyharborProposal(), game = new GameStore(':memory:'); t.after(() => game.close());
  const host = { campaign: 'greyharbor-plan', owner: 'host' }, player = { campaign: 'greyharbor-plan', owner: 'player' };
  const scene = proposal.pack.scenes.find(s => s.map.id === 'last-hearth-map-room');
  game.createCampaign({ campaign: host.campaign, title: 'Greyharbor plan fixture', members: [{ owner: host.owner, role: 'host' }, { owner: player.owner, role: 'player' }], map: scene.map, actors: [{ ...profile, id: 'hero', name: 'Hero', team: 'party', owner: player.owner, ...scene.entrances[0] }], effects: [] });
  game.configureMission(host, { reviewed: true, tracks: proposal.tracks, mission: proposal.pack.missions.find(node => node.mission.id === proposal.openingMissionId).mission });
  const result = game.installContent(host, { reviewed: true, pack: proposal.pack });
  assert.equal(result.packId, proposal.pack.id);
  assert.equal(result.missions, proposal.pack.missions.length);
  assert.equal(game.world(player).mission.resolution, 'adjudicated');
  assert.equal(game.view(player).phase, 'exploration');
});
