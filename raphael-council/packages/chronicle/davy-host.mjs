import { AsyncLocalStorage } from 'node:async_hooks';
import { createChronicleRuntimeCore } from '../../discord/chronicle-core.mjs';
import { ChronicleError } from '../../chronicle/store.mjs';
import { createObusChronicleProvider } from '../../chronicle/obus-provider.mjs';
import { createObusEvidenceBridge } from '../../chronicle/obus-evidence.mjs';
import { discordCampaignAuthority } from '../../auth/discord-policy.mjs';

const MEMBER_ACTIONS = new Set(['consent', 'status', 'note', 'correct', 'image']);
const ID = /^[A-Za-z0-9_-]{1,96}$/;
const denied = () => new ChronicleError('Current shared campaign membership is required for this session control.');

/**
 * Portable composition with explicit dependencies. No credential files,
 * provider administration, application singleton, or database is opened here.
 * The runtime owns the supplied ChronicleStore lifecycle. The caller retains
 * GameStore lifecycle ownership and must close it after runtime.close succeeds.
 */
export function createDavyChronicleHost({ client, config, discordTransport, obusTransport, hostControl,
  store, gameStore, makeVoice, images, music = null, log = () => {} } = {}) {
  if (!config || typeof config.campaignId !== 'string' || !ID.test(config.campaignId) ||
      !Array.isArray(config.dmIds) || !Array.isArray(config.playerIds) ||
      config.discordBindings?.campaign !== config.campaignId || config.discordBindings?.guild !== config.guildId ||
      !Array.isArray(config.discordBindings?.dmIds) || !Array.isArray(config.discordBindings?.playerIds) ||
      !gameStore || typeof gameStore.member !== 'function' || typeof gameStore.hasCampaign !== 'function' ||
      !store || typeof store.evidenceProjection !== 'function' || typeof makeVoice !== 'function' ||
      !['respond', 'edit', 'followup', 'send', 'member'].every(key => typeof discordTransport?.[key] === 'function')) {
    throw new TypeError('Supply the matching web Discord bindings, configured transports, current GameStore, ChronicleStore, and shared voice factory.');
  }
  if (!gameStore.hasCampaign(config.campaignId)) throw denied();
  const campaignId = config.campaignId;
  const commandContext = new AsyncLocalStorage();
  const bindings = Object.freeze({ ...config.discordBindings,
    dmIds: Object.freeze([...config.discordBindings.dmIds]), playerIds: Object.freeze([...config.discordBindings.playerIds]) });
  const memberRole = owner => {
    try { return gameStore.member({ campaign: campaignId, owner }); }
    catch { return null; }
  };
  // Saved game roles are the ceiling. The same live Discord restriction used
  // by browser/Activity authentication is checked before projecting those roles.
  const savedConfig = Object.freeze({ ...config, discordBindings: bindings, dmRoleId: '', playerRoleId: '',
    dmIds: Object.freeze({ includes: owner => memberRole(owner) === 'host' }),
    playerIds: Object.freeze({ includes: owner => ['host', 'player'].includes(memberRole(owner)) }),
  });
  const currentMember = async (owner, requireHost = false) => {
    const check = () => {
      const role = memberRole(owner);
      if (!['host', 'player'].includes(role) || requireHost && role !== 'host') throw denied();
      return role;
    };
    check();
    const member = await discordTransport.member(owner);
    const role = check();
    if (member?.user?.id !== owner) throw denied();
    const authority = discordCampaignAuthority({ owner, member, config: bindings, permissions: member.permissions });
    if (!authority.eligible || role === 'host' && !authority.host) throw denied();
    return member;
  };
  const authorize = async (scope, requireHost) => {
    if (!scope || scope.campaign !== campaignId || !['host', 'player'].includes(scope.role) || requireHost && scope.role !== 'host') return false;
    try { await currentMember(scope.owner, requireHost); return true; } catch { return false; }
  };
  const participant = scope => authorize(scope, false);
  const host = scope => authorize(scope, true);
  const bridge = createObusEvidenceBridge({ store, hostControl, campaigns: [campaignId], allowStoreSync: true,
    // Provider authorization performs fresh Discord checks around every bridge
    // operation. This synchronous guard additionally fences shared membership.
    authorizeCommand: scope => scope.action === 'evidence.sync' && scope.campaign === campaignId && memberRole(scope.owner) === 'host',
  });
  const provider = createObusChronicleProvider({ transport: obusTransport, campaigns: [campaignId], evidenceBridge: bridge,
    authorizeCommand: host, authorizeParticipant: participant });
  const transport = Object.fromEntries(['respond', 'edit', 'followup', 'send'].map(key => [key, discordTransport[key].bind(discordTransport)]));
  transport.member = async owner => {
    const context = commandContext.getStore();
    if (context && context.owner !== owner) throw denied();
    const member = await currentMember(owner, context?.host === true);
    // Discord administrative rights never promote a saved game player to GM.
    return { ...member, roles: [], permissions: '0' };
  };
  const runtime = createChronicleRuntimeCore({ client, config: savedConfig, transport, store, provider, images, music, log,
    authorizeCommand: host,
    makeVoice: options => makeVoice({ ...options, authorizeParticipant: scope => provider.authorizeParticipant(scope),
      captureRuntime: (scope, session) => provider.captureRuntime(scope, session) }),
  });
  return Object.freeze({ ...runtime, provider,
    handle(interaction, options) {
      if (interaction?.type !== 2 || interaction.data?.name !== 'session') return runtime.handle(interaction, options);
      const context = Object.freeze({ owner: interaction.member?.user?.id, host: !MEMBER_ACTIONS.has(interaction.data.options?.[0]?.name) });
      return commandContext.run(context, () => runtime.handle(interaction, options));
    },
  });
}
