import { createHash } from 'node:crypto';

export class WorldTimeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new WorldTimeError(code, message); };
const MAX_TICK = 10_000_000, MAX_EVENTS = 256, MAX_BYTES = 262_144;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const text = (value, max = 300) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value, min = 0, max = MAX_TICK) => Number.isSafeInteger(value) && value >= min && value <= max;
const scalar = value => value === null || typeof value === 'boolean' || integer(value, -1_000_000, 1_000_000) || text(value, 400);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = value => structuredClone(value);
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const list = (value, max, key = 'id') => Array.isArray(value) && value.length <= max && (key === null || new Set(value.map(item => item?.[key])).size === value.length);
const evidence = value => list(value, 12, null) && value.length > 0 && value.every(item => text(item, 300));
const known = (items, wanted) => items.find(item => item.id === wanted);
const statuses = ['active', 'paused', 'resolved'];
const opportunities = ['open', 'resolved', 'superseded'];
const knowledgeStatuses = ['known', 'believed', 'disputed'];

function inputCopy(input) {
  let body;
  try { body = JSON.stringify(input); } catch { fail('INVALID', 'Use a bounded JSON request.'); }
  if (!body || body.length > MAX_BYTES) fail('INVALID', 'Use a bounded JSON request.');
  return JSON.parse(body);
}
function visibility(value) {
  return exact(value, ['audience', 'owners']) && ['host', 'party', 'owners'].includes(value.audience) && list(value.owners, 32, null) && new Set(value.owners).size === value.owners.length && value.owners.every(id) && (value.audience === 'owners' ? value.owners.length > 0 : value.owners.length === 0);
}
function visible(value, scope, role) {
  return role === 'host' || value.audience === 'party' || value.audience === 'owners' && value.owners.includes(scope.owner);
}
function members(db, campaign) { return new Set(db.prepare('SELECT owner FROM game_members WHERE campaign=?').all(campaign).map(row => row.owner)); }
function validateGrants(value, currentMembers) {
  if (!visibility(value) || value.owners.some(owner => !currentMembers.has(owner))) fail('INVALID', 'Visibility grants require current campaign members.');
}
function conditions(value, definition) {
  return list(value, 16, 'factId') && value.every(item => exact(item, ['factId', 'equals']) && known(definition.facts, item.factId) && scalar(item.equals) && item.equals !== null);
}
function validateEffects(effects, definition, currentMembers) {
  if (!list(effects, 32, null)) fail('INVALID', 'Use bounded typed effects.');
  for (const effect of effects) {
    if (effect?.type === 'fact' && exact(effect, ['type', 'id', 'value']) && known(definition.facts, effect.id) && scalar(effect.value)) continue;
    if (effect?.type === 'opportunity' && exact(effect, ['type', 'id', 'status']) && known(definition.opportunities, effect.id) && opportunities.includes(effect.status)) continue;
    if (effect?.type === 'knowledge' && exact(effect, ['type', 'id', 'status']) && known(definition.knowledge, effect.id) && knowledgeStatuses.includes(effect.status)) continue;
    if (effect?.type === 'clock_status' && exact(effect, ['type', 'id', 'status']) && known(definition.clocks, effect.id) && statuses.includes(effect.status)) continue;
    // A reviewed mission can reverse a clock. Positive progress uses the clock's
    // rate-limited interval rule so a decision cannot bypass the three-day limit.
    if (effect?.type === 'clock_reverse' && exact(effect, ['type', 'id', 'steps']) && known(definition.clocks, effect.id) && integer(effect.steps, 1, 6)) continue;
    if (effect?.type === 'disclose' && exact(effect, ['type', 'collection', 'id', 'visibility']) && ['entities', 'facts', 'knowledge', 'opportunities', 'clocks'].includes(effect.collection) && known(definition[effect.collection], effect.id)) {
      validateGrants(effect.visibility, currentMembers); continue;
    }
    fail('INVALID', 'Effects must refer to reviewed facts, knowledge, opportunities, or clocks.');
  }
}
function validateDefinition(definition, currentMembers) {
  if (!exact(definition, ['schemaVersion', 'id', 'version', 'calendar', 'maxAdvanceTicks', 'adoption', 'entities', 'facts', 'knowledge', 'opportunities', 'deadlines', 'clocks', 'decisions']) || definition.schemaVersion !== 1 || !id(definition.id) || !id(definition.version)) fail('INVALID', 'Use an explicit version-one time definition.');
  const calendar = definition.calendar;
  if (!exact(calendar, ['label', 'unitLabel', 'ticksPerDay', 'originDay', 'originTick', 'initialTick', 'originLabel']) || !text(calendar.label, 160) || !text(calendar.unitLabel, 80) || !text(calendar.originLabel, 300) || !integer(calendar.ticksPerDay, 1, 1440) || !integer(calendar.originDay, 1, 1_000_000) || !integer(calendar.originTick) || !integer(calendar.initialTick, calendar.originTick) || !integer(definition.maxAdvanceTicks, 1, Math.min(MAX_TICK, calendar.ticksPerDay * 30))) fail('INVALID', 'Review the calendar origin, duration unit, starting point, and bounded interval explicitly.');
  if (!exact(definition.adoption, ['mode', 'reason', 'evidence']) || !['new', 'legacy'].includes(definition.adoption.mode) || !text(definition.adoption.reason, 1000) || !evidence(definition.adoption.evidence)) fail('INVALID', 'Record the reviewed new or legacy adoption point.');
  for (const [name, max] of [['entities', 128], ['facts', 256], ['knowledge', 128], ['opportunities', 64], ['deadlines', 64], ['clocks', 32], ['decisions', 128]]) {
    if (!list(definition[name], max)) fail('INVALID', 'Use bounded distinct time records.');
  }
  for (const entity of definition.entities) {
    if (!exact(entity, ['id', 'label', 'kind', 'visibility']) || !id(entity.id) || !text(entity.label, 160) || !['location', 'region', 'faction', 'npc', 'party', 'character', 'institution', 'route', 'item'].includes(entity.kind)) fail('INVALID', 'Use named, typed world entities.');
    validateGrants(entity.visibility, currentMembers);
  }
  for (const fact of definition.facts) {
    if (!exact(fact, ['id', 'entityId', 'kind', 'label', 'value', 'visibility', 'evidence']) || !id(fact.id) || !known(definition.entities, fact.entityId) || !['condition', 'agreement', 'possession', 'obligation', 'claim'].includes(fact.kind) || !text(fact.label, 160) || !scalar(fact.value) || !evidence(fact.evidence)) fail('INVALID', 'Facts require typed entities, explicit values, and evidence.');
    validateGrants(fact.visibility, currentMembers);
  }
  for (const record of definition.knowledge) {
    if (!exact(record, ['id', 'subjectId', 'factId', 'status', 'visibility', 'evidence']) || !id(record.id) || !known(definition.entities, record.subjectId) || !known(definition.facts, record.factId) || !knowledgeStatuses.includes(record.status) || !evidence(record.evidence)) fail('INVALID', 'Knowledge records require a known subject, fact, status, and source.');
    validateGrants(record.visibility, currentMembers);
  }
  for (const opportunity of definition.opportunities) {
    if (!exact(opportunity, ['id', 'title', 'status', 'visibility', 'evidence']) || !id(opportunity.id) || !text(opportunity.title, 160) || !opportunities.includes(opportunity.status) || !evidence(opportunity.evidence)) fail('INVALID', 'Review each opportunity independently of the selected mission.');
    validateGrants(opportunity.visibility, currentMembers);
  }
  const order = new Set(), ruleIds = new Set();
  function rule(record) {
    if (!id(record.id) || ruleIds.has(record.id) || !text(record.label, 160) || !text(record.summary, 1000) || !evidence(record.evidence) || !conditions(record.when, definition)) fail('INVALID', 'Rules need distinct IDs, supported predicates, evidence, and an authored summary.');
    ruleIds.add(record.id); validateGrants(record.visibility, currentMembers);
  }
  function ordered(record) {
    if (!integer(record.order, 0, 1023) || order.has(record.order)) fail('INVALID', 'Review a distinct ordering for every deadline and clock.');
    order.add(record.order);
  }
  for (const deadline of definition.deadlines) {
    if (!exact(deadline, ['id', 'label', 'opportunityId', 'atTick', 'order', 'when', 'effects', 'summary', 'visibility', 'evidence', 'initialState']) || !known(definition.opportunities, deadline.opportunityId) || !integer(deadline.atTick, calendar.originTick) || !['pending', 'applied', 'skipped'].includes(deadline.initialState) || (deadline.atTick <= calendar.initialTick && deadline.initialState === 'pending') || (deadline.atTick > calendar.initialTick && deadline.initialState !== 'pending')) fail('INVALID', 'Review exact deadline times and explicit dispositions for already elapsed deadlines.');
    rule(deadline); ordered(deadline);
  }
  for (const clock of definition.clocks) {
    if (!exact(clock, ['id', 'label', 'value', 'status', 'periodTicks', 'anchorTick', 'creditTicks', 'accrualPolicy', 'order', 'when', 'thresholds', 'summary', 'visibility', 'evidence']) || !integer(clock.value, 0, 6) || !statuses.includes(clock.status) || clock.periodTicks !== calendar.ticksPerDay * 3 || !integer(clock.anchorTick, calendar.originTick, calendar.initialTick) || !integer(clock.creditTicks, 0, clock.periodTicks - 1) || calendar.initialTick - clock.anchorTick < clock.creditTicks || !['retain', 'reset'].includes(clock.accrualPolicy) || !list(clock.thresholds, 6, 'value') || !clock.when?.length) fail('INVALID', 'Review clock causes, three-day periods, initial accrual anchors, and pause policy.');
    rule(clock); ordered(clock);
    for (const threshold of clock.thresholds) {
      if (!exact(threshold, ['value', 'effects', 'summary', 'visibility', 'evidence', 'initiallyConsumed']) || !integer(threshold.value, 1, 6) || !text(threshold.summary, 1000) || !evidence(threshold.evidence) || typeof threshold.initiallyConsumed !== 'boolean' || (threshold.value <= clock.value && !threshold.initiallyConsumed)) fail('INVALID', 'Review threshold effects and their existing occurrence history.');
      validateGrants(threshold.visibility, currentMembers);
    }
  }
  for (const decision of definition.decisions) {
    if (!exact(decision, ['id', 'label', 'when', 'effects', 'summary', 'visibility', 'evidence', 'initiallyConsumed']) || typeof decision.initiallyConsumed !== 'boolean') fail('INVALID', 'Use explicit, once-only reviewed decisions.');
    rule(decision);
  }
  for (const record of [...definition.deadlines, ...definition.decisions]) validateEffects(record.effects, definition, currentMembers);
  for (const clock of definition.clocks) for (const threshold of clock.thresholds) validateEffects(threshold.effects, definition, currentMembers);
  return clone(definition);
}

export function initializeWorldTime(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS world_time_campaigns(campaign TEXT PRIMARY KEY REFERENCES world_campaigns(campaign),schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,definition_hash TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS world_time_events(campaign TEXT NOT NULL REFERENCES world_time_campaigns(campaign),id TEXT NOT NULL,tick INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,id));
    CREATE TABLE IF NOT EXISTS world_time_occurrences(campaign TEXT NOT NULL REFERENCES world_time_campaigns(campaign),occurrence TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(campaign,occurrence));
    CREATE TABLE IF NOT EXISTS world_time_previews(campaign TEXT NOT NULL REFERENCES world_time_campaigns(campaign),owner TEXT NOT NULL,id TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,used_request TEXT,PRIMARY KEY(campaign,owner,id),UNIQUE(campaign,owner,request));
    CREATE TABLE IF NOT EXISTS world_time_receipts(campaign TEXT NOT NULL REFERENCES world_time_campaigns(campaign),owner TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(campaign,owner,request));`);
}
function requireHost(store, scope) { if (store.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only a current campaign host can review fictional time.'); }
function context(store, scope, required = true) {
  const game = store.load(scope.campaign), row = store.db.prepare('SELECT revision,body FROM world_campaigns WHERE campaign=?').get(scope.campaign);
  if (!row && required) fail('UNCONFIGURED', 'Link the reviewed mission before configuring fictional time.');
  const world = row ? JSON.parse(row.body) : null;
  if (row && world.revision !== row.revision) fail('STATE', 'The world revision record is inconsistent.');
  return { game, world };
}
function loadTime(store, campaign, required = true) {
  const row = store.db.prepare('SELECT * FROM world_time_campaigns WHERE campaign=?').get(campaign);
  if (!row) { if (required) fail('UNCONFIGURED', 'Review a fictional-time definition first.'); return null; }
  const state = JSON.parse(row.body);
  if (row.schema_version !== 1 || state.revision !== row.revision || state.definitionHash !== row.definition_hash) fail('STATE', 'The fictional-time schema or revision record is inconsistent.');
  return state;
}
function envelope(input, extra) {
  if (!exact(input, ['requestId', 'expectedGameRevision', 'expectedWorldRevision', 'expectedTimeRevision', 'reviewed', ...extra]) || !id(input.requestId) || !integer(input.expectedGameRevision, 1, Number.MAX_SAFE_INTEGER) || !integer(input.expectedWorldRevision, 1, Number.MAX_SAFE_INTEGER) || !integer(input.expectedTimeRevision, 0, Number.MAX_SAFE_INTEGER) || input.reviewed !== true) fail('INVALID', 'Confirm the reviewed request with current game, world, and time revisions.');
}
function revisions(input, current, state) {
  if (input.expectedGameRevision !== current.game.revision || input.expectedWorldRevision !== current.world.revision || input.expectedTimeRevision !== (state?.revision ?? 0)) fail('STALE', 'The game, world, or fictional time changed. Refresh the review.');
}
function requireSettled(store, scope, game) {
  if (game.phase === 'paused') fail('PAUSED', 'Fictional time waits while play is paused.');
  if (game.pendingReaction || game.pendingConcentration || game.continuations?.length) fail('PENDING', 'Finish the pending game decision before changing fictional time.');
  if (!['exploration', 'complete'].includes(game.phase)) fail('PHASE', 'This time service supports exploration or completed scenes, not combat advancement.');
  // Current checks survive only pause/resume revisions. Stale or revoked checks
  // cannot indefinitely block the world, but a valid unresolved player roll can.
  const pending = store.db.prepare(`SELECT c.body FROM game_checks c
    JOIN game_members h ON h.campaign=c.campaign AND h.owner=c.host AND h.role='host'
    JOIN game_members p ON p.campaign=c.campaign AND p.owner=json_extract(c.body,'$.owner')
    WHERE c.campaign=? AND c.result IS NULL AND json_type(c.body,'$.expectedRevision')='integer'
      AND json_extract(c.body,'$.expectedRevision') BETWEEN 1 AND ?
      AND ?-json_extract(c.body,'$.expectedRevision')=(SELECT COUNT(*) FROM game_events e WHERE e.campaign=c.campaign AND e.revision>json_extract(c.body,'$.expectedRevision') AND e.revision<=?)
      AND NOT EXISTS (SELECT 1 FROM game_events e WHERE e.campaign=c.campaign AND e.revision>json_extract(c.body,'$.expectedRevision') AND e.revision<=? AND (e.kind IS NULL OR e.kind NOT IN ('pause','resume')))`)
    .all(scope.campaign, game.revision, game.revision, game.revision, game.revision)
    .some(row => { const check = JSON.parse(row.body); return game.actors.some(actor => actor.id === check.actorId && actor.owner === check.owner && actor.hp > 0 && actor.characterVersion === check.characterVersion); });
  if (pending) fail('PENDING', 'Finish the current reviewed player check before changing fictional time.');
}
function replay(store, scope, input, operation) {
  const fingerprint = hash({ operation, input });
  const row = store.db.prepare('SELECT fingerprint,body FROM world_time_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
  if (row && row.fingerprint !== fingerprint) fail('CONFLICT', 'This request ID already records another world-time decision.');
  return { fingerprint, receipt: row ? JSON.parse(row.body) : null };
}
function ready(input, store, scope, required = true) {
  const current = context(store, scope), state = loadTime(store, scope.campaign, required);
  revisions(input, current, state); requireSettled(store, scope, current.game);
  return { ...current, state };
}
function calendarPoint(state) {
  const c = state.definition.calendar, elapsed = state.tick - c.originTick;
  return { label: c.label, unitLabel: c.unitLabel, ticksPerDay: c.ticksPerDay, tick: state.tick, day: c.originDay + Math.floor(elapsed / c.ticksPerDay), tickWithinDay: elapsed % c.ticksPerDay };
}
function occurrenceId(state, occurrence) { return hash([state.campaign, state.definitionHash, occurrence]).slice(0, 32); }
function event(state, occurrence, kind, rule, changes = []) {
  return { id: occurrenceId(state, occurrence), occurrence, kind, tick: state.tick, ruleId: rule.id, summary: rule.summary, visibility: clone(rule.visibility), evidence: clone(rule.evidence), changes };
}
function initialState(campaign, definition) {
  const state = { campaign, revision: 1, definitionHash: hash(definition), definition, tick: definition.calendar.initialTick, entities: clone(definition.entities), facts: clone(definition.facts), knowledge: clone(definition.knowledge), opportunities: clone(definition.opportunities), deadlines: definition.deadlines.map(rule => ({ id: rule.id, status: rule.initialState })), clocks: definition.clocks.map(rule => ({ id: rule.id, value: rule.value, status: rule.status, creditTicks: rule.creditTicks, anchorTick: rule.anchorTick, visibility: clone(rule.visibility) })), consumed: [] };
  for (const deadline of definition.deadlines) if (deadline.initialState !== 'pending') state.consumed.push(`deadline:${deadline.id}`);
  for (const clock of definition.clocks) for (const threshold of clock.thresholds) if (threshold.initiallyConsumed) state.consumed.push(`threshold:${clock.id}:${threshold.value}`);
  for (const decision of definition.decisions) if (decision.initiallyConsumed) state.consumed.push(`decision:${decision.id}`);
  return state;
}
function matches(state, when) {
  for (const condition of when) {
    const fact = known(state.facts, condition.factId);
    if (fact.value === null) fail('REVIEW', 'A causal fact is unknown. Review it before advancing this rule.');
    if (fact.value !== condition.equals) return false;
  }
  return true;
}
function clockActive(state, rule, clock) { return clock.status === 'active' && clock.value < 6 && matches(state, rule.when); }
function effects(state, items, eventId) {
  const changes = [];
  for (const effect of items) {
    let record, field, value;
    if (effect.type === 'fact') { record = known(state.facts, effect.id); field = 'value'; value = effect.value; }
    else if (effect.type === 'opportunity') { record = known(state.opportunities, effect.id); field = 'status'; value = effect.status; }
    else if (effect.type === 'knowledge') { record = known(state.knowledge, effect.id); field = 'status'; value = effect.status; }
    else if (effect.type === 'clock_status') { record = known(state.clocks, effect.id); field = 'status'; value = effect.status; }
    else if (effect.type === 'clock_reverse') { record = known(state.clocks, effect.id); field = 'value'; value = Math.max(0, record.value - effect.steps); }
    else { record = known(state[effect.collection], effect.id); field = 'visibility'; value = clone(effect.visibility); }
    const before = clone(record[field]); record[field] = value; record.sourceEventId = eventId;
    const label = record.label ?? record.title ?? known(state.definition.clocks, effect.id)?.label ?? (record.factId ? `${known(state.entities, record.subjectId).label}: ${known(state.facts, record.factId).label}` : effect.id);
    changes.push({ type: effect.type, id: effect.id, field, label, before, after: clone(value) });
  }
  for (const rule of state.definition.clocks) {
    const clock = known(state.clocks, rule.id);
    const cause = rule.when.every(condition => known(state.facts, condition.factId).value !== null) && matches(state, rule.when);
    if (rule.accrualPolicy === 'reset' && (clock.status !== 'active' || !cause)) { clock.creditTicks = 0; clock.anchorTick = state.tick; }
  }
  return changes;
}
function consume(state, occurrence) { if (!state.consumed.includes(occurrence)) state.consumed.push(occurrence); }
function interval(original, targetTick) {
  const state = clone(original), definition = state.definition, events = [], consumedBefore = new Set(state.consumed);
  if (!integer(targetTick, state.tick + 1) || targetTick - state.tick > definition.maxAdvanceTicks) fail('INVALID', 'Choose a strictly later point within the reviewed maximum interval.');
  let iterations = 0;
  while (state.tick < targetTick || definition.clocks.some(rule => { const clock = known(state.clocks, rule.id); return clock.creditTicks === rule.periodTicks && clockActive(state, rule, clock); })) {
    if (++iterations > MAX_EVENTS + 1 || events.length >= MAX_EVENTS) fail('LIMIT', 'This interval has too many developments. Review a shorter interval.');
    let next = targetTick;
    for (const rule of definition.deadlines) if (known(state.deadlines, rule.id).status === 'pending') next = Math.min(next, rule.atTick);
    const active = new Map();
    for (const rule of definition.clocks) {
      const clock = known(state.clocks, rule.id), enabled = clockActive(state, rule, clock); active.set(rule.id, enabled);
      if (enabled) next = Math.min(next, state.tick + rule.periodTicks - clock.creditTicks);
      else if (rule.accrualPolicy === 'reset') { clock.creditTicks = 0; clock.anchorTick = state.tick; }
    }
    if (next < state.tick) fail('STATE', 'An unconsumed deadline precedes the current calendar.');
    const elapsed = next - state.tick;
    for (const rule of definition.clocks) if (active.get(rule.id)) known(state.clocks, rule.id).creditTicks += elapsed;
    state.tick = next;
    const due = [
      ...definition.deadlines.filter(rule => known(state.deadlines, rule.id).status === 'pending' && rule.atTick === next).map(rule => ({ type: 'deadline', rule })),
      ...definition.clocks.filter(rule => known(state.clocks, rule.id).creditTicks === rule.periodTicks).map(rule => ({ type: 'clock', rule })),
    ].sort((a, b) => a.rule.order - b.rule.order);
    let processed = false;
    for (const item of due) {
      const rule = item.rule;
      if (item.type === 'deadline') {
        const applies = known(state.opportunities, rule.opportunityId).status === 'open' && matches(state, rule.when);
        const occurrence = `deadline:${rule.id}`, record = event(state, occurrence, applies ? 'deadline_applied' : 'deadline_skipped', applies ? rule : { ...rule, summary: 'The reviewed deadline did not apply.', visibility: { audience: 'host', owners: [] } });
        if (applies) record.changes = effects(state, rule.effects, record.id);
        known(state.deadlines, rule.id).status = applies ? 'applied' : 'skipped';
        known(state.deadlines, rule.id).sourceEventId = record.id;
        consume(state, occurrence); events.push(record); processed = true;
      } else {
        const clock = known(state.clocks, rule.id);
        if (clock.creditTicks !== rule.periodTicks || !clockActive(state, rule, clock)) continue;
        const before = clock.value; clock.value++; clock.creditTicks = 0; clock.anchorTick = next;
        const occurrence = `clock:${rule.id}:${next}`, threshold = rule.thresholds.find(value => value.value === clock.value && !state.consumed.includes(`threshold:${rule.id}:${value.value}`));
        const record = event(state, occurrence, 'clock_advanced', threshold ? { ...rule, summary: threshold.summary, visibility: threshold.visibility, evidence: threshold.evidence } : rule, [{ type: 'clock_advance', id: rule.id, label: rule.label, before, after: clock.value }]);
        clock.sourceEventId = record.id;
        if (threshold) { record.thresholdOccurrence = `threshold:${rule.id}:${threshold.value}`; consume(state, record.thresholdOccurrence); record.changes.push(...effects(state, threshold.effects, record.id)); }
        consume(state, occurrence); events.push(record); processed = true;
      }
    }
    if (!elapsed && !processed) fail('STATE', 'The reviewed event ordering did not make progress.');
  }
  return { state, events, occurrences: state.consumed.filter(value => !consumedBefore.has(value)) };
}
function saveState(store, state) {
  store.db.prepare('UPDATE world_time_campaigns SET revision=?,body=? WHERE campaign=?').run(state.revision, JSON.stringify(state), state.campaign);
}
function commitEvents(store, state, events, occurrences, fallbackId) {
  for (const record of events) store.db.prepare('INSERT INTO world_time_events VALUES(?,?,?,?)').run(state.campaign, record.id, record.tick, JSON.stringify({ ...record, timeRevision: state.revision }));
  for (const occurrence of occurrences) store.db.prepare('INSERT INTO world_time_occurrences VALUES(?,?,?)').run(state.campaign, occurrence, events.find(record => record.occurrence === occurrence || record.thresholdOccurrence === occurrence)?.id ?? fallbackId);
}
function publish(store, current, kind) {
  // Existing worldView exposes its entire event payload. Keep all private IDs,
  // summaries, reasons and effect counts solely in the scoped time tables.
  current.world.revision++;
  store.record(current.game, kind, {}); store.save(current.game);
  store.db.prepare('UPDATE world_campaigns SET revision=?,body=? WHERE campaign=?').run(current.world.revision, JSON.stringify(current.world), current.game.campaign);
  store.db.prepare('INSERT INTO world_events VALUES(?,?,?,?)').run(current.game.campaign, current.world.revision, `game:${current.game.campaign}:${current.game.revision}`, JSON.stringify({ type: kind }));
}
function saveReceipt(store, scope, input, fingerprint, current, state, operation, events) {
  const receipt = { requestId: input.requestId, operation, gameRevision: current.game.revision, worldRevision: current.world.revision, timeRevision: state.revision, fromTick: current.state?.tick ?? state.tick, targetTick: state.tick, calendar: calendarPoint(state), events: events.map(record => ({ ...record, timeRevision: state.revision })) };
  store.db.prepare('INSERT INTO world_time_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
  return receipt;
}

/** Explicit new/legacy adoption. Does not infer elapsed time or apply old deadlines. */
export function configureWorldTime(store, scope, rawInput) {
  return store.transaction(() => {
    requireHost(store, scope);
    const input = inputCopy(rawInput); envelope(input, ['definition']);
    const saved = replay(store, scope, input, 'configure'); if (saved.receipt) return saved.receipt;
    const current = ready(input, store, scope, false);
    if (current.state) fail('CONFLICT', 'The installed time definition is immutable; use a reviewed migration.');
    const definition = validateDefinition(input.definition, members(store.db, scope.campaign));
    const state = initialState(scope.campaign, definition), record = event(state, 'adoption', 'time_adopted', { id: definition.id, summary: definition.adoption.reason, visibility: { audience: 'host', owners: [] }, evidence: definition.adoption.evidence });
    for (const name of ['facts', 'knowledge', 'opportunities', 'clocks', 'deadlines']) for (const value of state[name]) value.sourceEventId = record.id;
    store.db.prepare('INSERT INTO world_time_campaigns VALUES(?,?,?,?,?)').run(scope.campaign, 1, state.revision, state.definitionHash, JSON.stringify(state));
    commitEvents(store, state, [record], state.consumed, record.id);
    publish(store, current, 'world_time_configured');
    return saveReceipt(store, scope, input, saved.fingerprint, current, state, 'configure', [record]);
  });
}

/** Saved review only: no dice, calendar advancement, world event, or game revision. */
export function previewWorldTime(store, scope, rawInput) {
  return store.transaction(() => {
    requireHost(store, scope);
    const input = inputCopy(rawInput); envelope(input, ['targetTick', 'reason']);
    if (!text(input.reason, 1000)) fail('INVALID', 'Record why this fictional interval passes.');
    const fingerprint = hash({ operation: 'preview', input });
    const previous = store.db.prepare('SELECT fingerprint,body FROM world_time_previews WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) fail('CONFLICT', 'This preview request already has different timing.'); return JSON.parse(previous.body); }
    const current = ready(input, store, scope), plan = interval(current.state, input.targetTick);
    const previewId = hash([scope.campaign, scope.owner, fingerprint]).slice(0, 32);
    const preview = { previewId, requestId: input.requestId, gameRevision: current.game.revision, worldRevision: current.world.revision, timeRevision: current.state.revision, definitionHash: current.state.definitionHash, fromTick: current.state.tick, targetTick: input.targetTick, reason: input.reason, calendar: calendarPoint(plan.state), events: plan.events, planHash: hash(plan) };
    store.db.prepare('INSERT INTO world_time_previews VALUES(?,?,?,?,?,?,NULL)').run(scope.campaign, scope.owner, previewId, input.requestId, fingerprint, JSON.stringify(preview));
    return preview;
  });
}

/** Confirms one saved host preview; the whole interval and receipt commit once. */
export function advanceWorldTime(store, scope, rawInput) {
  return store.transaction(() => {
    requireHost(store, scope);
    const input = inputCopy(rawInput); envelope(input, ['previewId']);
    if (!id(input.previewId)) fail('INVALID', 'Choose a saved time preview.');
    const saved = replay(store, scope, input, 'advance'); if (saved.receipt) return saved.receipt;
    const current = ready(input, store, scope);
    const row = store.db.prepare('SELECT body,used_request FROM world_time_previews WHERE campaign=? AND owner=? AND id=?').get(scope.campaign, scope.owner, input.previewId);
    if (!row) fail('UNAUTHORIZED', 'Review your own time preview before confirming it.');
    if (row.used_request) fail('CONFLICT', 'This preview already has a committed request.');
    const preview = JSON.parse(row.body);
    if (preview.gameRevision !== current.game.revision || preview.worldRevision !== current.world.revision || preview.timeRevision !== current.state.revision || preview.definitionHash !== current.state.definitionHash || preview.fromTick !== current.state.tick) fail('STALE', 'The saved review no longer describes this world.');
    const plan = interval(current.state, preview.targetTick);
    if (hash(plan) !== preview.planHash) fail('STATE', 'The reviewed interval no longer reproduces its saved event sequence.');
    plan.state.revision++;
    const summary = event(plan.state, `advance:${scope.owner}:${input.requestId}`, 'time_advanced', { id: plan.state.definition.id, summary: preview.reason, visibility: { audience: 'host', owners: [] }, evidence: [`preview:${preview.previewId}`] });
    const events = [...plan.events, summary];
    saveState(store, plan.state); commitEvents(store, plan.state, events, plan.occurrences, summary.id);
    publish(store, current, 'world_time_advanced');
    store.db.prepare('UPDATE world_time_previews SET used_request=? WHERE campaign=? AND owner=? AND id=?').run(input.requestId, scope.campaign, scope.owner, input.previewId);
    return saveReceipt(store, scope, input, saved.fingerprint, current, plan.state, 'advance', events);
  });
}

/** Applies a named reviewed outcome at the current point, never arbitrary deltas. */
export function recordWorldTimeDecision(store, scope, rawInput) {
  return store.transaction(() => {
    requireHost(store, scope);
    const input = inputCopy(rawInput); envelope(input, ['decisionId', 'reason']);
    if (!id(input.decisionId) || !text(input.reason, 1000)) fail('INVALID', 'Select a reviewed decision and its factual reason.');
    const saved = replay(store, scope, input, 'decision'); if (saved.receipt) return saved.receipt;
    const current = ready(input, store, scope), state = current.state;
    const rule = known(state.definition.decisions, input.decisionId), occurrence = `decision:${input.decisionId}`;
    if (!rule) fail('INVALID', 'This decision is not in the installed time definition.');
    if (state.consumed.includes(occurrence)) fail('CONFLICT', 'This authored decision already occurred.');
    if (!matches(state, rule.when)) fail('CONFLICT', 'The reviewed decision prerequisites do not hold.');
    const record = event(state, occurrence, 'decision_recorded', rule);
    record.reviewReason = input.reason; record.changes = effects(state, rule.effects, record.id);
    consume(state, occurrence); state.revision++;
    saveState(store, state); commitEvents(store, state, [record], [occurrence], record.id); publish(store, current, 'world_time_decision_recorded');
    return saveReceipt(store, scope, input, saved.fingerprint, current, state, 'decision', [record]);
  });
}

/** Owner-authorized projection. It never evaluates rules or advances fiction. */
export function worldTimeState(store, scope) {
  return store.transaction(() => {
    const role = store.member(scope), current = context(store, scope, false), state = loadTime(store, scope.campaign, false);
    let blockedReason = role !== 'host' ? 'Only a current campaign host can review fictional time.' : !state ? 'Review the fictional calendar before advancing time.' : null;
    if (!blockedReason) {
      try { requireSettled(store, scope, current.game); }
      catch (error) { if (!['PAUSED', 'PENDING', 'PHASE'].includes(error.code)) throw error; blockedReason = error.message; }
    }
    const base = { configured: !!state, campaign: scope.campaign, owner: scope.owner, role, phase: current.game.phase, canAdvance: blockedReason === null, blockedReason, gameRevision: current.game.revision, worldRevision: current.world?.revision ?? 0, timeRevision: state?.revision ?? 0 };
    if (!state) return base;
    const allEvents = store.db.prepare('SELECT body FROM world_time_events WHERE campaign=? ORDER BY tick,rowid').all(scope.campaign).map(row => JSON.parse(row.body));
    const shownEvents = allEvents.filter(record => visible(record.visibility, scope, role)), eventIds = new Set(shownEvents.map(record => record.id));
    const source = record => eventIds.has(record.sourceEventId) ? { sourceEventId: record.sourceEventId } : {};
    const entities = state.entities.filter(record => visible(record.visibility, scope, role));
    const entityIds = new Set(entities.map(record => record.id));
    const facts = state.facts.filter(record => entityIds.has(record.entityId) && visible(record.visibility, scope, role));
    const factIds = new Set(facts.map(record => record.id));
    const offered = state.opportunities.filter(record => visible(record.visibility, scope, role));
    const offeredIds = new Set(offered.map(record => record.id));
    const result = {
      ...base, calendar: calendarPoint(state),
      entities: entities.map(({ id, label, kind }) => ({ id, label, kind })),
      facts: facts.map(record => ({ id: record.id, entityId: record.entityId, kind: record.kind, label: record.label, value: record.value, ...source(record) })),
      knowledge: state.knowledge.filter(record => entityIds.has(record.subjectId) && factIds.has(record.factId) && visible(record.visibility, scope, role)).map(record => ({ id: record.id, subjectId: record.subjectId, factId: record.factId, status: record.status, ...source(record) })),
      opportunities: offered.map(record => ({ id: record.id, title: record.title, status: record.status, ...source(record) })),
      deadlines: state.definition.deadlines.filter(rule => offeredIds.has(rule.opportunityId) && visible(rule.visibility, scope, role)).map(rule => ({ id: rule.id, label: rule.label, opportunityId: rule.opportunityId, atTick: rule.atTick, status: known(state.deadlines, rule.id).status, ...source(known(state.deadlines, rule.id)) })),
      clocks: state.clocks.filter(record => visible(record.visibility, scope, role)).map(record => ({ id: record.id, label: known(state.definition.clocks, record.id).label, value: record.value, maximum: 6, status: record.status, ...source(record) })),
      events: role === 'host' ? shownEvents : shownEvents.map(record => ({ id: record.id, tick: record.tick, kind: record.kind, summary: record.summary })),
    };
    if (role === 'host') {
      result.definition = clone(state.definition);
      result.runtime = { consumed: clone(state.consumed), clocks: clone(state.clocks) };
      result.decisionOptions = state.definition.decisions.map(rule => {
        let unavailableReason = blockedReason;
        if (!unavailableReason && state.consumed.includes(`decision:${rule.id}`)) unavailableReason = 'This reviewed decision already occurred.';
        if (!unavailableReason) {
          try { if (!matches(state, rule.when)) unavailableReason = 'The reviewed prerequisites do not hold.'; }
          catch (error) { if (error.code !== 'REVIEW') throw error; unavailableReason = error.message; }
        }
        return { id: rule.id, label: rule.label, summary: rule.summary, available: unavailableReason === null, unavailableReason, consequences: effects(clone(state), rule.effects, occurrenceId(state, `decision:${rule.id}`)), evidence: clone(rule.evidence) };
      });
      result.receipts = store.db.prepare('SELECT body FROM world_time_receipts WHERE campaign=? AND owner=? ORDER BY rowid DESC LIMIT 20').all(scope.campaign, scope.owner).map(row => JSON.parse(row.body));
    }
    return result;
  });
}

/** Read-only semantic backup validation. Historical owner grants remain valid
 * records even after revocation; this is not an authorization or signature proof. */
export function validateWorldTimePersistence(db) {
  try {
    const names = ['world_time_campaigns', 'world_time_events', 'world_time_occurrences', 'world_time_previews', 'world_time_receipts'];
    const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const gameMarkers = existing.has('game_events') ? db.prepare("SELECT campaign,revision,kind,body FROM game_events WHERE kind GLOB 'world_time_*'").all() : [];
    const worldMarkers = existing.has('world_events') ? db.prepare("SELECT campaign,revision,source,body FROM world_events WHERE json_extract(body,'$.type') GLOB 'world_time_*'").all() : [];
    const present = names.filter(name => existing.has(name));
    if (!present.length) {
      if (gameMarkers.length || worldMarkers.length) fail('STATE', 'World-time history exists but its persistence tables are missing.');
      return { campaigns: 0, events: 0, receipts: 0, previews: 0 };
    }
    if (present.length !== names.length) fail('STATE', 'The world-time table set is incomplete.');
    const rows = db.prepare('SELECT * FROM world_time_campaigns ORDER BY campaign').all(), campaigns = new Set(rows.map(row => row.campaign));
    for (const name of names.slice(1)) for (const row of db.prepare(`SELECT DISTINCT campaign FROM ${name}`).all()) if (!campaigns.has(row.campaign)) fail('STATE', 'A world-time record has no campaign state.');
    if ([...gameMarkers, ...worldMarkers].some(row => !campaigns.has(row.campaign))) fail('STATE', 'World-time publication exists without its campaign state.');
    const counts = { campaigns: rows.length, events: 0, receipts: 0, previews: 0 }, expectedGameMarkers = new Set(), expectedWorldMarkers = new Set();
    const same = (actual, expected, message) => { if (hash(actual) !== hash(expected)) fail('STATE', message); };
    for (const row of rows) {
      const stored = JSON.parse(row.body);
      if (!id(row.campaign) || row.schema_version !== 1 || stored.campaign !== row.campaign || stored.revision !== row.revision || stored.definitionHash !== row.definition_hash || hash(stored.definition) !== row.definition_hash) fail('STATE', 'The time definition, schema, or state revision is inconsistent.');
      // Definition validation still checks syntax and references. A historical
      // visibility grant is not invalid merely because its owner was removed.
      const historicalOwners = new Set();
      const collectOwners = value => {
        if (!value || typeof value !== 'object') return;
        if (visibility(value)) for (const owner of value.owners) historicalOwners.add(owner);
        for (const child of Object.values(value)) collectOwners(child);
      };
      collectOwners(stored.definition);
      const definition = validateDefinition(stored.definition, historicalOwners);
      const receiptRows = db.prepare('SELECT * FROM world_time_receipts WHERE campaign=?').all(row.campaign).map(value => ({ ...value, receipt: JSON.parse(value.body) })).sort((a, b) => a.receipt.timeRevision - b.receipt.timeRevision);
      const previewRows = db.prepare('SELECT * FROM world_time_previews WHERE campaign=?').all(row.campaign).map(value => ({ ...value, preview: JSON.parse(value.body) }));
      const byPreview = new Map(previewRows.map(value => [`${value.owner}:${value.id}`, value]));
      const stateHistory = new Map(), expectedEvents = new Map(), expectedOccurrences = new Map();
      let state = null, previousGameRevision = 0, previousWorldRevision = 0;
      function includeEvents(events, occurrences, fallbackId) {
        for (const record of events) {
          if (expectedEvents.has(record.id)) fail('STATE', 'An event ID was reused.');
          expectedEvents.set(record.id, { ...record, timeRevision: state.revision });
        }
        for (const occurrence of occurrences) {
          if (expectedOccurrences.has(occurrence)) fail('STATE', 'A logical occurrence was consumed twice.');
          expectedOccurrences.set(occurrence, events.find(record => record.occurrence === occurrence || record.thresholdOccurrence === occurrence)?.id ?? fallbackId);
        }
      }
      for (const saved of receiptRows) {
        const receipt = saved.receipt;
        if (!id(saved.owner) || !id(saved.request) || receipt.requestId !== saved.request || !integer(receipt.gameRevision, 2, Number.MAX_SAFE_INTEGER) || !integer(receipt.worldRevision, 2, Number.MAX_SAFE_INTEGER) || !integer(receipt.timeRevision, 1, Number.MAX_SAFE_INTEGER) || receipt.timeRevision !== (state?.revision ?? 0) + 1 || receipt.gameRevision <= previousGameRevision || receipt.worldRevision <= previousWorldRevision) fail('STATE', 'World-time receipts do not form a complete ordered history.');
        let input = { requestId: saved.request, expectedGameRevision: receipt.gameRevision - 1, expectedWorldRevision: receipt.worldRevision - 1, expectedTimeRevision: receipt.timeRevision - 1, reviewed: true }, events, occurrences, fromTick;
        if (receipt.operation === 'configure') {
          if (state) fail('STATE', 'A time definition was configured more than once.');
          input.definition = definition;
          state = initialState(row.campaign, clone(definition)); fromTick = state.tick;
          const record = event(state, 'adoption', 'time_adopted', { id: definition.id, summary: definition.adoption.reason, visibility: { audience: 'host', owners: [] }, evidence: definition.adoption.evidence });
          for (const name of ['facts', 'knowledge', 'opportunities', 'clocks', 'deadlines']) for (const value of state[name]) value.sourceEventId = record.id;
          events = [record]; occurrences = clone(state.consumed);
        } else if (receipt.operation === 'advance') {
          if (!state) fail('STATE', 'A time advance has no reviewed adoption.');
          const matching = previewRows.filter(value => value.owner === saved.owner && value.used_request === saved.request);
          if (matching.length !== 1) fail('STATE', 'A committed advance requires exactly one owned used preview.');
          const review = matching[0].preview;
          if (review.gameRevision !== input.expectedGameRevision || review.worldRevision !== input.expectedWorldRevision || review.timeRevision !== input.expectedTimeRevision || review.fromTick !== state.tick || review.definitionHash !== state.definitionHash) fail('STATE', 'An advance does not match the revisions of its saved preview.');
          input.previewId = matching[0].id; fromTick = state.tick;
          const plan = interval(state, review.targetTick);
          if (hash(plan) !== review.planHash) fail('STATE', 'A committed preview does not reproduce its interval.');
          state = plan.state; state.revision++;
          const summary = event(state, `advance:${saved.owner}:${saved.request}`, 'time_advanced', { id: state.definition.id, summary: review.reason, visibility: { audience: 'host', owners: [] }, evidence: [`preview:${review.previewId}`] });
          events = [...plan.events, summary]; occurrences = plan.occurrences;
        } else if (receipt.operation === 'decision') {
          if (!state || !Array.isArray(receipt.events) || receipt.events.length !== 1) fail('STATE', 'A reviewed decision has no valid prior state.');
          const supplied = receipt.events[0], rule = known(definition.decisions, supplied.ruleId);
          if (!rule || !text(supplied.reviewReason, 1000)) fail('STATE', 'A decision receipt does not identify its reviewed rule and reason.');
          input.decisionId = rule.id; input.reason = supplied.reviewReason; fromTick = state.tick;
          const occurrence = `decision:${rule.id}`;
          if (state.consumed.includes(occurrence) || !matches(state, rule.when)) fail('STATE', 'A reviewed decision repeats or contradicts its prerequisites.');
          const record = event(state, occurrence, 'decision_recorded', rule);
          record.reviewReason = supplied.reviewReason; record.changes = effects(state, rule.effects, record.id);
          consume(state, occurrence); state.revision++; events = [record]; occurrences = [occurrence];
        } else fail('STATE', 'A world-time receipt has an unsupported operation.');
        same(saved.fingerprint, hash({ operation: receipt.operation, input }), 'The original world-time request fingerprint is inconsistent.');
        const expected = { requestId: saved.request, operation: receipt.operation, gameRevision: receipt.gameRevision, worldRevision: receipt.worldRevision, timeRevision: state.revision, fromTick, targetTick: state.tick, calendar: calendarPoint(state), events: events.map(record => ({ ...record, timeRevision: state.revision })) };
        same(receipt, expected, 'A world-time receipt differs from its deterministic result.');
        includeEvents(events, occurrences, events.at(-1).id);
        stateHistory.set(state.revision, { state: clone(state), gameRevision: receipt.gameRevision, worldRevision: receipt.worldRevision });
        previousGameRevision = receipt.gameRevision; previousWorldRevision = receipt.worldRevision;
        const kind = { configure: 'world_time_configured', advance: 'world_time_advanced', decision: 'world_time_decision_recorded' }[receipt.operation];
        const gameMarker = gameMarkers.find(value => value.campaign === row.campaign && value.revision === receipt.gameRevision);
        const worldMarker = worldMarkers.find(value => value.campaign === row.campaign && value.revision === receipt.worldRevision);
        if (!gameMarker || gameMarker.kind !== kind || !worldMarker || worldMarker.source !== `game:${row.campaign}:${receipt.gameRevision}`) fail('STATE', 'A world-time commit is missing its game or world publication.');
        same(JSON.parse(gameMarker.body), {}, 'A generic game time event contains unexpected data.');
        same(JSON.parse(worldMarker.body), { type: kind }, 'A generic world time event contains unexpected data.');
        expectedGameMarkers.add(`${row.campaign}:${receipt.gameRevision}`); expectedWorldMarkers.add(`${row.campaign}:${receipt.worldRevision}`);
      }
      if (!state) fail('STATE', 'A time campaign has no immutable adoption receipt.');
      same(stored, state, 'The current time projection does not reproduce from its committed history.');
      const gameHead = db.prepare('SELECT revision FROM game_campaigns WHERE id=?').get(row.campaign), worldHead = db.prepare('SELECT revision FROM world_campaigns WHERE campaign=?').get(row.campaign);
      if (!gameHead || !worldHead || gameHead.revision < previousGameRevision || worldHead.revision < previousWorldRevision) fail('STATE', 'The current game or world precedes its committed time history.');
      const actualEvents = db.prepare('SELECT * FROM world_time_events WHERE campaign=?').all(row.campaign);
      if (actualEvents.length !== expectedEvents.size) fail('STATE', 'The time event history is incomplete or contains unexpected events.');
      for (const actual of actualEvents) {
        const expected = expectedEvents.get(actual.id);
        if (!expected || actual.tick !== expected.tick) fail('STATE', 'A time event ID or indexed fictional point is inconsistent.');
        same(JSON.parse(actual.body), expected, 'A time event differs from its deterministic history.');
      }
      const actualOccurrences = db.prepare('SELECT * FROM world_time_occurrences WHERE campaign=?').all(row.campaign);
      if (actualOccurrences.length !== expectedOccurrences.size) fail('STATE', 'The consumed occurrence history is incomplete.');
      for (const actual of actualOccurrences) if (expectedOccurrences.get(actual.occurrence) !== actual.event_id) fail('STATE', 'An occurrence points to the wrong causal event.');
      for (const saved of previewRows) {
        const review = saved.preview, historical = stateHistory.get(review.timeRevision);
        if (!id(saved.owner) || !id(saved.request) || !historical || review.requestId !== saved.request || review.previewId !== saved.id || !integer(review.gameRevision, historical.gameRevision, gameHead.revision) || !integer(review.worldRevision, historical.worldRevision, worldHead.revision) || review.fromTick !== historical.state.tick || review.definitionHash !== historical.state.definitionHash || !text(review.reason, 1000)) fail('STATE', 'A saved time preview has invalid identity or historical context.');
        const following = stateHistory.get(review.timeRevision + 1);
        if (following && (review.gameRevision >= following.gameRevision || review.worldRevision >= following.worldRevision)) fail('STATE', 'A preview crossed another committed time revision.');
        const input = { requestId: saved.request, expectedGameRevision: review.gameRevision, expectedWorldRevision: review.worldRevision, expectedTimeRevision: review.timeRevision, reviewed: true, targetTick: review.targetTick, reason: review.reason };
        const fingerprint = hash({ operation: 'preview', input }), previewId = hash([row.campaign, saved.owner, fingerprint]).slice(0, 32), plan = interval(historical.state, review.targetTick);
        same(saved.fingerprint, fingerprint, 'A saved preview request fingerprint is inconsistent.');
        const expected = { previewId, requestId: saved.request, gameRevision: review.gameRevision, worldRevision: review.worldRevision, timeRevision: review.timeRevision, definitionHash: historical.state.definitionHash, fromTick: historical.state.tick, targetTick: review.targetTick, reason: review.reason, calendar: calendarPoint(plan.state), events: plan.events, planHash: hash(plan) };
        same(review, expected, 'A saved time preview does not reproduce its reviewed plan.');
        if (saved.used_request !== null) {
          const receipt = receiptRows.find(value => value.owner === saved.owner && value.request === saved.used_request);
          if (!receipt || receipt.receipt.operation !== 'advance' || receipt.receipt.timeRevision !== review.timeRevision + 1) fail('STATE', 'A used preview has no corresponding advance receipt.');
        }
      }
      // The map also catches duplicate composite identity if a malformed backup
      // removed the expected uniqueness constraints.
      if (byPreview.size !== previewRows.length) fail('STATE', 'A private preview identity is duplicated.');
      counts.events += actualEvents.length; counts.receipts += receiptRows.length; counts.previews += previewRows.length;
    }
    if (gameMarkers.length !== expectedGameMarkers.size || worldMarkers.length !== expectedWorldMarkers.size) fail('STATE', 'A generic time publication has no matching committed receipt.');
    return counts;
  } catch (error) {
    if (error instanceof WorldTimeError && error.code === 'STATE') throw error;
    fail('STATE', 'World-time persistence failed schema or deterministic history validation.');
  }
}
