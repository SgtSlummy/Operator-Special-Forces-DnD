// Server-side contract primitives for the Discord campaign feed. These functions
// are pure on purpose: the host supplies persistence, authentication and dice.
export const AUDIENCES = Object.freeze({ PARTY: 'party', PLAYER: 'player', DM: 'dm' });

const clone = value => structuredClone(value);
const assertText = (value, name) => { if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`${name} must be bounded text.`); };
const eventVisible = (event, viewer) => event.audience === AUDIENCES.PARTY || viewer === AUDIENCES.DM || (event.audience === AUDIENCES.PLAYER && event.playerId === viewer);

export function createCampaignFeed({ campaignId, revision = 0, chapterId = 'opening' } = {}) {
  assertText(campaignId, 'campaignId');
  return { campaignId, revision, chapterId, sequence: 0, events: [], facts: [], checks: new Map(), mapNames: new Map([['Briarhaven', 'seed']]), paused: false };
}

export function appendEvent(feed, { actorId = 'system', audience = AUDIENCES.PARTY, playerId, text, resolution, source = 'system' } = {}) {
  assertText(actorId, 'actorId'); assertText(text, 'text');
  if (![AUDIENCES.PARTY, AUDIENCES.PLAYER, AUDIENCES.DM].includes(audience)) throw new Error('Unsupported audience.');
  if (audience === AUDIENCES.PLAYER) assertText(playerId, 'playerId');
  const next = clone(feed); next.sequence += 1; next.revision += 1;
  next.events.push({ id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience, ...(playerId ? { playerId } : {}), text, ...(resolution ? { resolution: clone(resolution) } : {}), source });
  return next;
}

export function projectFeed(feed, viewer = AUDIENCES.PARTY) {
  return feed.events.filter(event => eventVisible(event, viewer)).map(clone);
}

export function addFact(feed, { id, ownerId, kind, text, sourceEventId }) {
  for (const [key, value] of Object.entries({ id, ownerId, kind, text, sourceEventId })) assertText(value, key);
  const next = clone(feed); if (!next.facts.some(fact => fact.id === id)) next.facts.push({ id, ownerId, kind, text, sourceEventId, sharedAt: null }); return next;
}

export function discoverMapName(feed, { actorId, placeId, name }) {
  assertText(actorId, 'actorId'); assertText(placeId, 'placeId'); assertText(name, 'name');
  const next = clone(feed); if (next.mapNames.get(placeId) === name) return { feed, changed: false };
  next.mapNames.set(placeId, name); next.revision += 1;
  const event = { id: `${next.campaignId}:event:${++next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.PARTY, text: `Map updated: ${name} added.`, resolution: { kind: 'map-discovery', placeId, name }, source: 'exploration' };
  next.events.push(event); return { feed: next, changed: true, event: clone(event) };
}

export function publishCue(feed, { cueId, hint, detail }) {
  assertText(cueId, 'cueId'); assertText(hint, 'hint'); assertText(detail, 'detail');
  if (feed.events.some(event => event.resolution?.cueId === cueId)) return { feed, changed: false };
  const next = clone(feed); next.sequence += 1; next.revision += 1;
  const partyEvent = { id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId: 'Raphael', audience: AUDIENCES.PARTY, text: hint, resolution: { kind: 'cue', cueId }, source: 'raphael' };
  next.events.push(partyEvent); next.sequence += 1;
  next.events.push({ id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId: 'Raphael', audience: AUDIENCES.DM, text: detail, resolution: { kind: 'cue-detail', cueId }, source: 'raphael' });
  return { feed: next, changed: true, event: clone(partyEvent) };
}

export function submitIntent(feed, { requestId, actorId, text }) {
  assertText(requestId, 'requestId'); assertText(actorId, 'actorId'); assertText(text, 'text');
  if (feed.events.some(event => event.resolution?.requestId === requestId)) return { feed, changed: false };
  const next = clone(feed); next.revision += 1; next.sequence += 1;
  const partyEvent = { id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.PARTY, text: `${actorId} is taking an action.`, resolution: { kind: 'intent-ack', requestId }, source: 'player' };
  next.events.push(partyEvent); next.sequence += 1;
  next.events.push({ id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.DM, text, resolution: { kind: 'intent', requestId }, source: 'player' });
  return { feed: next, changed: true, event: clone(partyEvent) };
}

export function resolveIntent(feed, { requestId, actorId = AUDIENCES.DM, text, expectedRevision }) {
  assertText(requestId, 'requestId'); assertText(actorId, 'actorId'); assertText(text, 'text');
  if (actorId !== AUDIENCES.DM) return { feed, accepted: false, reason: 'NOT_AUTHORIZED' };
  if (expectedRevision !== feed.revision) return { feed, accepted: false, reason: 'STALE_REVISION' };
  const source = feed.events.find(event => event.resolution?.kind === 'intent' && event.resolution.requestId === requestId);
  if (!source) return { feed, accepted: false, reason: 'NOT_FOUND' };
  if (feed.events.some(event => event.resolution?.kind === 'intent-resolution' && event.resolution.requestId === requestId)) return { feed, accepted: false, reason: 'ALREADY_RESOLVED' };
  const next = clone(feed); next.revision += 1; next.sequence += 1;
  const event = { id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.PARTY, text, resolution: { kind: 'intent-resolution', requestId, actorId: source.actorId }, source: 'dm' };
  next.events.push(event); return { feed: next, accepted: true, event: clone(event) };
}

export function setEncounter(feed, { players = [], enemies = [], abilityCheck = null }) {
  if (!Array.isArray(players) || !Array.isArray(enemies) || players.some(value => typeof value !== 'string') || enemies.some(value => typeof value !== 'string')) throw new Error('Encounter names must be text arrays.');
  if (abilityCheck !== null) assertText(abilityCheck, 'abilityCheck');
  const next = clone(feed); next.encounter = { players: [...players], enemies: [...enemies], ...(abilityCheck ? { abilityCheck } : {}) }; next.revision += 1; return next;
}

export function setShop(feed, { shopId, name, inventory = [] }) {
  assertText(shopId, 'shopId'); assertText(name, 'name');
  if (!Array.isArray(inventory) || inventory.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string')) throw new Error('Shop inventory must contain named items.');
  const next = clone(feed); next.shop = { shopId, name, inventory: inventory.map(item => ({ id: item.id, name: item.name, ...(item.price !== undefined ? { price: item.price } : {}) })) }; next.revision += 1; return next;
}

export function requestPurchase(feed, { requestId, actorId, itemId, text }) {
  assertText(requestId, 'requestId'); assertText(actorId, 'actorId'); assertText(itemId, 'itemId'); assertText(text, 'text');
  if (!feed.shop || !feed.shop.inventory.some(item => item.id === itemId)) return { feed, accepted: false, reason: 'ITEM_UNAVAILABLE' };
  if (feed.events.some(event => event.resolution?.kind === 'purchase-request' && event.resolution.requestId === requestId)) return { feed, accepted: false, reason: 'DUPLICATE' };
  const next = clone(feed); next.revision += 1; next.sequence += 1;
  const event = { id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.DM, playerId: actorId, text, resolution: { kind: 'purchase-request', requestId, itemId, status: 'pending' }, source: 'player' };
  next.events.push(event); return { feed: next, accepted: true, event: clone(event) };
}

export function resolvePurchase(feed, { requestId, approved, text, expectedRevision, actorId = AUDIENCES.DM }) {
  assertText(requestId, 'requestId'); assertText(text, 'text');
  if (actorId !== AUDIENCES.DM) return { feed, accepted: false, reason: 'NOT_AUTHORIZED' };
  if (expectedRevision !== feed.revision) return { feed, accepted: false, reason: 'STALE_REVISION' };
  const request = feed.events.find(event => event.resolution?.kind === 'purchase-request' && event.resolution.requestId === requestId);
  if (!request) return { feed, accepted: false, reason: 'NOT_FOUND' };
  if (feed.events.some(event => event.resolution?.kind === 'purchase-resolution' && event.resolution.requestId === requestId)) return { feed, accepted: false, reason: 'ALREADY_RESOLVED' };
  const next = clone(feed); next.revision += 1; next.sequence += 1;
  const event = { id: `${next.campaignId}:event:${next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: approved ? AUDIENCES.PARTY : AUDIENCES.PLAYER, ...(approved ? {} : { playerId: request.actorId }), text, resolution: { kind: 'purchase-resolution', requestId, itemId: request.resolution.itemId, approved: Boolean(approved) }, source: 'dm' };
  next.events.push(event); return { feed: next, accepted: true, event: clone(event) };
}

export function shareFact(feed, actorId, factId) {
  assertText(actorId, 'actorId'); assertText(factId, 'factId');
  const next = clone(feed); const fact = next.facts.find(value => value.id === factId);
  if (!fact || fact.ownerId !== actorId || fact.sharedAt) return { feed, changed: false };
  fact.sharedAt = new Date().toISOString();
  const event = { id: `${next.campaignId}:event:${++next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.PARTY, text: `shared ${fact.kind}: ${fact.text}`, source: 'player' };
  next.events.push(event); next.revision += 1; return { feed: next, changed: true, event: clone(event) };
}

export function requestCheck(feed, { requestId, actorIds, ability, skill, count = 1, sides = 20, modifiers = {} }) {
  assertText(requestId, 'requestId'); assertText(ability, 'ability');
  if (!Array.isArray(actorIds) || actorIds.length < 1 || actorIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('actorIds must name at least one actor.');
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(sides) || sides < 2) throw new Error('Invalid dice specification.');
  const next = clone(feed); if (next.checks.has(requestId)) return { feed, check: clone(next.checks.get(requestId)), replayed: true };
  const check = { requestId, actorIds: [...actorIds], ability, ...(skill ? { skill } : {}), count, sides, modifiers: { ...modifiers }, results: {}, status: 'pending', ruling: null };
  next.checks.set(requestId, check); next.revision += 1; return { feed: next, check: clone(check), replayed: false };
}

export function recordRoll(feed, { requestId, actorId, dice, expectedRevision, roll }) {
  assertText(requestId, 'requestId'); assertText(actorId, 'actorId');
  if (feed.paused || expectedRevision !== feed.revision) return { feed, accepted: false, reason: feed.paused ? 'PAUSED' : 'STALE_REVISION' };
  const next = clone(feed), check = next.checks.get(requestId);
  if (!check || !check.actorIds.includes(actorId)) return { feed, accepted: false, reason: 'NOT_AUTHORIZED' };
  if (check.results[actorId]) return { feed, accepted: false, reason: 'ALREADY_ROLLED' };
  if (!Array.isArray(dice) || dice.length !== check.count || dice.some(value => !Number.isSafeInteger(value) || value < 1 || value > check.sides)) return { feed, accepted: false, reason: 'INVALID_DICE' };
  if (!roll || !Number.isSafeInteger(roll.modifier)) return { feed, accepted: false, reason: 'INVALID_RESULT' };
  const total = dice.reduce((sum, value) => sum + value, 0) + roll.modifier;
  check.results[actorId] = { dice: [...dice], sides: check.sides, modifier: roll.modifier, total, status: 'awaiting_dm' };
  if (Object.keys(check.results).length === check.actorIds.length) check.status = 'awaiting_dm';
  next.revision += 1;
  const event = { id: `${next.campaignId}:event:${++next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId, audience: AUDIENCES.PLAYER, playerId: actorId, text: `rolled ${check.skill || check.ability}`, resolution: { kind: 'result', requestId, actorId, dice: [...dice], sides: check.sides, modifier: roll.modifier, total, status: 'awaiting_dm' }, source: 'player' };
  next.events.push(event); return { feed: next, accepted: true, check: clone(check), event: clone(event) };
}

export function ruleCheck(feed, { requestId, actorId, text, expectedRevision }) {
  assertText(actorId, 'actorId'); assertText(text, 'text');
  if (actorId !== AUDIENCES.DM || expectedRevision !== feed.revision) return { feed, accepted: false, reason: expectedRevision !== feed.revision ? 'STALE_REVISION' : 'NOT_AUTHORIZED' };
  const next = clone(feed), check = next.checks.get(requestId); if (!check || check.status !== 'awaiting_dm') return { feed, accepted: false, reason: 'NOT_PENDING' };
  check.ruling = text; check.status = 'ruled'; next.revision += 1;
  const totals = Object.values(check.results).map(result => result.total);
  const event = { id: `${next.campaignId}:event:${++next.sequence}`, sequence: next.sequence, campaignId: next.campaignId, chapterId: next.chapterId, actorId: AUDIENCES.DM, audience: AUDIENCES.PARTY, text: `${check.skill || check.ability}: ${totals.join(', ')} — ${text}`, resolution: { kind: 'check-ruling', requestId, totals, ruling: text }, source: 'dm' };
  next.events.push(event); return { feed: next, accepted: true, check: clone(check), event: clone(event) };
}

export function pauseFeed(feed, paused) { const next = clone(feed); next.paused = Boolean(paused); next.revision += 1; return next; }
