// Observed field rectangles in the official 2024 cropped sheet (603 x 774 pt), NOT a rules source.
// https://media.dndbeyond.com/compendium-images/free-rules/downloads/2024-character-sheet.pdf
// Never apply TextN aliases to arbitrary forms: structural anchors must match.
import { normalize, addEvidence, FIELDS } from './model.mjs';
export const OFFICIAL_CORE = [
  ['name', 'Text1', 26, 743, 244, 759], ['background', 'Text6', 25, 723, 144, 736],
  ['classes', 'Text7', 148, 723, 245, 736], ['species', 'Text8', 25, 701, 143, 715],
  ['subclass', 'Text9', 148, 701, 246, 715], ['level', 'Text11', 262, 727, 289, 749],
  ['armorClass', 'Text13', 321, 715, 357, 737], ['currentHp', 'Text14', 378, 702, 426, 729],
  ['tempHp', 'Text15', 438, 724, 481, 737], ['maxHp', 'Text16', 438, 703, 481, 716],
  ['proficiencyBonus', 'Text19', 42, 606, 73, 628],
  ['intelligenceModifier', 'Text20', 136, 615, 164, 637], ['strengthModifier', 'Text21', 29, 538, 58, 560],
  ['dexterityModifier', 'Text22', 29, 421, 57, 443], ['wisdomModifier', 'Text23', 135, 442, 164, 464],
  ['constitutionModifier', 'Text24', 29, 275, 58, 297], ['charismaModifier', 'Text25', 135, 268, 164, 290],
  ['initiative', 'Text26', 242, 622, 284, 644], ['speed', 'Text27', 333, 622, 381, 644],
  ['passivePerception', 'Text29', 521, 622, 573, 644],
  ['intelligence', 'Text63', 170, 613, 193, 635], ['strength', 'Text64', 63, 536, 87, 558],
  ['wisdom', 'Text65', 169, 438, 192, 460], ['dexterity', 'Text66', 63, 418, 86, 440],
  ['constitution', 'Text67', 62, 272, 88, 294], ['charisma', 'Text68', 168, 265, 192, 287],
];
const OTHER_FIELDS = {
  Text54: 'features', Text55: 'features', Text57: 'features', Text58: 'features', Text59: 'notes', Text60: 'notes',
  Text69: 'intelligenceSave', Text70: 'arcana', Text71: 'history', Text72: 'investigation', Text73: 'nature', Text74: 'religion',
  Text75: 'wisdomSave', Text76: 'animalhandling', Text77: 'insight', Text78: 'medicine', Text79: 'perception', Text80: 'survival',
  Text81: 'charismaSave', Text82: 'deception', Text83: 'intimidation', Text84: 'performance', Text85: 'persuasion',
  Text86: 'constitutionSave', Text87: 'dexteritySave', Text88: 'acrobatics', Text89: 'sleightofhand', Text90: 'stealth',
  Text91: 'strengthSave', Text92: 'athletics', Text93: 'spellModifier', Text94: 'spellSaveDc', Text95: 'spellAttack',
  Text96: 'notes', Text97: 'notes', Text98: 'notes', Text99: 'equipment', Text100: 'notes',
  Text101: 'equipment', Text102: 'equipment', Text103: 'equipment', Text111: 'spellAbility',
  Text112: 'slots1', Text113: 'slots2', Text114: 'slots3', Text117: 'slots4', Text116: 'slots5', Text115: 'slots6',
  Text118: 'slots7', Text119: 'slots8', Text120: 'slots9',
};
export function officialForm(annotations, width, height) {
  return Math.abs(width - 603) < 2 && Math.abs(height - 774) < 2 && ['Text1', 'Text13', 'Text64'].every(name => {
    const row = OFFICIAL_CORE.find(row => row[1] === name);
    const found = annotations.find(a => a.fieldName === name);
    return found?.rect && found.rect.every((value, index) => Math.abs(value - row[index + 2]) < 2);
  });
}
export function officialKey(name) {
  const core = OFFICIAL_CORE.find(row => row[1] === name);
  if (core) return core[0];
  if (OTHER_FIELDS[name]) return OTHER_FIELDS[name];
  const number = Number(/^Text(\d+)$/.exec(name)?.[1]);
  if (number >= 30 && number <= 53) return 'attacks';
  if ([105, 106, 107, 108, 109].includes(number) || (number >= 121 && number <= 265 && number !== 226) || number === 266) return 'spells';
  if (number === 226 || number >= 267 && number <= 270) return 'equipment';
  return null;
}
export function officialValue(name, key, value) {
  if (key === 'attacks') {
    const number = Number(name.slice(4)) - 30;
    return `Weapon ${Math.floor(number / 4) + 1} ${['name', 'attack bonus / DC', 'damage & type', 'notes'][number % 4]}: ${value}`;
  }
  if (['spells', 'equipment', 'features', 'notes'].includes(key)) return `${name}: ${value}`;
  return value;
}
export function isOfficialPositioned(items) {
  // Sparse OCR may interleave adjacent columns between HEROIC and INSPIRATION.
  // Check the words plus their geometry, not an assumed reading order.
  const words = new Set(items.flatMap(item => item.text.split(/\s+/).map(normalize)));
  if (!['heroic', 'inspiration', 'weapons', 'damage', 'cantrips', 'species', 'traits'].every(word => words.has(word))) return false;
  // Anchor positions also prevent recognizing a page merely quoting these labels.
  const strength = items.find(item => normalize(item.text) === 'strength');
  if (!strength || Math.abs(strength.x - 22) > 30 || Math.abs(strength.y - 199) > 22) return false;
  const heroic = items.find(item => normalize(item.text).startsWith('heroic'));
  if (!heroic || Math.abs(heroic.x - 44) > 22 || Math.abs(heroic.y - 559) > 15) return false;
  return true;
}
export function officialPositioned(draft, items, page, method, confidence) {
  if (!isOfficialPositioned(items)) return false;
  for (const [key, , x0, y0, x1, y1] of OFFICIAL_CORE) {
    const inside = items.filter(item => {
      const cx = item.x + item.width / 2;
      return cx >= x0 - 1 && cx <= x1 + 1 && item.y >= 774 - y1 - 2 && item.y <= 774 - y0 + 2;
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    const value = inside.map(item => item.text).join(' ');
    if (value) addEvidence(draft, key, value, { page, method, confidence });
  }
  // The skill/saving-throw columns have one numeric cell per line.
  for (const [name, key] of Object.entries(OTHER_FIELDS)) {
    if (!FIELDS[key] || Number(name.slice(4)) < 69 || Number(name.slice(4)) > 92) continue;
    const label = items.find(item => normalize(item.text) === normalize(FIELDS[key].label));
    if (!label) continue;
    const value = items.filter(item => Math.abs(item.y - label.y) < 5 && item.x < label.x && label.x - item.x < 30);
    if (value.length === 1) addEvidence(draft, key, value[0].text, { page, method, confidence });
  }
  return true;
}
