import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCES, appendEvent, createCampaignFeed } from './campaign-feed-contract.mjs';
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
  assert.equal(calls[0][0], 'respond'); assert.equal(calls[0][3].type, 4); assert.equal(calls[0][3].data.embeds[0].title, 'Briar feed');
});

test('campaign feed adapter uses edit for refresh and does not handle unrelated controls', async () => {
  const calls = []; const feed = createCampaignFeed({ campaignId: 'briar' });
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'p1' }), transport: { respond: async () => {}, edit: async (...args) => calls.push(args) } });
  assert.equal(await handler({ data: { custom_id: 'other:control' } }), false);
  assert.equal(await handler({ application_id: 'app', token: 't1', data: { custom_id: 'campaign:refresh:briar' } }), true);
  assert.equal(calls.length, 1);
});

test('campaign feed adapter renders the DM projection for a DM scope', async () => {
  const calls = []; let feed = createCampaignFeed({ campaignId: 'briar' });
  feed = appendEvent(feed, { actorId: 'Raphael', audience: AUDIENCES.DM, text: 'The hidden passage is behind the shelf.' });
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'dm-1', isDm: true }), transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } });
  assert.match(calls[0][2].data.embeds[0].fields[1].value, /hidden passage/);
});

test('campaign feed adapter denies unauthorized viewers before transport', async () => {
  const calls = [];
  const handler = createCampaignFeedAdapter({ readFeed: async () => { throw new Error('must not read'); }, authorize: async () => null, transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  assert.equal(await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } }), true);
  assert.equal(calls[0][2].data.flags, 64); assert.match(calls[0][2].data.content, /access denied/);
});
