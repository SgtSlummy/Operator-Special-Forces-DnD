import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, createCampaignFeed } from './campaign-feed-contract.mjs';
import { CampaignFeedStore } from './campaign-feed-store.mjs';

test('campaign feed store round-trips maps and events', () => {
  const store = new CampaignFeedStore();
  let feed = store.create('briar'); feed = appendEvent(feed, { actorId: 'Raphael', text: 'A cue.' });
  assert.equal(store.write(feed, 0).saved, true);
  const loaded = store.read('briar'); assert.equal(loaded.events[0].text, 'A cue.'); assert.equal(loaded.mapNames.get('Briarhaven'), 'seed');
  store.close();
});

test('campaign feed store rejects stale writes', () => {
  const store = new CampaignFeedStore(); const feed = store.create('briar');
  assert.equal(store.write({ ...feed, revision: 1, events: [] }, 0).saved, true);
  const stale = store.write({ ...feed, revision: 2, events: [] }, 0);
  assert.equal(stale.saved, false); assert.equal(stale.reason, 'STALE_REVISION'); store.close();
});
