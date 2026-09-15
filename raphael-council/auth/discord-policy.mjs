/** Shared Discord campaign bindings. The caller supplies environment values. */
export function discordCampaignBindings(env = {}) {
  return { ...(['1','true'].includes(env.HOLLOW_LANTERN_ADMISSION_ENABLED)?{admissionEnabled:true,admissionChannel:env.HOLLOW_LANTERN_CHANNEL_ID}:{}), guild: env.RAPHAEL_GUILD_ID, campaign: env.RAPHAEL_CAMPAIGN_ID,
    playerIds: (env.RAPHAEL_PLAYER_IDS || '').split(',').filter(Boolean), playerRole: env.RAPHAEL_PLAYER_ROLE_ID,
    dmIds: (env.RAPHAEL_DM_IDS || '').split(',').filter(Boolean), dmRole: env.RAPHAEL_DM_ROLE_ID };
}

/**
 * Current Discord eligibility only; this never grants a saved campaign role.
 * The caller fetches the current member and computes permissions from trusted
 * guild roles, or supplies an equivalent current Discord permission snapshot.
 * A saved host must satisfy host, and every saved member must satisfy eligible.
 */
export function discordCampaignAuthority({ owner, member, config, permissions = 0n, guildOwnerId }) {
  if (typeof owner !== 'string' || !owner) throw new TypeError('A current Discord owner is required.');
  const roles = member.roles || [];
  const bits = BigInt(permissions);
  const host = Boolean(guildOwnerId === owner || config.dmIds.includes(owner) ||
    (config.dmRole && roles.includes(config.dmRole)) || (bits & (8n | 32n)));
  const player = Boolean(config.admissionEnabled===true && member.user?.bot!==true && member.pending!==true || config.playerIds.includes(owner) || (config.playerRole && roles.includes(config.playerRole)));
  return Object.freeze({ host, player, eligible: host || player });
}
