import { createHash } from 'node:crypto';
import { FIELDS, GROUPS } from '../characters/model.mjs';
import { coordinate } from '../maps/grid.mjs';
import { GameError } from './store.mjs';

const fail = (code, message) => { throw new GameError(code, message); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const field = (key, label, value) => ({ key, label, value });

export function getCharacterOptions(game, scope) {
  const view = game.view(scope);
  return { revision: view.revision, mapTitle: view.map.title, actors: view.actors.map(actor => ({ id: actor.id, label: actor.name, controlled: actor.controlled, defeated: actor.defeated })) };
}

function approvedSheet(characters, scope, actor) {
  if (!actor.controlled) return { status: 'private', groups: [] };
  // The importer accepts Discord player IDs. A game may also contain a local
  // host or test player identity that has no importer account at all.
  if (!characters || !/^\d{1,20}$/.test(scope.owner) || !/^[A-Za-z0-9_-]{1,64}$/.test(scope.campaign)) return { status: 'unavailable', groups: [] };
  const saved = characters.character(scope);
  if (saved === null) return { status: 'unavailable', groups: [] };
  // Corrupt storage or a failed database read is an error, not an empty sheet.
  if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 1 || !saved.snapshot || saved.snapshot.edition !== '2024' || !saved.snapshot.fields || typeof saved.snapshot.fields !== 'object' || Array.isArray(saved.snapshot.fields)) throw new Error('Invalid approved character record.');
  const identity = `approved-${saved.revision}-${createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16)}`;
  if (actor.characterVersion !== identity) return { status: 'updated', revision: saved.revision, edition: saved.snapshot.edition, groups: [] };
  const groups = GROUPS.filter(title => title !== 'Warnings & source').map(title => ({
    title: `Approved sheet · ${title}`,
    fields: Object.entries(FIELDS).filter(([, spec]) => spec.group === title).map(([key, spec]) => {
      const source = saved.snapshot.fields[key];
      const value = source?.value ?? null;
      if (source?.conflict || (source?.uncertain && !source.corrected) || (value !== null && (spec.min === null ? typeof value !== 'string' || value.length > 12000 : !Number.isSafeInteger(value) || value < spec.min || value > spec.max))) throw new Error('Invalid approved character field.');
      return field(`sheet.${key}`, spec.label, value);
    }),
  }));
  return { status: 'matched', revision: saved.revision, edition: saved.snapshot.edition, groups };
}

/** Shared display data; all live facts come from the authorized game view. */
export function getCharacterInfo(game, characters, scope, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['actorId', 'expectedRevision'].includes(key)) || !validId(input.actorId) || (Object.hasOwn(input, 'expectedRevision') && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0))) fail('INVALID', 'Choose a visible character from the current scene.');
  const view = game.view(scope);
  if (Object.hasOwn(input, 'expectedRevision') && input.expectedRevision !== view.revision) fail('STALE', 'The scene changed. Open the character again from the current view.');
  const source = view.actors.find(actor => actor.id === input.actorId);
  if (!source) fail('NOT_VISIBLE', 'Choose a character in your current visible scene.');
  const actor = {
    id: source.id, name: source.name,
    position: { x: source.x, y: source.y, coordinate: coordinate(source.x, source.y), size: source.size },
    controlled: source.controlled, defeated: source.defeated,
  };
  const groups = [{ title: source.controlled ? 'Your character on the map' : 'Visible character', fields: [
    field('token.name', 'Name', actor.name),
    field('token.coordinate', 'Position', actor.position.coordinate),
    field('token.size', 'Token footprint', `${actor.position.size} × ${actor.position.size} cells`),
    field('token.defeated', 'Defeated', actor.defeated),
  ] }];
  const notes = [];
  if (source.controlled) {
    actor.hp = source.hp; actor.maxHp = source.maxHp; actor.armorClass = source.ac;
    actor.speed = source.speed; actor.characterVersion = source.characterVersion;
    actor.weapon = Object.fromEntries(['name', 'abilityScore', 'proficiencyBonus', 'proficient', 'equipmentBonus', 'damageDice', 'damageDie', 'addAbilityToDamage', 'rangeFeet'].map(key => [key, source.weapon[key]]));
    actor.turn = {
      active: view.activeActorId === actor.id,
      movementRemaining: view.activeActorId === actor.id ? view.movementRemaining : null,
      actionAvailable: view.activeActorId === actor.id ? view.actionAvailable : null,
    };
    groups.push({ title: 'Live encounter statistics', fields: [
      field('live.hp', 'Current HP', actor.hp), field('live.maxHp', 'Maximum HP', actor.maxHp),
      field('live.armorClass', 'Armor class', actor.armorClass), field('live.speed', 'Normal speed (feet)', actor.speed),
    ] });
    groups.push({ title: 'Turn and resources', fields: [
      field('turn.phase', 'Encounter phase', view.phase), field('turn.round', 'Round', view.round), field('turn.number', 'Turn', view.turn),
      field('turn.active', 'This character’s turn', actor.turn.active),
      field('turn.movementRemaining', 'Movement remaining this turn (feet)', actor.turn.movementRemaining),
      field('turn.actionAvailable', 'Action available this turn', actor.turn.actionAvailable),
    ] });
    groups.push({ title: 'Configured weapon', fields: [
      field('weapon.name', 'Weapon', actor.weapon.name), field('weapon.rangeFeet', 'Range (feet)', actor.weapon.rangeFeet),
      field('weapon.abilityScore', 'Attack ability score', actor.weapon.abilityScore),
      field('weapon.proficiencyBonus', 'Proficiency bonus', actor.weapon.proficiencyBonus), field('weapon.proficient', 'Proficient with this weapon', actor.weapon.proficient),
      field('weapon.equipmentBonus', 'Equipment bonus', actor.weapon.equipmentBonus),
      field('weapon.damageDice', 'Damage dice count', actor.weapon.damageDice), field('weapon.damageDie', 'Damage die sides', actor.weapon.damageDie),
      field('weapon.addAbilityToDamage', 'Add ability modifier to damage', actor.weapon.addAbilityToDamage),
    ] });
    notes.push('Live encounter statistics and turn resources come from the saved game state.');
    if (!actor.turn.active) notes.push('It is another character’s turn. Your current-turn resource values are not available until your turn.');
    if (view.phase === 'paused') notes.push('Play is paused. Character information remains available, but movement and attacks wait until play resumes.');
    else if (view.phase !== 'combat') notes.push('This encounter is not active. Displayed resources do not authorize an action.');
    if (actor.defeated) notes.push('This character is defeated and cannot move or attack.');
  } else notes.push('Only visible information is shown. Another character’s private statistics and character sheet are not shared.');
  const sheet = approvedSheet(characters, scope, actor);
  if (sheet.status === 'matched') {
    groups.push(...sheet.groups);
    notes.push(`Approved 2024 sheet revision ${sheet.revision} matches this character’s encounter profile. Sheet resource values are source snapshots, not current encounter resources. Features, equipment, and spell text do not automatically enable game actions.`);
  } else if (sheet.status === 'updated') notes.push('The approved sheet does not match this encounter profile. Its fields are omitted until the host links the reviewed version.');
  else if (sheet.status === 'unavailable') notes.push('No approved character sheet is available for this player. The live encounter profile is still shown.');
  notes.push('Viewing character information spends no action, movement, time, or dice.');
  return { revision: view.revision, mapTitle: view.map.title, phase: view.phase, round: view.round, turn: view.turn, actor, sheet, groups, notes };
}
