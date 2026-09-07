#!/usr/bin/env node
/** Offline JSON preview. Never logs in to Discord or advances the game. */
import { CARDS, MODALS, renderCard, renderModal, validateDeck } from './deck.mjs';

const [kind = 'list', id] = process.argv.slice(2);
const context = { session: 'sample', view: 'preview', revision: 1 };

try {
  validateDeck();
  if (kind === 'list') {
    console.log(JSON.stringify({ cards: Object.keys(CARDS), modals: Object.keys(MODALS) }, null, 2));
  } else if (kind === 'card') {
    console.log(JSON.stringify(renderCard(id, context), null, 2));
  } else if (kind === 'modal') {
    console.log(JSON.stringify(renderModal(id, context), null, 2));
  } else {
    throw new Error('Usage: node discord/preview.mjs [list | card <id> | modal <id>]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
