import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test('campaign feed store survives close and reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'campaign-feed-')), 'feed.sqlite');
  let store = new CampaignFeedStore(path); let feed = store.create('briar'); feed = appendEvent(feed, { actorId: 'system', text: 'Saved before restart.' }); store.write(feed, 0); store.close();
  store = new CampaignFeedStore(path); assert.equal(store.read('briar').events[0].text, 'Saved before restart.'); store.close();
});

test('campaign feed creation is idempotent for concurrent first opens', () => {
  const store = new CampaignFeedStore(); const first = store.create('briar'); const second = store.create('briar');
  assert.equal(first.campaignId, second.campaignId); assert.equal(second.revision, 0); store.close();
});

test('separate store instances can open the same new campaign safely', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'campaign-feed-workers-')), 'feed.sqlite');
  const first = new CampaignFeedStore(path); const second = new CampaignFeedStore(path);
  assert.doesNotThrow(() => { first.create('briar'); second.create('briar'); });
  assert.equal(first.read('briar').campaignId, 'briar'); assert.equal(second.read('briar').campaignId, 'briar');
  first.close(); second.close();
});
