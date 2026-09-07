import { createHash } from 'node:crypto';
import { ABILITIES } from '../characters/model.mjs';
import { GameError } from './store.mjs';
import { CombatProfileError, validateCombatCapabilities } from './combat-profile.mjs';

const fail = message => { throw new GameError('PROFILE', message); };
const keys = (value, allowed) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
function reviewedCapabilities(player, value, fields) {
  const input = player.combatCapabilities;
  if (input === undefined) return undefined;
  if (!keys(input, ['attackKind', 'meleeReachFeet', 'constitutionSave'])) fail('Provide explicit reviewed combat capabilities without overriding character statistics.');
  let constitutionSave;
  if (input.constitutionSave !== undefined) {
    const save = input.constitutionSave;
    if (!keys(save, ['proficient', 'proficiencyReason', 'adjustments', 'advantage', 'disadvantage']) ||
      typeof save.proficiencyReason !== 'string' || !save.proficiencyReason.trim() || save.proficiencyReason.length > 300) fail('Review Constitution save proficiency and record its source before enabling concentration saves.');
    constitutionSave = { abilityScore: value('constitution'), proficiencyBonus: value('proficiencyBonus'),
      proficient: save.proficient, adjustments: save.adjustments, advantage: save.advantage, disadvantage: save.disadvantage };
  }
  let result;
  try {
    result = validateCombatCapabilities({ ...input, ...(constitutionSave === undefined ? {} : { constitutionSave }) });
  } catch (error) {
    if (error instanceof CombatProfileError) fail(error.message);
    throw error;
  }
  if (result.attackKind === 'melee' && result.meleeReachFeet !== player.weapon.rangeFeet) fail('Reviewed melee reach must equal the configured weapon range.');
  if (constitutionSave && Object.hasOwn(fields, 'constitutionSave')) {
    const savedTotal = value('constitutionSave');
    const save = result.constitutionSave;
    const reviewedTotal = Math.floor((save.abilityScore - 10) / 2) + (save.proficient ? save.proficiencyBonus : 0) + save.adjustments.reduce((sum, adjustment) => sum + adjustment.value, 0);
    if (savedTotal !== reviewedTotal) fail('The reviewed Constitution save calculation differs from the approved sheet. Correct the sheet or review the declared mechanics.');
  }
  return result;
}
/** Trusted host operation: player profiles always come from approved importer records. */
export function bootstrapCampaign(game, characters, input) {
  if (!input || !Array.isArray(input.players) || !input.players.length || !Array.isArray(input.npcs) || !Array.isArray(input.members)) fail('Provide the reviewed player roster and NPC profiles.');
  if (!input.members.some(m => m.owner === input.reviewedBy && m.role === 'host') || input.mechanicsConfirmed !== true) fail('The host must confirm the encounter mechanics.');
  const actors = input.players.map(player => {
    if (!player || typeof player.owner !== 'string' || !input.members.some(m => m.owner === player.owner)) fail('Every player needs campaign membership.');
    const saved = characters.character({ campaign: input.campaign, owner: player.owner });
    if (!saved || saved.snapshot.edition !== '2024') fail('Approve the player’s 2024 character sheet before starting the encounter.');
    if (saved.revision !== player.expectedCharacterRevision) fail('The character changed. Review the current sheet revision.');
    const value = name => {
      const field = saved.snapshot.fields[name];
      if (!field || field.value == null || field.conflict || (field.uncertain && !field.corrected)) fail(`Confirm the character’s ${name} before starting the encounter.`);
      return field.value;
    };
    const weapon = player.weapon;
    if (!weapon || !ABILITIES.includes(weapon.ability) || Object.keys(weapon).some(k => !['name', 'ability', 'proficient', 'equipmentBonus', 'damageDice', 'damageDie', 'addAbilityToDamage', 'rangeFeet'].includes(k))) fail('Provide explicit reviewed weapon mechanics, without overriding character statistics.');
    const runtime = saved.runtime;
    if (!Number.isInteger(runtime.currentHp) || runtime.currentHp <= 0) fail('Resolve this character’s current HP before starting the encounter.');
    if (runtime.tempHp || runtime.conditions?.length || Object.values(runtime.spentSlots ?? {}).some(Boolean)) fail('This character has resources or conditions requiring the expanded rules adapter; do not silently discard them.');
    const digest = createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16);
    const combatCapabilities = reviewedCapabilities(player, value, saved.snapshot.fields);
    return { id: player.id, owner: player.owner, team: player.team, x: player.x, y: player.y, size: player.size, vision: player.vision, initiative: player.initiativeTotal,
      ...(combatCapabilities === undefined ? {} : { combatCapabilities }),
      ...(combatCapabilities?.constitutionSave ? { combatReview: { constitutionProficiencyReason: player.combatCapabilities.constitutionSave.proficiencyReason.trim() } } : {}),
      name: value('name'), hp: runtime.currentHp, maxHp: value('maxHp'), ac: value('armorClass'), speed: value('speed'), characterVersion: `approved-${saved.revision}-${digest}`,
      weapon: { name: weapon.name, abilityScore: value(weapon.ability), proficiencyBonus: value('proficiencyBonus'), proficient: weapon.proficient, equipmentBonus: weapon.equipmentBonus, damageDice: weapon.damageDice, damageDie: weapon.damageDie, addAbilityToDamage: weapon.addAbilityToDamage, rangeFeet: weapon.rangeFeet } };
  });
  if (input.npcs.some(actor => actor.owner !== null)) fail('NPC profiles cannot impersonate a player.');
  return game.createCampaign({ campaign: input.campaign, title: input.title, members: input.members, map: input.map, actors: [...actors, ...input.npcs], effects: input.effects });
}
