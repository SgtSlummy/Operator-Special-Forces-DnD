import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCES, appendEvent, createCampaignFeed, requestCheck } from './campaign-feed-contract.mjs';
import { renderCampaignFeed } from './campaign-feed-renderer.mjs';

test('party rendering keeps the interaction surface compact and natural-language first', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = appendEvent(feed, { actorId: 'Raphael', text: 'A secret is nearby.', resolution: { kind: 'cue' } });
  const payload = renderCampaignFeed(feed);
  assert.equal(payload.embeds[0].fields[0].value, 'A secret is nearby.');
  assert.equal(payload.components[0].components[0].label, 'Roll required die');
  assert.equal(payload.components[1].components[0].type, 4);
  assert.equal(payload.components.length, 2);
});

test('DM rendering exposes ruling only when a check is pending', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  ({ feed } = requestCheck(feed, { requestId: 'door', actorIds: ['p1'], ability: 'Wisdom', skill: 'Perception' }));
  const dm = renderCampaignFeed(feed, { viewer: AUDIENCES.DM });
  const player = renderCampaignFeed(feed, { viewer: 'p1' });
  assert.equal(dm.components.at(-1).components[0].label, 'Rule pending checks');
  assert.equal(player.components.length, 2);
});
