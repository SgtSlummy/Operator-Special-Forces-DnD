export const SAVE_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
export const DAMAGE_DIE_SIDES = [2, 4, 6, 8, 10, 12, 20];

export function createSaveDraft() {
  return {
    actorId: '', label: '', ability: 'dexterity', dc: '10', proficient: false, proficiencyReason: '',
    advantage: '', disadvantage: '', adjustmentSource: '', adjustmentValue: '0',
    diceCount: '2', dieSides: '6', bonus: '0', damageType: 'fire', onSuccess: 'half',
    reduction: '0', resistance: false, vulnerability: false, immunity: false, mitigationReason: '', reviewed: false,
  };
}

function textValue(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) throw new Error(`${name} is required and must be ${maxLength} characters or fewer.`);
  return value.trim();
}

function integerValue(value, name, minimum, maximum) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}.`);
  return number;
}

function reasons(value, name) {
  const result = value.split('\n').map(line => line.trim()).filter(Boolean);
  if (result.length > 8 || result.some(line => line.length > 160)) throw new Error(`${name} allows up to eight reasons, each 160 characters or fewer.`);
  return result;
}

/**
 * Build only the reviewed request contract. Character numbers never come from the browser.
 * @param {ReturnType<typeof createSaveDraft>} draft
 * @param {number} gameRevision
 * @param {string} id
 * @param {string[]} actorIds
 */
export function buildReviewedSaveRequest(draft, gameRevision, id, actorIds) {
  if (draft.reviewed !== true) throw new Error('Review the save, damage, and defenses before requesting it.');
  if (!Number.isSafeInteger(gameRevision) || gameRevision < 0) throw new Error('Refresh the game before reviewing this request.');
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(id)) throw new Error('A valid request ID is required.');
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(draft.actorId) || !actorIds.includes(draft.actorId)) throw new Error('Choose a current player character.');
  if (!SAVE_ABILITIES.includes(draft.ability)) throw new Error('Choose a saving throw ability.');
  if (!DAMAGE_TYPES.includes(draft.damageType)) throw new Error('Choose a supported damage type.');
  if (!['half', 'none'].includes(draft.onSuccess)) throw new Error('Choose the damage on a successful save.');
  const sides = integerValue(draft.dieSides, 'Damage die sides', 2, 20);
  if (!DAMAGE_DIE_SIDES.includes(sides)) throw new Error('Choose a supported damage die.');
  const adjustment = integerValue(draft.adjustmentValue, 'Save adjustment', -20, 20);
  const adjustments = draft.adjustmentSource.trim() || adjustment !== 0
    ? [{ source: textValue(draft.adjustmentSource, 'Adjustment reason', 160), value: adjustment }]
    : [];
  return {
    id, reviewed: true, expectedRevision: gameRevision, actorId: draft.actorId,
    label: textValue(draft.label, 'Save label', 160), kind: 'save', ability: draft.ability,
    proficiencyMultiplier: draft.proficient ? 1 : 0,
    proficiencyReason: textValue(draft.proficiencyReason, 'Proficiency decision reason', 300),
    advantage: reasons(draft.advantage, 'Advantage'), disadvantage: reasons(draft.disadvantage, 'Disadvantage'),
    adjustments, dc: integerValue(draft.dc, 'Save DC', 0, 100), cost: 'none',
    consequence: {
      type: 'single_target_damage', dice: { count: integerValue(draft.diceCount, 'Damage dice count', 0, 20), sides, bonus: integerValue(draft.bonus, 'Damage bonus', -100, 100) },
      damageType: draft.damageType, onSuccess: draft.onSuccess,
      mitigation: {
        reduction: integerValue(draft.reduction, 'Flat damage reduction', 0, 100),
        resistance: draft.resistance === true, vulnerability: draft.vulnerability === true, immunity: draft.immunity === true,
        reason: textValue(draft.mitigationReason, 'Reviewed defenses reason', 300),
      },
    },
  };
}

/**
 * Display the persisted server receipt verbatim; never recalculate damage or hit-point loss.
 * @param {{type: 'single_target_damage', damageType: string, dice: number[], dieSides: number, bonus: number, rolledTotal: number, afterSave: number, mitigation: {reduction: number, resistance: boolean, vulnerability: boolean, immunity: boolean}, appliedDamage: number, hpBefore: number, hpAfter: number}} consequence
 */
export function savedDamageLines(consequence) {
  return [
    { label: 'Damage type', value: consequence.damageType },
    { label: 'Saved damage dice', value: `d${consequence.dieSides}: [${consequence.dice.join(', ')}]` },
    { label: 'Saved damage bonus', value: `${consequence.bonus >= 0 ? '+' : ''}${consequence.bonus}` },
    { label: 'Rolled damage total', value: String(consequence.rolledTotal) },
    { label: 'Damage after save', value: String(consequence.afterSave) },
    { label: 'Reviewed mitigation', value: `Flat reduction ${consequence.mitigation.reduction}; resistance ${consequence.mitigation.resistance ? 'yes' : 'no'}; vulnerability ${consequence.mitigation.vulnerability ? 'yes' : 'no'}; immunity ${consequence.mitigation.immunity ? 'yes' : 'no'}` },
    { label: 'Applied damage (before HP limit)', value: String(consequence.appliedDamage) },
    { label: 'HP before', value: String(consequence.hpBefore) },
    { label: 'HP after', value: String(consequence.hpAfter) },
  ];
}
