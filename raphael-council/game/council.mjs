import { createHash } from 'node:crypto';
import { WorldError, recordCouncilChoice } from './world.mjs';
export const COUNCIL = [
  { id: 'aster', name: 'Aster', mandate: 'World Steward', kind: 'location' },
  { id: 'mnemos', name: 'Mnemos', mandate: 'Memory Keeper', kind: null },
  { id: 'seren', name: 'Seren', mandate: 'Consequence Keeper', kind: 'readiness' },
  { id: 'kael', name: 'Kael', mandate: 'Mission Architect', kind: 'faction' },
  { id: 'mira', name: 'Mira', mandate: 'Party Advocate', kind: null },
];
const fail = (message, code = 'CONFLICT') => { throw new WorldError(code, message); };
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const text = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function initializeCouncil(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS council_rounds(campaign TEXT NOT NULL,round INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,round));
    CREATE TABLE IF NOT EXISTS council_receipts(campaign TEXT NOT NULL,owner TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,owner,request));`);
}
/** Explicit offline policy: host-reviewed mandate ratings plus linked public
 * track pressure. These are deterministic personas, not live model agents. */
export function deliberate(packet, branches, round) {
  const members = COUNCIL.map(role => {
    const assessments = branches.map(branch => {
      const tracks = packet.tracks.filter(t => branch.trackIds.includes(t.id));
      const relevant = role.kind ? tracks.filter(t => t.kind === role.kind) : [];
      const pressure = relevant.length ? Math.floor(Math.max(...relevant.map(t => 100 - t.value)) / 20) : 0;
      const score = branch.priorities[role.id] * 10 + pressure;
      return { branchId: branch.id, score, confidence: 0.5, visibleCost: branch.cost, affectedEntities: branch.trackIds,
        evidence: branch.evidence, assessment: `Authored mandate rating ${branch.priorities[role.id]}/3; linked public-track pressure adds ${pressure}. Confidence is limited to the reviewed packet.` };
    });
    const best = Math.max(...assessments.map(a => a.score));
    return { ...role, weight: 1, assessments, supportedBranches: assessments.filter(a => a.score === best).map(a => a.branchId) };
  });
  const totals = branches.map(branch => ({ branchId: branch.id, score: members.reduce((total, member) => total + member.assessments.find(a => a.branchId === branch.id).score, 0) }));
  const best = Math.max(...totals.map(t => t.score)), tied = totals.filter(t => t.score === best).map(t => t.branchId);
  return { members, totals, leadingId: tied[(round - 1) % tied.length], tiedIds: tied, tieBreak: tied.length > 1 ? 'rotate-tied-branches-by-round' : 'none' };
}
export function prepareCouncil(db, campaign, world, input) {
  if (!keys(input, ['reviewed', 'expectedWorldRevision', 'branches']) || input.reviewed !== true || !Array.isArray(input.branches) || input.branches.length < 2 || input.branches.length > 5) fail('Review two to five council branches.', 'INVALID');
  if (!world.configured || world.mission.status !== 'complete' || world.revision !== input.expectedWorldRevision || world.nextMission) fail('Finish the debrief and use its current world revision before preparing the next mission council.');
  const previous = db.prepare('SELECT body FROM council_rounds WHERE campaign=? ORDER BY round DESC LIMIT 1').get(campaign);
  if (previous && !JSON.parse(previous.body).selection) fail('A council round is already awaiting the party’s choice.');
  const evidenceIds = new Set(world.events.slice(0, 10).map(e => `world:${campaign}:${e.revision}`));
  const branches = input.branches;
  if (new Set(branches.map(b => b?.id)).size !== branches.length) fail('Use distinct branch IDs.', 'INVALID');
  for (const b of branches) {
    if (!keys(b, ['id', 'title', 'summary', 'cost', 'trackIds', 'evidence', 'priorities']) || !id(b.id) || !text(b.title, 160) || !text(b.summary, 2000) || !text(b.cost, 500) || !Array.isArray(b.trackIds) || b.trackIds.length > 8 || new Set(b.trackIds).size !== b.trackIds.length || !b.trackIds.every(id => world.tracks.some(t => t.id === id)) || !Array.isArray(b.evidence) || !b.evidence.length || b.evidence.length > 5 || !b.evidence.every(e => evidenceIds.has(e)) || !keys(b.priorities, COUNCIL.map(r => r.id)) || !COUNCIL.every(r => Number.isInteger(b.priorities[r.id]) && b.priorities[r.id] >= 0 && b.priorities[r.id] <= 3)) fail('Branches need public evidence, known tracks and reviewed ratings for all five mandates.', 'INVALID');
  }
  const round = Number(db.prepare('SELECT MAX(round) AS n FROM council_rounds WHERE campaign=?').get(campaign).n ?? 0) + 1;
  const packet = { worldRevision: world.revision, mission: world.mission, outcome: world.outcome, debrief: world.debrief, tracks: world.tracks, events: world.events.slice(0, 10) };
  const body = { round, worldRevision: world.revision, mode: 'deterministic-reviewed-council-v1', packet, packetHash: hash(packet), branches, ...deliberate(packet, branches, round), selection: null };
  db.prepare('INSERT INTO council_rounds VALUES(?,?,?)').run(campaign, round, JSON.stringify(body));
  return body;
}
export function councilView(db, campaign) {
  const row = db.prepare('SELECT body FROM council_rounds WHERE campaign=? ORDER BY round DESC LIMIT 1').get(campaign);
  return row ? JSON.parse(row.body) : null;
}
export function chooseCouncil(db, scope, input) {
  if (!keys(input, ['requestId', 'round', 'branchId', 'expectedWorldRevision']) || !id(input.requestId) || !id(input.branchId) || !Number.isSafeInteger(input.round) || !Number.isSafeInteger(input.expectedWorldRevision)) fail('Choose a branch from the current council round.', 'INVALID');
  const fingerprint = hash([input.round, input.branchId, input.expectedWorldRevision]);
  const prior = db.prepare('SELECT fingerprint,body FROM council_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
  if (prior) { if (prior.fingerprint !== fingerprint) fail('This request already selects another branch.'); return JSON.parse(prior.body); }
  const round = councilView(db, scope.campaign), branch = round?.branches.find(b => b.id === input.branchId);
  if (!round || round.selection || round.round !== input.round || round.worldRevision !== input.expectedWorldRevision || !branch) fail('Refresh the council before choosing its next branch.');
  const worldRevision = recordCouncilChoice(db, scope, round.round, branch, input.expectedWorldRevision);
  round.selection = { branchId: branch.id, chosenBy: scope.owner, worldRevision };
  db.prepare('UPDATE council_rounds SET body=? WHERE campaign=? AND round=?').run(JSON.stringify(round), scope.campaign, round.round);
  const receipt = { requestId: input.requestId, round: round.round, ...round.selection };
  db.prepare('INSERT INTO council_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
  return receipt;
}
