// Presentation of the prepared campaign's supported actions. The engine remains
// responsible for legality, dice, target validation and resource spending.
export function abilityDescription(id,{slotLevel=1,resources={},dm=false}={}) {
 const slot=`One level-${slotLevel} spell slot (${resources[slotLevel===2?'spellSlots2':'spellSlots1']??0} remaining).`;
 const channel=`One Channel Divinity use (${resources.channelDivinity??0} remaining).`;
 const descriptions={
  'second-wind':`Bonus action. Restore 1d10 + 3 HP to yourself. One Second Wind use (${resources.secondWind??0} remaining).`,
  'action-surge':`After spending your action this turn, gain another action. One Action Surge use (${resources.actionSurge??0} remaining).`,
  'cunning-dash':'Bonus action. Gain movement equal to your current speed for this turn.',
  'cunning-disengage':'Bonus action. Your movement avoids opportunity attacks for this turn.',
  'steady-aim':'Bonus action, before moving. Advantage on your next attack this turn; you cannot move this turn.',
  'tactical-mind':`After an eligible failed ability check, add 1d10. Spend one Second Wind use only if it succeeds (${resources.secondWind??0} remaining).`,
  'sacred-flame':'Action. A visible enemy within 60 feet makes a Dexterity save; on failure, 1d8 radiant damage. No spell slot.',
  'cure-wounds':`Action. Heal an adjacent ally for ${2*slotLevel}d8 + Wisdom, plus the Life Domain bonus. ${slot}`,
  'healing-word':`Bonus action. Heal a visible ally within 60 feet for ${2*slotLevel}d4 + Wisdom, plus the Life Domain bonus. ${slot}`,
  'initiate-healing-word':`Bonus action. Heal a visible ally within 60 feet for 2d4 + Wisdom. Uses the origin spell's free daily casting (${resources.initiateSpellUses??0} remaining); no spell slot.`,
  'bless':`Action. Chosen allies within 30 feet add 1d4 to attacks and saves. Concentration, up to one minute; replaces your current concentration. ${slot}`,
  'guiding-bolt':`Action. Spell attack against a visible enemy within 120 feet for ${slotLevel+3}d6 radiant damage. On a hit, the next attack against it gains advantage before your next turn ends. ${slot}`,
  'divine-spark-heal':`Action. Restore 1d8 + Wisdom HP to one visible creature within 30 feet. ${channel}`,
  'divine-spark-radiant':`Action. One visible enemy within 30 feet makes a Constitution save against 1d8 + Wisdom radiant damage; half on success. ${channel}`,
  'preserve-life':`Action. Restore up to 15 HP to ONE visible creature within 30 feet, stopping at half its maximum HP. ${channel} Distributing healing among several creatures needs DM review.`,
  'aid':`Action. Chosen visible allies within 30 feet gain 5 maximum and current HP for eight hours. Does not stack with itself. ${slot}`,
  'lesser-restoration':`Bonus action. Remove one eligible blinded, deafened, paralyzed or poisoned condition from an adjacent creature. ${slot}`,
  'spare-the-dying':'Action. Stabilize a living creature at zero HP within 15 feet. No spell slot or HP recovery.',
  'innate-detect-magic':`Ask the DM what magic you perceive. Approval spends an action and one innate daily use (${resources.innateSpellUses??0} remaining), and starts concentration for up to ten minutes.`,
  'cunning-hide':'Ask the DM to assess cover, concealment and your Stealth check. Approval spends your bonus action; it does not automatically make you invisible.',
  'fast-hands':'Describe the object or tool task for the DM. Approval spends your bonus action; any item or lock outcome requires the corresponding ruling.',
  'turn-undead':`Ask the DM to resolve eligible undead and saves. Approval spends an action. ${channel} The current mission does not automatically resolve the affected group.`,
  'prestidigitation':'Describe a small magical effect for the DM. Approval spends an action; no spell slot.',
  'light':'Tell the DM which object should shine. Approval spends an action; the DM must also apply the appropriate lighting or disclosure ruling.',
  'thaumaturgy':'Describe a minor supernatural sign for the DM. Approval spends an action; no spell slot.',
  'detect-magic':`Ask the DM to interpret magical auras and apply any required concentration ruling. Approval spends an action. ${slot}`,
  'purify-food-and-drink':`Describe the food or drink to the DM. Approval spends an action. ${slot}`,
  'detect-poison-and-disease':`Ask the DM what the spell reveals and to track its concentration. Approval spends an action. ${slot}`,
  'create-or-destroy-water':`Describe the water effect and location to the DM. Approval spends an action. ${slot}`,
  'command':`Give the DM the intended one-word command and target. Approval spends an action and a slot; the DM resolves the save and legal effect. ${slot}`,
  'guidance':'Ask the DM to apply Guidance to the eligible ability check and track concentration. No automatic bonus is added by merely approving this request.',
  'ritual-casting':'Ask the DM to confirm a prepared ritual, its extra ten-minute casting time and effect. Approval alone does not advance time or spend a slot.',
  'alert':'The initiative bonus is already included. Ask the DM about a consensual initiative swap; this table does not currently reorder initiative for that request.',
  'weapon-mastery':'Prepared weapon effects are already included where supported. Ask the DM about a different mastery or target choice.',
  'remarkable-athlete':'Initiative advantage and the extra movement after a critical hit are included. Ask the DM about an Athletics ruling.',
  'second-story-work':'Describe your climb or jump. The DM checks the route and movement cost before resolving it.',
  'fey-ancestry':'Ask the DM to apply the appropriate protection when a charm effect calls for a save.',
  'thieves-cant':'Describe the coded message or signs to the DM. Only an explicit in-game communication shares it with another character.'
 };
 return descriptions[id]??(dm?'Describe the feature and desired effect for the DM. No resources are spent until an applicable cost is approved.':'Review this feature with the DM before use.');
}

export const standardActionDescription=id=>({dash:'Action. Gain movement equal to your speed for this turn.',disengage:'Action. Your movement avoids opportunity attacks for this turn.',dodge:'Action. Attacks against you have disadvantage while Dodge applies; the engine resolves supported modifiers.',stand:'Spend half your speed to stand up from prone; no action.'}[id]??'Review the action with the DM.');

export function featureDescription(id,resources={},{inspirationRulesVersion,preserveLife}={}) {
 if(id==='preserve-life'&&preserveLife)return `Magic action. Spend one Channel Divinity to divide up to ${preserveLife.pool} HP among eligible recipients within 30 feet, including yourself. Each recipient can be healed only to half maximum HP. Choose Preserve Life · Divide healing to assign amounts; unused healing is not redirected.`;
 const passive={
  'champion-critical':'Your weapon attacks score a critical hit on a natural 19 or 20. Included in attack resolution.',
  'sneak-attack':'The prepared rogue adds 2d6 damage on a qualifying finesse or ranged hit, once per turn. The engine checks advantage, disadvantage and a nearby ally.',
  'savage-attacker':'Once per turn, the prepared fighter rolls the weapon damage dice twice and keeps the higher result. Included in weapon attacks.',
  'defense':'Defense adds +1 AC while you are wearing armor. The displayed AC already includes the bonus when it applies.',
  'disciple-of-life':'Healing from the prepared Life cleric’s supported healing spells gains 2 + the slot level. The free origin casting does not spend a slot.',
  'divine-order-protector':'Martial weapon and heavy armor training are included in the prepared cleric’s sheet.',
  'expertise':'Kestrel’s doubled proficiency in Stealth and Investigation is already included in the listed skill modifiers.',
  'keen-senses':'Kestrel’s selected Perception proficiency is already included in the skill modifier and passive Perception.',
  'trance':'The prepared high elf’s long-rest recovery takes four hours of Trance. The DM must still confirm that the rest was uninterrupted.',
  'human-resourceful':`Heroic Inspiration: ${resources.heroicInspiration?'available':'spent'}. ${inspirationRulesVersion===1?'Eligible rolls pause for your private Keep or Reroll choice. Reroll spends Inspiration and you must use the replacement, even if it is lower.':'General die rerolls require DM review; they are not currently offered as an automatic control.'}`,
  'human-skillful':'The human’s selected extra skill proficiency is included in the listed skill modifiers.',
  'skilled':'The approved extra skill proficiencies are included in the sheet. Use the listed modifiers when the DM requests a check.'
 };
 return passive[id]??abilityDescription(id,{resources,slotLevel:['aid','lesser-restoration'].includes(id)?2:1,dm:true});
}
