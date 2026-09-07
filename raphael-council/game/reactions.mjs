import { createHash, randomBytes } from 'node:crypto';
import { opportunityCandidates } from './opportunity-attacks.mjs';

const token = () => randomBytes(12).toString('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const point = value => ({ x: value.x, y: value.y });
const controls = (actor, owner, role) => actor && (actor.owner === owner || (actor.owner === null && role === 'host'));
const source = actor => hash({ id: actor.id, owner: actor.owner, characterVersion: actor.characterVersion, weapon: actor.weapon, combatCapabilities: actor.combatCapabilities, combatReview: actor.combatReview });
const memberRole = (store, campaign, owner) => store.db.prepare('SELECT role FROM game_members WHERE campaign=? AND owner=?').get(campaign, owner)?.role;
const hasController = (store, state, actor) => actor.owner === null ? Boolean(store.db.prepare("SELECT 1 FROM game_members WHERE campaign=? AND role='host'").get(state.campaign)) : Boolean(memberRole(store, state.campaign, actor.owner));
const fail = (ErrorType, code, message) => { throw new ErrorType(code, message); };

/** No prospective candidate count or identity is included in another player's view. */
export function reactionProjection(state, owner, role, visibleActors) {
  const pending = state.pendingReaction;
  if (!pending) return null;
  const mover = state.actors.find(actor => actor.id === pending.moverId);
  const canManage = role === 'host' || controls(mover, owner, role);
  const visible = new Set(visibleActors.map(actor => actor.id));
  const offers = pending.stage === 'declare' && mover && visible.has(mover.id) ? pending.candidates.filter(candidate => candidate.status === 'pending').flatMap(candidate => {
    const actor = state.actors.find(value => value.id === candidate.actorId);
    return controls(actor, owner, role) ? [{ optionId: candidate.optionId, actorId: actor.id, actorName: actor.name, targetId: mover.id, targetName: mover.name, weapon: structuredClone(actor.weapon) }] : [];
  }) : [];
  const orderChoices = pending.stage === 'order' && canManage ? pending.candidates.filter(candidate => candidate.status === 'attack').map((candidate, index) => {
    const actor = state.actors.find(value => value.id === candidate.actorId);
    return actor && visible.has(actor.id) ? { optionId: candidate.optionId, label: actor.name, actorId: actor.id } : { optionId: candidate.optionId, label: `Unseen reaction ${index + 1}` };
  }) : [];
  return { id: pending.id, kind: 'opportunity_attack', stage: pending.stage, paused: state.phase === 'paused', canOrder: canManage && pending.stage === 'order' && state.phase !== 'paused' && !state.pendingConcentration, canRefresh: canManage && pending.stage !== 'resolving' && state.phase !== 'paused' && !state.pendingConcentration, offers, orderChoices };
}

export function reactionState(store, scope, project) {
  return store.transaction(() => {
    const role = store.member(scope), state = store.load(scope.campaign);
    const recentResults = store.db.prepare("SELECT body FROM game_receipts WHERE campaign=? AND owner=? AND json_extract(body,'$.result.reaction')=1 ORDER BY rowid DESC LIMIT 20").all(scope.campaign, scope.owner).map(row => JSON.parse(row.body));
    return { revision: state.revision, pending: project(state, scope.owner, role).pendingReaction ?? null, recentResults };
  });
}

/** Called immediately before a validated combat step; no movement or reaction is spent here. */
export function beginOpportunity(store, state, mover, { scope, path, requestId, movedPath, settledActorIds = [] }) {
  const from = point(mover), to = point(path[0]);
  const eligible = opportunityCandidates(state, mover, from, to).filter(candidate => !settledActorIds.includes(candidate.actorId)).map(candidate => state.actors.find(actor => actor.id === candidate.actorId)).filter(actor => actor && hasController(store, state, actor));
  if (!eligible.length) return false;
  state.pendingReaction = {
    id: token(), kind: 'opportunity_attack', stage: 'declare', moverId: mover.id, controller: scope.owner,
    moverOwner: mover.owner, moverVersion: mover.characterVersion, turn: state.turn, mapId: state.map.id,
    from, to, remainingPath: path.map(point), movedPath: movedPath.map(point), movementRequestId: requestId,
    settledActorIds: [...settledActorIds],
    candidates: eligible.map(actor => ({ optionId: token(), actorId: actor.id, actorOwner: actor.owner, profileHash: source(actor), status: 'pending' })),
  };
  store.record(state, 'movement_waiting', { pendingId: state.pendingReaction.id, actorId: mover.id });
  return true;
}

function validMover(store, state, pending) {
  const mover = state.actors.find(actor => actor.id === pending.moverId);
  const role = memberRole(store, state.campaign, pending.controller);
  return mover && role && controls(mover, pending.controller, role) && mover.owner === pending.moverOwner && mover.characterVersion === pending.moverVersion && mover.hp > 0 && state.phase === 'combat' && state.order[state.activeIndex] === mover.id && state.turn === pending.turn && state.map.id === pending.mapId && mover.x === pending.from.x && mover.y === pending.from.y ? { mover, role } : null;
}
function validCandidate(store, state, pending, candidate, eligibleIds) {
  const actor = state.actors.find(value => value.id === candidate.actorId);
  if (!actor || actor.owner !== candidate.actorOwner || source(actor) !== candidate.profileHash || !eligibleIds.has(actor.id) || !hasController(store, state, actor)) return false;
  if (candidate.status === 'attack') {
    const role = memberRole(store, state.campaign, candidate.declaredBy);
    if (!role || !controls(actor, candidate.declaredBy, role)) return false;
  }
  return true;
}
function pruneUnavailable(store, state, pending) {
  const current = validMover(store, state, pending);
  const eligible = new Set(current ? opportunityCandidates(state, current.mover, pending.from, pending.to).map(candidate => candidate.actorId) : []);
  for (const candidate of pending.candidates) if (['pending', 'attack'].includes(candidate.status) && !validCandidate(store, state, pending, candidate, eligible)) candidate.status = 'unavailable';
  return current;
}
function clearReactionContinuation(state, pendingId) {
  if (state.continuations) state.continuations = state.continuations.filter(frame => frame.kind !== 'reaction' || frame.pendingId !== pendingId);
}
function queueReactionContinuation(state, pendingId) {
  clearReactionContinuation(state, pendingId);
  (state.continuations ??= []).push({ kind: 'reaction', pendingId });
}
function finishMovement(store, state, pending) {
  const current = validMover(store, state, pending);
  clearReactionContinuation(state, pending.id);
  delete state.pendingReaction;
  store.record(state, 'movement_continued', { pendingId: pending.id, actorId: pending.moverId, stopped: !current });
  if (!current) return;
  try {
    store.move(state, current.mover, { path: pending.remainingPath, requestId: pending.movementRequestId }, { campaign: state.campaign, owner: pending.controller }, current.role, {
      settledActorIds: [...pending.settledActorIds, ...pending.candidates.map(candidate => candidate.actorId)],
      movedPath: pending.movedPath,
    });
  } catch (error) {
    // A changed route ends the remaining movement; it cannot undo already confirmed attacks.
    if (!['MOVEMENT', 'NOT_VISIBLE', 'INVALID'].includes(error.code)) throw error;
    store.record(state, 'movement_stopped', { pendingId: pending.id, actorId: pending.moverId, reason: 'The remaining movement is no longer available.' });
  }
}
function settle(store, state, pending, order) {
  if (state.pendingConcentration || state.phase === 'paused') return;
  if (!pruneUnavailable(store, state, pending)) { finishMovement(store, state, pending); return; }
  if (!pending.confirmedOrder) {
    if (pending.candidates.some(candidate => candidate.status === 'pending')) return;
    const declared = pending.candidates.filter(candidate => candidate.status === 'attack');
    if (declared.length > 1 && !order) { pending.stage = 'order'; return; }
    pending.confirmedOrder = [...(order ?? declared.map(candidate => candidate.optionId))];
    pending.cursor = 0;
    pending.stage = 'resolving';
  }
  while (pending.cursor < pending.confirmedOrder.length) {
    const candidate = pending.candidates.find(value => value.optionId === pending.confirmedOrder[pending.cursor]);
    const current = pruneUnavailable(store, state, pending);
    if (!current || candidate?.status !== 'attack') { pending.cursor++; continue; }
    const actor = state.actors.find(value => value.id === candidate.actorId);
    const role = memberRole(store, state.campaign, candidate.declaredBy);
    // Advance before attack records its first snapshot. The enclosing transaction
    // commits this cursor, the resource spend and the private receipt together.
    queueReactionContinuation(state, pending.id);
    candidate.status = 'resolved';
    pending.cursor++;
    const result = store.attack(state, actor, { targetId: current.mover.id }, { campaign: state.campaign, owner: candidate.declaredBy }, role, 'reaction');
    const receipt = { requestId: candidate.resultRequestId, revision: state.revision, result: { ...result, pendingId: pending.id, declarationRequestId: candidate.declarationRequestId } };
    store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(state.campaign, candidate.declaredBy, receipt.requestId, hash({ kind: 'authorized_reaction_result', pendingId: pending.id, optionId: candidate.optionId }), JSON.stringify(receipt));
    if (state.pendingConcentration) return;
    clearReactionContinuation(state, pending.id);
  }
  finishMovement(store, state, pending);
}

/** The store dispatcher pops the reaction frame before calling this in its transaction. */
export function resumeReaction(store, state) {
  const pending = state.pendingReaction;
  if (!pending?.confirmedOrder || state.pendingConcentration || state.phase === 'paused') return false;
  settle(store, state, pending);
  return true;
}
function authorizeSaved(store, state, scope, role, receipt, ErrorType) {
  const authority = receipt.reactionAuthority;
  const actor = state.actors.find(value => value.id === authority?.actorId);
  if (!authority || (authority.hostOnly ? role !== 'host' : !controls(actor, scope.owner, role))) fail(ErrorType, 'UNAUTHORIZED', 'These reaction controls are no longer yours.');
}

/** Attack means an explicit declaration authorizing later resolution after simultaneous order is chosen. */
export function resolveReaction(store, scope, input, ErrorType) {
  const common = ['requestId', 'expectedRevision', 'pendingId', 'decision'];
  const extra = input?.decision === 'order' ? ['order'] : ['attack', 'decline'].includes(input?.decision) ? ['optionId'] : [];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => ![...common, ...extra].includes(key)) || !id(input.requestId) || !id(input.pendingId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !['attack', 'decline', 'order', 'refresh'].includes(input.decision) || (extra.includes('optionId') && !id(input.optionId)) || (input.decision === 'order' && (!Array.isArray(input.order) || input.order.length < 2 || input.order.length > 64 || !Array.from(input.order).every(id) || new Set(input.order).size !== input.order.length))) fail(ErrorType, 'INVALID', 'Use a current explicit reaction decision.');
  const fingerprint = hash({ kind: 'reaction_command', input });
  return store.transaction(() => {
    const role = store.member(scope), state = store.load(scope.campaign);
    const previous = store.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail(ErrorType, 'CONFLICT', 'That request already describes another action.');
      const receipt = JSON.parse(previous.body); authorizeSaved(store, state, scope, role, receipt, ErrorType); return receipt;
    }
    if (state.revision !== input.expectedRevision || state.pendingReaction?.id !== input.pendingId) fail(ErrorType, 'STALE', 'The interruption changed. Open the current reaction view.');
    if (state.phase === 'paused') fail(ErrorType, 'PAUSED', 'Play is paused. Reaction declarations remain saved.');
    if (state.phase !== 'combat') fail(ErrorType, 'REACTION', 'This reaction requires the suspended combat movement.');
    if (state.pendingConcentration) fail(ErrorType, 'CONCENTRATION', 'Resolve the pending concentration save before reactions continue.');
    if (state.pendingReaction.stage === 'resolving') fail(ErrorType, 'REACTION', 'The saved reaction order is already being resolved.');
    const pending = state.pendingReaction, mover = state.actors.find(actor => actor.id === pending.moverId);
    let authority;
    if (['order', 'refresh'].includes(input.decision)) {
      if (role !== 'host' && !controls(mover, scope.owner, role)) fail(ErrorType, 'UNAUTHORIZED', 'The current-turn player or host manages this interruption.');
      authority = { actorId: pending.moverId, hostOnly: !controls(mover, scope.owner, role) };
      if (input.decision === 'order') {
        if (pending.stage !== 'order') fail(ErrorType, 'REACTION', 'Wait for the private declarations before choosing their order.');
        const choices = pending.candidates.filter(candidate => candidate.status === 'attack').map(candidate => candidate.optionId);
        if (input.order.length !== choices.length || input.order.some(optionId => !choices.includes(optionId))) fail(ErrorType, 'INVALID', 'Choose every declared reaction exactly once.');
      }
      settle(store, state, pending, input.decision === 'order' ? input.order : undefined);
    } else {
      const candidate = pending.candidates.find(value => value.optionId === input.optionId);
      const actor = state.actors.find(value => value.id === candidate?.actorId);
      if (!candidate || !controls(actor, scope.owner, role)) fail(ErrorType, 'UNAUTHORIZED', 'Choose a reaction belonging to your character.');
      if (pending.stage !== 'declare' || candidate.status !== 'pending') fail(ErrorType, 'REACTION', 'This opportunity already has a saved decision.');
      const current = validMover(store, state, pending);
      const eligible = new Set(current ? opportunityCandidates(state, current.mover, pending.from, pending.to).map(value => value.actorId) : []);
      if (!validCandidate(store, state, pending, candidate, eligible)) fail(ErrorType, 'REACTION', 'This opportunity is no longer available. The current-turn player or host can refresh it.');
      authority = { actorId: actor.id, hostOnly: actor.owner === null };
      candidate.status = input.decision;
      if (input.decision === 'attack') {
        candidate.declaredBy = scope.owner; candidate.declarationRequestId = input.requestId; candidate.resultRequestId = `reaction-${token()}`;
      }
      settle(store, state, pending);
    }
    // Record the safe final snapshot after declarations, ordering and any authorized continuation.
    store.record(state, 'reaction_decision', { pendingId: pending.id, decision: input.decision });
    store.save(state);
    const receipt = { requestId: input.requestId, revision: state.revision, result: { type: 'reaction', pendingId: pending.id, decision: input.decision }, reactionAuthority: authority };
    store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
    return receipt;
  });
}
