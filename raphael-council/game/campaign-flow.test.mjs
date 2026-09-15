import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCampaignAction, createCampaignFlow, projectThreads } from './campaign-flow.mjs';

function atStore() {
  let state = createCampaignFlow();
  state = applyCampaignAction(state, { type: 'finish_combat', owner: 'dm', role: 'host' });
  state = applyCampaignAction(state, { type: 'record_debrief', owner: 'dm', role: 'host', notes: 'The courier survives and the party follows the tide road.' });
  state = applyCampaignAction(state, { type: 'open_store', owner: 'dm', role: 'host' });
  return state;
}

test('the always-on interval carries every encounter into a store-ready branch', () => {
  const state = atStore();
  assert.equal(state.phase, 'store');
  assert.deepEqual(state.alwaysBranch.resumePolicy, ['combat', 'aftermath', 'travel', 'store', 'ready']);
  assert.equal(projectThreads(state, { owner: 'player-1', role: 'player' }).store.store.title, 'Saltglass Outfitters');
});

test('store purchases change only the owner private wallet while the shared thread keeps prices and stock', () => {
  const before = atStore();
  const after = applyCampaignAction(before, { type: 'buy_item', owner: 'player-1', role: 'player', itemId: 'smoke-bead', quantity: 2 });
  const privateView = projectThreads(after, { owner: 'player-1', role: 'player' });
  const otherView = projectThreads(after, { owner: 'player-2', role: 'player' });
  assert.equal(privateView.player.wallet.gold, 50);
  assert.deepEqual(privateView.player.wallet.inventory, [{ itemId: 'smoke-bead', name: 'Smoke bead', quantity: 2 }]);
  assert.deepEqual(otherView.player.wallet.inventory, []);
  assert.equal(privateView.store.store.items.find(item => item.id === 'smoke-bead').stock, 6);
  assert.equal(privateView.store.messages.at(-1).summary, 'Smoke bead stock changed. Personal gold and inventory remain private.');
});

test('a perception or intelligence check reveals hidden cover only in the player projection', () => {
  const before = createCampaignFlow();
  const after = applyCampaignAction(before, { type: 'spot', owner: 'player-1', role: 'player', ability: 'perception', roll: 10, coord: 'H15' });
  const branna = projectThreads(after, { owner: 'player-1', role: 'player' });
  const pip = projectThreads(after, { owner: 'player-2', role: 'player' });
  const general = projectThreads(after, { owner: 'player-1', role: 'player' });
  const found = branna.player.map.cells.find(cell => cell.coord === 'H15');
  const hiddenFromPip = pip.player.map.cells.find(cell => cell.coord === 'H15');
  const hiddenFromGeneral = general.general.map.cells.find(cell => cell.coord === 'H15');
  assert.equal(found.cover, 'half');
  assert.equal(found.clue, 'A low outcropping breaks the sightline toward the abbey gate.');
  assert.equal(hiddenFromPip.cover, undefined);
  assert.equal(hiddenFromPip.terrain, 'unread terrain');
  assert.equal(hiddenFromGeneral.cover, undefined);
  assert.equal(hiddenFromGeneral.terrain, 'unread terrain');
});

test('only the host can advance the shared interval', () => {
  assert.throws(() => applyCampaignAction(createCampaignFlow(), { type: 'finish_combat', owner: 'player-1', role: 'player' }), /Only the campaign host/);
  const state = atStore();
  assert.throws(() => applyCampaignAction(state, { type: 'ready_next_scene', owner: 'player-1', role: 'player' }), /Only the campaign host/);
});
