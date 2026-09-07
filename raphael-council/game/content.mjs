import { createHash } from 'node:crypto';
import { validateMission } from './world.mjs';
import { COUNCIL } from './council.mjs';
const keys = (v, list) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => list.includes(k));
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const text = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const distinct = (items, get = v => v.id) => new Set(items.map(get)).size === items.length;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export function initializeContent(db) {
  db.exec('CREATE TABLE IF NOT EXISTS game_content(campaign TEXT PRIMARY KEY,hash TEXT NOT NULL,body TEXT NOT NULL);');
}
function host(store, scope, ErrorType) {
  if (store.member(scope) !== 'host') throw new ErrorType('UNAUTHORIZED', 'A host must review campaign content.');
}
function load(store, scope, ErrorType) {
  host(store, scope, ErrorType);
  const row = store.db.prepare('SELECT body FROM game_content WHERE campaign=?').get(scope.campaign);
  if (!row) throw new ErrorType('NOT_FOUND', 'Install a reviewed campaign pack first.');
  return JSON.parse(row.body);
}
function partyPlacement(state, scene) {
  return state.actors.filter(a => a.owner !== null).sort((a, b) => a.id.localeCompare(b.id)).map((a, index) => ({ actorId: a.id, ...scene.entrances[index] }));
}
function hazards(scene, turn) { return scene.effects.map(({ durationTurns, ...e }) => ({ ...e, expiresAtTurn: turn + durationTurns })); }

/** Private authored content only. Blueprint files are never silently treated as executable rules. */
export function installContent(store, scope, input, validateSeed, ErrorType) {
  return store.transaction(() => {
    host(store, scope, ErrorType);
    const fail = message => { throw new ErrorType('INVALID', message); };
    if (!keys(input, ['reviewed', 'pack']) || input.reviewed !== true) fail('Review the campaign pack before installation.');
    const pack = structuredClone(input.pack);
    if (!keys(pack, ['schemaVersion', 'id', 'title', 'world', 'regions', 'locations', 'scenes', 'missions']) || pack.schemaVersion !== 1 || !id(pack.id) || !text(pack.title, 160)) fail('Use a version-one executable campaign pack.');
    if (!keys(pack.world, ['id', 'title']) || !id(pack.world.id) || !text(pack.world.title, 160)) fail('Provide the world identity.');
    for (const name of ['regions', 'locations', 'scenes', 'missions']) if (!Array.isArray(pack[name]) || !pack[name].length || pack[name].length > 64 || !distinct(pack[name], name === 'scenes' ? v => v?.map?.id : name === 'missions' ? v => v?.mission?.id : v => v?.id)) fail('Use bounded, distinct campaign records.');
    if (!pack.regions.every(r => keys(r, ['id', 'title']) && id(r.id) && text(r.title, 160))) fail('Invalid region.');
    if (!pack.locations.every(l => keys(l, ['id', 'title', 'regionId']) && id(l.id) && text(l.title, 160) && pack.regions.some(r => r.id === l.regionId))) fail('Every location needs a known region.');
    const state = store.load(scope.campaign), world = store.world(scope);
    if (!world.configured) fail('Link the initial reviewed mission before installing its continuation pack.');
    const members = store.db.prepare('SELECT owner,role FROM game_members WHERE campaign=?').all(scope.campaign);
    const npcIds = new Set(), checkedScenes = new Map();
    for (const scene of pack.scenes) {
      if (!keys(scene, ['map', 'locationId', 'npcs', 'effects', 'entrances']) || !pack.locations.some(l => l.id === scene.locationId) || !Array.isArray(scene.npcs) || !scene.npcs.every(a => a?.owner === null) || !Array.isArray(scene.effects) || !Array.isArray(scene.entrances) || scene.entrances.length > 32 || scene.entrances.length < state.actors.filter(a => a.owner !== null).length || !scene.entrances.every(p => keys(p, ['x', 'y']) && Number.isInteger(p.x) && Number.isInteger(p.y))) fail('Scenes require a known location and bounded party entrances, NPCs and effects.');
      if (!scene.effects.every(e => keys(e, ['id', 'name', 'trigger', 'damage', 'durationTurns', 'visible', 'cells']) && Number.isInteger(e.durationTurns) && e.durationTurns >= 1 && e.durationTurns <= 9998)) fail('Use supported hazards with durations in turns.');
      for (const a of scene.npcs) { if (npcIds.has(a.id)) fail('NPC IDs must be unique across authored scenes.'); npcIds.add(a.id); }
      const placements = partyPlacement(state, scene);
      const actors = state.actors.filter(a => a.owner !== null).map(a => ({ ...a, ...placements.find(p => p.actorId === a.id) })).concat(scene.npcs);
      const checked = validateSeed({ campaign: state.campaign, title: state.title, members, map: scene.map, actors, effects: hazards(scene, 1) }, true);
      checkedScenes.set(scene.map.id, checked);
    }
    for (const node of pack.missions) {
      if (!keys(node, ['mission', 'summary', 'cost', 'trackIds', 'priorities', 'next', 'nextByOutcome']) || !text(node.summary, 2000) || !text(node.cost, 500) || !Array.isArray(node.next) || (node.next.length !== 0 && (node.next.length < 2 || node.next.length > 5)) || !distinct(node.next, v => v) || !node.next.every(id => pack.missions.some(n => n.mission?.id === id)) || !Array.isArray(node.trackIds) || node.trackIds.length > 8 || !distinct(node.trackIds, v => v) || !node.trackIds.every(id => world.tracks.some(t => t.id === id)) || !keys(node.priorities, COUNCIL.map(r => r.id)) || !COUNCIL.every(r => Number.isInteger(node.priorities[r.id]) && node.priorities[r.id] >= 0 && node.priorities[r.id] <= 3)) fail('Missions need supported council ratings, known tracks and zero or two to five outgoing branches.');
      const scene = checkedScenes.get(node.mission?.mapId);
      if (!scene) fail('Every mission requires an authored scene.');
      validateMission(scene, world.tracks, node.mission);
      if (node.nextByOutcome !== undefined) {
        const outcomes = node.mission.outcomes?.map(outcome => outcome.id) ?? [];
        if (node.mission.resolution !== 'adjudicated' || !keys(node.nextByOutcome, outcomes) || Object.keys(node.nextByOutcome).length !== outcomes.length || !Object.values(node.nextByOutcome).every(next => Array.isArray(next) && (next.length === 0 || next.length >= 2 && next.length <= 5) && distinct(next, value => value) && next.every(value => node.next.includes(value)))) fail('Conditional branches must cover every reviewed outcome with zero or two to five declared successors.');
        const reachable = new Set(Object.values(node.nextByOutcome).flat());
        if (reachable.size !== node.next.length || !node.next.every(value => reachable.has(value))) fail('Conditional branches must account for every declared successor.');
      }
    }
    const root = pack.missions.find(n => n.mission.id === world.mission.id);
    if (!root || root.mission.mapId !== state.map.id || root.mission.title !== world.mission.title) fail('The pack must include the current mission and map.');
    const reviewedPlan = JSON.parse(store.db.prepare('SELECT plan FROM world_campaigns WHERE campaign=?').get(scope.campaign).plan);
    // Legacy mission plans omit resolution; their reviewed combat semantics are identical.
    const planBody = mission => JSON.stringify(canonical({ ...mission, resolution: mission.resolution ?? 'combat' }));
    if (planBody(root.mission) !== planBody(reviewedPlan)) fail('The pack starting mission must match the already reviewed mission plan.');
    const visiting = new Set(), visited = new Set();
    function visit(node) {
      if (visiting.has(node.mission.id)) fail('Mission cycles would reuse completed mission identifiers.');
      if (visited.has(node.mission.id)) return;
      visiting.add(node.mission.id);
      for (const id of node.next) visit(pack.missions.find(n => n.mission.id === id));
      visiting.delete(node.mission.id); visited.add(node.mission.id);
    }
    visit(root);
    if (visited.size !== pack.missions.length) fail('Every mission must be reachable from the installed starting mission.');
    const body = JSON.stringify(canonical(pack)), hash = createHash('sha256').update(body).digest('hex');
    const previous = store.db.prepare('SELECT hash FROM game_content WHERE campaign=?').get(scope.campaign);
    if (previous && previous.hash !== hash) throw new ErrorType('CONFLICT', 'Installed campaign content is immutable; use a reviewed migration to replace it.');
    store.db.prepare('INSERT OR IGNORE INTO game_content VALUES(?,?,?)').run(scope.campaign, hash, body);
    return { packId: pack.id, hash, scenes: pack.scenes.length, missions: pack.missions.length };
  });
}

function outgoing(node, world, ErrorType) {
  if (!node) throw new ErrorType('PHASE', 'The current mission is not in this campaign pack.');
  if (node.nextByOutcome === undefined) return node.next;
  const outcomeId = world.outcome?.outcomeId;
  if (!outcomeId || !Object.hasOwn(node.nextByOutcome, outcomeId)) throw new ErrorType('PHASE', 'Record the reviewed mission outcome before preparing its branches.');
  return node.nextByOutcome[outcomeId];
}
export function prepareContentCouncil(store, scope, ErrorType) {
  const pack = load(store, scope, ErrorType), world = store.world(scope);
  const node = pack.missions.find(n => n.mission.id === world.mission?.id), next = outgoing(node, world, ErrorType);
  if (!next.length) throw new ErrorType('PHASE', 'This authored mission has no further council branches.');
  return store.prepareCouncil(scope, { reviewed: true, expectedWorldRevision: world.revision, branches: next.map(id => {
    const n = pack.missions.find(n => n.mission.id === id);
    return { id, title: n.mission.title, summary: n.summary, cost: n.cost, trackIds: n.trackIds, priorities: n.priorities, evidence: [`world:${scope.campaign}:${world.revision}`] };
  }) });
}

export function prepareContentDeparture(store, scope, requestId, ErrorType) {
  const pack = load(store, scope, ErrorType), world = store.world(scope), state = store.load(scope.campaign);
  const node = pack.missions.find(n => n.mission.id === world.nextMission?.id);
  const current = pack.missions.find(n => n.mission.id === world.mission?.id);
  if (!node || !outgoing(current, world, ErrorType).includes(node.mission.id)) throw new ErrorType('PHASE', 'Choose an available authored branch before preparing departure.');
  const scene = pack.scenes.find(s => s.map.id === node.mission.mapId);
  const visited = store.db.prepare('SELECT 1 FROM game_scenes WHERE campaign=? AND map=?').get(scope.campaign, scene.map.id);
  return store.prepareDeparture(scope, { requestId, reviewed: true, expectedRevision: state.revision, expectedWorldRevision: world.revision, mission: node.mission,
    placements: partyPlacement(state, scene), destination: visited ? { mapId: scene.map.id } : { mapId: scene.map.id, map: scene.map, npcs: scene.npcs, effects: hazards(scene, state.turn + 1) } });
}
