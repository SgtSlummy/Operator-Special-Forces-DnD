import { Client, GatewayIntentBits, Events, Routes } from 'discord.js';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CharacterStore } from '../characters/store.mjs';
import { ImportService } from '../characters/service.mjs';
import { checkOcrAssets } from '../characters/pdf.mjs';
import { createImportHandler, authenticateInteraction } from './import-adapter.mjs';
import { entryScreen } from './import-ui.mjs';
import { createImageHandler } from './image-adapter.mjs';
import { getImageService } from '../images/runtime.mjs';
import { getGameStore } from '../game/runtime.mjs';
import { createAdventureHandler } from './adventure-adapter.mjs';
import { createCompanionHandler } from './companion-adapter.mjs';
import { createChecksHandler } from './checks-adapter.mjs';
import { BoardDelivery } from './board-delivery.mjs';
import { createWorldHandler } from './world-adapter.mjs';
import { createWorldTimeHandler } from './world-time-adapter.mjs';
import { createCouncilHandler } from './council-adapter.mjs';
import { createDepartureHandler } from './departure-adapter.mjs';
import { createChronicleRuntime, registerSessionCommand } from './chronicle-runtime.mjs';
import { createLaunchHandler, registerLaunchCommand } from './launch-adapter.mjs';

// Discord REST expects binary files beside the JSON body, never inside it.
export function restPayload(payload) {
  const { files, ...body } = payload;
  return files ? { body, files } : { body };
}

export function readConfig(env = process.env) {
  const required = ['DISCORD_TOKEN', 'RAPHAEL_GUILD_ID', 'RAPHAEL_CHANNEL_ID', 'RAPHAEL_CAMPAIGN_ID'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Set these values in .env.local: ${missing.join(', ')}. Do not paste the bot token into chat.`);
  const snowflake = value => /^\d{17,20}$/.test(value ?? '');
  if (!snowflake(env.RAPHAEL_GUILD_ID) || !snowflake(env.RAPHAEL_CHANNEL_ID)) throw new Error('Guild and channel IDs must be Discord numeric IDs.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(env.RAPHAEL_CAMPAIGN_ID)) throw new Error('Campaign ID must be 1-64 letters, numbers, underscores or hyphens.');
  const playerIds = (env.RAPHAEL_PLAYER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const playerRoleId = env.RAPHAEL_PLAYER_ROLE_ID?.trim() || null;
  if ((!playerRoleId && !playerIds.length) || playerIds.some(value => !snowflake(value)) || (playerRoleId && !snowflake(playerRoleId))) throw new Error('Set a valid RAPHAEL_PLAYER_ROLE_ID or comma-separated RAPHAEL_PLAYER_IDS. Membership is never open by default.');
  const dmIds = (env.RAPHAEL_DM_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const dmRoleId = env.RAPHAEL_DM_ROLE_ID?.trim() || null;
  const journalChannelId = env.RAPHAEL_JOURNAL_CHANNEL_ID?.trim() || env.RAPHAEL_CHANNEL_ID;
  if (dmIds.some(value => !snowflake(value)) || (dmRoleId && !snowflake(dmRoleId)) || !snowflake(journalChannelId)) throw new Error('DM and story channel IDs must be Discord numeric IDs.');
  const publicOrigin = env.RAPHAEL_PUBLIC_ORIGIN?.trim() || null;
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('RAPHAEL_PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  const localBase = env.LOCALAPPDATA ?? env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return { token: env.DISCORD_TOKEN, guildId: env.RAPHAEL_GUILD_ID, channelId: env.RAPHAEL_CHANNEL_ID,
    campaignId: env.RAPHAEL_CAMPAIGN_ID, playerIds, playerRoleId, dmIds, dmRoleId, journalChannelId, publicOrigin,
    chronicleEnabled: env.RAPHAEL_CHRONICLE_ENABLED === '1',
    chronicleDir: resolve(env.RAPHAEL_CHRONICLE_DATA_DIR || join(localBase, 'Raphael', 'chronicle', env.RAPHAEL_CAMPAIGN_ID)),
    dataDir: resolve(env.RAPHAEL_DATA_DIR || join(localBase, 'Raphael', 'character-importer')) };
}
import { createAdjudicationHandler } from './adjudication-adapter.mjs';
import { createReactionsHandler } from './reactions-adapter.mjs';
import { createConcentrationHandler } from './concentration-adapter.mjs';

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--check', '--publish', '--register'].includes(arg)) || args.length > 1) throw new Error('Use npm run bot, bot:check, bot:publish, or npm run bot -- --register.');
  const controlOnly = args.includes('--publish') || args.includes('--register');
  await checkOcrAssets();
  const config = readConfig();
  if (args.includes('--check')) {
    console.log('Local OCR assets and bot configuration are valid. No Discord connection was made.'); return;
  }
  const log = event => console.log(JSON.stringify({ component: 'character-importer', ...event }));
  const store = new CharacterStore(join(config.dataDir, 'characters.sqlite'));
  const service = new ImportService(store, join(config.dataDir, 'sources'), { log });
  let hostLock;
  if (!controlOnly) {
    // A separate SQLite lock survives concurrent starts but is automatically
    // released by the OS on a crash; it never locks the character database.
    hostLock = new DatabaseSync(join(config.dataDir, 'host-lock.sqlite'));
    try { hostLock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS running_host(id INTEGER)'); }
    catch { hostLock.close(); store.close(); throw new Error('Another Raphael host is already using this data directory. Stop that host before starting another.'); }
    await service.initialize();
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(config.chronicleEnabled && !controlOnly ? [GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])] });
  const transport = {
    respond: (id, token, payload) => client.rest.post(Routes.interactionCallback(id, token), { body: payload }),
    edit: (applicationId, token, payload) => client.rest.patch(Routes.webhookMessage(applicationId, token, '@original'), restPayload(payload)),
    followup: (applicationId, token, payload) => client.rest.post(Routes.webhook(applicationId, token), restPayload(payload)),
    member: user => client.rest.get(Routes.guildMember(config.guildId, user)),
    send: (channel, payload) => client.rest.post(Routes.channelMessages(channel), restPayload(payload)),
  };
  const imageService = getImageService();
  const game = getGameStore();
  const delivery = new BoardDelivery({ game, transport, secret: config.token,
    authorize: async (scope, context) => {
      if (scope.campaign !== config.campaignId || context.guild !== config.guildId || context.channel !== config.channelId) return false;
      const member = await client.rest.get(Routes.guildMember(config.guildId, scope.owner));
      try { authenticateInteraction({ guild_id: context.guild, channel_id: context.channel, member }, config); return true; }
      catch { return false; }
    } });
  const imageHandler = createImageHandler({ service: imageService, game, config, transport, log });
  const adventureHandler = createAdventureHandler({ game, config, transport, delivery, log });
  const importHandler = createImportHandler({ store, service, config, transport, log });
  const companionHandler = createCompanionHandler({ game, characters: store, config, transport, log });
  const checksHandler = createChecksHandler({ game, config, transport, log });
  const reactionsHandler = createReactionsHandler({ game, config, transport, log });
  const concentrationHandler = createConcentrationHandler({ game, config, transport, log });
  const worldHandler = createWorldHandler({ game, config, transport, log });
  const worldTimeHandler = createWorldTimeHandler({ game, config, transport, log });
  const adjudicationHandler = createAdjudicationHandler({ game, config, transport, log });
  const councilHandler = createCouncilHandler({ game, config, transport, log });
  const departureHandler = createDepartureHandler({ game, config, transport, log });
  const chronicle = config.chronicleEnabled && !controlOnly ? createChronicleRuntime({ client, config, images: imageService, transport, log,
    authorizeCommand: scope => { try { return game.member(scope) === 'host'; } catch { return false; } } }) : null;
  const launchHandler = createLaunchHandler({ config, transport });
  const handler = async interaction => (await launchHandler(interaction)) || (await chronicle?.handle(interaction)) || (await departureHandler(interaction)) || (await councilHandler(interaction)) || (await worldHandler(interaction)) || (await worldTimeHandler(interaction)) || (await adjudicationHandler(interaction)) || (await concentrationHandler(interaction)) || (await reactionsHandler(interaction)) || (await checksHandler(interaction)) || (await companionHandler(interaction)) || (await adventureHandler(interaction)) || (await imageHandler(interaction)) || importHandler(interaction);
  const inFlight = new Set();
  let closing = false;
  client.on(Events.Raw, packet => {
    if (closing || controlOnly) return;
    const task = packet.t === 'INTERACTION_CREATE' ? handler(packet.d) : chronicle?.packet(packet);
    if (!task) return;
    inFlight.add(task);
    task.finally(() => inFlight.delete(task)).catch(() => log({ outcome: 'interaction_failed' }));
  });
  client.on(Events.Error, () => log({ outcome: 'discord_client_error' }));
  client.on(Events.ShardDisconnect, () => { if (!closing) void chronicle?.gap().catch(() => log({ outcome: 'chronicle_gap_failed' })); });
  let timer, mapTimer, chronicleTimer;
  const close = async () => {
    if (closing) return;
    closing = true; clearInterval(timer); clearInterval(mapTimer); clearInterval(chronicleTimer);
    await chronicle?.voice.stop({ flush: true });
    // Client.destroy clears the REST token. Finish private image deliveries while
    // both transport and databases are still available, then close the host.
    await Promise.allSettled(inFlight); if (delivery.running) await delivery.running.catch(() => {});
    await chronicle?.close();
    await client.destroy(); await imageService.close(); await service.close(); game.close(); store.close(); hostLock?.close();
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  try {
    const ready = new Promise(resolveReady => client.once(Events.ClientReady, resolveReady));
    await client.login(config.token); await ready;
    if (args.includes('--register')) {
      await registerLaunchCommand(client, config);
      if (config.chronicleEnabled) await registerSessionCommand(client, config);
      console.log('Raphael commands registered on the existing bot. Unrelated commands were preserved.');
      await close(); return;
    }
    if (args.includes('--publish')) {
      const channel = await client.rest.get(Routes.channel(config.channelId));
      if (channel.guild_id !== config.guildId) throw new Error('Configured channel is not in the configured server.');
      store.db.exec('CREATE TABLE IF NOT EXISTS character_desks(campaign TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)');
      const existing = store.db.prepare('SELECT * FROM character_desks WHERE campaign=?').get(config.campaignId);
      let message;
      if (existing?.channel_id === config.channelId) {
        try { message = await client.rest.patch(Routes.channelMessage(config.channelId, existing.message_id), { body: entryScreen() }); }
        catch (error) { if (error.code !== 10008) throw error; }
      }
      if (!message) message = await client.rest.post(Routes.channelMessages(config.channelId), { body: entryScreen() });
      store.db.prepare('INSERT INTO character_desks VALUES(?,?,?) ON CONFLICT(campaign) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id')
        .run(config.campaignId, config.channelId, message.id);
      console.log('Adventure desk published with character and image controls. Run npm run bot to keep its buttons active.');
      await close(); return;
    }
    timer = setInterval(() => { void service.expire().catch(() => log({ outcome: 'expiry_cleanup_failed' })); }, 60_000);
    mapTimer = setInterval(() => { void delivery.tick().catch(() => log({ outcome: 'private_map_delivery_failed' })); }, 2000);
    if (chronicle) chronicleTimer = setInterval(() => { void chronicle.tick(); }, 2000);
    log({ outcome: 'ready', chronicle: Boolean(chronicle), aiBackend: 'obus' });
  } catch {
    await close();
    throw new Error('Discord startup failed. Check the local bot token, server/channel IDs, and View Channel / Send Messages / Read Message History permissions.');
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
