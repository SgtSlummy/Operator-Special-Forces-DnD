import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { GameStore } from './store.mjs';
import { canOccupy, footprint } from '../maps/grid.mjs';
import { createGreyharborProposal } from './packs/greyharbor.mjs';

const orders = [
  ['accord', 'archive', 'vigil'], ['accord', 'vigil', 'archive'],
  ['archive', 'accord', 'vigil'], ['archive', 'vigil', 'accord'],
  ['vigil', 'accord', 'archive'], ['vigil', 'archive', 'accord'],
];

test('Greyharbor keeps the Day 6 unlit lantern and all three freely ordered requests', () => {
  const { pack, openingMissionId, review, tracks } = createGreyharborProposal();
  assert.equal(review.status, 'proposed-host-review-required');
  assert.equal(Object.hasOwn(pack, 'reviewed'), false);
  assert.equal(pack.world.title, 'Avarra');
  assert.equal(pack.regions[0].title, 'The Lantern Reach');
  const opening = pack.missions.find(n => n.mission.id === openingMissionId);
  assert.equal(opening.mission.resolution, 'adjudicated');
  assert.match(opening.mission.briefing, /Day 6/);
  assert.match(opening.mission.briefing, /Lysa/);
  assert.match(opening.mission.briefing, /ferryman/);
  assert.match(opening.mission.briefing, /propose another response/);
  assert.deepEqual(opening.next, ['accord-first', 'archive-first', 'vigil-first']);
  assert.deepEqual(tracks.map(t => t.value), [72, 38, 62, 37, 68, 64, 47, 71, 58, 51, 34]);
  const briefs = Object.fromEntries(['accord', 'archive', 'vigil'].map(k => [k, pack.missions.find(n => n.mission.id === `${k}-first`).mission.briefing]));
  assert.match(briefs.accord, /sunset on Day 8/);
  assert.match(briefs.archive, /Day 9 hearing/);
  assert.match(briefs.vigil, /morning of Day 8/);
});

test('every request order and optional Hollow route remains a finite connected choice graph', () => {
  const { pack, openingMissionId } = createGreyharborProposal();
  const byId = new Map(pack.missions.map(n => [n.mission.id, n]));
  const seen = new Set(), active = new Set();
  function visit(id) {
    assert.equal(active.has(id), false, `mission cycle at ${id}`);
    if (seen.has(id)) return;
    const n = byId.get(id);
    assert.ok(n, `missing destination ${id}`);
    assert.ok(n.next.length === 0 || n.next.length >= 2 && n.next.length <= 5);
    assert.equal(new Set(n.next).size, n.next.length);
    active.add(id);
    n.next.forEach(visit);
    active.delete(id); seen.add(id);
  }
  visit(openingMissionId);
  assert.equal(seen.size, pack.missions.length);
  assert.ok(pack.missions.length <= 64);
  for (const order of orders) {
    let previous = byId.get(openingMissionId);
    const done = [];
    for (const key of order) {
      const suffix = [...done].sort().join('-') || 'first';
      const current = byId.get(`${key}-${suffix}`);
      assert.ok(previous.next.includes(current.mission.id), `${previous.mission.id} to ${current.mission.id}`);
      if (key === 'vigil') {
        const combat = byId.get(`hollow-${suffix}`);
        const civic = byId.get(`vigil-civic-${suffix}`);
        assert.ok(current.next.includes(combat.mission.id));
        assert.ok(current.nextByOutcome['hollow-located'].includes(combat.mission.id));
        for (const [outcomeId, destinations] of Object.entries(current.nextByOutcome)) {
          if (outcomeId !== 'hollow-located') assert.equal(destinations.includes(combat.mission.id), false);
        }
        assert.ok(combat.next.includes(civic.mission.id));
        assert.equal(combat.mission.successTeam, 'party');
        assert.equal(civic.mission.resolution, 'adjudicated');
        previous = civic;
      } else previous = current;
      done.push(key);
    }
    assert.ok(previous.next.includes('return-last-hearth'));
  }
  assert.equal(byId.get('return-last-hearth').mission.mapId, byId.get(openingMissionId).mission.mapId);
});

test('narrative choices do not turn consent, hearings or erased residents into combat targets', () => {
  const { pack } = createGreyharborProposal();
  const npcs = pack.scenes.flatMap(s => s.npcs);
  assert.equal(npcs.length, 1);
  assert.equal(npcs[0].name, 'Hollow at the failed warning');
  for (const n of pack.missions) {
    if (n.mission.resolution === 'adjudicated') {
      assert.equal(Object.hasOwn(n.mission, 'successTeam'), false);
      assert.equal(Object.hasOwn(n.mission, 'success'), false);
      assert.ok(n.mission.outcomes.length);
      assert.equal(new Set(n.mission.outcomes.map(o => o.id)).size, n.mission.outcomes.length);
    } else {
      assert.match(n.mission.id, /^hollow-/);
      assert.match(n.mission.success.summary, /separate questions/);
    }
  }
  const accord = pack.missions.find(n => n.mission.id === 'accord-first').mission;
  assert.deepEqual(accord.outcomes.map(o => o.id), ['revised-agreement', 'shared-repayment', 'clause-challenged', 'community-settlement', 'unresolved']);
  const archive = pack.missions.find(n => n.mission.id === 'archive-first').mission;
  assert.deepEqual(archive.outcomes.map(o => o.id), ['original-recovered', 'copy-corroborated', 'scribe-account', 'adjournment', 'unresolved']);
  assert.match(archive.briefing, /does not decide/);
  assert.match(accord.briefing, /own consent/);
});

test('eight proposed party entrances fit size-four actors in every scene without terrain or NPC overlap', () => {
  const { pack } = createGreyharborProposal();
  for (const scene of pack.scenes) {
    const occupied = scene.npcs.flatMap(a => footprint(a, a.size));
    assert.equal(scene.entrances.length, 8);
    for (const p of scene.entrances) {
      assert.ok(canOccupy(scene.map, p, { size: 4, occupied }), `${scene.map.id} unsafe entrance ${JSON.stringify(p)}`);
      for (const cell of footprint(p, 4)) assert.equal(scene.map.difficult.some(q => q.x === cell.x && q.y === cell.y), false);
      occupied.push(...footprint(p, 4));
    }
  }
});

test('public briefs and council summaries preserve secrets and distinguish proposals from source facts', () => {
  const proposal = createGreyharborProposal();
  const playerText = proposal.pack.missions.map(n => `${n.mission.title}\n${n.mission.briefing}\n${n.summary}\n${n.cost}`).join('\n');
  assert.doesNotMatch(playerText, /\bRook\b|\bEdran\b|Continuance Amendment|Lysa.s brother|missing niece|protected witness|mentor did conceal|genuine breach is developing/i);
  assert.match(proposal.review.mechanics.join(' '), /proposals, not source facts/);
  assert.match(proposal.review.mechanics.join(' '), /No source art is automatically approved/);
  assert.match(proposal.review.remaining.join(' '), /clocks/);
  const other = createGreyharborProposal();
  proposal.pack.missions[0].mission.briefing = 'Changed for fixture';
  proposal.pack.scenes[0].entrances[0].x = 999;
  assert.notEqual(other.pack.missions[0].mission.briefing, 'Changed for fixture');
  assert.equal(other.pack.scenes[0].entrances[0].x, 1);
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'greyharbor-pack-test-'));
  const file = join(directory, 'campaign.sqlite');
  const proposal = createGreyharborProposal();
  const f = { proposal, rolls: 0, serial: 0, host: { campaign: 'greyharbor-test', owner: 'fixture-host' }, player: { campaign: 'greyharbor-test', owner: 'fixture-player' } };
  f.open = () => new GameStore(file, { rollDie: sides => { f.rolls++; return sides === 20 ? 14 : sides; } });
  f.game = f.open();
  f.restart = () => { f.game.close(); f.game = f.open(); };
  t.after(() => {
    f.game.close();
    const resolvedDirectory = resolve(directory);
    assert.equal(dirname(resolvedDirectory), resolve(tmpdir()));
    assert.ok(basename(resolvedDirectory).startsWith('greyharbor-pack-test-'));
    rmSync(resolvedDirectory, { recursive: true, force: true });
  });
  const scene = proposal.pack.scenes.find(s => s.map.id === 'last-hearth-map-room');
  f.game.createCampaign({
    campaign: f.host.campaign, title: 'Greyharbor disposable authored-content test',
    members: [{ owner: f.host.owner, role: 'host' }, { owner: f.player.owner, role: 'player' }], map: scene.map,
    actors: [{ id: 'fixture-hero', name: 'Fixture hero', team: 'party', owner: f.player.owner, ...scene.entrances[0], size: 1, hp: 9, maxHp: 20, ac: 15, speed: 30, vision: 32, initiative: 20, characterVersion: 'fixture-approved-profile', weapon: { name: 'Fixture longbow', abilityScore: 20, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 12, addAbilityToDamage: true, rangeFeet: 600 } }], effects: [],
  });
  f.game.configureMission(f.host, { reviewed: true, tracks: proposal.tracks, mission: proposal.pack.missions.find(n => n.mission.id === proposal.openingMissionId).mission });
  f.installed = f.game.installContent(f.host, { reviewed: true, pack: proposal.pack });
  return f;
}
const requestId = (f, prefix) => `${prefix}-${++f.serial}`;
const currentNode = f => f.proposal.pack.missions.find(n => n.mission.id === f.game.world(f.player).mission.id);
function complete(f, outcomeId) {
  const n = currentNode(f);
  if (n.mission.resolution === 'adjudicated') {
    const actors = structuredClone(f.game.load(f.host.campaign).actors), rolls = f.rolls;
    f.game.adjudicateMission(f.host, { reviewed: true, requestId: requestId(f, 'resolve'), expectedRevision: f.game.view(f.host).revision, expectedWorldRevision: f.game.world(f.host).revision, outcomeId: outcomeId ?? n.mission.outcomes[0].id });
    assert.deepEqual(f.game.load(f.host.campaign).actors, actors);
    assert.equal(f.rolls, rolls);
  } else {
    f.game.command(f.player, { requestId: requestId(f, 'attack'), expectedRevision: f.game.view(f.player).revision, actorId: 'fixture-hero', type: 'attack', targetId: 'ember-warning-hollow' });
    if (f.game.view(f.player).phase !== 'complete') f.game.command(f.player, { requestId: requestId(f, 'end'), expectedRevision: f.game.view(f.player).revision, actorId: 'fixture-hero', type: 'end_turn' });
  }
  assert.equal(f.game.world(f.player).mission.status, 'debrief');
}
function debrief(f) {
  f.game.debrief(f.player, { requestId: requestId(f, 'debrief'), expectedRevision: f.game.world(f.player).revision, notes: 'Disposable fixture: only the stated, selected result is established.' });
}
function depart(f, id, { restart = false } = {}) {
  debrief(f);
  const round = f.game.prepareContentCouncil(f.host);
  f.game.chooseCouncil(f.player, { requestId: requestId(f, 'choice'), round: round.round, branchId: id, expectedWorldRevision: round.worldRevision });
  const before = JSON.stringify({ game: f.game.load(f.host.campaign), world: f.game.world(f.player) });
  f.game.prepareContentDeparture(f.host, requestId(f, 'prepare'));
  const offer = f.game.departure(f.player);
  assert.equal(JSON.stringify({ game: f.game.load(f.host.campaign), world: f.game.world(f.player) }), before, 'preparing a departure must not move the party');
  assert.ok(offer);
  assert.doesNotMatch(JSON.stringify(offer), /"npcs"|"outcomes"|"success"|"nextByOutcome"/);
  const input = { departureId: offer.id, requestId: requestId(f, 'enter') };
  if (restart) f.restart();
  f.game.enterDeparture(f.player, input);
  assert.equal(f.game.world(f.player).mission.id, id);
  assert.equal(f.game.load(f.host.campaign).actors.find(a => a.id === 'fixture-hero').hp, 9);
  const committed = JSON.stringify({ game: f.game.load(f.host.campaign), world: f.game.world(f.player) });
  f.game.enterDeparture(f.player, input);
  assert.equal(JSON.stringify({ game: f.game.load(f.host.campaign), world: f.game.world(f.player) }), committed, 'same departure request must not apply twice');
}
function pathTo(pack, target) {
  const byId = new Map(pack.missions.map(n => [n.mission.id, n]));
  const queue = [['greyharbor-arrival']];
  const visited = new Set();
  while (queue.length) {
    const path = queue.shift(), id = path.at(-1);
    if (id === target) return path;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of byId.get(id).next) queue.push([...path, next]);
  }
  throw new Error(`No authored path to ${target}`);
}
function reach(f, target) {
  const path = pathTo(f.proposal.pack, target);
  for (const destination of path.slice(1)) {
    const n = currentNode(f);
    const outcomeId = n.nextByOutcome ? Object.keys(n.nextByOutcome).find(id => n.nextByOutcome[id].includes(destination)) : undefined;
    complete(f, outcomeId);
    depart(f, destination);
  }
}

test('fixture installation keeps the unlit-lantern scene noncombat and unrevealed outcomes private', t => {
  const f = fixture(t);
  assert.equal(f.installed.packId, 'greyharbor-opening-proposal-v1');
  assert.equal(f.game.view(f.player).phase, 'exploration');
  const before = JSON.stringify(f.game.load(f.host.campaign));
  assert.throws(() => f.game.command(f.player, { requestId: 'not-an-objective', expectedRevision: f.game.view(f.player).revision, actorId: 'fixture-hero', type: 'end_turn' }));
  assert.equal(JSON.stringify(f.game.load(f.host.campaign)), before);
  const projected = JSON.stringify({ game: f.game.view(f.player), world: f.game.world(f.player), council: f.game.council(f.player) });
  assert.doesNotMatch(projected, /ember-warning-hollow|hollow-located|revised-agreement|nextByOutcome|"outcomes"/);
  f.restart();
  assert.equal(f.game.view(f.player).phase, 'exploration');
  complete(f);
  assert.equal(f.game.world(f.player).outcome.outcomeId, 'briefing-shared');
  assert.equal(f.rolls, 0);
});

for (const n of createGreyharborProposal().pack.missions.filter(n => n.mission.resolution === 'adjudicated')) {
  for (const selected of n.mission.outcomes) test(`saved authored result: ${n.mission.id} / ${selected.id}`, t => {
    const f = fixture(t);
    reach(f, n.mission.id);
    complete(f, selected.id);
    const world = f.game.world(f.player);
    assert.equal(world.outcome.outcomeId, selected.id);
    assert.equal(world.outcome.summary, selected.summary);
    const projected = JSON.stringify(world);
    for (const unchosen of n.mission.outcomes.filter(o => o.id !== selected.id)) assert.equal(projected.includes(unchosen.summary), false);
    f.restart();
    assert.equal(f.game.world(f.player).outcome.summary, selected.summary);
  });
}

for (const order of orders) test(`persistent journey and return: ${order.join(' -> ')}`, t => {
  const f = fixture(t);
  let done = [];
  complete(f);
  for (const key of order) {
    const suffix = [...done].sort().join('-') || 'first';
    awaitDeparture: {
      depart(f, `${key}-${suffix}`, { restart: true });
      if (key === 'vigil') {
        complete(f, 'hollow-located');
        depart(f, `hollow-${suffix}`);
        complete(f);
        assert.equal(f.game.load(f.host.campaign).actors.find(a => a.id === 'ember-warning-hollow').hp, 0);
        depart(f, `vigil-civic-${suffix}`, { restart: true });
        complete(f, 'decision-pending');
        break awaitDeparture;
      }
      complete(f, key === 'accord' ? 'community-settlement' : 'copy-corroborated');
    }
    done = [...done, key];
  }
  depart(f, 'return-last-hearth', { restart: true });
  assert.equal(f.game.view(f.player).map.id, 'last-hearth-map-room');
  assert.equal(f.game.view(f.player).phase, 'exploration');
  assert.equal(f.game.load(f.host.campaign).actors.some(a => a.id === 'ember-warning-hollow'), false);
  complete(f);
  debrief(f);
  assert.equal(f.game.world(f.player).tracks.find(t => t.id === 'crossing-readiness').value, 74);
  assert.equal(f.game.load(f.host.campaign).actors.find(a => a.id === 'fixture-hero').hp, 9);
  assert.equal(f.rolls, 2);
});

test('unlocated Hollow stays out of saved council branches and cannot be selected', t => {
  const f = fixture(t);
  reach(f, 'vigil-first');
  complete(f, 'signals-investigated');
  debrief(f);
  const round = f.game.prepareContentCouncil(f.host);
  assert.doesNotMatch(JSON.stringify(f.game.council(f.player)), /hollow-first|Hollow at the warning/);
  const before = f.game.world(f.player);
  assert.equal(before.nextMission ?? null, null);
  assert.throws(() => f.game.chooseCouncil(f.player, { requestId: 'forged-hidden-branch', round: round.round, branchId: 'hollow-first', expectedWorldRevision: round.worldRevision }));
  assert.deepEqual(f.game.world(f.player), before);
});
