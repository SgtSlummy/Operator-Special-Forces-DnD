const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const damageTypes = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];

/** A reviewed one-target primitive. Multi-target effects require a shared damage intent. */
export function validateCheckConsequence(input, fail) {
  if (!Object.hasOwn(input, 'consequence')) return;
  const c = input.consequence;
  if (input.kind !== 'save' || input.cost !== 'none'
    || !exact(c, ['type', 'dice', 'damageType', 'onSuccess', 'mitigation'])
    || c.type !== 'single_target_damage' || !damageTypes.includes(c.damageType)
    || !['half', 'none'].includes(c.onSuccess)
    || !exact(c.dice, ['count', 'sides', 'bonus'])
    || !Number.isInteger(c.dice.count) || c.dice.count < 0 || c.dice.count > 20
    || ![2, 4, 6, 8, 10, 12, 20].includes(c.dice.sides)
    || !Number.isInteger(c.dice.bonus) || c.dice.bonus < -100 || c.dice.bonus > 100
    || !exact(c.mitigation, ['reduction', 'resistance', 'vulnerability', 'immunity', 'reason'])
    || !Number.isInteger(c.mitigation.reduction) || c.mitigation.reduction < 0 || c.mitigation.reduction > 100
    || !['resistance', 'vulnerability', 'immunity'].every(name => typeof c.mitigation[name] === 'boolean')
    || typeof c.mitigation.reason !== 'string' || !c.mitigation.reason.trim() || c.mitigation.reason.length > 300) {
    fail('INVALID', 'Supply reviewed single-target save damage and explicit applicable mitigation.');
  }
}

/** Public intent omits the host's damage mechanics and private review notes. */
export function publicCheckConsequence(consequence) {
  return { type: consequence.type, damageType: consequence.damageType, onSuccess: consequence.onSuccess };
}

/** Runs only inside resolveCheck's transaction, after all eligibility checks. */
export function applyCheckConsequence(store, actor, intent, success) {
  const dice = Array.from({ length: intent.dice.count }, () => store.roll(intent.dice.sides));
  const rolledTotal = Math.max(0, dice.reduce((sum, die) => sum + die, 0) + intent.dice.bonus);
  const afterSave = success ? (intent.onSuccess === 'half' ? Math.floor(rolledTotal / 2) : 0) : rolledTotal;
  const { reduction, resistance, vulnerability, immunity } = intent.mitigation;
  let appliedDamage = Math.max(0, afterSave - reduction);
  if (resistance) appliedDamage = Math.floor(appliedDamage / 2);
  if (vulnerability) appliedDamage *= 2;
  if (immunity) appliedDamage = 0;
  const hpBefore = actor.hp;
  actor.hp = Math.max(0, hpBefore - appliedDamage);
  return {
    type: intent.type, damageType: intent.damageType, dice, dieSides: intent.dice.sides,
    bonus: intent.dice.bonus, rolledTotal, afterSave,
    mitigation: { reduction, resistance, vulnerability, immunity },
    appliedDamage, hpBefore, hpAfter: actor.hp,
  };
}
