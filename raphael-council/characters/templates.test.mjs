import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_CORE, officialForm, isOfficialPositioned, officialKey } from './templates.mjs';
test('anonymous form mappings require known geometry, not just a TextN field name', () => {
  const annotations = OFFICIAL_CORE.map(([, fieldName, ...rect]) => ({ fieldName, rect }));
  assert.equal(officialForm(annotations, 603, 774), true);
  assert.equal(officialForm(annotations, 612, 792), false);
  assert.equal(officialForm([{ fieldName: 'Text1', rect: [0, 0, 10, 10] }], 603, 774), false);
  assert.equal(officialKey('Text66'), 'dexterity');
});
test('sparse OCR can interleave columns without losing a positively located template', () => {
  const items = ['HEROIC', 'Deception', 'INSPIRATION', 'WEAPONS', '&', 'DAMAGE', 'CANTRIPS', 'SPECIES', 'TRAITS'].map(text => ({ text, x: 44, y: 559, width: 20 }));
  items.push({ text: 'STRENGTH', x: 37, y: 194, width: 40 });
  assert.equal(isOfficialPositioned(items), true);
  assert.equal(isOfficialPositioned(items.map(item => ({ ...item, y: item.y + 60 }))), false);
});
