import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCard } from './deck.mjs';

test('My Hero exposes a PDF import without player commands', () => {
  const card = renderCard('hero', { session: 'greyharbor', view: 'test', revision: 0 });
  const buttons = card.components.slice(1).flatMap(row => row.components);
  assert.ok(buttons.some(button => button.label === 'Import PDF'), 'My Hero must offer Import PDF');
  assert.equal(card.flags & 64, 64);
});
