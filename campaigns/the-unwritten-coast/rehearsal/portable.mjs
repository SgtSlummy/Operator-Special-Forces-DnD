import { createHash } from 'node:crypto';
import { parseAtlas } from './model.mjs';

export const PORTABLE_VERSION = 1;
const PACK_ID = 'unwritten-coast-undertow';
const ROOM_IDS = Array.from({ length: 18 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
const bad = message => { throw new Error(message); };
const routeId = (a, b) => [a, b].sort().join('--');

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad(`${label} must be a JSON object.`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!keys.includes(key) || descriptor.get || descriptor.set) bad(`${label} contains an unsupported field.`);
  }
}
function text(value, label, maximum = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) bad(`${label} must be bounded nonempty text.`);
  return value;
}
function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) bad(`${label} must be a bounded list.`);
  return value;
}
function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0 || value > 10000000) bad(`${label} must be a positive finite dimension.`);
  return value;
}
function permission(value, label) {
  if (value !== undefined && typeof value !== 'boolean') bad(`${label} must be true or false.`);
  return value === true;
}

/** A portable GM document, deliberately unsuitable for direct delivery to players. */
export function createPortablePack(atlas) {
  if (typeof atlas !== 'string' || Buffer.byteLength(atlas) > 512000) bad('Atlas must be text under 512 KB.');
  const revision = createHash('sha256').update(atlas).digest('hex');
  const parsed = parseAtlas(atlas, revision);
  const pack = {
    schemaVersion: PORTABLE_VERSION, kind: 'undertow-gm-pack', audience: 'gm',
    packId: PACK_ID, sourceRevision: revision, title: parsed.title, units: 'feet', entryRoomId: 'R01',
    rooms: parsed.rooms.map(room => ({
      id: room.id, name: room.name, arrival: room.reveal, purpose: room.purpose,
      scale: { widthFeet: room.width, depthFeet: room.depth,
        verticalFeet: Number(room.vertical.match(/^\d+/)?.[0]),
        verticalKind: room.vertical.endsWith('deep') ? 'depth' : room.vertical.includes('above') ? 'elevation' : 'height',
        footprintLabel: room.footprint, verticalLabel: room.vertical, shape: room.shape,
        interpretation: 'footprint-envelope-not-collision-geometry' },
      gmNotes: room.notes.map(note => ({ label: note.label, text: note.text }))
    })).sort((a, b) => a.id.localeCompare(b.id)),
    routes: parsed.routes.map(route => ({ id: routeId(route.from, route.to),
      from: route.from, to: route.to, bidirectional: true, passage: route.passage, gmDetail: route.detail }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    boundaries: parsed.boundaries.map(boundary => ({ id: `${boundary.from}--${boundary.name}`, from: boundary.from,
      name: boundary.name, passage: boundary.passage, gmDetail: boundary.detail, requiresGmRuling: true }))
  };
  return validatePortablePack(pack);
}

/** Validate imported JSON; a matching revision is compatibility evidence, not a signature. */
export function validatePortablePack(input) {
  record(input, ['schemaVersion','kind','audience','packId','sourceRevision','title','units','entryRoomId','rooms','routes','boundaries'], 'Pack');
  if (input.schemaVersion !== PORTABLE_VERSION || input.kind !== 'undertow-gm-pack' || input.audience !== 'gm' ||
      input.packId !== PACK_ID || input.units !== 'feet' || input.entryRoomId !== 'R01') bad('Unsupported dungeon pack contract.');
  if (typeof input.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceRevision)) bad('Invalid source revision.');
  text(input.title, 'Pack title', 200);
  const rooms = list(input.rooms, 18, 'Rooms');
  if (rooms.length !== 18 || ROOM_IDS.some(id => rooms.filter(room => room?.id === id).length !== 1)) bad('Pack requires each room R01–R18 exactly once.');
  for (const room of rooms) {
    record(room, ['id','name','arrival','purpose','scale','gmNotes'], 'Room');
    text(room.name, 'Room name', 200); text(room.arrival, 'Arrival'); text(room.purpose, 'Room purpose', 1000);
    record(room.scale, ['widthFeet','depthFeet','verticalFeet','verticalKind','footprintLabel','verticalLabel','shape','interpretation'], 'Room scale');
    for (const key of ['widthFeet','depthFeet','verticalFeet']) positive(room.scale[key], key);
    for (const key of ['footprintLabel','verticalLabel','shape']) text(room.scale[key], key, 500);
    if (!['height','depth','elevation'].includes(room.scale.verticalKind) ||
        room.scale.interpretation !== 'footprint-envelope-not-collision-geometry') bad('Unsupported scale interpretation.');
    for (const note of list(room.gmNotes, 32, 'GM notes')) {
      record(note, ['label','text'], 'GM note'); text(note.label, 'Note label', 200); text(note.text, 'GM note');
    }
  }
  const locations = new Set(['surface', ...ROOM_IDS]), seen = new Set();
  const routes = list(input.routes, 128, 'Routes');
  for (const route of routes) {
    record(route, ['id','from','to','bidirectional','passage','gmDetail'], 'Route');
    if (!locations.has(route.from) || !locations.has(route.to) || route.from === route.to ||
        route.bidirectional !== true || route.id !== routeId(route.from, route.to) || seen.has(route.id)) bad('Invalid or duplicate ordinary route.');
    seen.add(route.id); text(route.passage, 'Passage', 1000); text(route.gmDetail, 'Route detail', 2000);
  }
  const reached = new Set(['surface']);
  for (let changed = true; changed;) {
    changed = false;
    for (const route of routes) for (const [from,to] of [[route.from,route.to],[route.to,route.from]])
      if (reached.has(from) && !reached.has(to)) { reached.add(to); changed = true; }
  }
  if (reached.size !== locations.size) bad('Pack contains an unreachable room.');
  for (const boundary of list(input.boundaries, 16, 'Boundaries')) {
    record(boundary, ['id','from','name','passage','gmDetail','requiresGmRuling'], 'Boundary');
    if (!ROOM_IDS.includes(boundary.from) || boundary.requiresGmRuling !== true ||
        boundary.id !== `${boundary.from}--${boundary.name}` || seen.has(boundary.id)) bad('Invalid or duplicate special boundary.');
    seen.add(boundary.id); text(boundary.name, 'Boundary name', 200);
    text(boundary.passage, 'Boundary passage', 1000); text(boundary.gmDetail, 'Boundary detail', 2000);
  }
  return structuredClone(input);
}

/**
 * Call on the trusted GM/server side with per-recipient disclosure state.
 * Never trust player-supplied grants and never send the full pack alongside the view.
 * Rehearsal saves and inspected/visited flags are deliberately not accepted here.
 */
export function projectPlayer(input, disclosure) {
  const pack = validatePortablePack(input);
  record(disclosure, ['schemaVersion','packId','sourceRevision','currentRoomId','rooms','routes'], 'Disclosure');
  if (disclosure.schemaVersion !== PORTABLE_VERSION || disclosure.packId !== pack.packId || disclosure.sourceRevision !== pack.sourceRevision)
    bad('Disclosure and dungeon pack versions do not match.');
  const grantedRooms = list(disclosure.rooms, 19, 'Room disclosures');
  const grantedRoutes = list(disclosure.routes, 128, 'Route disclosures');
  const known = new Map(pack.rooms.map(room => [room.id, room]));
  known.set('surface', { id: 'surface', name: 'Surface' });
  const visible = new Set(), rooms = [];
  for (const grant of grantedRooms) {
    record(grant, ['roomId','name','arrival','scale'], 'Room disclosure');
    if (!known.has(grant.roomId) || visible.has(grant.roomId)) bad('Unknown or duplicate room disclosure.');
    const includeName = permission(grant.name, 'Name disclosure');
    const includeArrival = permission(grant.arrival, 'Arrival disclosure');
    const includeScale = permission(grant.scale, 'Scale disclosure');
    const source = known.get(grant.roomId), room = { id: source.id };
    if (includeName) room.name = source.name;
    if (includeArrival && source.arrival) room.arrival = source.arrival;
    if (includeScale) {
      if (!source.scale) bad('The surface has no authored room dimensions.');
      room.scale = { widthFeet: source.scale.widthFeet, depthFeet: source.scale.depthFeet,
        verticalFeet: source.scale.verticalFeet, verticalKind: source.scale.verticalKind,
        footprintLabel: source.scale.footprintLabel, verticalLabel: source.scale.verticalLabel,
        shape: source.scale.shape, interpretation: source.scale.interpretation };
    }
    visible.add(grant.roomId); rooms.push(room);
  }
  if (disclosure.currentRoomId !== null && !visible.has(disclosure.currentRoomId)) bad('The current room must be explicitly disclosed.');
  const routesById = new Map(pack.routes.map(route => [route.id, route])), seen = new Set(), routes = [];
  for (const grant of grantedRoutes) {
    record(grant, ['routeId','passage'], 'Route disclosure');
    const source = routesById.get(grant.routeId);
    if (!source || seen.has(grant.routeId) || !visible.has(source.from) || !visible.has(source.to))
      bad('A disclosed route needs two explicitly disclosed endpoints.');
    const route = { id: source.id, from: source.from, to: source.to, bidirectional: true };
    if (permission(grant.passage, 'Passage disclosure')) route.passage = source.passage;
    seen.add(grant.routeId); routes.push(route);
  }
  return { schemaVersion: PORTABLE_VERSION, kind: 'undertow-player-view', audience: 'player',
    packId: pack.packId, sourceRevision: pack.sourceRevision, currentRoomId: disclosure.currentRoomId,
    rooms: rooms.sort((a,b) => a.id.localeCompare(b.id)), routes: routes.sort((a,b) => a.id.localeCompare(b.id)) };
}
