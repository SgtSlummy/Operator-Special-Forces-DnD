import { createHash, randomBytes } from 'node:crypto';
import { normalizeAreaDamageInput, approveAreaDamageTarget } from './area-damage-definition.mjs';

// Internal first card. Do not expose commit to a live transport until the
// campaign command guards, continuation drain and recovery validator are wired.
const copy = value => structuredClone(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const actorIdentity = actor => ({ actorId: actor.id, owner: actor.owner, characterVersion: actor.characterVersion, x: actor.x, y: actor.y });

export function initializeAreaDamage(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS game_area_intents(
    campaign TEXT NOT NULL REFERENCES game_campaigns(id), id TEXT NOT NULL,
    host TEXT NOT NULL, input_hash TEXT NOT NULL, definition_hash TEXT NOT NULL,
    approval_id TEXT NOT NULL, definition TEXT NOT NULL, stage TEXT NOT NULL,
    progress TEXT NOT NULL, PRIMARY KEY(campaign,id));
    CREATE UNIQUE INDEX IF NOT EXISTS game_area_one_active ON game_area_intents(campaign)
      WHERE stage NOT IN ('prepared','completed');`);
}

export function createAreaDamageService(store, characters, ErrorType) {
  if (typeof ErrorType !== 'function') throw new TypeError('Supply the game error type.');
  const fail = (code, message) => { throw new ErrorType(code, message); };
  initializeAreaDamage(store.db);
  const row = (campaign, intentId) => store.db.prepare('SELECT * FROM game_area_intents WHERE campaign=? AND id=?').get(campaign, intentId);
  const unpack = saved => ({ definition: JSON.parse(saved.definition), progress: JSON.parse(saved.progress) });
  function currentHost(scope) {
    if (store.member(scope) !== 'host') fail('UNAUTHORIZED', 'Only the host can prepare an area save.');
  }
  function currentMember(campaign, owner) {
    try { return store.member({ campaign, owner }); }
    catch (error) { if (error instanceof ErrorType && error.code === 'UNAUTHORIZED') fail('TARGET', 'Every target must belong to a current campaign member.'); throw error; }
  }
  function ongoing(state) {
    if (state.phase === 'paused') fail('PAUSED', 'Area actions wait while play is paused.');
    if (state.phase !== 'combat') fail('UNSUPPORTED', 'This area action requires an active combat turn.');
    if (state.pendingAreaIntentId || state.pendingReaction || state.pendingConcentration) fail('PENDING', 'Resolve the current action, reaction or concentration save first.');
  }
  function context(state, sourceActorId, hostOwner) {
    const active = state.actors.find(actor => actor.id === state.order[state.activeIndex]);
    const source = state.actors.find(actor => actor.id === sourceActorId);
    if (!active || active.hp <= 0 || !source || source.hp <= 0) fail('TARGET', 'Choose a living source during a living actor’s turn.');
    if (active.owner) currentMember(state.campaign, active.owner);
    if (source.owner) currentMember(state.campaign, source.owner);
    return { mapId: state.map.id, turn: state.turn, active: actorIdentity(active), source: actorIdentity(source), decidingOwner: active.owner ?? hostOwner };
  }
  function approve(state, scope, normalized) {
    return normalized.targets.map(target => {
      const actor = state.actors.find(value => value.id === target.actorId);
      if (!actor?.owner || actor.hp <= 0) fail('TARGET', 'Choose living player characters for the area save.');
      currentMember(scope.campaign, actor.owner);
      return { ...approveAreaDamageTarget(characters, scope, actor, target, fail), position: { x: actor.x, y: actor.y } };
    });
  }
  function hostView(saved) {
    const { definition, progress } = unpack(saved);
    return { intentId: saved.id, definitionHash: saved.definition_hash, approvalId: saved.approval_id, stage: saved.stage, definition, progress };
  }
  function orderingView(state, saved, scope) {
    const { definition } = unpack(saved);
    if (scope.owner !== definition.context.decidingOwner) return null;
    const visible = new Map(store.view(scope).actors.map(actor => [actor.id, actor]));
    const targets = definition.input.order.map(targetId => {
      const target = definition.targets.find(value => value.targetId === targetId);
      const actor = visible.get(target.actorId);
      return actor ? { targetId, actorId: actor.id, name: actor.name } : null;
    });
    const visibleProposal = visible.has(definition.input.sourceActorId) && targets.every(Boolean);
    let eligible = false;
    if (saved.stage === 'prepared') {
      try {
        const hostScope = { campaign: scope.campaign, owner: saved.host };
        currentHost(hostScope);
        eligible = hash(context(state, definition.input.sourceActorId, saved.host)) === hash(definition.context)
          && hash(approve(state, hostScope, definition.input)) === hash(definition.targets);
      } catch (error) {
        if (!(error instanceof ErrorType) || !['TARGET', 'UNAUTHORIZED', 'PROFILE', 'UNSUPPORTED'].includes(error.code)) throw error;
      }
    }
    const resourceAvailable = definition.input.cost !== 'action' || state.actionAvailable;
    const canConfirm = saved.stage === 'prepared' && state.phase === 'combat' && state.revision === definition.input.expectedRevision && eligible && visibleProposal && resourceAvailable && !state.pendingAreaIntentId && !state.pendingReaction && !state.pendingConcentration;
    // Ordering reveals visible identities and damage type, never private dice
    // formulas or target reviews. The random token is not a private-data hash.
    const needsHostReview = !visibleProposal || (saved.stage === 'prepared' && (!eligible || state.revision !== definition.input.expectedRevision));
    return { intentId: saved.id, label: definition.input.label, stage: saved.stage, canConfirm,
      ...(visibleProposal ? { ...(canConfirm ? { approvalId: saved.approval_id } : {}), sourceActorId: definition.input.sourceActorId, cost: definition.input.cost, damage: { damageType: definition.input.damage.damageType }, targets } : {}),
      ...(needsHostReview ? { needsHostReview: true } : {}) };
  }
  function read(scope, intentId) {
    return store.transaction(() => {
      const role = store.member(scope);
      if (!id(intentId)) fail('INVALID', 'Choose an area intent.');
      const saved = row(scope.campaign, intentId);
      if (!saved) fail('NOT_FOUND', 'Area intent not found.');
      if (role === 'host') return hostView(saved);
      const state = store.load(scope.campaign), { definition } = unpack(saved);
      const ordering = orderingView(state, saved, scope);
      const targets = definition.targets.filter(target => target.owner === scope.owner).map(target => ({ targetId: target.targetId, actorId: target.actorId, ability: target.ability, mode: target.mode, advantage: copy(target.advantage), disadvantage: copy(target.disadvantage), modifiers: copy(target.modifiers), characterVersion: target.characterVersion, consequence: { damageType: definition.input.damage.damageType, onSuccess: target.onSuccess } }));
      if (!ordering && !targets.length) fail('UNAUTHORIZED', 'Open only an area action assigned to you.');
      return { intentId, label: definition.input.label, stage: saved.stage, targets, ...(ordering ? { ordering } : {}) };
    });
  }
  function prepare(scope, rawInput) {
    return store.transaction(() => {
      currentHost(scope);
      const input = normalizeAreaDamageInput(rawInput, fail), inputHash = hash(input), prior = row(scope.campaign, input.id);
      if (prior) {
        if (prior.input_hash !== inputHash) fail('CONFLICT', 'This area ID describes different reviewed mechanics.');
        return hostView(prior);
      }
      const state = store.load(scope.campaign);
      ongoing(state);
      if (state.revision !== input.expectedRevision) fail('STALE', 'Refresh the scene before reviewing this area action.');
      const boundContext = context(state, input.sourceActorId, scope.owner);
      if (input.cost === 'action' && boundContext.active.actorId !== input.sourceActorId) fail('TURN', 'An action cost must belong to the active source actor.');
      const definition = { rulesVersion: 'raph-reviewed-area-damage-v1', input, context: boundContext, targets: approve(state, scope, input) };
      const definitionHash = hash(definition), approvalId = randomBytes(16).toString('hex');
      store.db.prepare('INSERT INTO game_area_intents VALUES(?,?,?,?,?,?,?,?,?)').run(scope.campaign, input.id, scope.owner, inputHash, definitionHash, approvalId, JSON.stringify(definition), 'prepared', JSON.stringify({}));
      return hostView(row(scope.campaign, input.id));
    });
  }
  function commit(scope, input) {
    return store.transaction(() => {
      store.member(scope);
      if (!exact(input, ['intentId', 'requestId', 'approvalId', 'reviewed', 'order']) || !id(input.intentId) || !id(input.requestId) || !id(input.approvalId) || input.reviewed !== true || !Array.isArray(input.order) || input.order.length < 2 || input.order.length > 16 || !input.order.every(id)) fail('INVALID', 'Confirm the exact reviewed area action and order.');
      const fingerprint = hash({ type: 'commit_area_damage', ...input });
      const previous = store.db.prepare('SELECT fingerprint,body FROM game_receipts WHERE campaign=? AND owner=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('CONFLICT', 'This request ID describes another action.');
        return JSON.parse(previous.body);
      }
      const saved = row(scope.campaign, input.intentId);
      if (!saved) fail('NOT_FOUND', 'Area intent not found.');
      const { definition } = unpack(saved);
      if (scope.owner !== definition.context.decidingOwner) fail('UNAUTHORIZED', 'The current turn controller must confirm this action and order.');
      if (store.member({ campaign: scope.campaign, owner: saved.host }) !== 'host') fail('UNAUTHORIZED', 'The reviewing host is no longer authorized.');
      if (saved.stage !== 'prepared') fail('CONFLICT', 'This area action is already committed.');
      if (saved.approval_id !== input.approvalId || hash(input.order) !== hash(definition.input.order)) fail('CONFLICT', 'Confirm the current proposed order or ask for a revised proposal.');
      const state = store.load(scope.campaign);
      ongoing(state);
      if (state.revision !== definition.input.expectedRevision) fail('STALE', 'The scene changed before area confirmation.');
      if (hash(context(state, definition.input.sourceActorId, saved.host)) !== hash(definition.context)) fail('PROFILE', 'The source or turn controller changed.');
      if (hash(approve(state, { campaign: scope.campaign, owner: saved.host }, definition.input)) !== hash(definition.targets)) fail('PROFILE', 'A reviewed target changed.');
      if (definition.input.cost === 'action' && !state.actionAvailable) fail('RESOURCE', 'The source action has already been spent.');
      const ordering = orderingView(state, saved, scope);
      if (!ordering?.canConfirm) fail('REVIEW', 'The proposed order needs a private host review before confirmation.');
      if (definition.input.cost === 'action') state.actionAvailable = false;
      const formula = definition.input.damage.dice;
      const dice = Array.from({ length: formula.count }, () => store.roll(formula.sides));
      const commonDamage = { rollId: `${saved.id}:damage`, damageType: definition.input.damage.damageType, dice, dieSides: formula.sides, bonus: formula.bonus, total: Math.max(0, dice.reduce((sum, die) => sum + die, 0) + formula.bonus) };
      const progress = { commonDamage, nextTargetIndex: 0, confirmation: { owner: scope.owner, requestId: input.requestId, order: copy(input.order) }, resourceReceiptId: input.requestId };
      state.pendingAreaIntentId = saved.id;
      store.db.prepare('UPDATE game_area_intents SET stage=?,progress=? WHERE campaign=? AND id=?').run('collecting_saves', JSON.stringify(progress), scope.campaign, saved.id);
      store.record(state, 'area_damage_committed', { intentId: saved.id, sourceActorId: definition.input.sourceActorId });
      store.save(state);
      const receipt = { requestId: input.requestId, revision: state.revision, result: { type: 'area_damage_committed', intentId: saved.id, commonDamage, order: copy(input.order), cost: definition.input.cost } };
      store.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, fingerprint, JSON.stringify(receipt));
      return receipt;
    });
  }
  return { prepare, read, commit };
}
