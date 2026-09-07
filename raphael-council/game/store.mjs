import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { narrateChange } from './narration.mjs';
import { validateCombatCapabilities } from './combat-profile.mjs';
import { beginOpportunity, reactionProjection, reactionState, resolveReaction, resumeReaction } from './reactions.mjs';
import { concentrationProjection, concentrationState, concentrationCommand, concentrationDamage, validateConcentrationRecord } from './concentration.mjs';
import { initializeWorld, configureWorld, completeWorldEncounter, worldView, debriefWorld, adjudicateMission } from './world.mjs';
import { initializeWorldTime, configureWorldTime, worldTimeState, previewWorldTime, advanceWorldTime, recordWorldTimeDecision } from './world-time.mjs';
import { initializeCounsel, counselState, askCounsel } from './counsel.mjs';
import { initializeCouncil, prepareCouncil, councilView, chooseCouncil } from './council.mjs';
import { initializeScenes, transitionScene, prepareDeparture, departureView, enterDeparture } from './scenes.mjs';
import { initializeContent, installContent, prepareContentCouncil, prepareContentDeparture } from './content.mjs';
import { initializeChecks, requestCheck, pendingChecks, resolveCheck, rollHistory } from './checks.mjs';
import { distance, footprint, canOccupy, stepCost, visibleCells, lineOfSight, cellKey, inBounds } from '../maps/grid.mjs';

export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const key = p => cellKey(p.x, p.y);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = input => createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
const point = p => ({ x: p.x, y: p.y });

function validateSeed(input, allowDefeated = false) {
  if (!id(input?.campaign) || !label(input.title) || !Array.isArray(input.members) || !input.members.length || input.members.length > 32) fail('INVALID', 'Campaign identity and members are required.');
  if (new Set(input.members.map(m => m.owner)).size !== input.members.length || !input.members.every(m => id(m.owner) && ['host', 'player'].includes(m.role)) || !input.members.some(m => m.role === 'host')) fail('INVALID', 'Use unique members and one or more hosts.');
  const map = input.map;
  if (!map || !id(map.id) || !label(map.title) || !int(map.width, 2, 64) || !int(map.height, 2, 64)) fail('INVALID', 'Provide a bounded map.');
  for (const name of ['blocked', 'difficult']) if (!Array.isArray(map[name]) || map[name].length > map.width * map.height || !map[name].every(p => inBounds(map, p))) fail('INVALID', 'Invalid terrain cells.');
  if (!Array.isArray(input.actors) || !input.actors.length || input.actors.length > 64 || new Set(input.actors.map(a => a.id)).size !== input.actors.length) fail('INVALID', 'Provide distinct actors.');
  const members = new Set(input.members.map(m => m.owner)), occupied = [], capabilities = new Map();
  for (const a of input.actors) {
    if (!id(a.id) || !id(a.team) || !label(a.name) || (a.owner !== null && !members.has(a.owner)) || !int(a.size, 1, 4) || !int(a.hp, allowDefeated ? 0 : 1, 10000) || !int(a.maxHp, Math.max(1, a.hp), 10000) || !int(a.ac, 1, 50) || !int(a.speed, 0, 120) || a.speed % 5 || !int(a.vision, 0, 32) || !int(a.initiative, -20, 100) || !id(a.characterVersion)) fail('INVALID', 'Actor needs a validated combat profile.');
    if (!canOccupy(map, a, { size: a.size, occupied })) fail('INVALID', 'Actors cannot start outside the map, in walls or overlapping.');
    occupied.push(...footprint(a, a.size));
    const w = a.weapon;
    if (!w || !label(w.name) || !int(w.abilityScore, 1, 30) || !int(w.proficiencyBonus, 0, 10) || typeof w.proficient !== 'boolean' || !int(w.equipmentBonus, -5, 10) || !int(w.damageDice, 1, 10) || ![4, 6, 8, 10, 12].includes(w.damageDie) || typeof w.addAbilityToDamage !== 'boolean' || !int(w.rangeFeet, 5, 600)) fail('INVALID', 'Weapon mechanics must be supplied by a validated profile.');
    let combatCapabilities;
    try { combatCapabilities = validateCombatCapabilities(a.combatCapabilities); } catch (error) { if (error.code === 'COMBAT_PROFILE') fail('INVALID', error.message); throw error; }
    if (combatCapabilities?.attackKind === 'melee' && combatCapabilities.meleeReachFeet !== w.rangeFeet) fail('INVALID', 'Melee reach must match the reviewed weapon range.');
    if (a.reactionAvailable !== undefined && (!combatCapabilities || typeof a.reactionAvailable !== 'boolean')) fail('INVALID', 'Reaction state requires an explicitly configured combat profile.');
    let combatReview;
    if (combatCapabilities?.constitutionSave && a.owner !== null && a.combatReview === undefined) fail('INVALID', 'Player Constitution save proficiency needs its recorded host review.');
    if (a.combatReview !== undefined) {
      if (!combatCapabilities?.constitutionSave || !a.combatReview || typeof a.combatReview !== 'object' || Array.isArray(a.combatReview) || Object.keys(a.combatReview).length !== 1 || typeof a.combatReview.constitutionProficiencyReason !== 'string' || !a.combatReview.constitutionProficiencyReason.trim() || a.combatReview.constitutionProficiencyReason.length > 300) fail('INVALID', 'Record the reviewed Constitution proficiency source.');
      combatReview = { constitutionProficiencyReason: a.combatReview.constitutionProficiencyReason.trim() };
    }
    if (combatCapabilities) capabilities.set(a.id, { combatCapabilities, reactionAvailable: a.reactionAvailable ?? true, ...(combatReview ? { combatReview } : {}) });
  }
  if (!Array.isArray(input.effects) || input.effects.length > 128 || new Set(input.effects.map(e => e.id)).size !== input.effects.length) fail('INVALID', 'Effects must be distinct.');
  for (const e of input.effects) {
    if (!id(e.id) || !label(e.name) || !['enter', 'start_turn', 'end_turn'].includes(e.trigger) || !int(e.damage, 0, 1000) || !int(e.expiresAtTurn, 2, 10000) || typeof e.visible !== 'boolean' || !Array.isArray(e.cells) || !e.cells.length || e.cells.length > map.width * map.height || !e.cells.every(p => inBounds(map, p))) fail('INVALID', 'Invalid timed hazard.');
  }
  const concentrationSources = new Set(), concentrationEffects = new Set();
  for (const actor of input.actors) {
    if (actor.concentration !== undefined) {
      let concentration;
      try { concentration = validateConcentrationRecord(actor.concentration, { ...actor, ...capabilities.get(actor.id) }, input.effects); }
      catch (error) { fail('INVALID', error.message); }
      if (concentrationSources.has(concentration.id) || concentration.effects.some(effect => concentrationEffects.has(effect.id))) fail('INVALID', 'Concentration sources and their bound effects must belong to one actor.');
      concentrationSources.add(concentration.id);
      for (const effect of concentration.effects) concentrationEffects.add(effect.id);
      capabilities.set(actor.id, { ...capabilities.get(actor.id), concentration });
    }
  }
  // Explicit whitelists prevent unknown source/hidden properties entering views.
  return {
    campaign: input.campaign, title: input.title, rulesVersion: 'raph-explicit-combat-v1', revision: 0, phase: 'combat', round: 1, turn: 1,
    map: { id: map.id, title: map.title, width: map.width, height: map.height, blocked: map.blocked.map(point), difficult: map.difficult.map(point) },
    actors: input.actors.map(a => ({ id: a.id, team: a.team, name: a.name, owner: a.owner, x: a.x, y: a.y, size: a.size, hp: a.hp, maxHp: a.maxHp, ac: a.ac, speed: a.speed, vision: a.vision, initiative: a.initiative, characterVersion: a.characterVersion, ...capabilities.get(a.id), weapon: { name: a.weapon.name, abilityScore: a.weapon.abilityScore, proficiencyBonus: a.weapon.proficiencyBonus, proficient: a.weapon.proficient, equipmentBonus: a.weapon.equipmentBonus, damageDice: a.weapon.damageDice, damageDie: a.weapon.damageDie, addAbilityToDamage: a.weapon.addAbilityToDamage, rangeFeet: a.weapon.rangeFeet } })),
    effects: input.effects.map(e => ({ id: e.id, name: e.name, trigger: e.trigger, damage: e.damage, expiresAtTurn: e.expiresAtTurn, visible: e.visible, cells: e.cells.map(point), triggered: [] })),
    order: [...input.actors].sort((a, b) => b.initiative - a.initiative || a.id.localeCompare(b.id)).map(a => a.id),
    activeIndex: 0, movementRemaining: 0, actionAvailable: true,
  };
}

export function projectState(state, owner, role) {
  const full = role === 'host';
  const viewers = state.actors.filter(a => a.owner === owner && a.hp > 0).flatMap(a => footprint(a, a.size).map(p => ({ ...p, vision: a.vision })));
  const cells = full ? Array.from({ length: state.map.width * state.map.height }, (_, i) => ({ x: i % state.map.width, y: Math.floor(i / state.map.width) })) : visibleCells(state.map, viewers);
  const seen = new Set(cells.map(key));
  const visibleActor = a => full || a.owner === owner || footprint(a, a.size).some(p => seen.has(key(p)));
  const actors = state.actors.filter(visibleActor).map(a => ({ id: a.id, name: a.name, x: a.x, y: a.y, size: a.size, controlled: a.owner === owner || (full && a.owner === null), defeated: a.hp === 0,
    ...((full || a.owner === owner) ? { hp: a.hp, maxHp: a.maxHp, ac: a.ac, speed: a.speed, characterVersion: a.characterVersion, weapon: a.weapon, ...(a.combatCapabilities ? { combatCapabilities: structuredClone(a.combatCapabilities), reactionAvailable: a.reactionAvailable === true, ...(a.combatReview ? { combatReview: structuredClone(a.combatReview) } : {}) } : {}) } : {}) }));
  const combat = state.phase === 'combat' || (state.phase === 'paused' && state.resumePhase !== 'exploration');
  const active = combat ? state.actors.find(a => a.id === state.order[state.activeIndex]) : null;
  return { campaign: state.campaign, title: state.title, rulesVersion: state.rulesVersion, revision: state.revision, phase: state.phase, round: state.round, turn: state.turn,
    canResume: full,
    ...(state.pendingReaction ? { pendingReaction: reactionProjection(state, owner, role, actors) } : {}),
    ...(state.pendingConcentration ? { pendingConcentration: concentrationProjection(state, owner, role, actors) } : {}),
    ...(state.phase === 'paused' ? { resumePhase: state.resumePhase === 'exploration' ? 'exploration' : 'combat' } : {}),
    activeActorId: active && visibleActor(active) ? active.id : null,
    movementRemaining: active && (active.owner === owner || full) ? state.movementRemaining : null,
    actionAvailable: active && (active.owner === owner || full) ? state.actionAvailable : null,
    map: { id: state.map.id, title: state.map.title, width: state.map.width, height: state.map.height, cells, blocked: state.map.blocked.filter(p => seen.has(key(p))), difficult: state.map.difficult.filter(p => seen.has(key(p))) },
    actors,
    effects: state.effects.filter(e => full || e.visible).map(e => ({ id: e.id, name: e.name, trigger: e.trigger, expiresAtTurn: e.expiresAtTurn, cells: e.cells.filter(p => seen.has(key(p))) })).filter(e => e.cells.length),
  };
}

export class GameStore {
  constructor(path, { rollDie = sides => randomInt(1, sides + 1) } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path); this.rollDie = rollDie;
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS game_schema(version INTEGER PRIMARY KEY);');
    const versions = this.db.prepare('SELECT version FROM game_schema').all();
    if (versions.length && (versions.length !== 1 || versions[0].version !== 1)) { this.db.close(); fail('SCHEMA', 'Unsupported game schema; migrate a backup before opening.'); }
    this.db.exec(`BEGIN IMMEDIATE;
      INSERT OR IGNORE INTO game_schema VALUES(1);
      CREATE TABLE IF NOT EXISTS game_campaigns(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_members(campaign TEXT NOT NULL REFERENCES game_campaigns(id), owner TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(campaign,owner));
      CREATE TABLE IF NOT EXISTS game_events(id INTEGER PRIMARY KEY, campaign TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(campaign,revision));
      CREATE TABLE IF NOT EXISTS game_receipts(campaign TEXT NOT NULL, owner TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(campaign,owner,request));
      CREATE TABLE IF NOT EXISTS game_controls(id TEXT PRIMARY KEY, campaign TEXT NOT NULL, owner TEXT NOT NULL, guild TEXT NOT NULL, channel TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS game_outbox(id INTEGER PRIMARY KEY, campaign TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', UNIQUE(campaign,revision,kind));
      COMMIT;`);
    initializeWorld(this.db);
    initializeWorldTime(this.db);
    initializeCounsel(this.db);
    initializeCouncil(this.db);
    initializeScenes(this.db);
    initializeContent(this.db);
    initializeChecks(this.db);
  }
  close() { if (!this.closed) this.db.close(); this.closed = true; }
  transaction(work) {
    const depth = this.transactionDepth ?? 0, savepoint = `game_nested_${depth}`;
    this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE'); this.transactionDepth = depth + 1;
    try { const result = work(); this.db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT'); return result; }
    catch (error) { this.db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : 'ROLLBACK'); throw error; }
    finally { this.transactionDepth = depth; }
  }
  guardPending(scope, work, replay) {
    return this.transaction(() => {
      this.member(scope);
      const pendingState = this.load(scope.campaign);
      if (pendingState.pendingReaction || pendingState.pendingConcentration) {
        let prior;
        if (id(replay?.requestId)) {
          // Only these services return saved requests before any write. Existence
          // permits their full fingerprint/authority checks; it is never a response.
          if (['resolveCheck', 'transitionScene', 'enterDeparture'].includes(replay.service)) prior = this.db.prepare('SELECT 1 FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, replay.requestId);
          else if (replay.service === 'askCounsel') prior = this.db.prepare('SELECT 1 FROM counsel_records WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, replay.requestId);
        }
        if (!prior) fail('PENDING', pendingState.pendingConcentration ? 'Resolve the pending concentration save first.' : 'Resolve pending reactions first. In Discord, open Checks & rolls → Opportunity reactions.');
      }
      return work();
    });
  }
  // Trusted host bootstrap only; never accept seed documents directly from a player endpoint.
  createCampaign(input) {
    const state = validateSeed(structuredClone(input));
    const firstActor = state.actors.find(a => a.id === state.order[0]);
    state.movementRemaining = firstActor.speed;
    if (firstActor.combatCapabilities) firstActor.reactionAvailable = true;
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM game_campaigns WHERE id=?').get(state.campaign)) fail('EXISTS', 'Campaign already exists.');
      this.db.prepare('INSERT INTO game_campaigns VALUES(?,?,?)').run(state.campaign, 0, JSON.stringify(state));
      for (const m of input.members) this.db.prepare('INSERT INTO game_members VALUES(?,?,?)').run(state.campaign, m.owner, m.role);
      this.record(state, 'campaign_created', { snapshot: state });
      this.startEffects(state);
      this.save(state);
      return { campaign: state.campaign, revision: state.revision };
    });
  }
  member(scope) {
    if (!id(scope?.campaign) || !id(scope?.owner)) fail('UNAUTHORIZED', 'Connect as a campaign member.');
    const row = this.db.prepare('SELECT role FROM game_members WHERE campaign=? AND owner=?').get(scope.campaign, scope.owner);
    if (!row) fail('UNAUTHORIZED', 'Campaign membership is required.');
    return row.role;
  }
  load(campaign) { const row = this.db.prepare('SELECT body FROM game_campaigns WHERE id=?').get(campaign); if (!row) fail('NOT_FOUND', 'Campaign not found.'); return JSON.parse(row.body); }
  save(state) {
    // A remaining-work frame may finish without another gameplay event (for
    // example, checked damage to a living actor or a removed tail hazard).
    // Preserve earlier damage snapshots and publish that final stack change.
    const latest = this.db.prepare("SELECT snapshot FROM game_outbox WHERE campaign=? AND revision=? AND kind='projection'").get(state.campaign, state.revision);
    if (latest && hash(JSON.parse(latest.snapshot).continuations ?? null) !== hash(state.continuations ?? null)) this.record(state, 'continuation_settled', {});
    this.db.prepare('UPDATE game_campaigns SET revision=?,body=? WHERE id=?').run(state.revision, JSON.stringify(state), state.campaign);
  }
  record(state, kind, payload) {
    state.revision++;
    if (kind === 'encounter_completed') completeWorldEncounter(this.db, state);
    this.db.prepare('INSERT INTO game_events(campaign,revision,kind,body) VALUES(?,?,?,?)').run(state.campaign, state.revision, kind, JSON.stringify(payload));
    this.db.prepare("INSERT INTO game_outbox(campaign,revision,kind,snapshot) VALUES(?,?,'projection',?)").run(state.campaign, state.revision, JSON.stringify(state));
  }
  view(scope) { const role = this.member(scope); return projectState(this.load(scope.campaign), scope.owner, role); }
  reactions(scope) { return reactionState(this, scope, projectState); }
  resolveReaction(scope, input) { return resolveReaction(this, scope, input, GameError); }
  concentration(scope) { return concentrationState(this, scope, projectState); }
  resolveConcentration(scope, input) { return concentrationCommand(this, scope, input, GameError); }
  concentrationDamage(state, actor, damageTaken, origin) { return concentrationDamage(this, state, actor, damageTaken, origin); }
  requestCheck(characters, scope, input) { return this.guardPending(scope, () => requestCheck(this, characters, scope, input, GameError)); }
  pendingChecks(scope) { return pendingChecks(this, scope); }
  rollHistory(scope, before) { return rollHistory(this, scope, before, GameError); }
  resolveCheck(scope, input) { return this.guardPending(scope, () => resolveCheck(this, scope, input, GameError), { service: 'resolveCheck', requestId: input?.requestId }); }
  installContent(scope, input) { return this.guardPending(scope, () => installContent(this, scope, input, validateSeed, GameError)); }
  prepareContentCouncil(scope) { return this.guardPending(scope, () => prepareContentCouncil(this, scope, GameError)); }
  prepareContentDeparture(scope, requestId) { return this.guardPending(scope, () => prepareContentDeparture(this, scope, requestId, GameError)); }
  prepareDeparture(scope, input) { return this.guardPending(scope, () => prepareDeparture(this, scope, input, validateSeed, GameError)); }
  departure(scope) { return departureView(this, scope); }
  enterDeparture(scope, input) { return this.guardPending(scope, () => enterDeparture(this, scope, input, validateSeed, GameError), { service: 'enterDeparture', requestId: input?.requestId }); }
  transitionScene(scope, input) { return this.guardPending(scope, () => transitionScene(this, scope, input, validateSeed, GameError), { service: 'transitionScene', requestId: input?.requestId }); }
  world(scope) { this.member(scope); return worldView(this.db, scope.campaign); }
  worldTime(scope) { return worldTimeState(this, scope); }
  configureWorldTime(scope, input) { return configureWorldTime(this, scope, input); }
  previewWorldTime(scope, input) { return previewWorldTime(this, scope, input); }
  advanceWorldTime(scope, input) { return advanceWorldTime(this, scope, input); }
  recordWorldTimeDecision(scope, input) { return recordWorldTimeDecision(this, scope, input); }
  council(scope) { this.member(scope); return councilView(this.db, scope.campaign); }
  prepareCouncil(scope, input) {
    return this.guardPending(scope, () => { if (this.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only the host can prepare reviewed mission branches.'); return prepareCouncil(this.db, scope.campaign, worldView(this.db, scope.campaign), input); });
  }
  chooseCouncil(scope, input) { return this.guardPending(scope, () => chooseCouncil(this.db, scope, input)); }
  counsel(scope) { this.member(scope); return counselState(this.db, scope, worldView(this.db, scope.campaign)); }
  askCounsel(scope, input) {
    return this.guardPending(scope, () => { const role = this.member(scope); return askCounsel(this.db, scope, input, projectState(this.load(scope.campaign), scope.owner, role), worldView(this.db, scope.campaign)); }, { service: 'askCounsel', requestId: input?.requestId });
  }
  adjudicateMission(scope, input) { return this.guardPending(scope, () => adjudicateMission(this, scope, input)); }
  configureMission(scope, input) {
    return this.transaction(() => {
      if (this.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only the host can author mission consequences.');
      const state = this.load(scope.campaign), beforePhase = state.phase, beforeResume = state.resumePhase;
      if (state.pendingConcentration) fail('PENDING', 'Resolve the pending concentration save first.');
      if (state.pendingReaction) fail('PENDING', 'Resolve pending reactions first. In Discord, open Checks & rolls → Opportunity reactions.');
      const world = configureWorld(this.db, state, input);
      if (beforePhase === 'paused' && state.phase !== 'paused') { state.resumePhase = state.phase; state.phase = 'paused'; }
      if (state.phase !== beforePhase || state.resumePhase !== beforeResume) {
        this.record(state, 'exploration_started', { missionId: world.mission.id, paused: state.phase === 'paused' }); this.save(state);
      }
      return world;
    });
  }
  debrief(scope, input) { return this.guardPending(scope, () => debriefWorld(this.db, scope, input)); }
  hasCampaign(campaign) { return Boolean(this.db.prepare('SELECT 1 FROM game_campaigns WHERE id=?').get(campaign)); }
  journal(scope, after, limit = 20) {
    const page = this.updates(scope, after, limit);
    let previous = after ? this.updates(scope, after - 1, 1).views[0] : null;
    // Read receipts for this exact revision range, never another member's rolls.
    const receipts = this.db.prepare('SELECT body FROM game_receipts WHERE campaign=? AND owner=? AND json_extract(body,\'$.revision\')>? AND json_extract(body,\'$.revision\')<=?').all(scope.campaign, scope.owner, after, page.next).map(row => JSON.parse(row.body));
    const entries = page.views.map(view => {
      const entry = narrateChange(previous, view, receipts.find(r => r.revision === view.revision));
      previous = view; return entry;
    }).filter(entry => entry.facts.length);
    return { entries, next: page.next, current: page.current, hasMore: page.hasMore };
  }
  updates(scope, after, limit = 20) {
    if (!int(after, 0, Number.MAX_SAFE_INTEGER) || !int(limit, 1, 50)) fail('INVALID', 'Use a bounded revision cursor.');
    // One read transaction keeps the membership, upper bound and page consistent.
    return this.transaction(() => {
      const role = this.member(scope);
      const current = this.load(scope.campaign).revision;
      if (after > current) fail('STALE', 'The revision cursor is ahead of this campaign.');
      const rows = this.db.prepare("SELECT revision,snapshot FROM game_outbox WHERE campaign=? AND kind='projection' AND revision>? AND revision<=? ORDER BY revision LIMIT ?").all(scope.campaign, after, current, limit);
      const views = rows.map(row => projectState(JSON.parse(row.snapshot), scope.owner, role));
      const next = rows.at(-1)?.revision ?? after;
      return { views, next, current, hasMore: next < current };
    });
  }
  createControl(scope, context, body) {
    this.member(scope);
    if (!id(context?.guild) || !id(context?.channel) || JSON.stringify(body).length > 16384) fail('INVALID', 'Invalid control binding.');
    const control = randomBytes(12).toString('hex');
    this.db.prepare('INSERT INTO game_controls VALUES(?,?,?,?,?,?,?)').run(control, scope.campaign, scope.owner, context.guild, context.channel, JSON.stringify(body), Date.now() + 86400000);
    return control;
  }
  control(scope, context, controlId) {
    this.member(scope);
    const row = this.db.prepare('SELECT body FROM game_controls WHERE id=? AND campaign=? AND owner=? AND guild=? AND channel=? AND expires>?').get(controlId, scope.campaign, scope.owner, context.guild, context.channel, Date.now());
    if (!row) fail('UNAUTHORIZED', 'Open a current private game control.');
    return JSON.parse(row.body);
  }
  receipts(scope, limit = 20) {
    this.member(scope);
    if (!int(limit, 1, 100)) fail('INVALID', 'Choose a bounded receipt page.');
    return this.db.prepare('SELECT body FROM game_receipts WHERE campaign=? AND owner=? ORDER BY rowid DESC LIMIT ?').all(scope.campaign, scope.owner, limit).map(row => JSON.parse(row.body));
  }
  events(scope) { if (this.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only the host can inspect the full ledger.'); return this.db.prepare('SELECT revision,kind,body FROM game_events WHERE campaign=? ORDER BY revision').all(scope.campaign).map(e => ({ ...e, body: JSON.parse(e.body) })); }
  roll(sides) { const value = this.rollDie(sides); if (!int(value, 1, sides)) fail('RNG', 'Dice provider returned an invalid result.'); return value; }
  queueContinuation(state, frame) {
    const saved = { ...structuredClone(frame), id: randomBytes(12).toString('hex') };
    (state.continuations ??= []).push(saved);
    return saved.id;
  }
  removeContinuation(state, frameId) {
    state.continuations = (state.continuations ?? []).filter(frame => frame.id !== frameId);
    if (!state.continuations.length) delete state.continuations;
  }
  continuationActor(state, frame) {
    if (state.map.id !== frame.mapId || state.turn !== frame.turn || state.phase !== frame.phase) return null;
    const actor = state.actors.find(a => a.id === frame.actorId);
    return actor && actor.characterVersion === frame.characterVersion && actor.owner === frame.owner && actor.x === frame.from.x && actor.y === frame.from.y ? actor : null;
  }
  continuationContext(state, actor) {
    return { actorId: actor.id, characterVersion: actor.characterVersion, owner: actor.owner, mapId: state.map.id, turn: state.turn, phase: state.phase, from: point(actor) };
  }
  drainContinuations(state) {
    let count = 0;
    while (state.continuations?.length && !state.pendingConcentration && state.phase !== 'paused') {
      const next = state.continuations.at(-1);
      if (state.pendingReaction && next.kind !== 'reaction') break;
      if (++count > 512) fail('CONTINUATION', 'The saved resolution exceeded its bounded continuation limit.');
      const frame = state.continuations.pop();
      if (!state.continuations.length) delete state.continuations;
      if (frame.kind === 'reaction') { resumeReaction(this, state); continue; }
      const actor = this.continuationActor(state, frame);
      if (!actor) { this.record(state, 'continuation_stopped', { kind: frame.kind, reason: 'state_changed' }); continue; }
      if (frame.kind === 'effects') {
        if (actor.hp > 0) this.triggerEffects(state, actor, frame.trigger, frame.entryFrom, frame.remaining);
      } else if (frame.kind === 'move') {
        let role;
        try { role = this.member(frame.scope); }
        catch (error) { if (error.code !== 'UNAUTHORIZED') throw error; }
        if (!role || (actor.owner !== frame.scope.owner && !(role === 'host' && actor.owner === null)) || actor.hp === 0 || (state.phase === 'combat' && state.order[state.activeIndex] !== actor.id)) {
          this.record(state, 'movement_stopped', { actorId: actor.id, reason: 'state_changed' }); continue;
        }
        try { this.move(state, actor, { path: frame.path, requestId: frame.requestId }, frame.scope, role, { movedPath: frame.movedPath }); }
        catch (error) {
          if (!['MOVEMENT', 'NOT_VISIBLE', 'INVALID'].includes(error.code)) throw error;
          this.record(state, 'movement_stopped', { actorId: actor.id, reason: 'path_changed' });
        }
      } else if (frame.kind === 'start_effects_done') {
        if (actor.hp === 0 && state.phase === 'combat' && state.order[state.activeIndex] === actor.id) this.endTurn(state);
      } else if (frame.kind === 'end_turn_done') {
        if (state.order[state.activeIndex] === actor.id) this.finishEndTurn(state);
      } else if (frame.kind === 'checked_damage_done') {
        this.finishCheckedDamage(state, actor);
      } else fail('CONTINUATION', 'Unknown saved resolution kind.');
    }
  }
  finishCheckedDamage(state, actor) {
    if (actor.hp === 0 && state.phase === 'combat' && !this.completeEncounter(state) && state.order[state.activeIndex] === actor.id) this.endTurn(state);
  }
  triggerEffects(state, actor, trigger, from = null, remaining = null) {
    const explorationEntry = state.phase === 'exploration' && trigger === 'enter';
    const effectIdentity = effect => hash({ ...effect, triggered: undefined });
    const effects = remaining ?? state.effects.map(effect => ({ id: effect.id, fingerprint: effectIdentity(effect) }));
    for (const [index, identity] of effects.entries()) {
      if (actor.hp === 0) break;
      const effect = state.effects.find(value => value.id === identity.id && effectIdentity(value) === identity.fingerprint);
      if (!effect) continue;
      const mark = `${actor.id}:${state.turn}`;
      if (effect.trigger !== trigger || (!explorationEntry && effect.triggered.includes(mark)) || !effect.cells.some(p => footprint(actor, actor.size).some(cell => key(cell) === key(p)))) continue;
      if (explorationEntry && from && effect.cells.some(p => footprint(from, actor.size).some(cell => key(cell) === key(p)))) continue;
      if (!explorationEntry) effect.triggered.push(mark);
      const rest = effects.slice(index + 1);
      const frameId = rest.length ? this.queueContinuation(state, { kind: 'effects', ...this.continuationContext(state, actor), trigger, entryFrom: from, remaining: rest }) : null;
      actor.hp = Math.max(0, actor.hp - effect.damage);
      this.concentrationDamage(state, actor, effect.damage, { kind: 'hazard', effectId: effect.id, effectFingerprint: identity.fingerprint, trigger, actorId: actor.id, turn: state.turn, revision: state.revision + 1 });
      this.record(state, 'effect_triggered', { effectId: effect.id, actorId: actor.id, trigger, damage: effect.damage, hp: actor.hp, turn: state.turn });
      if (state.pendingConcentration) return true;
      if (frameId) this.removeContinuation(state, frameId);
    }
    return false;
  }
  startEffects(state) {
    const actor = state.actors.find(a => a.id === state.order[state.activeIndex]);
    const frameId = this.queueContinuation(state, { kind: 'start_effects_done', ...this.continuationContext(state, actor) });
    if (this.triggerEffects(state, actor, 'start_turn')) return;
    this.removeContinuation(state, frameId);
    if (actor.hp === 0 && state.phase === 'combat') this.endTurn(state);
  }
  command(scope, input) {
    if (!id(input?.requestId) || !int(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER) || !id(input.actorId) || !['move', 'attack', 'end_turn', 'pause', 'resume'].includes(input.type)) fail('INVALID', 'Use a revision-bound game command.');
    const allowed = new Set(['requestId', 'expectedRevision', 'actorId', 'type', ...(input.type === 'move' ? ['path'] : input.type === 'attack' ? ['targetId'] : [])]);
    if (Object.keys(input).some(k => !allowed.has(k))) fail('UNSUPPORTED', 'This command includes an unsupported mechanic or field.');
    const fingerprint = hash(input);
    return this.transaction(() => {
      const role = this.member(scope);
      const prior = this.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
      if (prior) { if (prior.fingerprint !== fingerprint) fail('CONFLICT', 'That request already describes another action.'); return JSON.parse(prior.body); }
      const state = this.load(scope.campaign);
      if (input.expectedRevision !== state.revision) fail('STALE', 'The scene changed. Open the current view.');
      const actor = state.actors.find(a => a.id === input.actorId);
      const hostTransition = role === 'host' && ['pause', 'resume'].includes(input.type);
      if (!actor || (!hostTransition && actor.owner !== scope.owner && !(role === 'host' && actor.owner === null))) fail('UNAUTHORIZED', 'You can act only for your own character.');
      let result;
      if (input.type === 'pause' || input.type === 'resume') {
        if (input.type === 'resume' && role !== 'host') fail('UNAUTHORIZED', 'The host resumes the campaign after the party is ready.');
        if ((input.type === 'pause' && !['combat', 'exploration'].includes(state.phase)) || (input.type === 'resume' && state.phase !== 'paused')) fail('PHASE', 'That transition is unavailable.');
        if (input.type === 'pause') { state.resumePhase = state.phase; state.phase = 'paused'; }
        else { state.phase = state.resumePhase === 'exploration' ? 'exploration' : 'combat'; delete state.resumePhase; }
        this.record(state, input.type, { actorId: actor.id }); result = { type: input.type };
      } else {
        if (state.phase === 'paused') fail('PAUSED', 'Play is paused. Maps remain available.');
        if (state.pendingConcentration) fail('PENDING', 'Resolve the pending concentration save first.');
        if (state.pendingReaction) fail('PENDING', 'Resolve pending reactions first. In Discord, open Checks & rolls → Opportunity reactions.');
        if (!['combat', 'exploration'].includes(state.phase) || (state.phase === 'exploration' && input.type !== 'move')) fail('PHASE', 'That action requires an active combat encounter.');
        if (state.phase === 'combat' && state.order[state.activeIndex] !== actor.id) fail('TURN', 'Wait for your character’s turn.');
        if (actor.hp === 0 && input.type !== 'end_turn') fail('DEFEATED', 'This actor cannot act.');
        if (input.type === 'move') result = this.move(state, actor, input, scope, role);
        if (input.type === 'attack') result = this.attack(state, actor, input, scope, role);
        if (input.type === 'end_turn') result = this.endTurn(state);
      }
      this.save(state);
      const receipt = { requestId: input.requestId, revision: state.revision, result };
      this.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
      return receipt;
    });
  }
  move(state, actor, input, scope, role, continuation = null) {
    if (!Array.isArray(input.path) || !input.path.length || input.path.length > 24 || !input.path.every(p => inBounds(state.map, p))) fail('INVALID', 'Provide a bounded movement path.');
    const visible = new Set(projectState(state, scope.owner, role).map.cells.map(key));
    const occupied = state.actors.filter(a => a.id !== actor.id && a.hp > 0).flatMap(a => footprint(a, a.size));
    const options = { occupied, size: actor.size };
    let from = actor, cost = 0;
    // Validate the full preview before spending anything. Hidden destinations are not queried as an oracle.
    for (const p of input.path.map(point)) {
      if (!footprint(p, actor.size).every(cell => visible.has(key(cell)))) fail('NOT_VISIBLE', 'Move within the visible area first.');
      cost += stepCost(state.map, from, p, options); from = p;
    }
    const exploration = state.phase === 'exploration';
    if (!Number.isFinite(cost) || (exploration ? actor.speed === 0 : cost > state.movementRemaining)) fail('MOVEMENT', 'That path is blocked or exceeds available movement.');
    const moved = [], path = input.path.map(point);
    for (const [index, p] of path.entries()) {
      const settledActorIds = index === 0 ? continuation?.settledActorIds ?? [] : [];
      if (!exploration && beginOpportunity(this, state, actor, { scope, path: path.slice(index), requestId: input.requestId, movedPath: [...(continuation?.movedPath ?? []), ...moved], settledActorIds })) return { type: 'move', path: moved, stopped: true, movementRemaining: state.movementRemaining, pendingReactionId: state.pendingReaction.id };
      const spent = stepCost(state.map, actor, p, options), from = point(actor);
      actor.x = p.x; actor.y = p.y; if (!exploration) state.movementRemaining -= spent; moved.push({ ...p });
      const rest = path.slice(index + 1);
      const frameId = rest.length ? this.queueContinuation(state, { kind: 'move', ...this.continuationContext(state, actor), scope, requestId: input.requestId, path: rest, movedPath: [...(continuation?.movedPath ?? []), ...moved] }) : null;
      this.record(state, 'actor_moved', { actorId: actor.id, to: p, spent, movementRemaining: exploration ? null : state.movementRemaining });
      if (this.triggerEffects(state, actor, 'enter', from)) return { type: 'move', path: moved, stopped: true, movementRemaining: exploration ? null : state.movementRemaining, pendingConcentrationId: state.pendingConcentration.id };
      if (frameId) this.removeContinuation(state, frameId);
      if (actor.hp === 0) break;
    }
    return { type: 'move', path: moved, stopped: moved.length !== input.path.length, movementRemaining: exploration ? null : state.movementRemaining };
  }
  attack(state, actor, input, scope, role, resource = 'action') {
    if (resource === 'reaction') {
      if (actor.combatCapabilities?.attackKind !== 'melee' || actor.reactionAvailable !== true) fail('RESOURCE', 'The reviewed melee reaction is unavailable.');
    } else if (resource !== 'action') fail('INVALID', 'Unknown attack resource.');
    else if (!state.actionAvailable) fail('RESOURCE', 'The action has already been spent.');
    const view = projectState(state, scope.owner, role);
    if (!id(input.targetId) || !view.actors.some(a => a.id === input.targetId)) fail('NOT_VISIBLE', 'Select a visible target.');
    const target = state.actors.find(a => a.id === input.targetId);
    if (!target || target.id === actor.id || target.hp === 0) fail('TARGET', 'Select another active actor.');
    const inRange = footprint(actor, actor.size).some(a => footprint(target, target.size).some(t => distance(a, t) * 5 <= actor.weapon.rangeFeet && lineOfSight(state.map, a, t)));
    if (!inRange) fail('RANGE', 'Target is out of range or behind cover.');
    const w = actor.weapon, ability = Math.floor((w.abilityScore - 10) / 2);
    const modifiers = [{ source: 'ability', value: ability }, { source: 'proficiency', value: w.proficient ? w.proficiencyBonus : 0 }, { source: 'equipment', value: w.equipmentBonus }];
    const raw = this.roll(20), total = raw + modifiers.reduce((sum, m) => sum + m.value, 0);
    const hit = raw === 20 || (raw !== 1 && total >= target.ac), critical = raw === 20;
    const damageDice = hit ? Array.from({ length: w.damageDice * (critical ? 2 : 1) }, () => this.roll(w.damageDie)) : [];
    const damageModifier = hit ? (w.addAbilityToDamage ? ability : 0) + w.equipmentBonus : 0;
    const damage = hit ? Math.max(0, damageDice.reduce((sum, value) => sum + value, 0) + damageModifier) : 0;
    target.hp = Math.max(0, target.hp - damage);
    if (resource === 'reaction') actor.reactionAvailable = false; else state.actionAvailable = false;
    this.concentrationDamage(state, target, damage, { kind: 'attack', actorId: actor.id, targetId: target.id, ...(id(input.requestId) ? { requestId: input.requestId } : {}), resource, revision: state.revision + 1 });
    const result = { type: 'attack', actorId: actor.id, targetId: target.id, weapon: w.name, characterVersion: actor.characterVersion, dice: [raw], modifiers, total, hit, critical, damageDice, damageModifier, damage, rulesVersion: state.rulesVersion, ...(resource === 'reaction' ? { reaction: true } : {}) };
    this.record(state, 'attack_resolved', result);
    return result;
  }
  completeEncounter(state) {
    if (state.phase === 'complete') return true;
    if (state.phase !== 'combat') return false;
    const living = state.actors.filter(a => a.hp > 0);
    if (new Set(living.map(a => a.team)).size >= 2) return false;
    state.phase = 'complete';
    this.record(state, 'encounter_completed', {});
    return true;
  }
  endTurn(state) {
    const endingActor = state.actors.find(a => a.id === state.order[state.activeIndex]);
    const frameId = this.queueContinuation(state, { kind: 'end_turn_done', ...this.continuationContext(state, endingActor) });
    if (endingActor.hp > 0 && this.triggerEffects(state, endingActor, 'end_turn')) return { type: 'end_turn', stopped: true, pendingConcentrationId: state.pendingConcentration.id, round: state.round, turn: state.turn };
    this.removeContinuation(state, frameId);
    return this.finishEndTurn(state);
  }
  finishEndTurn(state) {
    this.record(state, 'turn_ended', { actorId: state.order[state.activeIndex], turn: state.turn });
    if (this.completeEncounter(state)) return { type: 'end_turn', complete: true };
    do { state.activeIndex = (state.activeIndex + 1) % state.order.length; if (state.activeIndex === 0) state.round++; } while (state.actors.find(a => a.id === state.order[state.activeIndex]).hp === 0);
    state.turn++;
    for (const e of state.effects.filter(e => e.expiresAtTurn <= state.turn)) {
      state.effects = state.effects.filter(active => active.id !== e.id);
      this.record(state, 'effect_expired', { effectId: e.id, turn: state.turn });
    }
    state.effects = state.effects.map(e => ({ ...e, triggered: [] }));
    state.actionAvailable = true;
    const nextActor = state.actors.find(a => a.id === state.order[state.activeIndex]);
    state.movementRemaining = nextActor.speed;
    if (nextActor.combatCapabilities) nextActor.reactionAvailable = true;
    this.record(state, 'turn_started', { actorId: state.order[state.activeIndex], round: state.round, turn: state.turn });
    this.startEffects(state);
    if (state.phase === 'complete') return { type: 'end_turn', complete: true };
    return { type: 'end_turn', round: state.round, turn: state.turn }; // Hidden next-actor identity stays out of receipt.
  }
}
