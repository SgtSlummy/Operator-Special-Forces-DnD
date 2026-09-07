import { createHash } from 'node:crypto';
import { WorldError } from './world.mjs';
import { coordinate } from '../maps/grid.mjs';
const LIMIT = 3;
const topics = ['surroundings', 'readiness', 'mission'];
const invalid = (message, code = 'INVALID') => { throw new WorldError(code, message); };
export function initializeCounsel(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS counsel_records(campaign TEXT NOT NULL,mission TEXT NOT NULL,owner TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,owner,request));`);
}
function used(db, campaign, mission) { return db.prepare('SELECT COUNT(*) AS n FROM counsel_records WHERE campaign=? AND mission=?').get(campaign, mission).n; }
export function counselState(db, scope, world) {
  if (!world.configured) return { configured: false, remaining: 0, limit: LIMIT, records: [] };
  return { configured: true, remaining: Math.max(0, LIMIT - used(db, scope.campaign, world.mission.id)), limit: LIMIT,
    records: db.prepare('SELECT body FROM counsel_records WHERE campaign=? AND mission=? AND owner=? ORDER BY rowid DESC').all(scope.campaign, world.mission.id, scope.owner).map(row => JSON.parse(row.body)) };
}
function guidance(topic, view, world, index) {
  const own = view.actors.filter(a => a.controlled), hurt = own.find(a => a.hp !== undefined && a.hp < a.maxHp);
  let observation;
  if (topic === 'surroundings') {
    const effect = view.effects[0];
    observation = effect ? `You can see ${effect.name} at ${effect.cells.slice(0, 6).map(p => coordinate(p.x, p.y)).join(', ')}.` : `Your current view is ${view.map.title}; no lingering effect is visible in it.`;
  } else if (topic === 'readiness') {
    observation = hurt ? `${hurt.name} has ${hurt.hp} of ${hurt.maxHp} HP.` : `You can currently account for ${own.length} controlled character${own.length === 1 ? '' : 's'} in this view.`;
  } else observation = `The recorded mission is ${world.mission.title}, currently ${world.mission.status}.`;
  const nudges = [
    'What would you want to understand before committing your next choice?',
    'Which cost is your party willing to accept, and which needs discussion first?',
    'What uncertainty should you carry forward into your next choice or debrief?',
  ];
  return `${observation} ${nudges[index % nudges.length]} What lies beyond your observed facts remains uncertain; the choice belongs to your party.`;
}
/** Within the caller's game transaction. Only authorized projections and public
 * mission facts enter deterministic guidance. It issues no game command. */
export function askCounsel(db, scope, input, view, world) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['requestId', 'expectedRevision', 'expectedWorldRevision', 'topic'].includes(k)) || !/^[A-Za-z0-9_-]{1,96}$/.test(input.requestId ?? '') || !topics.includes(input.topic) || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.expectedWorldRevision)) invalid('Choose a counsel topic from the current campaign.');
  const fingerprint = createHash('sha256').update(JSON.stringify([input.topic, input.expectedRevision, input.expectedWorldRevision])).digest('hex');
  const saved = db.prepare('SELECT fingerprint,body FROM counsel_records WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
  if (saved) { if (saved.fingerprint !== fingerprint) invalid('This request already describes another counsel question.', 'CONFLICT'); return JSON.parse(saved.body); }
  if (!world.configured) invalid('The host must link a mission before requesting counsel.', 'CONFLICT');
  if (view.revision !== input.expectedRevision || world.revision !== input.expectedWorldRevision) invalid('The scene or mission changed. Refresh before requesting counsel.', 'CONFLICT');
  const count = used(db, scope.campaign, world.mission.id);
  if (count >= LIMIT) invalid('This mission’s three counsel requests have been used. Your saved advice remains available.', 'CONFLICT');
  const record = { requestId: input.requestId, missionId: world.mission.id, topic: input.topic,
    text: guidance(input.topic, view, world, count), mode: 'deterministic-counsel',
    evidence: [`game:${view.campaign}:${view.revision}`, `world:${view.campaign}:${world.revision}`],
    gameRevision: view.revision, worldRevision: world.revision, ordinal: count + 1, proposals: [] };
  db.prepare('INSERT INTO counsel_records VALUES(?,?,?,?,?,?)').run(scope.campaign, world.mission.id, scope.owner, input.requestId, fingerprint, JSON.stringify(record));
  return record;
}
