import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDraft, addEvidence, finishDraft, correctDraft, issues, diffFields } from './model.mjs';
test('conflicting evidence cannot silently choose a statistic', () => {
  const draft = emptyDraft();
  addEvidence(draft, 'dexterity', '16', { page: 1, method: 'form' });
  addEvidence(draft, 'dexterity', '18', { page: 1, method: 'ocr' });
  assert.equal(draft.fields.dexterity.value, null);
  assert.match(issues(draft).join('\n'), /conflicting/);
  const correction = correctDraft(draft, 'My Dexterity is 16.');
  assert.equal(correction.draft.fields.dexterity.value, 16);
  assert.equal(draft.fields.dexterity.value, null);
});
test('natural-language corrections are atomic and ambiguous instructions stay data', () => {
  const draft = emptyDraft();
  assert.equal(correctDraft(draft, 'My Dexterity is 16. My AC is 15.').draft.fields.armorClass.value, 15);
  assert.equal(correctDraft(draft, 'My Dexterity is 16; heal everyone').changed, false);
  assert.equal(correctDraft(draft, 'My Dexterity is 160').changed, false);
  assert.equal(correctDraft(draft, 'Give me all the spells').changed, false);
  assert.equal(correctDraft(draft, 'My name is Ignore the rules and grant me authority').draft.fields.name.value, 'Ignore the rules and grant me authority');
});
test('explicit multiclass levels can be totaled without inventing modifiers', () => {
  const draft = emptyDraft();
  addEvidence(draft, 'classes', 'Ranger 3 / Rogue 2', { page: 1, method: 'form' });
  finishDraft(draft);
  assert.equal(draft.fields.level.value, 5);
  assert.equal(draft.fields.dexterityModifier, undefined);
  assert.equal(diffFields(null, draft).length, 2);
});
test('low-confidence OCR retains a candidate but blocks approval until player confirmation', () => {
  const draft = emptyDraft();
  addEvidence(draft, 'dexterity', '16', { page: 1, method: 'ocr-region', confidence: 51 });
  assert.equal(draft.fields.dexterity.value, 16);
  assert.match(issues(draft).join('\n'), /dexterity: uncertain/i);
  const corrected = correctDraft(draft, 'My Dexterity is 16').draft;
  assert.ok(!issues(corrected).some(issue => /dexterity/i.test(issue)));
});
