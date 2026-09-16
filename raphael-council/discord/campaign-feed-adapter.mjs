import { AUDIENCES, submitIntent } from './campaign-feed-contract.mjs';
import { renderCampaignFeed } from './campaign-feed-renderer.mjs';

const route = value => {
  const match = /^campaign:(open|refresh|private):([a-zA-Z0-9_-]{1,64})$/.exec(value ?? '');
  return match ? { action: match[1], campaignId: match[2], privateView: match[1] === 'private' } : null;
};

const viewerFor = ({ actorId, isDm = false } = {}) => isDm ? AUDIENCES.DM : actorId;

export function renderCampaignIntentModal({ campaignId, revision } = {}) {
  return {
    type: 9,
    data: {
      custom_id: `campaign:say:${campaignId}:${revision}:submit`,
      title: 'Tell Raphael what you do',
      components: [{ type: 18, label: 'Describe your action', component: { type: 4, custom_id: 'intent', style: 2, required: true, min_length: 1, max_length: 1000, placeholder: 'I pause at the doorway and listen upstairs.' } }],
    },
  };
}

export function createCampaignFeedAdapter({ readFeed, writeFeed, authorize, transport, render = renderCampaignFeed } = {}) {
  if (typeof readFeed !== 'function' || typeof authorize !== 'function' || !transport?.respond || !transport?.edit) throw new Error('Campaign feed adapter requires readFeed, authorize, respond, and edit.');
  return async interaction => {
    const submitted = /^campaign:say:([a-zA-Z0-9_-]{1,64}):(\d+):submit$/.exec(interaction?.data?.custom_id ?? '');
    if (submitted) {
      const scope = await authorize(interaction, { action: 'say-submit', campaignId: submitted[1] });
      const text = interaction?.data?.components?.flatMap(row => row?.component ? [row.component] : row?.components || []).find(component => component?.custom_id === 'intent')?.value;
      if (!scope?.campaignId || scope.campaignId !== submitted[1] || typeof text !== 'string' || !text.trim() || typeof writeFeed !== 'function') {
        await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'That action form is no longer available.', flags: 64 } });
        return true;
      }
      const feed = await readFeed(submitted[1]);
      if (!feed || feed.revision !== Number(submitted[2])) {
        await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'That action form is stale. Open the campaign feed again.', flags: 64 } });
        return true;
      }
      const result = submitIntent(feed, { requestId: interaction.id, actorId: scope.actorId, text: text.trim() });
      if (result.changed) await writeFeed(result.feed, feed.revision);
      await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'Raphael has your action. The party feed has been updated.', flags: 64 } });
      return true;
    }
    const say = /^campaign:say:([a-zA-Z0-9_-]{1,64}):(\d+)$/.exec(interaction?.data?.custom_id ?? '');
    if (say) {
      const scope = await authorize(interaction, { action: 'say', campaignId: say[1] });
      if (!scope?.campaignId || scope.campaignId !== say[1]) {
        await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'Campaign feed access denied.', flags: 64 } });
        return true;
      }
      await transport.respond(interaction.id, interaction.token, renderCampaignIntentModal({ campaignId: scope.campaignId, revision: Number(say[2]) }));
      return true;
    }
    const parsed = route(interaction?.data?.custom_id);
    if (!parsed) return false;
    const scope = await authorize(interaction, parsed);
    if (!scope || scope.campaignId !== parsed.campaignId) {
      await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'Campaign feed access denied.', flags: 64 } });
      return true;
    }
    const feed = await readFeed(parsed.campaignId);
    if (!feed || feed.campaignId !== parsed.campaignId) {
      await transport.respond(interaction.id, interaction.token, { type: 4, data: { content: 'Campaign feed is unavailable.', flags: 64 } });
      return true;
    }
    const viewer = scope.isDm ? AUDIENCES.DM : (parsed.privateView ? viewerFor(scope) : AUDIENCES.PARTY);
    const payload = render(feed, { viewer, title: scope.title || 'Campaign feed' });
    if (scope.isDm || parsed.privateView) payload.flags = (payload.flags || 0) | 64;
    if (parsed.action === 'open' || parsed.action === 'private') await transport.respond(interaction.id, interaction.token, { type: 4, data: payload });
    else await transport.edit(interaction.application_id, interaction.token, payload);
    return true;
  };
}

export { route as campaignFeedRoute };
