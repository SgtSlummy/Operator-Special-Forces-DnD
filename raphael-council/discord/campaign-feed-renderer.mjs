import { AUDIENCES, projectFeed } from './campaign-feed-contract.mjs';

const limit = value => String(value ?? '').slice(0, 4000);

export function renderCampaignFeed(feed, { viewer = AUDIENCES.PARTY, title = 'Campaign feed' } = {}) {
  const events = projectFeed(feed, viewer);
  const pending = [...feed.checks.values()].filter(check => check.status === 'pending' || check.status === 'awaiting_dm');
  const fields = pending.map(check => ({
    name: `Check · ${check.skill || check.ability}`,
    value: `${check.ability}${check.skill ? ` (${check.skill})` : ''} · ${check.count}d${check.sides}${Object.values(check.modifiers || {}).length ? ` · modifiers ${JSON.stringify(check.modifiers)}` : ''}\n${check.actorIds.map(actorId => `${actorId}: ${check.results[actorId] ? `rolled ${check.results[actorId].total}` : 'awaiting roll'}`).join(' · ')}`,
    inline: false,
  })).concat(events.slice(-12).map(event => ({
    name: `${event.actorId} · ${event.source}`,
    value: limit(event.text),
    inline: false,
  })));
  const components = [
    { type: 1, components: [{ type: 2, style: 1, custom_id: `campaign:roll:${feed.revision}`, label: 'Roll required die' }, { type: 2, style: 2, custom_id: `campaign:options:${feed.revision}`, label: 'Options' }] },
    { type: 1, components: [{ type: 4, custom_id: `campaign:say:${feed.revision}`, style: 1, label: 'Tell Raphael what you do', placeholder: 'Describe your action in natural language…', required: false, max_length: 1000 }] },
  ];
  if (viewer === AUDIENCES.DM && pending.length) components.push({ type: 1, components: [{ type: 2, style: 3, custom_id: `campaign:rule:${feed.revision}`, label: 'Rule pending checks' }] });
  return {
    embeds: [{ title, description: `Chapter: ${feed.chapterId} · Revision ${feed.revision}${feed.paused ? ' · Paused' : ''}`, fields, footer: { text: `${events.length} visible events · ${pending.length} pending checks` } }],
    components,
  };
}
