import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignFeed } from './campaign-feed-contract.mjs';
import { campaignFeedRoute, createCampaignFeedAdapter } from './campaign-feed-adapter.mjs';

test('campaign feed routes reject malformed IDs and parse open/refresh', () => {
  assert.deepEqual(campaignFeedRoute('campaign:open:briar'), { action: 'open', campaignId: 'briar' });
});

test('campaign feed adapter authorizes, projects and responds to open', async () => {
  const calls = []; const feed = createCampaignFeed({ campaignId: 'briar' });
  const handler = createCampaignFeedAdapter({
    readFeed: async id => id === 'briar' ? feed : null,
    authorize: async () => ({ campaignId: 'briar', actorId: 'p1', title: 'Briar feed' }),
    transport: { respond: async (...args) => calls.push(['respond', ...args]), edit: async () => {} },
  });
  assert.equal(await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } }), true);
  assert.equal(calls[0][0], 'respond'); assert.equal(calls[0][2].type, 4); assert.equal(calls[0][2].data.embeds[0].title, 'Briar feed');
});

test('campaign feed adapter uses edit for refresh and does not handle unrelated controls', async () => {
  const calls = []; const feed = createCampaignFeed({ campaignId: 'briar' });
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'p1' }), transport: { respond: async () => {}, edit: async (...args) => calls.push(args) } });
  assert.equal(await handler({ data: { custom_id: 'other:control' } }), false);
  assert.equal(await handler({ application_id: 'app', token: 't1', data: { custom_id: 'campaign:refresh:briar' } }), true);
  assert.equal(calls.length, 1);
});
