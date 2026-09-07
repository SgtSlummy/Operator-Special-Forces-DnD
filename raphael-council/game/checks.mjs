import { createHash } from 'node:crypto';
import { validateCheckConsequence, publicCheckConsequence, applyCheckConsequence } from './check-consequences.mjs';
const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const bounded = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
// Unique (campaign, revision) integer events plus this count prove no crossed revision is missing.
// Keep the approval immutable; only a complete pause/resume interval may preserve its mechanics.
const currentCheckRevision = `
  json_type(c.body, '$.expectedRevision') = 'integer'
  AND json_extract(c.body, '$.expectedRevision') BETWEEN 1 AND ?
  AND ? - json_extract(c.body, '$.expectedRevision') = (
    SELECT COUNT(*) FROM game_events e
    WHERE e.campaign = c.campaign
      AND e.revision > json_extract(c.body, '$.expectedRevision') AND e.revision <= ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM game_events e
    WHERE e.campaign = c.campaign
      AND e.revision > json_extract(c.body, '$.expectedRevision') AND e.revision <= ?
      AND (typeof(e.revision) <> 'integer' OR e.kind IS NULL OR e.kind NOT IN ('pause', 'resume'))
  )`;
export function initializeChecks(db) {
  db.exec('CREATE TABLE IF NOT EXISTS game_checks(campaign TEXT NOT NULL,id TEXT NOT NULL,host TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,result TEXT,PRIMARY KEY(campaign,id));');
}
function publicCheck(body) {
  return { id: body.id, actorId: body.actorId, label: body.label, kind: body.kind, ability: body.ability, mode: body.mode, modifiers: body.modifiers, cost: body.cost, revision: body.expectedRevision, characterVersion: body.characterVersion,
    ...(body.consequence ? { consequence: publicCheckConsequence(body.consequence) } : {}) };
}
/** Host reviews proficiency applicability; numeric stats come from the exact approved snapshot. */
export function requestCheck(store, characters, scope, input, ErrorType) {
  const fail = (code, message) => { throw new ErrorType(code, message); };
  return store.transaction(() => {
    if (store.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only the host can request a reviewed check.');
    if (!keys(input, ['id', 'reviewed', 'expectedRevision', 'actorId', 'label', 'kind', 'ability', 'proficiencyMultiplier', 'proficiencyReason', 'advantage', 'disadvantage', 'adjustments', 'dc', 'cost', 'consequence']) || !id(input.id) || input.reviewed !== true || !Number.isSafeInteger(input.expectedRevision) || !id(input.actorId) || !bounded(input.label, 160) || !['check', 'save'].includes(input.kind) || !abilities.includes(input.ability) || ![0, 1, 2].includes(input.proficiencyMultiplier) || (input.kind === 'save' && input.proficiencyMultiplier === 2) || !bounded(input.proficiencyReason, 300) || !['none', 'action'].includes(input.cost) || !Number.isInteger(input.dc) || input.dc < 0 || input.dc > 100) fail('INVALID', 'Use a reviewed ability check or saving throw with explicit proficiency and cost.');
    for (const name of ['advantage', 'disadvantage']) if (!Array.isArray(input[name]) || input[name].length > 8 || !input[name].every(v => bounded(v, 160))) fail('INVALID', 'Record bounded sources for advantage and disadvantage.');
    if (!Array.isArray(input.adjustments) || input.adjustments.length > 8 || !input.adjustments.every(a => keys(a, ['source', 'value']) && bounded(a.source, 160) && Number.isInteger(a.value) && a.value >= -20 && a.value <= 20)) fail('INVALID', 'Supply explicit bounded situational modifiers.');
    validateCheckConsequence(input, fail);
    const fingerprint = hash(input), previous = store.db.prepare('SELECT fingerprint,body FROM game_checks WHERE campaign=? AND id=?').get(scope.campaign, input.id);
    if (previous) { if (previous.fingerprint !== fingerprint) fail('CONFLICT', 'This check ID already has different mechanics.'); return publicCheck(JSON.parse(previous.body)); }
    const state = store.load(scope.campaign), actor = state.actors.find(a => a.id === input.actorId);
    if (state.revision !== input.expectedRevision) fail('STALE', 'Refresh before requesting the check.');
    if (input.consequence && state.phase === 'complete') fail('UNSUPPORTED', 'Damage saves require an ongoing scene.');
    if (!actor?.owner) fail('UNSUPPORTED', 'This check requires an approved player character.');
    try { store.member({ campaign: scope.campaign, owner: actor.owner }); }
    catch (error) { if (error instanceof ErrorType && error.code === 'UNAUTHORIZED') fail('TARGET', 'Choose a character belonging to a current campaign member.'); throw error; }
    const saved = characters?.character({ campaign: scope.campaign, owner: actor.owner });
    const digest = saved && createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16);
    if (!saved || saved.snapshot.edition !== '2024' || actor.characterVersion !== `approved-${saved.revision}-${digest}`) fail('PROFILE', 'The approved sheet must match this encounter character version.');
    const value = name => {
      const field = saved.snapshot.fields[name];
      if (!field || !Number.isInteger(field.value) || field.conflict || (field.uncertain && !field.corrected)) fail('PROFILE', 'Confirm the required character statistics first.');
      return field.value;
    };
    const score = value(input.ability), proficiency = value('proficiencyBonus');
    if (score < 1 || score > 30 || proficiency < 0 || proficiency > 10) fail('PROFILE', 'The approved statistics are outside the supported range.');
    const mode = !!input.advantage.length === !!input.disadvantage.length ? 'normal' : input.advantage.length ? 'advantage' : 'disadvantage';
    const modifiers = [{ source: input.ability, value: Math.floor((score - 10) / 2) }, { source: `proficiency ×${input.proficiencyMultiplier}: ${input.proficiencyReason}`, value: proficiency * input.proficiencyMultiplier }, ...input.adjustments];
    const body = { ...input, mode, modifiers, owner: actor.owner, characterVersion: actor.characterVersion, rulesVersion: input.consequence ? 'raph-reviewed-d20-damage-v1' : 'raph-reviewed-d20-v1' };
    store.db.prepare('INSERT INTO game_checks VALUES(?,?,?,?,?,NULL)').run(scope.campaign, input.id, scope.owner, fingerprint, JSON.stringify(body));
    return publicCheck(body);
  });
}
export function pendingChecks(store, scope) {
  return store.transaction(() => {
    store.member(scope);
    const state = store.load(scope.campaign);
    if (state.phase === 'paused') return [];
    return store.db.prepare(`SELECT c.body FROM game_checks c
      WHERE c.campaign=? AND c.result IS NULL AND json_extract(c.body,'$.owner')=?
        AND ${currentCheckRevision}
      ORDER BY c.rowid DESC LIMIT 100`)
      .all(scope.campaign, scope.owner, state.revision, state.revision, state.revision, state.revision)
      .map(r => ({ ...publicCheck(JSON.parse(r.body)), revision: state.revision }));
  });
}
export function rollHistory(store, scope, before, ErrorType) {
  return store.transaction(() => {
    store.member(scope);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new ErrorType('INVALID', 'Use a positive roll revision cursor.');
    const rows = store.db.prepare("SELECT body FROM game_receipts WHERE campaign=? AND owner=? AND json_extract(body,'$.result.type') IN ('attack','check','save') AND json_extract(body,'$.revision')<? ORDER BY json_extract(body,'$.revision') DESC LIMIT 21").all(scope.campaign, scope.owner, before ?? Number.MAX_SAFE_INTEGER);
    const receipts = rows.slice(0, 20).map(row => JSON.parse(row.body));
    return { receipts, nextBefore: rows.length > 20 ? receipts.at(-1).revision : null };
  });
}
export function resolveCheck(store, scope, input, ErrorType) {
  const fail = (code, message) => { throw new ErrorType(code, message); };
  return store.transaction(() => {
    store.member(scope);
    if (!keys(input, ['checkId', 'requestId']) || !id(input.checkId) || !id(input.requestId)) fail('INVALID', 'Select a pending check and request ID.');
    const fingerprint = hash({ type: 'resolve_check', ...input });
    const prior = store.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (prior) { if (prior.fingerprint !== fingerprint) fail('CONFLICT', 'This request describes another action.'); return JSON.parse(prior.body); }
    const row = store.db.prepare('SELECT host,body,result FROM game_checks WHERE campaign=? AND id=?').get(scope.campaign, input.checkId);
    const body = row && JSON.parse(row.body);
    if (!body || body.owner !== scope.owner) fail('UNAUTHORIZED', 'Roll only your own pending check.');
    if (row.result) fail('CONFLICT', 'This check already has a saved result.');
    if (store.member({ ...scope, owner: row.host }) !== 'host') fail('UNAUTHORIZED', 'The requesting host is no longer authorized.');
    const state = store.load(scope.campaign), actor = state.actors.find(a => a.id === body.actorId);
    const current = store.db.prepare(`SELECT 1 FROM game_checks c
      WHERE c.campaign=? AND c.id=? AND ${currentCheckRevision}`)
      .get(scope.campaign, body.id, state.revision, state.revision, state.revision, state.revision);
    if (!current) fail('STALE', 'The scene changed; ask for a current check.');
    if (state.phase === 'paused') fail('PAUSED', 'Checks wait while play is paused.');
    if (body.consequence && state.phase === 'complete') fail('UNSUPPORTED', 'Damage saves require an ongoing scene.');
    if (!actor || actor.owner !== scope.owner || actor.characterVersion !== body.characterVersion) fail('PROFILE', 'The character profile changed.');
    if (!actor.hp) fail('UNSUPPORTED', 'Checks for defeated actors require the expanded condition rules.');
    if (body.cost === 'action') {
      if (state.phase !== 'combat' || state.order[state.activeIndex] !== actor.id) fail('TURN', 'Use this action on your turn.');
      if (!state.actionAvailable) fail('RESOURCE', 'Your action has already been spent.');
      state.actionAvailable = false;
    }
    const dice = Array.from({ length: body.mode === 'normal' ? 1 : 2 }, () => store.roll(20));
    const keptIndex = dice.length === 1 || dice[0] === dice[1] ? 0 : body.mode === 'advantage' ? (dice[0] > dice[1] ? 0 : 1) : (dice[0] < dice[1] ? 0 : 1);
    const total = dice[keptIndex] + body.modifiers.reduce((sum, m) => sum + m.value, 0);
    const result = { type: body.kind, checkId: body.id, actorId: actor.id, label: body.label, ability: body.ability, mode: body.mode, advantage: body.advantage, disadvantage: body.disadvantage, dice, keptIndex, discardedDice: dice.filter((_, i) => i !== keptIndex), modifiers: body.modifiers, total, success: total >= body.dc, characterVersion: body.characterVersion, rulesVersion: body.rulesVersion };
    if (body.consequence) {
      result.consequence = applyCheckConsequence(store, actor, body.consequence, result.success);
      const pending = store.concentrationDamage(state, actor, result.consequence.appliedDamage, { kind: 'checked_save', checkId: body.id, requestId: input.requestId, characterVersion: body.characterVersion });
      if (pending) store.queueContinuation(state, { kind: 'checked_damage_done', ...store.continuationContext(state, actor) });
    }
    store.record(state, 'check_resolved', result);
    if (result.consequence) {
      store.record(state, 'save_damage_applied', { checkId: body.id, actorId: actor.id, consequence: result.consequence });
      if (!state.pendingConcentration) store.finishCheckedDamage(state, actor);
    }
    store.save(state);
    const receipt = { requestId: input.requestId, revision: state.revision, result };
    store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
    store.db.prepare('UPDATE game_checks SET result=? WHERE campaign=? AND id=?').run(JSON.stringify(receipt), scope.campaign, body.id);
    return receipt;
  });
}
