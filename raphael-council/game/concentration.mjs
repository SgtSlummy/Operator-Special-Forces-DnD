import { createHash, randomBytes } from 'node:crypto';
import { validateCombatCapabilities, concentrationSaveDC } from './combat-profile.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const opaque = () => randomBytes(16).toString('hex');
const copy = value => structuredClone(value);
const controls = (actor, owner, role) => !!actor && (actor.owner === owner || (actor.owner === null && role === 'host'));
const fail = (ErrorType, code, message) => { const error = ErrorType ? new ErrorType(code, message) : Object.assign(new Error(message), { code }); throw error; };
const invalid = message => fail(null, 'INVALID', message);

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Use an explicit concentration record.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value')) || keys.some(key => !Object.hasOwn(descriptors, key))) invalid('Concentration fields are missing or unsupported.');
}
function label(value, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) invalid('Provide a bounded nonempty reviewed source label or reason.');
  return value.trim();
}
function profile(value) {
  const normalized = validateCombatCapabilities({ attackKind: 'ranged', constitutionSave: value });
  return normalized.constitutionSave;
}
function actorProfile(actor) {
  const normalized = validateCombatCapabilities(actor.combatCapabilities)?.constitutionSave;
  if (!normalized || (actor.owner !== null && (typeof actor.combatReview?.constitutionProficiencyReason !== 'string' || !actor.combatReview.constitutionProficiencyReason.trim()))) invalid('A reviewed Constitution saving throw profile is required.');
  return normalized;
}
function profileFingerprint(actor) {
  return hash({ characterVersion: actor.characterVersion, profile: actorProfile(actor), combatReview: actor.combatReview ?? null });
}
function effectFingerprint(effect) {
  // Trigger marks change during normal play; they are not effect identity.
  return hash({ id: effect.id, name: effect.name, trigger: effect.trigger, damage: effect.damage, expiresAtTurn: effect.expiresAtTurn, cells: effect.cells });
}
function normalizeSource(input) {
  object(input, ['id', 'actorId', 'owner', 'characterVersion', 'sourceLabel', 'profile', 'profileFingerprint', 'effects', 'review']);
  if (![input.id, input.actorId, input.characterVersion].every(id) || (input.owner !== null && !id(input.owner)) || !digest(input.profileFingerprint)) invalid('Concentration must be bound to an actor and reviewed profile.');
  if (!Array.isArray(input.effects) || input.effects.length > 128) invalid('Use a bounded effect binding list.');
  const effects = Array.from(input.effects, effect => { object(effect, ['id', 'fingerprint']); if (!id(effect.id) || !digest(effect.fingerprint)) invalid('Use exact effect bindings.'); return { ...effect }; });
  if (new Set(effects.map(effect => effect.id)).size !== effects.length) invalid('Effect bindings must be distinct.');
  object(input.review, ['owner', 'reason', 'revision']);
  if (!id(input.review.owner) || !integer(input.review.revision)) invalid('A host review identity and revision are required.');
  return { id: input.id, actorId: input.actorId, owner: input.owner, characterVersion: input.characterVersion, sourceLabel: label(input.sourceLabel), profile: profile(input.profile), profileFingerprint: input.profileFingerprint, effects, review: { owner: input.review.owner, reason: label(input.review.reason, 300), revision: input.review.revision } };
}

/** Validate an optional trusted seed/restored actor record without inferring a source. */
export function validateConcentrationRecord(input, actor, effects) {
  if (input === undefined) return undefined;
  const source = normalizeSource(input);
  if (source.actorId !== actor.id || source.owner !== actor.owner || source.characterVersion !== actor.characterVersion || source.profileFingerprint !== profileFingerprint(actor) || hash(source.profile) !== hash(actorProfile(actor))) invalid('Concentration no longer matches its reviewed actor profile.');
  if (effects && !source.effects.every(binding => effects.some(effect => effect.id === binding.id && effectFingerprint(effect) === binding.fingerprint))) invalid('A concentration effect binding is unavailable or changed.');
  return source;
}

function serializableOrigin(origin) {
  const visit = (value, depth = 0) => {
    if (depth > 6) invalid('Damage origin is too deeply nested.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 1000 || typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (Array.isArray(value) && value.length <= 32) return Array.from(value, entry => visit(entry, depth + 1));
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (keys.length > 24 || keys.some(key => typeof key !== 'string' || key.length > 96 || !Object.hasOwn(descriptors[key], 'value'))) invalid('Damage origin must contain plain data.');
      return Object.fromEntries(keys.map(key => [key, visit(descriptors[key].value, depth + 1)]));
    }
    invalid('Damage origin must contain bounded JSON data.');
  };
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) invalid('A server-created damage origin is required.');
  const result = visit(origin);
  if (JSON.stringify(result).length > 6000) invalid('Damage origin is too large.');
  return result;
}
/** Structural persistence validation; current actor authority is checked separately. */
// Restore checks the saved schema, not current authority. A revoked owner or an
// expired/replaced effect is legitimate state for the existing recovery workflow.
export function validateConcentrationPersistence(state) {
  const reject = message => { throw Object.assign(new Error(message), { code: 'CONCENTRATION' }); };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
  const coordinate = value => exact(value, ['x', 'y']) && Number.isInteger(value.x) && value.x >= 0 && value.x < 64 && Number.isInteger(value.y) && value.y >= 0 && value.y < 64;
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const sources = new Set(), effects = new Set();
  if (!plain(state) || !Array.isArray(state.actors)) reject('The saved concentration state needs actors.');
  for (const actor of state.actors) {
    if (actor.concentration === undefined) continue;
    const source = normalizeSource(actor.concentration);
    if (source.actorId !== actor.id || sources.has(source.id) || source.effects.some(effect => effects.has(effect.id))) reject('Saved concentration sources and effects must have distinct actor bindings.');
    sources.add(source.id);
    for (const effect of source.effects) effects.add(effect.id);
  }
  if (state.pendingConcentration !== undefined) {
    const pending = validatePendingConcentrationRecord(state.pendingConcentration);
    if (pending.campaign !== state.campaign) reject('The saved concentration request belongs to another campaign.');
  }
  if (state.continuations === undefined) return;
  if (!Array.isArray(state.continuations) || state.continuations.length > 512) reject('Use a bounded saved continuation stack.');
  const frameIds = new Set();
  const contextFields = ['id', 'kind', 'actorId', 'characterVersion', 'owner', 'mapId', 'turn', 'phase', 'from'];
  for (const frame of state.continuations) {
    if (!plain(frame)) reject('Saved continuations need a known record shape.');
    if (frame.kind === 'reaction') {
      const identity = `reaction:${frame.pendingId}`;
      if (!exact(frame, ['kind', 'pendingId']) || !id(frame.pendingId) || frame.pendingId !== state.pendingReaction?.id || frameIds.has(identity)) reject('The saved reaction continuation needs its distinct pending request.');
      frameIds.add(identity);
      continue;
    }
    if (typeof frame.id !== 'string' || !frame.id.length || frame.id.length > 192 || frameIds.has(frame.id)) reject('Saved continuations need distinct bounded identities.');
    frameIds.add(frame.id);
    const extraFields = frame.kind === 'effects' ? ['trigger', 'entryFrom', 'remaining'] : frame.kind === 'move' ? ['scope', 'requestId', 'path', 'movedPath'] : ['start_effects_done', 'end_turn_done', 'checked_damage_done'].includes(frame.kind) ? [] : null;
    if (extraFields === null || !exact(frame, [...contextFields, ...extraFields])) reject('Unknown or malformed saved continuation kind.');
    if (![frame.actorId, frame.characterVersion, frame.mapId].every(id) || (frame.owner !== null && !id(frame.owner)) || !Number.isSafeInteger(frame.turn) || frame.turn < 1 || !['combat', 'exploration'].includes(frame.phase) || !coordinate(frame.from)) reject('The saved continuation has invalid actor context.');
    if (frame.kind === 'effects') {
      if (!['enter', 'start_turn', 'end_turn'].includes(frame.trigger) || (frame.entryFrom !== null && !coordinate(frame.entryFrom)) || !Array.isArray(frame.remaining) || !frame.remaining.length || frame.remaining.length > 128 || !frame.remaining.every(effect => exact(effect, ['id', 'fingerprint']) && id(effect.id) && digest(effect.fingerprint)) || new Set(frame.remaining.map(effect => effect.id)).size !== frame.remaining.length) reject('The saved hazard continuation has invalid remaining effects.');
    } else if (frame.kind === 'move') {
      if (!plain(frame.scope) || frame.scope.campaign !== state.campaign || !id(frame.scope.owner) || !id(frame.requestId) || !Array.isArray(frame.path) || !frame.path.length || frame.path.length > 24 || !frame.path.every(coordinate) || !Array.isArray(frame.movedPath) || frame.movedPath.length > 24 || !frame.movedPath.every(coordinate) || frame.path.length + frame.movedPath.length > 24) reject('The saved movement continuation has invalid scope or route.');
    }
  }
}

export function validatePendingConcentrationRecord(input) {
  if (input === undefined) return undefined;
  object(input, ['id', 'campaign', 'mapId', 'turn', 'actorId', 'owner', 'characterVersion', 'concentrationId', 'profile', 'profileFingerprint', 'source', 'sourceFingerprint', 'damageTaken', 'dc', 'origin', 'originFingerprint']);
  if (![input.id, input.campaign, input.mapId, input.actorId, input.characterVersion, input.concentrationId].every(id) || (input.owner !== null && !id(input.owner)) || !integer(input.turn) || !integer(input.damageTaken) || input.damageTaken === 0 || input.dc !== concentrationSaveDC(input.damageTaken)) invalid('The saved concentration damage identity or DC is invalid.');
  const source = normalizeSource(input.source), saveProfile = profile(input.profile), origin = serializableOrigin(input.origin);
  if (source.id !== input.concentrationId || source.actorId !== input.actorId || source.owner !== input.owner || source.characterVersion !== input.characterVersion || hash(source) !== input.sourceFingerprint || source.profileFingerprint !== input.profileFingerprint || hash(source.profile) !== hash(saveProfile) || hash(origin) !== input.originFingerprint) invalid('The saved concentration source or damage packet changed.');
  return { ...input, profile: saveProfile, source, origin };
}
function boundElsewhere(state, source, effectId) {
  return state.actors.some(actor => actor.concentration && hash(actor.concentration) !== hash(source) && actor.concentration.effects?.some(binding => binding.id === effectId));
}
function removeSource(state, source) {
  const removed = [];
  state.effects = state.effects.filter(effect => {
    const matches = source.effects.some(binding => binding.id === effect.id && binding.fingerprint === effectFingerprint(effect));
    if (matches && !boundElsewhere(state, source, effect.id)) { removed.push(effect.id); return false; }
    return true;
  });
  const actor = state.actors.find(item => item.id === source.actorId);
  if (actor?.concentration && hash(actor.concentration) === hash(source)) delete actor.concentration;
  return removed;
}
function eligible(state, pending, store) {
  try {
    validatePendingConcentrationRecord(pending);
    const actor = state.actors.find(item => item.id === pending.actorId);
    if (!actor || actor.hp <= 0 || actor.incapacitated === true || actor.owner !== pending.owner || actor.characterVersion !== pending.characterVersion || pending.campaign !== state.campaign || pending.mapId !== state.map.id || pending.turn !== state.turn) return false;
    const source = validateConcentrationRecord(actor.concentration, actor, state.effects);
    if (!source || source.id !== pending.concentrationId || hash(source) !== pending.sourceFingerprint || pending.profileFingerprint !== profileFingerprint(actor) || hash(pending.profile) !== hash(source.profile)) return false;
    if (source.effects.some(binding => boundElsewhere(state, source, binding.id))) return false;
    if (store) {
      if (actor.owner !== null && !store.db.prepare('SELECT 1 FROM game_members WHERE campaign=? AND owner=?').get(state.campaign, actor.owner)) return false;
      if (!store.db.prepare("SELECT 1 FROM game_members WHERE campaign=? AND owner=? AND role='host'").get(state.campaign, source.review.owner)) return false;
    }
    return true;
  } catch { return false; }
}

/** Called once after the HP write, before its first snapshot. Never writes HP, events, or receipts. */
export function concentrationDamage(store, state, actor, damageTaken, origin) {
  concentrationSaveDC(damageTaken);
  if (!actor.concentration || damageTaken === 0) return false;
  const source = normalizeSource(actor.concentration);
  if (actor.hp <= 0 || actor.incapacitated === true) {
    removeSource(state, source);
    if (state.pendingConcentration?.concentrationId === source.id) delete state.pendingConcentration;
    return false;
  }
  const damageOrigin = serializableOrigin(origin), originFingerprint = hash(damageOrigin);
  if (state.pendingConcentration) fail(null, 'PENDING', 'Resolve the pending concentration save before another damage packet.');
  state.pendingConcentration = { id: opaque(), campaign: state.campaign, mapId: state.map.id, turn: state.turn, actorId: actor.id, owner: source.owner, characterVersion: source.characterVersion, concentrationId: source.id, profile: copy(source.profile), profileFingerprint: source.profileFingerprint, source, sourceFingerprint: hash(source), damageTaken, dc: concentrationSaveDC(damageTaken), origin: damageOrigin, originFingerprint };
  validatePendingConcentrationRecord(state.pendingConcentration);
  return true;
}

function pendingProjection(state, owner, role, store) {
  const pending = validatePendingConcentrationRecord(state.pendingConcentration);
  if (!pending) return null;
  const paused = state.phase === 'paused', actor = state.actors.find(item => item.id === pending.actorId), available = eligible(state, pending, store);
  const privateView = controls(actor, owner, role) && actor.owner === pending.owner;
  const result = { waiting: true, paused, canResolve: false, canEnd: false, canRefresh: role === 'host' && !paused && !available };
  if (result.canRefresh) result.id = pending.id;
  if (!privateView) return result;
  return { ...result, id: pending.id, actorId: actor.id, actorName: actor.name, concentrationId: pending.concentrationId, sourceLabel: pending.source.sourceLabel, damageTaken: pending.damageTaken, dc: pending.dc, profile: copy(pending.profile), canResolve: !paused && available, canEnd: !paused && actor.concentration?.id === pending.concentrationId, ...(available ? {} : { recoveryRequired: true }) };
}

export function concentrationProjection(state, owner, role, visibleActors) {
  void visibleActors;
  const projection = pendingProjection(state, owner, role);
  // Historical snapshots describe the wait. Only the current store-backed query
  // can authorize decisions against current membership and reviewer authority.
  if (projection) for (const key of ['canResolve', 'canEnd', 'canRefresh']) delete projection[key];
  return projection;
}
function savedAuthority(state, role, owner, action, result) {
  if (action === 'start' || action === 'refresh') return role === 'host';
  return controls(state.actors.find(actor => actor.id === result.actorId), owner, role);
}
export function concentrationState(store, scope, project) {
  return store.transaction(() => {
    const role = store.member(scope), state = store.load(scope.campaign), view = project(state, scope.owner, role);
    const actors = state.actors.filter(actor => controls(actor, scope.owner, role)).map(actor => {
      let ready = actor.hp > 0 && actor.incapacitated !== true;
      try { actorProfile(actor); } catch { ready = false; }
      return { id: actor.id, name: actor.name, characterVersion: actor.characterVersion, eligible: ready, concentration: actor.concentration ? copy(actor.concentration) : null };
    });
    const bound = new Set(state.actors.flatMap(actor => actor.concentration?.effects?.map(effect => effect.id) ?? []));
    const recentResults = store.db.prepare("SELECT body FROM game_receipts WHERE campaign=? AND owner=? AND json_extract(body,'$.result.type') IN ('concentration_started','concentration_ended','concentration_save','concentration_refreshed') ORDER BY rowid DESC LIMIT 20").all(scope.campaign, scope.owner).map(row => JSON.parse(row.body)).filter(receipt => savedAuthority(state, role, scope.owner, receipt.result.action, receipt.result));
    const registrationActors = role === 'host' ? state.actors.flatMap(actor => {
      if (actor.hp <= 0 || actor.incapacitated === true || (actor.owner !== null && !store.db.prepare('SELECT 1 FROM game_members WHERE campaign=? AND owner=?').get(state.campaign, actor.owner))) return [];
      try { actorProfile(actor); } catch { return []; }
      return [{ id: actor.id, name: actor.name, characterVersion: actor.characterVersion }];
    }) : [];
    return { revision: view.revision, role, phase: state.phase, pendingReaction: Boolean(state.pendingReaction), registrationActors, actors, effects: role === 'host' ? state.effects.filter(effect => !bound.has(effect.id)).map(effect => ({ id: effect.id, name: effect.name })) : [], pending: pendingProjection(state, scope.owner, role, store), recentResults };
  });
}

function commandInput(input) {
  const extra = { start: ['actorId', 'characterVersion', 'sourceLabel', 'effectIds', 'reviewed', 'reason'], end: ['actorId'], resolve: ['pendingId'], refresh: ['pendingId', 'reviewed', 'reason'] };
  if (!input || !Object.hasOwn(extra, input.action)) invalid('Choose a supported concentration command.');
  object(input, ['requestId', 'expectedRevision', 'action', ...extra[input.action]]);
  if (!id(input.requestId) || !integer(input.expectedRevision)) invalid('Use a stable request and current revision.');
  if (['start', 'end'].includes(input.action) && !id(input.actorId) || ['resolve', 'refresh'].includes(input.action) && !id(input.pendingId)) invalid('Use an exact actor or pending save identity.');
  if (['start', 'refresh'].includes(input.action)) { if (input.reviewed !== true) invalid('Explicit host review is required.'); label(input.reason, 300); }
  if (input.action === 'start') {
    if (!id(input.characterVersion)) invalid('Use the reviewed character version.');
    label(input.sourceLabel);
    if (!Array.isArray(input.effectIds) || input.effectIds.length > 128 || !Array.from(input.effectIds).every(id) || new Set(input.effectIds).size !== input.effectIds.length) invalid('Bind a distinct bounded list of existing effects.');
  }
}
function resume(store, state, ErrorType) {
  if (typeof store.drainContinuations !== 'function') fail(ErrorType, 'CONFLICT', 'Concentration continuation recovery is unavailable.');
  store.drainContinuations(state);
}

export function concentrationCommand(store, scope, input, ErrorType) {
  commandInput(input);
  const fingerprint = hash({ type: 'concentration', ...input });
  return store.transaction(() => {
    const role = store.member(scope), state = store.load(scope.campaign);
    const prior = store.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail(ErrorType, 'CONFLICT', 'That request already describes another concentration decision.');
      const receipt = JSON.parse(prior.body);
      if (!savedAuthority(state, role, scope.owner, input.action, receipt.result)) fail(ErrorType, 'UNAUTHORIZED', 'Current control is required to recover that concentration receipt.');
      return receipt;
    }
    if (input.expectedRevision !== state.revision) fail(ErrorType, 'STALE', 'The scene changed. Open the current concentration view.');
    if (state.phase === 'paused') fail(ErrorType, 'PAUSED', 'Play is paused. Concentration remains unchanged.');
    validatePendingConcentrationRecord(state.pendingConcentration);
    let result, clearPending = false;
    if (input.action === 'start') {
      if (role !== 'host') fail(ErrorType, 'UNAUTHORIZED', 'Only the host can register a reviewed concentration source.');
      if (state.pendingReaction || state.pendingConcentration) fail(ErrorType, 'PENDING', 'Resolve pending reactions and concentration first.');
      if (!['combat', 'exploration'].includes(state.phase)) fail(ErrorType, 'CONFLICT', 'Register concentration in an active scene.');
      const actor = state.actors.find(item => item.id === input.actorId);
      if (!actor || actor.hp <= 0 || actor.incapacitated === true) fail(ErrorType, 'CONFLICT', 'The actor cannot sustain concentration.');
      if (actor.characterVersion !== input.characterVersion) fail(ErrorType, 'CONFLICT', 'The reviewed character version changed.');
      if (actor.owner !== null && !store.db.prepare('SELECT 1 FROM game_members WHERE campaign=? AND owner=?').get(state.campaign, actor.owner)) fail(ErrorType, 'UNAUTHORIZED', 'The concentrating actor needs a current controller.');
      const saveProfile = actorProfile(actor), bound = new Set(state.actors.flatMap(item => item.concentration?.effects?.map(effect => effect.id) ?? []));
      const effects = input.effectIds.map(effectId => { const effect = state.effects.find(item => item.id === effectId); if (!effect || bound.has(effectId)) fail(ErrorType, 'CONFLICT', 'An effect is unavailable or already sustained by concentration.'); return { id: effect.id, fingerprint: effectFingerprint(effect) }; });
      const removedEffectIds = actor.concentration ? removeSource(state, normalizeSource(actor.concentration)) : [];
      const source = { id: opaque(), actorId: actor.id, owner: actor.owner, characterVersion: actor.characterVersion, sourceLabel: label(input.sourceLabel), profile: saveProfile, profileFingerprint: profileFingerprint(actor), effects, review: { owner: scope.owner, reason: label(input.reason, 300), revision: state.revision } };
      actor.concentration = source;
      result = { type: 'concentration_started', action: input.action, actorId: actor.id, concentrationId: source.id, sourceLabel: source.sourceLabel, effectIds: effects.map(effect => effect.id), removedEffectIds };
      store.record(state, 'concentration_started', { actorId: actor.id, concentrationId: source.id, removedEffectIds });
    } else if (input.action === 'end') {
      const actor = state.actors.find(item => item.id === input.actorId);
      if (!controls(actor, scope.owner, role)) fail(ErrorType, 'UNAUTHORIZED', 'You can end only your own character’s concentration.');
      if (!actor.concentration) fail(ErrorType, 'NOT_FOUND', 'That actor is not concentrating.');
      const source = normalizeSource(actor.concentration);
      if (state.pendingConcentration && state.pendingConcentration.concentrationId !== source.id) fail(ErrorType, 'PENDING', 'Resolve the current concentration save first.');
      clearPending = state.pendingConcentration?.concentrationId === source.id;
      const removedEffectIds = removeSource(state, source);
      if (clearPending) delete state.pendingConcentration;
      result = { type: 'concentration_ended', action: input.action, actorId: actor.id, concentrationId: source.id, sourceLabel: source.sourceLabel, removedEffectIds };
      store.record(state, 'concentration_ended', { actorId: actor.id, concentrationId: source.id, reason: 'voluntary', removedEffectIds });
    } else {
      const pending = state.pendingConcentration;
      if (!pending || pending.id !== input.pendingId) fail(ErrorType, 'NOT_FOUND', 'Open the current pending concentration save.');
      const actor = state.actors.find(item => item.id === pending.actorId);
      if (input.action === 'refresh') {
        if (role !== 'host') fail(ErrorType, 'UNAUTHORIZED', 'Only the host can review an unavailable concentration response.');
        if (eligible(state, pending, store)) fail(ErrorType, 'CONFLICT', 'The authorized character can still decide this concentration save.');
        const removedEffectIds = removeSource(state, normalizeSource(pending.source));
        result = { type: 'concentration_refreshed', action: input.action, actorId: pending.actorId, concentrationId: pending.concentrationId, removedEffectIds, reason: label(input.reason, 300) };
      } else {
        if (!controls(actor, scope.owner, role) || actor.owner !== pending.owner) fail(ErrorType, 'UNAUTHORIZED', 'Only the concentrating character’s controller can resolve this save.');
        if (!eligible(state, pending, store)) fail(ErrorType, 'CONFLICT', 'The reviewed source or responder changed. The host must review recovery.');
        const saveProfile = profile(pending.profile), advantage = saveProfile.advantage.length > 0, disadvantage = saveProfile.disadvantage.length > 0;
        const mode = advantage === disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage';
        const dice = Array.from({ length: mode === 'normal' ? 1 : 2 }, () => store.roll(20));
        const kept = mode === 'advantage' ? Math.max(...dice) : mode === 'disadvantage' ? Math.min(...dice) : dice[0];
        const modifier = Math.floor((saveProfile.abilityScore - 10) / 2) + (saveProfile.proficient ? saveProfile.proficiencyBonus : 0) + saveProfile.adjustments.reduce((total, item) => total + item.value, 0);
        const total = kept + modifier, success = total >= pending.dc;
        const removedEffectIds = success ? [] : removeSource(state, normalizeSource(pending.source));
        result = { type: 'concentration_save', action: input.action, actorId: pending.actorId, concentrationId: pending.concentrationId, sourceLabel: pending.source.sourceLabel, damageTaken: pending.damageTaken, dc: pending.dc, dice, kept, mode, modifier, total, success, profile: saveProfile, removedEffectIds };
      }
      delete state.pendingConcentration;
      clearPending = true;
      store.record(state, input.action === 'refresh' ? 'concentration_refreshed' : 'concentration_resolved', { actorId: pending.actorId, concentrationId: pending.concentrationId, ...(input.action === 'refresh' ? { reason: result.reason } : { success: result.success }), removedEffectIds: result.removedEffectIds });
    }
    if (clearPending) resume(store, state, ErrorType);
    store.save(state);
    const receipt = { requestId: input.requestId, revision: state.revision, result };
    store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
    return receipt;
  });
}
