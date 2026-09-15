export function missionEquipment(view) {
  const sheet=view?.actor?.sheet;
  if(typeof sheet?.armor!=='string'||!sheet.armor.trim())return null;
  return {
    owned:view.actor.equipment?.version===1,
    guidance:view.actor.equipment?.version===1?'Use the available equipment actions to change owned gear. Armor takes the displayed time and DM approval; worn armor must be removed before trading or dropping it.':armorLimitation,
    name:sheet.armor.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase()),
    calculation:typeof sheet.armorCalculation==='string'?sheet.armorCalculation:'',
    grant:typeof sheet.equipmentGrant==='string'?sheet.equipmentGrant:'',
  };
}
export const armorLimitation='Armor changes are not supported in this rehearsal. Ask the DM before planning a different loadout. The controls below apply to carried items and supported weapons.';
