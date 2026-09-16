import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCES, appendEvent, createCampaignFeed } from './campaign-feed-contract.mjs';
import { campaignFeedRoute, createCampaignFeedAdapter } from './campaign-feed-adapter.mjs';

test('campaign feed routes reject malformed IDs and parse open/refresh', () => {
  assert.deepEqual(campaignFeedRoute('campaign:open:briar'), { action: 'open', campaignId: 'briar', privateView: false });
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

test('campaign feed natural-language button opens a modal', async () => {
  const calls = [];
  const handler = createCampaignFeedAdapter({
    readFeed: async () => createCampaignFeed({ campaignId: 'briar', revision: 3 }),
    authorize: async (_interaction, route) => ({ campaignId: route.campaignId, actorId: 'p1' }),
    transport: { respond: async (...args) => calls.push(args), edit: async () => {} },
  });
  assert.equal(await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:say:briar:3' } }), true);
  assert.equal(calls[0][2].type, 9);
  assert.equal(calls[0][2].data.custom_id, 'campaign:say:briar:3:submit');
  assert.equal(calls[0][2].data.components[0].component.custom_id, 'intent');
});

test('campaign feed modal submission stores the private intent and acknowledges the party update', async () => {
  const calls = []; let feed = createCampaignFeed({ campaignId: 'briar' });
  const handler = createCampaignFeedAdapter({
    readFeed: async () => feed,
    writeFeed: async next => { feed = next; return { saved: true, feed: next }; },
    authorize: async (_interaction, route) => ({ campaignId: route.campaignId, actorId: 'p1' }),
    transport: { respond: async (...args) => calls.push(args), edit: async () => {} },
  });
  await handler({ id: 'intent-1', token: 't1', data: { custom_id: 'campaign:say:briar:0:submit', components: [{ type: 18, component: { type: 4, custom_id: 'intent', value: 'I listen at the upstairs doorway.' } }] } });
  assert.equal(feed.revision, 1);
  assert.equal(feed.events.at(-1).audience, AUDIENCES.DM);
  assert.equal(feed.events.at(-1).text, 'I listen at the upstairs doorway.');
  assert.equal(calls[0][2].data.flags, 64);
});

test('campaign feed roll button auto-selects the pending check dice', async () => {
  const calls = []; let feed = createCampaignFeed({ campaignId: 'briar' });
  const requested = (await import('./campaign-feed-contract.mjs')).requestCheck(feed, { requestId: 'door', actorIds: ['p1'], ability: 'Wisdom', skill: 'Perception', count: 1, sides: 20 });
  feed = requested.feed;
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, writeFeed: async next => { feed = next; }, roll: () => [17], authorize: async (_interaction, route) => ({ campaignId: route.campaignId, actorId: 'p1' }), transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  await handler({ id: 'roll-1', token: 't1', data: { custom_id: `campaign:roll:briar:${feed.revision}` } });
  assert.equal(feed.checks.get('door').results.p1.total, 17);
  assert.match(calls[0][2].data.content, /Wisdom \(Perception\)/);
});

test('campaign feed adapter uses edit for refresh and does not handle unrelated controls', async () => {
  const calls = []; const feed = createCampaignFeed({ campaignId: 'briar' });
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'p1' }), transport: { respond: async () => {}, edit: async (...args) => calls.push(args) } });
  assert.equal(await handler({ data: { custom_id: 'other:control' } }), false);
  assert.equal(await handler({ application_id: 'app', token: 't1', data: { custom_id: 'campaign:refresh:briar' } }), true);
  assert.equal(calls.length, 1); assert.equal(calls[0][2].flags, undefined);
});

test('campaign feed adapter renders the DM projection for a DM scope', async () => {
  const calls = []; let feed = createCampaignFeed({ campaignId: 'briar' });
  feed = appendEvent(feed, { actorId: 'Raphael', audience: AUDIENCES.DM, text: 'The hidden passage is behind the shelf.' });
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'dm-1', isDm: true }), transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } });
  assert.match(calls[0][2].data.embeds[0].fields[1].value, /hidden passage/); assert.equal(calls[0][2].data.flags & 64, 64);
});

test('campaign feed open is public while private route is ephemeral and player-scoped', async () => {
  let feed = createCampaignFeed({ campaignId: 'briar' }); feed = appendEvent(feed, { actorId: 'p1', audience: 'player', playerId: 'p1', text: 'Private clue.' });
  const calls = [];
  const handler = createCampaignFeedAdapter({ readFeed: async () => feed, authorize: async () => ({ campaignId: 'briar', actorId: 'p1' }), transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } });
  assert.equal(calls[0][2].data.flags, undefined); assert.equal(calls[0][2].data.embeds[0].fields.some(field => /Private clue/.test(field.value)), false);
  await handler({ id: 'i2', token: 't2', data: { custom_id: 'campaign:private:briar' } });
  assert.equal(calls[1][2].data.flags & 64, 64); assert.equal(calls[1][2].data.embeds[0].fields.some(field => /Private clue/.test(field.value)), true);
});

test('campaign feed adapter denies unauthorized viewers before transport', async () => {
  const calls = [];
  const handler = createCampaignFeedAdapter({ readFeed: async () => { throw new Error('must not read'); }, authorize: async () => null, transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  assert.equal(await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } }), true);
  assert.equal(calls[0][2].data.flags, 64); assert.match(calls[0][2].data.content, /access denied/);
});

test('campaign feed adapter acknowledges an unavailable feed privately', async () => {
  const calls = [];
  const handler = createCampaignFeedAdapter({ readFeed: async () => null, authorize: async () => ({ campaignId: 'briar', actorId: 'p1' }), transport: { respond: async (...args) => calls.push(args), edit: async () => {} } });
  assert.equal(await handler({ id: 'i1', token: 't1', data: { custom_id: 'campaign:open:briar' } }), true);
  assert.equal(calls[0][2].data.flags, 64); assert.match(calls[0][2].data.content, /unavailable/);
});
