const field = (label, value) => ({ label, value });
const yesNo = value => value ? 'Yes' : 'No';

/** Public intent only: show this warning on every confirmation preview page. */
export function checkDamageWarning(check) {
  const consequence = check.consequence;
  if (consequence?.type !== 'single_target_damage') return '';
  const success = consequence.onSuccess === 'half' ? 'half damage' : 'no damage';
  return `Damage risk: this saving throw can apply ${consequence.damageType} damage to your character. On success: ${success}. Confirming rolls the save and applies its damage.`;
}

/** Display persisted save damage values without evaluating rules or exposing host intent. */
export function checkConsequenceFields(result) {
  const consequence = result.consequence;
  if (result.type !== 'save' || consequence?.type !== 'single_target_damage') return [];
  return [
    field('Damage type', consequence.damageType),
    field('Damage dice', consequence.dice.join(', ')),
    field('Damage die sides', consequence.dieSides),
    field('Damage bonus', consequence.bonus),
    field('Rolled damage', consequence.rolledTotal),
    field('Damage after save', consequence.afterSave),
    field('Damage reduction', consequence.mitigation.reduction),
    field('Damage resistance', yesNo(consequence.mitigation.resistance)),
    field('Damage vulnerability', yesNo(consequence.mitigation.vulnerability)),
    field('Damage immunity', yesNo(consequence.mitigation.immunity)),
    field('Damage after mitigation', consequence.appliedDamage),
    field('HP before', consequence.hpBefore),
    field('HP after', consequence.hpAfter),
  ];
}
