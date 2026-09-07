/** Structural validation only. The caller must authorize and bind the reviewed source. */
export class CombatProfileError extends Error {
  constructor(message) { super(message); this.name = 'CombatProfileError'; this.code = 'COMBAT_PROFILE'; }
}
const invalid = message => { throw new CombatProfileError(message); };
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;

function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Use an explicit combat profile object.');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => !allowed.includes(key) || !Object.hasOwn(fields[key], 'value')) || required.some(key => !Object.hasOwn(fields, key))) invalid('Combat profile fields are missing or unsupported.');
}
function sourceLabel(value) {
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) invalid('Use nonempty source labels of at most 160 characters.');
  return value.trim();
}
function entries(value, copy) {
  if (!Array.isArray(value) || value.length > 8) invalid('Provide at most eight explicit sources per list.');
  return Array.from(value, copy);
}
function constitutionProfile(value) {
  record(value, ['abilityScore', 'proficiencyBonus', 'proficient', 'adjustments', 'advantage', 'disadvantage']);
  if (!integer(value.abilityScore, 1, 30) || !integer(value.proficiencyBonus, 0, 10) || typeof value.proficient !== 'boolean') invalid('Use explicit bounded Constitution saving throw statistics.');
  return {
    abilityScore: value.abilityScore,
    proficiencyBonus: value.proficiencyBonus,
    proficient: value.proficient,
    adjustments: entries(value.adjustments, adjustment => {
      record(adjustment, ['source', 'value']);
      if (!integer(adjustment.value, -20, 20)) invalid('Saving throw adjustments must be integers from -20 to 20.');
      return { source: sourceLabel(adjustment.source), value: adjustment.value };
    }),
    advantage: entries(value.advantage, sourceLabel),
    disadvantage: entries(value.disadvantage, sourceLabel),
  };
}

/** Missing legacy capabilities remain unconfigured; labels and weapon ranges never imply mechanics. */
export function validateCombatCapabilities(input) {
  if (input === undefined) return undefined;
  record(input, ['attackKind', 'meleeReachFeet', 'constitutionSave'], ['attackKind']);
  if (!['melee', 'ranged'].includes(input.attackKind)) invalid('Choose an explicit melee or ranged attack kind.');
  const result = { attackKind: input.attackKind };
  if (input.attackKind === 'melee') {
    if (!integer(input.meleeReachFeet, 5, 30) || input.meleeReachFeet % 5 !== 0) invalid('Melee reach must be 5 to 30 feet in five-foot units.');
    result.meleeReachFeet = input.meleeReachFeet;
  } else if (Object.hasOwn(input, 'meleeReachFeet')) invalid('A ranged attack profile cannot claim melee reach.');
  if (Object.hasOwn(input, 'constitutionSave')) result.constitutionSave = constitutionProfile(input.constitutionSave);
  return result;
}

/** This calculates a DC only; it does not decide whether concentration is active or a save is required. */
export function concentrationSaveDC(damageTaken) {
  if (!integer(damageTaken, 0, Number.MAX_SAFE_INTEGER)) invalid('Damage taken must be a nonnegative safe integer.');
  return Math.min(30, Math.max(10, Math.floor(damageTaken / 2)));
}
