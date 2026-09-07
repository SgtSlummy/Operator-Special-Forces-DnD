import { createHash, randomUUID } from 'node:crypto';
import { activateWorldMission } from './world.mjs';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
export function initializeScenes(db) {
  db.exec('CREATE TABLE IF NOT EXISTS game_departures(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,host TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS game_scenes(campaign TEXT NOT NULL,map TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,map));');
}

/** Trusted host entry point. No player endpoint accepts destination documents. */
export function transitionScene(store, scope, input, validate, ErrorType, options = {}) {
  const fail = (code, message) => { throw new ErrorType(code, message); };
  return store.transaction(() => {
    const role = store.member(scope);
    if (options.offerId) {
      const offer = store.db.prepare('SELECT host,body FROM game_departures WHERE id=? AND campaign=?').get(options.offerId, scope.campaign);
      if (!offer || store.member({ ...scope, owner: offer.host }) !== 'host' || JSON.stringify(canonical({ ...JSON.parse(offer.body), requestId: input.requestId })) !== JSON.stringify(canonical(input))) fail('UNAUTHORIZED', 'Choose a host-prepared departure.');
    } else if (role !== 'host') fail('UNAUTHORIZED', 'Only a host can activate a reviewed scene.');
    if (!keys(input, ['requestId', 'expectedRevision', 'expectedWorldRevision', 'reviewed', 'destination', 'placements', 'mission']) || input.reviewed !== true || !/^[A-Za-z0-9_-]{1,96}$/.test(input.requestId ?? '') || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.expectedWorldRevision)) fail('INVALID', 'Supply a reviewed scene transition with current revisions.');
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ type: 'scene_transition', ...input }))).digest('hex');
    const prior = store.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) fail('CONFLICT', 'This request describes another transition.'); return JSON.parse(prior.body); }
    if (options.offerId && store.db.prepare('SELECT id FROM game_departures WHERE campaign=? ORDER BY rowid DESC LIMIT 1').get(scope.campaign)?.id !== options.offerId) fail('STALE', 'The host replaced this departure.');
    const old = store.load(scope.campaign);
    if (old.revision !== input.expectedRevision) fail('STALE', 'Refresh the map before activating a scene.');
    if (old.phase !== 'complete') fail('PHASE', 'Complete this encounter before leaving.');
    const party = old.actors.filter(a => a.owner !== null);
    if (!party.some(a => a.hp > 0)) fail('PHASE', 'A surviving party is required.');
    if (!Array.isArray(input.placements) || input.placements.length !== party.length || new Set(input.placements.map(p => p?.actorId)).size !== party.length || !input.placements.every(p => keys(p, ['actorId', 'x', 'y']) && party.some(a => a.id === p.actorId))) fail('INVALID', 'Supply exactly one destination coordinate for each party actor.');
    const d = input.destination;
    if (!keys(d, ['mapId', 'map', 'npcs', 'effects']) || typeof d.mapId !== 'string' || d.mapId === old.map.id) fail('INVALID', 'Select a different destination map.');
    const archived = store.db.prepare('SELECT body FROM game_scenes WHERE campaign=? AND map=?').get(scope.campaign, d.mapId);
    let destination;
    if (archived) {
      if (Object.keys(d).length !== 1) fail('INVALID', 'Revisits use the saved scene without replacement terrain or actors.');
      destination = JSON.parse(archived.body);
    } else {
      if (d.map?.id !== d.mapId || !Array.isArray(d.npcs) || !d.npcs.every(a => a?.owner === null && a.hp > 0) || !Array.isArray(d.effects)) fail('INVALID', 'New scenes require a map, NPC profiles and effects.');
      if (store.db.prepare('SELECT count(*) AS count FROM game_scenes WHERE campaign=?').get(scope.campaign).count >= 63) fail('INVALID', 'Campaign scene limit reached.');
      const used = new Set(old.actors.map(a => a.id));
      for (const row of store.db.prepare('SELECT body FROM game_scenes WHERE campaign=?').all(scope.campaign)) for (const a of JSON.parse(row.body).npcs) used.add(a.id);
      if (d.npcs.some(a => used.has(a.id))) fail('INVALID', 'New NPCs require unused actor identifiers.');
      destination = { map: d.map, npcs: d.npcs, effects: d.effects };
      if (d.effects.some(e => e.expiresAtTurn <= old.turn + 1)) fail('INVALID', 'New effects must expire after the destination turn starts.');
    }
    const actors = party.map(a => ({ ...a, ...input.placements.find(p => p.actorId === a.id) })).concat(destination.npcs);
    const members = store.db.prepare('SELECT owner,role FROM game_members WHERE campaign=?').all(scope.campaign);
    const next = validate({ campaign: old.campaign, title: old.title, members, map: destination.map, actors, effects: destination.effects.filter(e => e.expiresAtTurn > old.turn + 1) }, true);
    next.revision = old.revision; next.turn = old.turn + 1;
    next.activeIndex = next.order.findIndex(id => next.actors.find(a => a.id === id).hp > 0);
    next.movementRemaining = next.actors.find(a => a.id === next.order[next.activeIndex]).speed;
    store.db.prepare('INSERT OR REPLACE INTO game_scenes VALUES(?,?,?)').run(old.campaign, old.map.id, JSON.stringify({ map: old.map, npcs: old.actors.filter(a => a.owner === null), effects: old.effects }));
    // The first committed projection already carries the reviewed scene phase.
    if (input.mission?.resolution === 'adjudicated') next.phase = 'exploration';
    store.record(next, 'scene_entered', { fromMapId: old.map.id, mapId: next.map.id });
    const worldRevision = activateWorldMission(store.db, next, input.mission, input.expectedWorldRevision);
    if (next.phase === 'combat') store.startEffects(next);
    store.save(next);
    const receipt = { requestId: input.requestId, revision: next.revision, result: { type: 'scene_transition', mapId: next.map.id, worldRevision } };
    store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
    if (options.dryRun) throw options.dryRun;
    return receipt;
  });
}


export function prepareDeparture(store, scope, input, validate, ErrorType) {
  const marker = new Error('Validated rehearsal; roll back all writes.');
  try { transitionScene(store, scope, input, validate, ErrorType, { dryRun: marker }); }
  catch (error) { if (error !== marker) throw error; }
  return store.transaction(() => {
    if (store.member(scope) !== 'host') throw new ErrorType('UNAUTHORIZED', 'Host membership is required.');
    if (store.load(scope.campaign).revision !== input.expectedRevision || store.world(scope).revision !== input.expectedWorldRevision) throw new ErrorType('STALE', 'Refresh before preparing departure.');
    const existing = store.db.prepare('SELECT id,body FROM game_departures WHERE campaign=? ORDER BY rowid DESC').all(scope.campaign);
    const body = JSON.stringify(canonical(input));
    const same = existing[0]?.body === body ? existing[0] : null;
    if (same) return { id: same.id };
    if (existing.length >= 256) throw new ErrorType('INVALID', 'Campaign departure limit reached.');
    const id = randomUUID();
    store.db.prepare('INSERT INTO game_departures VALUES(?,?,?,?)').run(id, scope.campaign, scope.owner, body);
    return { id };
  });
}

export function departureView(store, scope) {
  store.member(scope);
  const game = store.load(scope.campaign), world = store.world(scope);
  const rows = store.db.prepare('SELECT id,host,body FROM game_departures WHERE campaign=? ORDER BY rowid DESC LIMIT 1').all(scope.campaign);
  for (const row of rows) {
    const input = JSON.parse(row.body);
    const host = store.db.prepare('SELECT role FROM game_members WHERE campaign=? AND owner=?').get(scope.campaign, row.host);
    if (host?.role === 'host' && input.expectedRevision === game.revision && input.expectedWorldRevision === world.revision) return { id: row.id, title: input.mission.title, briefing: input.mission.briefing, expectedRevision: game.revision, expectedWorldRevision: world.revision };
  }
  return null;
}

export function enterDeparture(store, scope, request, validate, ErrorType) {
  store.member(scope);
  if (!keys(request, ['departureId', 'requestId']) || typeof request.departureId !== 'string' || typeof request.requestId !== 'string') throw new ErrorType('INVALID', 'Select a prepared departure.');
  const row = store.db.prepare('SELECT body FROM game_departures WHERE id=? AND campaign=?').get(request.departureId, scope.campaign);
  if (!row) throw new ErrorType('NOT_FOUND', 'Departure is unavailable.');
  return transitionScene(store, scope, { ...JSON.parse(row.body), requestId: request.requestId }, validate, ErrorType, { offerId: request.departureId });
}
