import { authenticateInteraction } from './import-adapter.mjs';

export const LAUNCH_COMMAND = {
  name: 'raphael', type: 1, description: 'Open the shared Raphael game in Discord or a browser',
  options: [
    { type: 1, name: 'activity', description: 'Launch the game inside Discord' },
    { type: 1, name: 'web', description: 'Open the same saved campaign in your browser' },
  ],
};

export function createLaunchHandler({ config, transport }) {
  return async interaction => {
    if (interaction.type !== 2 || interaction.data?.name !== LAUNCH_COMMAND.name) return false;
    const reply = content => transport.respond(interaction.id, interaction.token, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
    try {
      authenticateInteraction(interaction, config);
      const action = interaction.data.options?.[0]?.name;
      if (action === 'activity') {
        await transport.respond(interaction.id, interaction.token, { type: 12 });
      } else if (action === 'web' && config.publicOrigin) {
        const url = new URL('/play', config.publicOrigin).href;
        await transport.respond(interaction.id, interaction.token, { type: 4, data: {
          content: 'Open your saved campaign and sign in with Discord.', flags: 64, allowed_mentions: { parse: [] },
          components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open Raphael', url }] }],
        } });
      } else { await reply(action === 'web' ? 'The host has not configured the public game address yet.' : 'Choose /raphael activity or /raphael web.'); }
    } catch { await reply('The game could not be opened. Use the configured campaign channel and check your campaign membership.').catch(() => {}); }
    return true;
  };
}

export async function registerLaunchCommand(client, config) {
  const endpoint = `/applications/${client.application.id}/guilds/${config.guildId}/commands`;
  const existing = await client.rest.get(endpoint);
  if (existing.some(command => command.name === LAUNCH_COMMAND.name && command.type === LAUNCH_COMMAND.type && command.description !== LAUNCH_COMMAND.description)) {
    throw new Error('An unrelated /raphael command already exists. It was left unchanged.');
  }
  return client.rest.post(endpoint, { body: LAUNCH_COMMAND });
}
