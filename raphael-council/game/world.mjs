import { createHash } from 'node:crypto';
export class WorldError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (message, code = 'INVALID') => { throw new WorldError(code, message); };
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
export function initializeWorld(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS world_missions(campaign TEXT NOT NULL,mission TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,mission));
    CREATE TABLE IF NOT EXISTS world_campaigns(campaign TEXT PRIMARY KEY REFERENCES game_campaigns(id),revision INTEGER NOT NULL,body TEXT NOT NULL,plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS world_events(campaign TEXT NOT NULL,revision INTEGER NOT NULL,source TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,revision));
    CREATE TABLE IF NOT EXISTS world_receipts(campaign TEXT NOT NULL,owner TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,owner,request));`);
}
export function validateMission(state, tracks, mission) {
  const adjudicated = mission?.resolution === 'adjudicated';
  const allowed = adjudicated ? ['id', 'title', 'briefing', 'mapId', 'resolution', 'outcomes'] : ['id', 'title', 'briefing', 'mapId', 'resolution', 'successTeam', 'success', 'failure'];
  if (!keys(mission, allowed) || !id(mission.id) || !text(mission.title, 160) || !text(mission.briefing, 3000) || mission.mapId !== state.map.id || (!adjudicated && (mission.resolution !== undefined && mission.resolution !== 'combat' || !state.actors.some(a => a.team === mission.successTeam)))) fail('Link a reviewed mission to this map and its resolution method.');
  const outcomes = adjudicated ? mission.outcomes : [mission.success, mission.failure];
  if (!Array.isArray(outcomes) || !outcomes.length || outcomes.length > 16 || (adjudicated && new Set(outcomes.map(o => o?.id)).size !== outcomes.length)) fail('Use distinct reviewed mission outcomes.');
  for (const outcome of outcomes) {
    if (!keys(outcome, adjudicated ? ['id', 'title', 'summary', 'changes'] : ['summary', 'changes']) || (adjudicated && (!id(outcome.id) || !text(outcome.title, 160))) || !text(outcome.summary, 2000) || !Array.isArray(outcome.changes) || outcome.changes.length > 32 || new Set(outcome.changes.map(c => c?.trackId)).size !== outcome.changes.length || !outcome.changes.every(c => keys(c, ['trackId', 'delta']) && tracks.some(t => t.id === c.trackId) && Number.isInteger(c.delta) && c.delta >= -100 && c.delta <= 100)) fail('Specify reviewed outcome summaries and bounded changes to known tracks.');
  }
}
function commit(db, campaign, state, source, event) {
  db.prepare('UPDATE world_campaigns SET revision=?,body=? WHERE campaign=?').run(state.revision, JSON.stringify(state), campaign);
  db.prepare('INSERT INTO world_events VALUES(?,?,?,?)').run(campaign, state.revision, source, JSON.stringify(event));
}
export function recordCouncilChoice(db, scope, round, branch, expectedRevision) {
  const row = db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(scope.campaign);
  const state = row && JSON.parse(row.body);
  if (!state || state.revision !== expectedRevision || state.mission.status !== 'complete' || state.nextMission) fail('Refresh the completed mission before selecting a branch.', 'CONFLICT');
  state.revision++;
  state.nextMission = { id: branch.id, title: branch.title, summary: branch.summary, cost: branch.cost, councilRound: round, status: 'selected-awaiting-scene' };
  commit(db, scope.campaign, state, `council:${scope.campaign}:${round}`, { type: 'next_branch_selected', branchId: branch.id, chosenBy: scope.owner });
  return state.revision;
}
export function configureWorld(db, state, input) {
  if (!keys(input, ['reviewed', 'tracks', 'mission']) || input.reviewed !== true || !Array.isArray(input.tracks) || input.tracks.length > 32) fail('Supply reviewed mission consequences and bounded tracks.');
  if (db.prepare('SELECT 1 FROM world_campaigns WHERE campaign=?').get(state.campaign)) fail('This campaign already has a mission record.', 'CONFLICT');
  if (!['combat', 'paused'].includes(state.phase)) fail('Attach consequences before the encounter ends.', 'CONFLICT');
  const tracks = input.tracks;
  if (new Set(tracks.map(t => t?.id)).size !== tracks.length || !tracks.every(t => keys(t, ['id', 'label', 'kind', 'value']) && id(t.id) && text(t.label, 120) && ['location', 'faction', 'readiness', 'attention', 'relationship'].includes(t.kind) && Number.isInteger(t.value) && t.value >= 0 && t.value <= 100)) fail('Use unique tracks with values from zero to one hundred.');
  const mission = input.mission;
  validateMission(state, tracks, mission);
  if (mission.resolution === 'adjudicated') state.phase = 'exploration';
  const body = { revision: 1, tracks, mission: { id: mission.id, title: mission.title, briefing: mission.briefing, mapId: mission.mapId, resolution: mission.resolution ?? 'combat', status: 'active' }, outcome: null, debrief: null };
  db.prepare('INSERT INTO world_campaigns VALUES(?,?,?,?)').run(state.campaign, 1, JSON.stringify(body), JSON.stringify(mission));
  db.prepare('INSERT INTO world_events VALUES(?,?,?,?)').run(state.campaign, 1, `game:${state.campaign}:${state.revision}`, JSON.stringify({ type: 'mission_linked', missionId: mission.id }));
  return body;
}
/** Called within encounter completion's game transaction. No player-authored deltas. */
export function completeWorldEncounter(db, game) {
  const row = db.prepare('SELECT body,plan FROM world_campaigns WHERE campaign=?').get(game.campaign);
  if (!row) return;
  const state = JSON.parse(row.body), plan = JSON.parse(row.plan);
  if (plan.resolution === 'adjudicated' || game.phase !== 'complete' || state.mission.status !== 'active' || plan.mapId !== game.map.id) return;
  const teams = [...new Set(game.actors.filter(a => a.hp > 0).map(a => a.team))];
  const success = teams.length === 1 && teams[0] === plan.successTeam, outcome = success ? plan.success : plan.failure;
  const changes = outcome.changes.map(change => {
    const track = state.tracks.find(t => t.id === change.trackId), before = track.value;
    track.value = Math.max(0, Math.min(100, track.value + change.delta));
    return { trackId: track.id, before, after: track.value };
  });
  const source = `game:${game.campaign}:${game.revision}`;
  state.revision++; state.mission.status = 'debrief';
  state.outcome = { result: success ? 'success' : 'failure', summary: outcome.summary, changes, source };
  commit(db, game.campaign, state, source, { type: 'mission_resolved', missionId: plan.id, ...state.outcome });
}
/** Reviewed host outcome selection; all game/world writes share one transaction. */
export function adjudicateMission(store, scope, input) {
  return store.transaction(() => {
    if (store.member(scope) !== 'host') fail('Only the host can adjudicate a mission.', 'UNAUTHORIZED');
    if (!keys(input, ['reviewed', 'requestId', 'expectedRevision', 'expectedWorldRevision', 'outcomeId']) || input.reviewed !== true || !id(input.requestId) || !id(input.outcomeId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.expectedWorldRevision) || input.expectedWorldRevision < 1) fail('Confirm one reviewed outcome with its current game and world revisions.');
    const fingerprint = createHash('sha256').update(JSON.stringify(['adjudicateMission', input.expectedRevision, input.expectedWorldRevision, input.outcomeId])).digest('hex');
    const saved = store.db.prepare('SELECT fingerprint,body FROM world_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (saved) { if (saved.fingerprint !== fingerprint) fail('This request already contains another decision.', 'CONFLICT'); return JSON.parse(saved.body); }
    const game = store.load(scope.campaign);
    const row = store.db.prepare('SELECT body,plan FROM world_campaigns WHERE campaign=?').get(scope.campaign);
    if (!row) fail('The host has not linked a reviewed mission.', 'CONFLICT');
    const state = JSON.parse(row.body), plan = JSON.parse(row.plan);
    if (game.revision !== input.expectedRevision || state.revision !== input.expectedWorldRevision || game.phase !== 'exploration' || state.mission.status !== 'active' || plan.resolution !== 'adjudicated' || plan.mapId !== game.map.id) fail('Review the current active mission before adjudicating it.', 'CONFLICT');
    const outcome = plan.outcomes.find(value => value.id === input.outcomeId);
    if (!outcome) fail('Choose an outcome from the reviewed mission.');
    const changes = outcome.changes.map(change => {
      const track = state.tracks.find(value => value.id === change.trackId), before = track.value;
      track.value = Math.max(0, Math.min(100, before + change.delta));
      return { trackId: track.id, before, after: track.value };
    });
    game.phase = 'complete';
    store.record(game, 'mission_adjudicated', { missionId: plan.id, outcomeId: outcome.id, title: outcome.title, summary: outcome.summary });
    store.save(game);
    const source = `game:${game.campaign}:${game.revision}`;
    state.revision++; state.mission.status = 'debrief';
    state.outcome = { result: 'adjudicated', outcomeId: outcome.id, title: outcome.title, summary: outcome.summary, changes, source };
    commit(store.db, scope.campaign, state, source, { type: 'mission_resolved', missionId: plan.id, ...state.outcome });
    const receipt = { requestId: input.requestId, revision: game.revision, worldRevision: state.revision, missionId: plan.id, outcomeId: outcome.id };
    store.db.prepare('INSERT INTO world_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
    return receipt;
  });
}
export function worldView(db, campaign) {
  const row = db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(campaign);
  if (!row) return { configured: false };
  return { configured: true, ...JSON.parse(row.body), events: db.prepare('SELECT revision,source,body FROM world_events WHERE campaign=? ORDER BY revision DESC LIMIT 20').all(campaign).map(row => ({ revision: row.revision, source: row.source, ...JSON.parse(row.body) })) };
}
export function debriefWorld(db, scope, input) {
  if (!keys(input, ['requestId', 'expectedRevision', 'notes']) || !id(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || typeof input.notes !== 'string' || input.notes.length > 2000) fail('Submit a bounded debrief with its current world revision.');
  const fingerprint = createHash('sha256').update(JSON.stringify([input.expectedRevision, input.notes])).digest('hex');
  const saved = db.prepare('SELECT fingerprint,body FROM world_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
  if (saved) { if (saved.fingerprint !== fingerprint) fail('This request already contains another debrief.', 'CONFLICT'); return JSON.parse(saved.body); }
  const row = db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(scope.campaign);
  if (!row) fail('The host has not linked a mission.', 'CONFLICT');
  const state = JSON.parse(row.body);
  if (state.revision !== input.expectedRevision || state.mission.status !== 'debrief') fail('Refresh the mission before recording its debrief.', 'CONFLICT');
  state.revision++; state.mission.status = 'complete'; state.debrief = { notes: input.notes, recordedBy: scope.owner };
  commit(db, scope.campaign, state, state.outcome.source, { type: 'debrief_recorded', missionId: state.mission.id, ...state.debrief });
  const result = { requestId: input.requestId, revision: state.revision, missionId: state.mission.id };
  db.prepare('INSERT INTO world_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(result));
  return result;
}

/** Caller owns the game transaction; mission and scene must commit together. */
export function activateWorldMission(db, game, mission, expectedRevision) {
  const row = db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(game.campaign);
  const state = row && JSON.parse(row.body);
  if (!state || state.revision !== expectedRevision || state.mission.status !== 'complete' || !state.nextMission || state.nextMission.id !== mission?.id || state.nextMission.title !== mission?.title) fail('Activate the selected branch from the current completed mission.', 'CONFLICT');
  if (mission.id === state.mission.id || db.prepare('SELECT 1 FROM world_missions WHERE campaign=? AND mission=?').get(game.campaign, mission.id)) fail('Mission identifiers cannot be reused.', 'CONFLICT');
  validateMission(game, state.tracks, mission);
  db.prepare('INSERT INTO world_missions VALUES(?,?,?)').run(game.campaign, state.mission.id, JSON.stringify(state));
  const selection = state.nextMission;
  state.revision++;
  if (mission.resolution === 'adjudicated') game.phase = 'exploration';
  state.mission = { id: mission.id, title: mission.title, briefing: mission.briefing, mapId: mission.mapId, resolution: mission.resolution ?? 'combat', status: 'active' };
  state.outcome = null; state.debrief = null; delete state.nextMission;
  db.prepare('UPDATE world_campaigns SET plan=? WHERE campaign=?').run(JSON.stringify(mission), game.campaign);
  commit(db, game.campaign, state, `game:${game.campaign}:${game.revision}`, { type: 'mission_activated', missionId: mission.id, mapId: game.map.id, councilRound: selection.councilRound });
  return state.revision;
}
