import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCES, addFact, appendEvent, createCampaignFeed, recordRoll, requestCheck, requestPurchase, setShop, shareFact, submitIntent } from './campaign-feed-contract.mjs';
import { renderCampaignFeed } from './campaign-feed-renderer.mjs';

test('party rendering keeps the interaction surface compact and natural-language first', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = appendEvent(feed, { actorId: 'Raphael', text: 'A secret is nearby.', resolution: { kind: 'cue' } });
  const payload = renderCampaignFeed(feed);
  assert.equal(payload.embeds[0].fields.find(field => field.name === 'Raphael · system').value, 'A secret is nearby.');
  assert.equal(payload.components[0].components[0].label, 'Roll required die');
  assert.equal(payload.components[1].components[0].type, 2);
  assert.equal(payload.components[1].components[0].custom_id, 'campaign:say:demo:1');
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

test('pending checks show the rule and every actor roll state', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  ({ feed } = requestCheck(feed, { requestId: 'door', actorIds: ['p1', 'p2'], ability: 'Wisdom', skill: 'Perception', count: 1, sides: 20, modifiers: { proficiency: 2 } }));
  const payload = renderCampaignFeed(feed);
  const checkField = payload.embeds[0].fields.find(field => field.name.startsWith('Check ·'));
  assert.match(checkField.value, /Wisdom \(Perception\) · 1d20/);
  assert.match(checkField.value, /p1: awaiting roll/);
  assert.match(checkField.value, /p2: awaiting roll/);
});

test('private player rendering includes only that player roll event', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  ({ feed } = requestCheck(feed, { requestId: 'door', actorIds: ['p1', 'p2'], ability: 'Wisdom', skill: 'Perception' }));
  const revision = feed.revision;
  ({ feed } = recordRoll(feed, { requestId: 'door', actorId: 'p1', dice: [15], expectedRevision: revision, roll: { modifier: 3 } }));
  const p1 = renderCampaignFeed(feed, { viewer: 'p1', title: 'Rowan · private feed' });
  const p2 = renderCampaignFeed(feed, { viewer: 'p2', title: 'Mira · private feed' });
  assert.match(p1.embeds[0].fields.at(-1).value, /rolled Perception/);
  assert.equal(p2.embeds[0].fields.some(field => /rolled Perception/.test(field.value)), false);
});

test('paused feed disables the dice action visibly', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = { ...feed, paused: true };
  const payload = renderCampaignFeed(feed);
  assert.equal(payload.components[0].components[0].disabled, true);
  assert.match(payload.components[0].components[0].label, /Paused/);
});

test('feed footer summarizes pending DM queues without exposing private text', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = appendEvent(feed, { actorId: 'p1', audience: AUDIENCES.DM, playerId: 'p1', text: 'I inspect the lock.', resolution: { kind: 'intent', requestId: 'i1' } });
  const payload = renderCampaignFeed(feed);
  assert.match(payload.embeds[0].footer.text, /0 pending actions/);
  const dm = renderCampaignFeed(feed, { viewer: AUDIENCES.DM });
  assert.match(dm.embeds[0].footer.text, /1 pending actions/);
});

test('DM footer counts a pending purchase request', () => {
  let feed = setShop(createCampaignFeed({ campaignId: 'demo' }), { shopId: 'shop', name: 'Briar Apothecary', inventory: [{ id: 'potion', name: 'Healing Draught' }] });
  feed = requestPurchase(feed, { requestId: 'buy-1', actorId: 'p1', itemId: 'potion', text: 'I buy it.' }).feed;
  const dm = renderCampaignFeed(feed, { viewer: AUDIENCES.DM });
  assert.match(dm.embeds[0].footer.text, /1 pending purchases/);
});

test('private player feed offers sharing only for that player’s unshared facts', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = addFact(feed, { id: 'fact-1', ownerId: 'p1', kind: 'clue', text: 'A loose stone.', sourceEventId: 'event-1' });
  const player = renderCampaignFeed(feed, { viewer: 'p1' });
  const other = renderCampaignFeed(feed, { viewer: 'p2' });
  assert.equal(player.components[0].components.some(button => button.label === 'Share information'), true);
  assert.equal(other.components[0].components.some(button => button.label === 'Share information'), false);
  const shared = shareFact(feed, 'p1', 'fact-1');
  const after = renderCampaignFeed(shared.feed, { viewer: 'p1' });
  assert.equal(after.components[0].components.some(button => button.label === 'Share information'), false);
  assert.equal(player.components[0].components.some(button => button.label === 'Refresh private feed'), true);
  assert.equal(other.components[0].components.some(button => button.label === 'Refresh private feed'), true);
});
