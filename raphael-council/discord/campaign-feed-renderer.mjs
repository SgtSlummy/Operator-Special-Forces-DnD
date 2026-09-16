import { AUDIENCES, projectFeed } from './campaign-feed-contract.mjs';

const limit = value => String(value ?? '').slice(0, 4000);

export function renderCampaignFeed(feed, { viewer = AUDIENCES.PARTY, title = 'Campaign feed' } = {}) {
  const events = projectFeed(feed, viewer);
  const pending = [...feed.checks.values()].filter(check => check.status === 'pending' || check.status === 'awaiting_dm');
  const pendingIntents = viewer === AUDIENCES.DM ? feed.events.filter(event => event.resolution?.kind === 'intent' && !feed.events.some(other => other.resolution?.kind === 'intent-resolution' && other.resolution.requestId === event.resolution.requestId)).length : 0;
  const pendingPurchases = viewer === AUDIENCES.DM ? feed.events.filter(event => event.resolution?.kind === 'purchase-request' && !feed.events.some(other => other.resolution?.kind === 'purchase-resolution' && other.resolution.requestId === event.resolution.requestId)).length : 0;
  const mapField = { name: 'Known map names', value: [...feed.mapNames.values()].filter(name => name !== 'seed').join(' · ') || 'Briarhaven', inline: false };
  const encounter = feed.encounter;
  const encounterField = encounter ? { name: encounter.enemies.length ? `Encounter · Round ${encounter.round}` : 'Ability check', value: `${encounter.players.join(' · ') || 'No players'}${encounter.enemies.length ? ` vs ${encounter.enemies.join(' · ')}` : ` · ${encounter.abilityCheck || 'Awaiting check'}`}${encounter.activeActor ? ` · ${encounter.activeActor}'s turn` : ''}`, inline: false } : null;
  const shopField = feed.shop ? { name: `Shop · ${feed.shop.name}`, value: feed.shop.inventory.map(item => `${item.name}${item.price !== undefined ? ` · ${item.price}` : ''}`).join(' · ') || 'No visible inventory', inline: false } : null;
  const fields = [mapField, ...(encounterField ? [encounterField] : []), ...(shopField ? [shopField] : [])].concat(pending.map(check => ({
    name: `Check · ${check.skill || check.ability}`,
    value: `${check.ability}${check.skill ? ` (${check.skill})` : ''} · ${check.count}d${check.sides}${Object.values(check.modifiers || {}).length ? ` · modifiers ${JSON.stringify(check.modifiers)}` : ''}\n${check.actorIds.map(actorId => `${actorId}: ${check.results[actorId] ? `rolled ${check.results[actorId].total}` : 'awaiting roll'}`).join(' · ')}`,
    inline: false,
  })), ...events.slice(-12).map(event => ({
    name: `${event.actorId} · ${event.source}`,
    value: limit(event.text),
    inline: false,
  })));
  const unsharedFact = viewer !== AUDIENCES.PARTY && viewer !== AUDIENCES.DM && feed.facts.some(fact => fact.ownerId === viewer && !fact.sharedAt);
  const privateViewer = viewer !== AUDIENCES.PARTY;
  const components = [
    { type: 1, components: [{ type: 2, style: 1, custom_id: `campaign:roll:${feed.campaignId}:${feed.revision}`, label: feed.paused ? 'Paused · rolling unavailable' : 'Roll required die', disabled: feed.paused }, { type: 2, style: 2, custom_id: `campaign:options:${feed.revision}`, label: 'Options' }, ...(unsharedFact ? [{ type: 2, style: 2, custom_id: `campaign:share:${feed.revision}`, label: 'Share information' }] : []), ...(privateViewer ? [{ type: 2, style: 2, custom_id: `campaign:private:${feed.campaignId}`, label: 'Refresh private feed' }] : [])] },
    // Discord message action rows accept buttons/selects only. The adapter opens
    // the natural-language modal after this button is pressed.
    { type: 1, components: [{ type: 2, style: 1, custom_id: `campaign:say:${feed.campaignId}:${feed.revision}`, label: 'Tell Raphael what you do' }] },
  ];
  if (viewer === AUDIENCES.DM && pending.length) components.push({ type: 1, components: [{ type: 2, style: 3, custom_id: `campaign:rule:${feed.revision}`, label: 'Rule pending checks' }] });
  return {
    embeds: [{ title, description: `Chapter: ${feed.chapterId} · Revision ${feed.revision}${feed.paused ? ' · Paused' : ''}`, fields, footer: { text: `${events.length} visible events · ${pending.length} pending checks · ${pendingIntents} pending actions · ${pendingPurchases} pending purchases` } }],
    components,
  };
}
