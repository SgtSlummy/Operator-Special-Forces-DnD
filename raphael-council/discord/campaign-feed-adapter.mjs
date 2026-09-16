import { AUDIENCES } from './campaign-feed-contract.mjs';
import { renderCampaignFeed } from './campaign-feed-renderer.mjs';

const route = value => {
  const match = /^campaign:(open|refresh):([a-zA-Z0-9_-]{1,64})$/.exec(value ?? '');
  return match ? { action: match[1], campaignId: match[2] } : null;
};

const viewerFor = ({ actorId, isDm = false } = {}) => isDm ? AUDIENCES.DM : actorId;

export function createCampaignFeedAdapter({ readFeed, authorize, transport, render = renderCampaignFeed } = {}) {
  if (typeof readFeed !== 'function' || typeof authorize !== 'function' || !transport?.respond || !transport?.edit) throw new Error('Campaign feed adapter requires readFeed, authorize, respond, and edit.');
  return async interaction => {
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
    const payload = render(feed, { viewer: viewerFor(scope), title: scope.title || 'Campaign feed' });
    if (parsed.action === 'open') await transport.respond(interaction.id, interaction.token, { type: 4, data: payload });
    else await transport.edit(interaction.application_id, interaction.token, payload);
    return true;
  };
}

export { route as campaignFeedRoute };
