import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCES, addFact, appendEvent, createCampaignFeed, discoverMapName, pauseFeed, projectFeed, publishCue, recordRoll, requestCheck, requestPurchase, resolveIntent, resolvePurchase, ruleCheck, setEncounter, setShop, shareFact, submitIntent } from './campaign-feed-contract.mjs';

const base = () => appendEvent(createCampaignFeed({ campaignId: 'silent-beacon' }), { actorId: 'dm', text: 'Only Briarhaven is named.', source: 'system' });

test('audience projection keeps private facts out of the party and other players', () => {
  let feed = appendEvent(base(), { actorId: 'Mira', audience: AUDIENCES.PLAYER, playerId: 'mira', text: 'Raphael: something is hidden.', source: 'dm' });
  assert.equal(projectFeed(feed, AUDIENCES.PARTY).some(event => event.text.includes('hidden')), false);
  assert.equal(projectFeed(feed, 'rowan').length, 1);
  assert.equal(projectFeed(feed, 'mira').some(event => event.text.includes('hidden')), true);
});

test('a player can share one owned fact exactly once', () => {
  let feed = addFact(base(), { id: 'cue', ownerId: 'mira', kind: 'cue', text: 'There is something hidden.', sourceEventId: 'e1' });
  const first = shareFact(feed, 'mira', 'cue'); feed = first.feed;
  assert.equal(first.changed, true); assert.equal(projectFeed(feed, AUDIENCES.PARTY).at(-1).text, 'shared cue: There is something hidden.');
  assert.equal(shareFact(feed, 'mira', 'cue').changed, false); assert.equal(shareFact(feed, 'rowan', 'cue').changed, false);
});

test('roll lifecycle enforces ownership, revision, one result and separate DM ruling', () => {
  let feed = base();
  const requested = requestCheck(feed, { requestId: 'check-1', actorIds: ['rowan'], ability: 'Wisdom', skill: 'Perception', modifiers: { rowan: 4 } }); feed = requested.feed;
  assert.equal(recordRoll(feed, { requestId: 'check-1', actorId: 'mira', dice: [12], expectedRevision: feed.revision, roll: { modifier: 4 } }).reason, 'NOT_AUTHORIZED');
  const rolled = recordRoll(feed, { requestId: 'check-1', actorId: 'rowan', dice: [14], expectedRevision: feed.revision, roll: { modifier: 4 } }); assert.equal(rolled.accepted, true); feed = rolled.feed;
  assert.equal(rolled.event.resolution.total, 18); assert.equal(rolled.event.resolution.status, 'awaiting_dm');
  assert.equal(recordRoll(feed, { requestId: 'check-1', actorId: 'rowan', dice: [20], expectedRevision: feed.revision, roll: { modifier: 4 } }).reason, 'ALREADY_ROLLED');
  const ruled = ruleCheck(feed, { requestId: 'check-1', actorId: AUDIENCES.DM, text: 'You hear wind above the landing, but no footsteps.', expectedRevision: feed.revision });
  assert.equal(ruled.accepted, true); assert.equal(ruled.check.status, 'ruled'); assert.equal(ruled.check.results.rowan.total, 18); assert.equal(ruled.event.audience, AUDIENCES.PARTY); assert.match(ruled.event.text, /Perception:/);
});

test('stale, paused and malformed rolls produce no mutation', () => {
  let feed = base(); feed = requestCheck(feed, { requestId: 'check-2', actorIds: ['rowan'], ability: 'Wisdom' }).feed;
  assert.equal(recordRoll(feed, { requestId: 'check-2', actorId: 'rowan', dice: [1], expectedRevision: feed.revision - 1, roll: { modifier: 0 } }).reason, 'STALE_REVISION');
  feed = pauseFeed(feed, true); assert.equal(recordRoll(feed, { requestId: 'check-2', actorId: 'rowan', dice: [1], expectedRevision: feed.revision, roll: { modifier: 0 } }).reason, 'PAUSED');
  assert.equal(projectFeed(feed, AUDIENCES.PARTY).filter(event => event.resolution?.kind === 'result').length, 0);
});

test('map discovery reveals one place and emits a party event once', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  const first = discoverMapName(feed, { actorId: 'p1', placeId: 'watchtower', name: 'Old Watchtower' });
  assert.equal(first.changed, true); assert.equal(first.feed.mapNames.get('watchtower'), 'Old Watchtower');
  const replay = discoverMapName(first.feed, { actorId: 'p2', placeId: 'watchtower', name: 'Old Watchtower' });
  assert.equal(replay.changed, false); assert.equal(first.feed.events.at(-1).audience, AUDIENCES.PARTY);
});

test('Raphael cues separate the public hint from DM detail and deduplicate', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  const cue = publishCue(feed, { cueId: 'room-secret', hint: 'Raphael senses a secret in this room.', detail: 'The loose stone hides a passage behind the north shelf.' });
  assert.equal(projectFeed(cue.feed).at(-1).text, 'Raphael senses a secret in this room.');
  assert.equal(projectFeed(cue.feed, AUDIENCES.DM).at(-1).text, 'The loose stone hides a passage behind the north shelf.');
  assert.equal(publishCue(cue.feed, { cueId: 'room-secret', hint: 'changed', detail: 'changed' }).changed, false);
});

test('natural-language intent acknowledges publicly while preserving exact text for the DM', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  const submitted = submitIntent(feed, { requestId: 'intent-1', actorId: 'p1', text: 'I pause at the doorway and listen upstairs.' });
  assert.equal(projectFeed(submitted.feed).at(-1).text, 'p1 is taking an action.');
  assert.equal(projectFeed(submitted.feed, AUDIENCES.DM).at(-1).text, 'I pause at the doorway and listen upstairs.');
  assert.equal(submitIntent(submitted.feed, { requestId: 'intent-1', actorId: 'p1', text: 'changed' }).changed, false);
  const resolved = resolveIntent(submitted.feed, { requestId: 'intent-1', text: 'You hear a floorboard creak above.', expectedRevision: submitted.feed.revision });
  assert.equal(resolved.accepted, true); assert.equal(projectFeed(resolved.feed).at(-1).text, 'You hear a floorboard creak above.');
});

test('encounter state supports combat or an ability-check mini display', () => {
  let feed = createCampaignFeed({ campaignId: 'demo' });
  feed = setEncounter(feed, { players: ['p1', 'p2'], enemies: ['Ash Warden'] });
  assert.deepEqual(feed.encounter.enemies, ['Ash Warden']);
  feed = setEncounter(feed, { players: ['p1', 'p2'], abilityCheck: 'Perception' });
  assert.equal(feed.encounter.abilityCheck, 'Perception'); assert.deepEqual(feed.encounter.enemies, []);
});

test('shop state keeps visible inventory bounded for the shop template', () => {
  const feed = setShop(createCampaignFeed({ campaignId: 'demo' }), { shopId: 'briar-apothecary', name: 'Briar Apothecary', inventory: [{ id: 'potion', name: 'Healing Draught', price: 50 }] });
  assert.equal(feed.shop.name, 'Briar Apothecary'); assert.equal(feed.shop.inventory[0].price, 50);
});

test('shop purchase requests stay DM-private and deduplicate', () => {
  let feed = setShop(createCampaignFeed({ campaignId: 'demo' }), { shopId: 'shop', name: 'Briar Apothecary', inventory: [{ id: 'potion', name: 'Healing Draught' }] });
  const purchase = requestPurchase(feed, { requestId: 'buy-1', actorId: 'p1', itemId: 'potion', text: 'I buy the healing draught.' });
  assert.equal(purchase.accepted, true); assert.equal(projectFeed(purchase.feed).length, 0); assert.equal(projectFeed(purchase.feed, AUDIENCES.DM).at(-1).text, 'I buy the healing draught.');
  assert.equal(requestPurchase(purchase.feed, { requestId: 'buy-1', actorId: 'p1', itemId: 'potion', text: 'again' }).reason, 'DUPLICATE');
  const resolved = resolvePurchase(purchase.feed, { requestId: 'buy-1', approved: true, text: 'Purchase approved.', expectedRevision: purchase.feed.revision });
  assert.equal(resolved.accepted, true); assert.equal(projectFeed(resolved.feed).at(-1).text, 'Purchase approved.');
});
