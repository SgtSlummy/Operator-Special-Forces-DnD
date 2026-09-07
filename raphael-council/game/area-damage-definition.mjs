import { createHash } from 'node:crypto';

const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const damageTypes = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const inputKeys = ['id', 'reviewed', 'expectedRevision', 'label', 'sourceActorId', 'cost', 'damage', 'targets', 'order'];
const targetKeys = ['targetId', 'actorId', 'ability', 'dc', 'proficiencyMultiplier', 'proficiencyReason', 'advantage', 'disadvantage', 'adjustments', 'onSuccess', 'mitigation'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const bounded = (value, length) => typeof value === 'string' && value.trim().length > 0 && value.length <= length;
const integer = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const list = (value, maximum, valid) => Array.isArray(value) && value.length <= maximum && Array.from(value).every(valid);

function normalizeTarget(target, fail) {
  if (!exact(target, targetKeys) || !id(target.targetId) || !id(target.actorId)
    || !abilities.includes(target.ability) || !integer(target.dc, 0, 100)
    || ![0, 1].includes(target.proficiencyMultiplier) || !bounded(target.proficiencyReason, 300)
    || !['half', 'none'].includes(target.onSuccess)) {
    fail('INVALID', 'Supply a reviewed saving throw and success outcome for every area target.');
  }
  for (const name of ['advantage', 'disadvantage']) {
    if (!list(target[name], 8, value => bounded(value, 160))) {
      fail('INVALID', 'Record bounded sources for advantage and disadvantage.');
    }
  }
  if (!list(target.adjustments, 8, adjustment => exact(adjustment, ['source', 'value'])
    && bounded(adjustment.source, 160) && integer(adjustment.value, -20, 20))) {
    fail('INVALID', 'Supply explicit bounded situational modifiers.');
  }
  const mitigation = target.mitigation;
  if (!exact(mitigation, ['reduction', 'resistance', 'vulnerability', 'immunity', 'reason'])
    || !integer(mitigation.reduction, 0, 100) || !bounded(mitigation.reason, 300)
    || !['resistance', 'vulnerability', 'immunity'].every(name => typeof mitigation[name] === 'boolean')) {
    fail('INVALID', 'Review the reduction, resistance, vulnerability and immunity for every area target.');
  }
  return {
    targetId: target.targetId, actorId: target.actorId, ability: target.ability, dc: target.dc,
    proficiencyMultiplier: target.proficiencyMultiplier, proficiencyReason: target.proficiencyReason,
    advantage: [...target.advantage], disadvantage: [...target.disadvantage],
    adjustments: target.adjustments.map(({ source, value }) => ({ source, value })), onSuccess: target.onSuccess,
    mitigation: { reduction: mitigation.reduction, resistance: mitigation.resistance, vulnerability: mitigation.vulnerability, immunity: mitigation.immunity, reason: mitigation.reason },
  };
}

/** Validate the reviewed shared packet; neither target order nor caller objects are mutated. */
export function normalizeAreaDamageInput(input, fail) {
  if (!exact(input, inputKeys) || !id(input.id) || input.reviewed !== true
    || !Number.isSafeInteger(input.expectedRevision) || !bounded(input.label, 160)
    || !id(input.sourceActorId) || !['action', 'none'].includes(input.cost)) {
    fail('INVALID', 'Supply a reviewed area damage request with an explicit source and cost.');
  }
  const damage = input.damage;
  if (!exact(damage, ['dice', 'damageType']) || !damageTypes.includes(damage.damageType)
    || !exact(damage.dice, ['count', 'sides', 'bonus']) || !integer(damage.dice.count, 0, 20)
    || ![2, 4, 6, 8, 10, 12, 20].includes(damage.dice.sides) || !integer(damage.dice.bonus, -100, 100)) {
    fail('INVALID', 'Supply one supported shared damage type and bounded damage dice.');
  }
  if (!Array.isArray(input.targets) || input.targets.length < 2 || input.targets.length > 16) {
    fail('INVALID', 'Review between two and sixteen area targets.');
  }
  const targets = Array.from(input.targets, target => normalizeTarget(target, fail));
  const targetIds = new Set(targets.map(target => target.targetId));
  if (targetIds.size !== targets.length || new Set(targets.map(target => target.actorId)).size !== targets.length) {
    fail('INVALID', 'Area targets must have unique target IDs and actor IDs.');
  }
  if (!list(input.order, 16, id) || input.order.length !== targets.length
    || new Set(input.order).size !== targets.length || !input.order.every(targetId => targetIds.has(targetId))) {
    fail('INVALID', 'The damage order must contain every reviewed target exactly once.');
  }
  targets.sort((left, right) => left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0);
  return {
    id: input.id, reviewed: true, expectedRevision: input.expectedRevision, label: input.label,
    sourceActorId: input.sourceActorId, cost: input.cost,
    damage: { dice: { count: damage.dice.count, sides: damage.dice.sides, bonus: damage.dice.bonus }, damageType: damage.damageType },
    targets, order: [...input.order],
  };
}

/** Pin each target to approved statistics. Authorization and living-state checks belong to the service. */
export function approveAreaDamageTarget(characters, scope, actor, target, fail) {
  const reviewed = normalizeTarget(target, fail);
  if (!actor?.owner) fail('UNSUPPORTED', 'This area target requires an approved player character.');
  if (actor.id !== reviewed.actorId) fail('TARGET', 'The approved area target must match the encounter actor.');
  const saved = typeof characters?.character === 'function'
    ? characters.character({ campaign: scope.campaign, owner: actor.owner }) : null;
  const snapshot = saved?.snapshot;
  const digest = snapshot && createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  if (!snapshot || snapshot.edition !== '2024' || actor.characterVersion !== `approved-${saved.revision}-${digest}`) {
    fail('PROFILE', 'The approved sheet must match this encounter character version.');
  }
  const value = name => {
    const field = snapshot.fields?.[name];
    if (!field || !Number.isInteger(field.value) || field.conflict || (field.uncertain && !field.corrected)) {
      fail('PROFILE', 'Confirm the required character statistics first.');
    }
    return field.value;
  };
  const score = value(reviewed.ability), proficiency = value('proficiencyBonus');
  if (score < 1 || score > 30 || proficiency < 0 || proficiency > 10) {
    fail('PROFILE', 'The approved statistics are outside the supported range.');
  }
  const mode = !!reviewed.advantage.length === !!reviewed.disadvantage.length
    ? 'normal' : reviewed.advantage.length ? 'advantage' : 'disadvantage';
  const modifiers = [
    { source: reviewed.ability, value: Math.floor((score - 10) / 2) },
    { source: `proficiency ×${reviewed.proficiencyMultiplier}: ${reviewed.proficiencyReason}`, value: proficiency * reviewed.proficiencyMultiplier },
    ...reviewed.adjustments,
  ];
  return {
    targetId: reviewed.targetId, actorId: reviewed.actorId, owner: actor.owner, characterVersion: actor.characterVersion,
    ability: reviewed.ability, mode, advantage: reviewed.advantage, disadvantage: reviewed.disadvantage, modifiers,
    dc: reviewed.dc, onSuccess: reviewed.onSuccess, mitigation: reviewed.mitigation,
  };
}
