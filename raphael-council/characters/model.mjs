// Sheet contents are data. No prompt execution, rules lookup, or inferred proficiency.
export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export const SKILLS = ['acrobatics', 'animal handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight of hand', 'stealth', 'survival'];
export const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const descriptor = (label, aliases, group, min = null, max = null) => ({ label, aliases, group, min, max });
export const FIELDS = {
  name: descriptor('Character name', ['name', 'charactername'], 'Identity'),
  classes: descriptor('Class / level', ['class', 'classes', 'classlevel', 'classandlevel'], 'Identity'),
  level: descriptor('Level', ['level', 'totallevel', 'characterlevel'], 'Identity', 1, 20),
  background: descriptor('Background', ['background'], 'Identity'),
  species: descriptor('Species', ['species', 'race'], 'Identity'),
  subclass: descriptor('Subclass', ['subclass'], 'Identity'),
  armorClass: descriptor('AC', ['ac', 'armorclass', 'armourclass'], 'Statistics', 0, 99),
  maxHp: descriptor('Maximum HP', ['maxhp', 'hpmax', 'maximumhp', 'hitpointmaximum', 'hitpointsmaximum', 'maximumhitpoints', 'maxhitpoints'], 'Statistics', 1, 9999),
  currentHp: descriptor('Current HP (source snapshot)', ['currenthp', 'hpcurrent', 'currenthitpoints', 'hitpointscurrent'], 'Statistics', 0, 9999),
  tempHp: descriptor('Temporary HP (source snapshot)', ['temphp', 'hptemp', 'temporaryhp', 'temporaryhitpoints'], 'Statistics', 0, 9999),
  speed: descriptor('Speed', ['speed', 'walkingspeed'], 'Statistics', 0, 999),
  proficiencyBonus: descriptor('Proficiency bonus', ['proficiencybonus', 'profbonus'], 'Statistics', 0, 20),
  initiative: descriptor('Initiative', ['initiative'], 'Statistics', -30, 99),
  passivePerception: descriptor('Passive perception', ['passiveperception', 'passive', 'passivewisdomperception'], 'Statistics', 0, 99),
  attacks: descriptor('Attacks', ['attacks', 'attacksspellcasting', 'attacksandspellcasting', 'weaponsdamagecantrips'], 'Equipment & attacks'),
  equipment: descriptor('Equipment', ['equipment', 'inventory', 'possessions'], 'Equipment & attacks'),
  spells: descriptor('Spells', ['spells', 'preparedspells', 'spellsknown'], 'Spells'),
  features: descriptor('Features', ['features', 'featurestraits', 'featuresandtraits', 'classfeatures', 'feats'], 'Abilities & features'),
  notes: descriptor('Notes', ['notes', 'backstory', 'characterbackstory', 'otherproficiencieslanguages'], 'Abilities & features'),
  spellAbility: descriptor('Spellcasting ability', ['spellcastingability'], 'Spells'),
  spellModifier: descriptor('Spellcasting modifier', ['spellcastingmodifier'], 'Spells', -10, 20),
  spellSaveDc: descriptor('Spell save DC', ['spellsavedc', 'savedc'], 'Spells', 0, 99),
  spellAttack: descriptor('Spell attack bonus', ['spellattackbonus', 'spellatkbonus'], 'Spells', -30, 99),
};
for (const ability of ABILITIES) {
  const short = ability.slice(0, 3);
  FIELDS[ability] = descriptor(ability, [ability, short, `${ability}score`], 'Statistics', 1, 30);
  FIELDS[`${ability}Modifier`] = descriptor(`${ability} modifier`, [`${ability}modifier`, `${ability}mod`, `${short}mod`], 'Statistics', -10, 20);
  FIELDS[`${ability}Save`] = descriptor(`${ability} save`, [`${ability}save`, `${ability}savingthrow`, `savingthrow${ability}`, `st${ability}`], 'Saves & skills', -30, 99);
}
for (const skill of SKILLS) FIELDS[normalize(skill)] = descriptor(skill, [normalize(skill)], 'Saves & skills', -30, 99);
for (let level = 1; level <= 9; level++) {
  FIELDS[`slots${level}`] = descriptor(`Level ${level} spell slots`, [`slots${level}`, `spellslots${level}`, `spellslotstotal${level}`, `slotstotal${level}`], 'Spells', 0, 99);
}
export const REQUIRED = ['name', 'classes', 'level', ...ABILITIES, 'armorClass', 'maxHp'];
export const GROUPS = ['Identity', 'Statistics', 'Saves & skills', 'Abilities & features', 'Equipment & attacks', 'Spells', 'Warnings & source'];
export function fieldFor(label) {
  const n = normalize(label);
  return Object.keys(FIELDS).find(key => normalize(key) === n || FIELDS[key].aliases.includes(n)) ?? null;
}
export function parseValue(key, value) {
  const spec = FIELDS[key];
  const text = String(value).trim().replace(/−/g, '-');
  if (!text || !spec) return null;
  if (spec.min === null) return text.slice(0, 12000);
  const numeric = text.replace(/\s*(?:feet|ft\.?)$/i, '').trim();
  if (!/^[+-]?\d+$/.test(numeric)) return null;
  const number = Number(numeric);
  return Number.isSafeInteger(number) && number >= spec.min && number <= spec.max ? number : null;
}
export function emptyDraft() { return { schemaVersion: 1, edition: null, fields: {}, warnings: [], unknown: [] }; }
export function addEvidence(draft, key, raw, source) {
  if (!FIELDS[key] || raw === null || raw === undefined || String(raw).trim() === '') return;
  const value = parseValue(key, raw);
  const candidate = { value, raw: String(raw).slice(0, 12000), page: source.page ?? null, method: source.method, confidence: source.confidence ?? null };
  const entry = draft.fields[key] ??= { value: null, evidence: [], conflict: false, corrected: false };
  if (entry.evidence.length >= 50) return;
  entry.evidence.push(candidate);
  if (value !== null && source.confidence != null && source.confidence < 70) entry.uncertain = true;
  if (value === null) {
    draft.warnings.push(`Could not read ${FIELDS[key].label} on page ${source.page ?? '?'}.`);
  } else if (entry.value === null && !entry.conflict) entry.value = value;
  else if (entry.value !== value && FIELDS[key].min === null && ['spells', 'features', 'equipment', 'attacks', 'notes'].includes(key)) {
    if (!String(entry.value).includes(value)) entry.value = `${entry.value}\n${value}`.slice(0, 12000);
  } else if (entry.value !== value) { entry.value = null; entry.conflict = true; }
}
export function finishDraft(draft) {
  if (!draft.fields.level && draft.fields.classes?.value) {
    const chunks = [...draft.fields.classes.value.matchAll(/\b(Artificer|Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard)\s+(\d{1,2})\b/gi)];
    if (chunks.length) addEvidence(draft, 'level', chunks.reduce((sum, part) => sum + Number(part[2]), 0), {
      ...draft.fields.classes.evidence[0], method: 'explicit-class-levels', raw: undefined,
    });
  }
  draft.warnings = [...new Set(draft.warnings)];
  return draft;
}
export function issues(draft) {
  return Object.entries(FIELDS).flatMap(([key, spec]) => {
    const field = draft.fields[key];
    if (field?.conflict) return [`${spec.label}: conflicting readings; correct this field.`];
    if (field?.uncertain && !field.corrected) return [`${spec.label}: uncertain OCR; confirm or correct this value using Correct Details.`];
    if (REQUIRED.includes(key) && field?.value == null) return [`${spec.label}: required before approval.`];
    return [];
  });
}
export function correctDraft(draft, input) {
  if (typeof input !== 'string' || input.length > 1500) throw new Error('Correction is too long.');
  const statements = input.trim().split(/\n+|;\s*|\.\s+(?=(?:my|the)\s)/i).filter(Boolean);
  const changes = [];
  for (const statement of statements) {
    const match = statement.trim().replace(/\.$/, '').match(/^(?:(?:my|the)\s+)?(.+?)\s*(?:\s+is\s+|\s+are\s+|:|=)\s*(.+)$/i);
    const key = match && fieldFor(match[1]);
    if (!key) return { draft, changed: false, clarification: 'Name one field and its value, for example: My Dexterity is 16. For long text use Equipment: rope, lantern.' };
    const clear = /^(?:unknown|not provided|clear)$/i.test(match[2].trim());
    const value = clear ? null : parseValue(key, match[2]);
    if ((!clear && value === null) || changes.some(change => change.key === key)) return { draft, changed: false, clarification: `Please give one valid value for ${FIELDS[key].label}. Nothing was changed.` };
    changes.push({ key, value });
  }
  if (!changes.length) return { draft, changed: false, clarification: 'What field and value should change?' };
  const result = structuredClone(draft);
  for (const { key, value } of changes) result.fields[key] = { value, conflict: false, corrected: true,
    evidence: [...(result.fields[key]?.evidence ?? []), { value, raw: String(value), method: 'player-correction', page: null }].slice(-50) };
  return { draft: finishDraft(result), changed: true, clarification: null };
}
export function diffFields(before, after) {
  return Object.keys(FIELDS).filter(key => (before?.fields[key]?.value ?? null) !== (after.fields[key]?.value ?? null))
    .map(key => ({ key, label: FIELDS[key].label, before: before?.fields[key]?.value ?? null, after: after.fields[key]?.value ?? null }));
}
