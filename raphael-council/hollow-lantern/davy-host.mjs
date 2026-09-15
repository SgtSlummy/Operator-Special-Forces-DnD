import {createAdmissionMembership} from './admission-membership.mjs';
import { createEngineClient, EngineError } from './engine-client.mjs';
import { createGameService, presentProjection } from './service.mjs';
import { createHollowLanternAdapter, ControlStore } from '../discord/hollow-lantern/adapter.mjs';
import { buildPanel } from '../discord/hollow-lantern/components.mjs';
import { renderPublicCombatCard } from '../discord/hollow-lantern/renderers.mjs';
import { randomBytes, createHash } from 'node:crypto';

const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const mountedClients = new WeakMap();
export const HOLLOW_LANTERN_COMMAND = Object.freeze({ name: 'hollow-lantern', description: 'Open your Hollow Lantern game panel', type: 1,
  options: [{ name: 'public', description: 'DM: publish the public game entry in DMD Arcade', type: 5, required: false }] });

/** Opt-in composition for Davy's EXISTING client. Never logs in or starts another client.
 * createDavyHost({discordClient,config:{enabled:true,campaignId,guildId,channelId,
 * applicationId,gmUserId,characterOwners:{actorId:ownerId},registeredCommandId?},
 * engineOptions:{baseUrl,secret},renderAssets?,engineClient?,onError?}).
 * registerCommand() explicitly performs GET then additive guild POST, never bulk PUT.
 * publishLobby({requestedBy}) is an explicit authenticated DM action.
 * close() removes only this host's listener. Construction performs no network request.
 */
export function createDavyHost({ discordClient, config, engineOptions = {}, renderAssets, engineClient, presentationState, publicFeed, draftStore, mountListener = true, webLink, panelExtras, enrollmentEntry, onError = () => {} } = {}) {
  if (config?.enabled !== true) return Object.freeze({ enabled: false, close() {} });
  if (!discordClient?.on || !discordClient?.off || !config.campaignId || !['guildId','channelId','applicationId','gmUserId'].every(key => snowflake(config[key]))) throw new Error('Explicit Discord campaign configuration is required.');
  if (discordClient.application?.id && discordClient.application.id !== config.applicationId) throw new Error('The existing Discord application does not match this host.');
  if (config.rehearsalNotice !== undefined && (typeof config.rehearsalNotice !== 'string' || config.rehearsalNotice.length > 1000)) throw new Error('The rehearsal notice must be a short public label.');
  const mountKey = `${config.applicationId}:${config.guildId}:hollow-lantern`;
  if (mountedClients.get(discordClient)?.has(mountKey)) throw new Error('Hollow Lantern is already mounted for this server.');
  config = Object.freeze({ ...config });
  if(presentationState){const saved=presentationState.read();if(['campaignId','guildId','channelId','applicationId'].some(key=>saved[key]!==config[key]))throw new Error('Presentation state scope does not match this host.');}
  if (!config.characterOwners || typeof config.characterOwners !== 'object' || Array.isArray(config.characterOwners)) throw new Error('An explicit character ownership map is required.');
  const owners = Object.freeze({ ...config.characterOwners });
  if (Object.values(owners).some(id => !snowflake(id) && !['ai-fighter','ai-rogue','ai-cleric'].includes(id))) throw new Error('Character owners must be Discord user IDs or explicit AI seats.');
  const client = engineClient ?? createEngineClient({ ...engineOptions, campaignId: config.campaignId, channelId: config.channelId });
  if (client.campaignId !== config.campaignId || (client.channelId && client.channelId !== config.channelId)) throw new Error('Engine campaign scope does not match this host.');
  let closed = false, lobby, publishedRevision = -1, requestedRevision = -1, renderGeneration = 0, publicationQueue = Promise.resolve(), commandRegistrationQueue = Promise.resolve();
  const tableControls = new Map();
  const entryPrefix='hl:entry:'+createHash('sha256').update(JSON.stringify([config.applicationId,config.guildId,config.channelId,config.campaignId])).digest('hex').slice(0,24)+':';
  const entryId=navigation=>entryPrefix+navigation;
  const noSeat=()=>`This Discord account has no single enrolled character. The configured DM is <@${config.gmUserId}>. Switch to that Discord account if you are the DM, or ask that DM to enroll this account. Use /hollow-lantern to open a fresh panel; Session Recap is available without a character.`;
  async function entryOrigin(i,{publicOnly=false}={}){
    if(i.applicationId!==config.applicationId||i.guildId!==config.guildId||i.message?.author?.id!==config.applicationId)return false;
    if(i.channelId===config.channelId)return true;
    if(publicOnly)return false;
    try{const channel=await discordClient.channels.fetch(i.channelId);return channel?.guildId===config.guildId&&channel.parentId===config.channelId&&channel.isThread?.()===true;}catch{return false;}
  }
  async function freshEntry(i,navigation,{expired=false}={}){
    await i.deferReply({flags:64});
    if(!await entryOrigin(i,{publicOnly:!expired})){await i.editReply({content:'Use /hollow-lantern in the configured game server to open a fresh panel.',allowedMentions:{parse:[]}});return true;}
    const userId=i.user.id;
    if(!await currentMember(userId)){await i.editReply({content:'Your campaign membership is no longer available.',allowedMentions:{parse:[]}});return true;}
    if(navigation==='join'&&typeof enrollmentEntry==='function'){await enrollmentEntry(i);return true;}
    if(navigation==='recap'){
      const view=await service.project({campaignId:config.campaignId,userId:config.gmUserId,audience:'public'});
      const content=('Session Recap\n'+(view.journal?.join('\n')||view.publicSummary||'No public events yet.')).slice(0,1900).replace(/@/g,'@\u200b');
      if(!await currentMember(userId))throw new Error('Access changed');await i.editReply({content,allowedMentions:{parse:[]}});return true;
    }
    const seat=await resolveScope({userId});
    if(!seat){await i.editReply({content:noSeat(),allowedMentions:{parse:[]}});return true;}
    const payload=await openPanel({userId,...seat});
    if(expired)payload.components.unshift({type:10,content:'Your old control expired. This is your fresh authorized panel; no old action was repeated.'});
    if(!await authorize({campaignId:config.campaignId,userId,...seat}))throw new Error('Access changed');await i.editReply(payload);return true;
  }

  const admissionMembership=config.admissionEnabled?createAdmissionMembership({client:discordClient,guildId:config.guildId,channelId:config.channelId}):null;
  async function currentMember(userId, fresh=false) {
    if(admissionMembership)return admissionMembership.member(userId,{fresh});
    if (closed || !snowflake(userId)) return false;
    try {
      const guild = await discordClient.guilds.fetch(config.guildId);
      const member = await guild.members.fetch({ user: userId, force: true, cache: false });
      if(config.admissionEnabled){const channel=await guild.channels.fetch(config.channelId);if(!channel?.permissionsFor(member)?.has('ViewChannel'))return false;}
      return Boolean(member && member.id === userId && member.user?.bot !== true && (!config.admissionEnabled || member.pending !== true));
    } catch { return false; }
  }
  async function authorize(scope) {
    if (scope.campaignId !== config.campaignId || !await currentMember(scope.userId,scope.freshMembership===true)) return false;
    if (scope.audience === 'public') return true;
    if (scope.audience === 'gm') return scope.userId === config.gmUserId;
    if(scope.audience!=='player'||!scope.actorId)return false;
    try {
      const view=await client.project({ownerId:scope.userId,actorId:scope.actorId,audience:'private',mapLevel:scope.mapLevel??'tactical'});
      const character=view.characters?.find(c=>c.characterId===scope.actorId);
      return view.audience==='private'&&view.characterId===scope.actorId&&Boolean(character)&&(scope.userId===config.gmUserId||character.ownerId===scope.userId);
    } catch {return false;}
  }
  async function resolveScope({ userId }) {
    if (!await currentMember(userId)) return null;
    if (userId === config.gmUserId) return { audience: 'gm' };
    let seats;
    try {
      // This internal DM read is reduced to owned seat IDs; it is never returned to the requester.
      const view=await client.project({ownerId:config.gmUserId,audience:'gm'});
      seats=(view.characters??[]).filter(c=>c.characterType==='player'&&c.ownerId===userId).map(c=>[c.characterId,c.ownerId]);
    }catch{return null;}
    // Multiple human-owned characters require an explicit seat chooser, never an owner-wide union.
    return seats.length === 1 ? { actorId: seats[0][0], audience: 'player' } : null;
  }
  const committedListeners = new Set();
  const observedCommits = new Set();
  const baseService = createGameService({ client, authorize });
  const report = code => { try { onError({ code }); } catch { /* Logging cannot affect game state. */ } };
  const service = { project: baseService.project, receipt: baseService.receipt, async command(scope) {
    const receipt = await baseService.command(scope);
    // Only a returned authoritative receipt may schedule a public refresh. No retry of commands.
    if (Number.isSafeInteger(receipt.revision)) {
      try { await refreshPublic({ committedRevision: receipt.revision }); } catch { report('PUBLIC_REFRESH_FAILED'); }
    }
    await notifyCommit({ scope, receipt });
    return receipt;
  } };
  async function notifyCommit({scope,receipt}) {
    const key=`${receipt.revision}:${receipt.commandId}`;
    if(receipt.replayed||observedCommits.has(key))return;
    observedCommits.add(key);if(observedCommits.size>10000)observedCommits.delete(observedCommits.values().next().value);
    for (const listener of committedListeners) {
      try { await listener({scope:structuredClone(scope),input:{action:scope.action,payload:structuredClone(scope.payload??{})},receipt:structuredClone(receipt)}); }
      catch {report('COMMIT_OBSERVER_FAILED');}
    }
  }
  async function flushPublicFeed() {
    if(!publicFeed)return null;
    if(!await currentMember(config.gmUserId))throw new EngineError('ACCESS_DENIED','Current DM membership is required.',403);
    return publicFeed.flush({channel:await targetChannel(),render:async raw=>{
      const view=presentProjection(raw);
      return renderPublicCombatCard({title:view.publicTitle,summary:view.publicSummary,participants:view.publicParticipants},{portraits:renderAssets?.portraits,sceneArt:renderAssets?.publicSceneArts?.[view.sceneId]??renderAssets?.publicSceneArt});
    }});
  }
  // Only the authenticated durable engine journal supplies this entry. A client
  // form or gameplay model cannot call this method through an interaction route.
  async function acceptCommittedEvent(entry) {
    if(entry?.receipt?.campaignId!==config.campaignId||entry.receipt.revision!==entry.revision||entry.receipt.commandId!==entry.commandId||entry.publicProjection?.audience!=='public'||entry.publicProjection.revision!==entry.revision)throw new Error('Committed event scope mismatch.');
    if(publicFeed){await publicFeed.record({receipt:entry.receipt,projection:entry.publicProjection});const result=await flushPublicFeed();if(result?.blocked||result?.missingRevision)throw new Error('Public step delivery needs recovery.');}
    const action=entry.type==='gm_decision'?'decision':entry.type==='gm_scene'?`scene:${entry.publicProjection.currentSceneId}`:entry.type;
    await refreshPublic({committedRevision:entry.revision});
    await notifyCommit({scope:{campaignId:config.campaignId,userId:entry.ownerId,actorId:entry.actorId,audience:entry.ownerId===config.gmUserId?'gm':'player',action,payload:{}},receipt:entry.receipt});
  }
  const tokenStore = new ControlStore();
  const adapter = createHollowLanternAdapter({ campaignId: config.campaignId, engine: service, authorize, resolveScope, renderAssets, tokenStore, draftStore,
    async onJoin(interaction, { userId }) {
      if (typeof enrollmentEntry === 'function') return enrollmentEntry(interaction);
      await interaction.deferReply({ flags: 64 });
      const seat = await resolveScope({ userId });
      if (!seat) { await interaction.editReply({ content: noSeat(), allowedMentions: { parse: [] } }); return; }
      await interaction.editReply(await openPanel({ userId, ...seat }));
    } });

  async function openPanel(scope) {
    const bound={campaignId:config.campaignId,...scope};
    if(!await authorize(bound))throw new EngineError('ACCESS_DENIED','You no longer have access to this panel.',403);
    const payload=await adapter.panel(bound);
    if(config.rehearsalNotice)payload.components.unshift({type:10,content:config.rehearsalNotice});
    if(typeof panelExtras==='function'){
      try{const extras=await panelExtras(bound);if(Array.isArray(extras))payload.components.push(...extras);}catch{report('PANEL_ASSISTANCE_UNAVAILABLE');}
    }
    if(typeof webLink==='function'&&bound.audience!=='public') {
      // Static Discord panels outlive a one-use sign-in link. Mint the link only
      // after the rightful viewer presses this freshly authorized control.
      for(const [id,entry]of tableControls)if(entry.expires<Date.now())tableControls.delete(id);
      if(tableControls.size>=512)tableControls.delete(tableControls.keys().next().value);
      const id=`hl:table:${randomBytes(18).toString('base64url')}`;
      tableControls.set(id,{scope:structuredClone(bound),expires:Date.now()+24*60*60*1000});
      payload.components.push({type:1,components:[{type:2,style:2,label:'Open Table',custom_id:id}]});
    }
    if(!await authorize(bound))throw new EngineError('ACCESS_DENIED','Your access changed before this panel could be delivered.',403);
    return payload;
  }

  async function targetChannel() {
    const channel = await discordClient.channels.fetch(config.channelId);
    if (!channel || channel.guildId !== config.guildId || !channel.isTextBased?.() || typeof channel.send !== 'function') throw new Error('The configured game channel is unavailable.');
    return channel;
  }
  async function publicPayload() {
    // The DM identity is internal authorization only; audience remains PUBLIC all the way to engine.
    if (!await authorize({ campaignId: config.campaignId, userId: config.gmUserId, audience: 'gm' })) throw new Error('Current DM membership is required.');
    const scope = { campaignId: config.campaignId, userId: config.gmUserId, audience: 'public' };
    const view = await service.project(scope);
    if (view.audience !== 'public') throw new Error('A public projection is required.');
    let image;
    if (renderAssets?.publicSceneArts?.[view.sceneId] || renderAssets?.publicSceneArt || view.publicParticipants?.length) image = await renderPublicCombatCard({ title: view.publicTitle, summary: view.publicSummary, participants: view.publicParticipants }, { portraits: renderAssets?.portraits, sceneArt: renderAssets?.publicSceneArts?.[view.sceneId] ?? renderAssets?.publicSceneArt });
    const payload = buildPanel(image ? { ...view, publicArtUrl: 'attachment://public-scene.png' } : view, data => entryId(data.navigation));
    if(config.rehearsalNotice)payload.components.unshift({type:10,content:config.rehearsalNotice});
    if(typeof config.publicCredits==='string'&&config.publicCredits.length<=1500)payload.components.push({type:10,content:`-# ${config.publicCredits}`});
    if (image) payload.files = [{ attachment: image, name: 'public-scene.png' }];
    return { payload, revision: view.revision };
  }
  async function refreshPublic({ committedRevision, forcePresentation = false } = {}) {
    if (closed || !lobby || !Number.isSafeInteger(committedRevision) || (forcePresentation ? committedRevision < publishedRevision || requestedRevision > publishedRevision : committedRevision <= requestedRevision || committedRevision <= publishedRevision)) return false;
    requestedRevision = committedRevision;
    const generation = ++renderGeneration;
    try {
      const rendered = await publicPayload();
      if (forcePresentation && rendered.revision !== committedRevision) return false;
      if (closed || generation !== renderGeneration || rendered.revision < requestedRevision) return false;
      const task = publicationQueue.then(async () => {
        if (closed || generation !== renderGeneration || (forcePresentation ? rendered.revision < publishedRevision : rendered.revision <= publishedRevision)) return false;
        await lobby.edit({ ...rendered.payload, attachments: [] });
        publishedRevision = rendered.revision;
        return true;
      });
      publicationQueue = task.catch(() => {});
      return await task;
    } finally {
      // Release only this failed reservation. An older render cannot clear a newer
      // refresh, and retrying presentation never resubmits a gameplay command.
      if (generation === renderGeneration && publishedRevision < requestedRevision) requestedRevision = publishedRevision;
    }
  }
  async function publishLobby({ requestedBy } = {}) {
    if (requestedBy !== config.gmUserId || !await currentMember(requestedBy)) throw new EngineError('ACCESS_DENIED', 'Only the current DM may publish the game entry.', 403);
    const generation = ++renderGeneration;
    const rendered = await publicPayload();
    const channel = await targetChannel();
    const task = publicationQueue.then(async () => {
      if (closed || generation !== renderGeneration) return null;
      if(!await currentMember(requestedBy))throw new EngineError('ACCESS_DENIED','DM membership changed before publication.',403);
      if(presentationState){
        if(presentationState.read().pending.lobby)throw new Error('Public panel delivery needs explicit recovery.');
        if(!lobby&&presentationState.read().lobbyMessageId)lobby=await presentationState.verifyExisting('lobby',async({id})=>channel.messages.fetch(id));
      }
      if(lobby)lobby=await lobby.edit({ ...rendered.payload, attachments: [] });
      else{
        const operationId=presentationState?await presentationState.beginSend('lobby'):null;
        const sent=await channel.send(rendered.payload);
        if(presentationState)await presentationState.completeSend('lobby',{operationId,id:sent.id});
        lobby=sent;
      }
      publishedRevision = rendered.revision; requestedRevision = Math.max(requestedRevision, rendered.revision);
      return lobby;
    });
    publicationQueue = task.catch(() => {});
    return task;
  }

  function registerCommand() {
    const task=commandRegistrationQueue.then(registerCommandOnce);
    commandRegistrationQueue=task.catch(()=>{});return task;
  }
  async function registerCommandOnce() {
    if (closed) throw new Error('The game host is closed.');
    const route = `/applications/${config.applicationId}/guilds/${config.guildId}/commands`;
    const existing = await discordClient.rest.get(route);
    if (!Array.isArray(existing)) throw new Error('Discord returned an invalid command registry.');
    const conflict = existing.find(command => command.name === HOLLOW_LANTERN_COMMAND.name);
    if(presentationState){
      const saved=presentationState.read();
      if(saved.pending.command)throw new Error('Command registration needs explicit recovery.');
      if(saved.registeredCommandId)return presentationState.verifyExisting('command',async({id})=>existing.find(command=>command.id===id));
      if(conflict&&config.registeredCommandId===conflict.id){await presentationState.recover('command',{id:conflict.id,verify:async()=>conflict});return conflict;}
    }
    if (conflict) {
      if (config.registeredCommandId && conflict.id === config.registeredCommandId && conflict.type === 1) return conflict;
      throw new Error('The hollow-lantern command already exists. Bind its verified command ID before mounting; existing commands were preserved.');
    }
    const operationId=presentationState?await presentationState.beginSend('command'):null;
    const registered=await discordClient.rest.post(route, { body: HOLLOW_LANTERN_COMMAND });
    if(presentationState)await presentationState.completeSend('command',{operationId,id:registered.id});
    return registered;
  }
  const pendingInteractions = new Set();
  let closeFlight;
  function handleInteraction(interaction) {
    if (closed) return Promise.resolve(false);
    const task = handleInteractionOnce(interaction);
    pendingInteractions.add(task);
    void task.then(() => pendingInteractions.delete(task), () => pendingInteractions.delete(task));
    return task;
  }
  async function handleInteractionOnce(interaction) {
    const slash = interaction.isChatInputCommand?.() && interaction.commandName === HOLLOW_LANTERN_COMMAND.name;
    const control = interaction.customId?.startsWith('hl:');
    if (!slash && !control) return false;
    if (closed) return false;
    if (interaction.guildId !== config.guildId || (interaction.applicationId && interaction.applicationId !== config.applicationId)) {
      await interaction.reply({ content: 'Open the game from its configured server.', flags: 64 }); return true;
    }
    if(interaction.customId?.startsWith('hl:entry:')){
      const navigation=interaction.customId.slice(entryPrefix.length);
      if(!interaction.customId.startsWith(entryPrefix)||!['join','character','recap'].includes(navigation)){await interaction.reply({content:'This entry belongs to another campaign. Use /hollow-lantern for the current campaign.',flags:64,allowedMentions:{parse:[]}});return true;}
      return freshEntry(interaction,navigation);
    }
    const oldToken=control?tokenStore.get(interaction.customId):null;
    if(oldToken?.audience==='public'&&['join','character','recap'].includes(oldToken.navigation))return freshEntry(interaction,oldToken.navigation);
    if(control&&!interaction.customId.startsWith('hl:table:')&&(!oldToken||(oldToken.select&&!tokenStore.get(interaction.values?.[0]))))return freshEntry(interaction,'character',{expired:true});
    if(interaction.customId?.startsWith('hl:table:')){
      const entry=tableControls.get(interaction.customId);
      if(!entry||entry.expires<Date.now())return freshEntry(interaction,'character',{expired:true});
      if(interaction.user?.id!==entry.scope.userId||!await authorize(entry.scope)){
        await interaction.reply({content:'Open a current private game panel to get your table link.',flags:64,allowedMentions:{parse:[]}});return true;
      }
      await interaction.deferReply({flags:64});
      const link=await webLink(entry.scope),url=new URL(link);
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('The table link must use HTTPS or loopback HTTP.');
      if(!await authorize(entry.scope))throw new EngineError('ACCESS_DENIED','Your table access changed.',403);
      await interaction.editReply({content:'Open your private table within one minute. This local table opens on the computer running the game.',allowedMentions:{parse:[]},components:[{type:1,components:[{type:2,style:5,label:'Open private table',url:link}]}]});return true;
    }
    if (control) return adapter.handleInteraction(interaction);
    await interaction.deferReply({ flags: 64 });
    const userId = interaction.user.id;
    if (interaction.options?.getBoolean('public')) {
      await publishLobby({ requestedBy: userId });
      await interaction.editReply({ content: 'The public game entry is ready in DMD Arcade.', allowedMentions: { parse: [] } });
      return true;
    }
    const seat = await resolveScope({ userId });
    if (!seat) {
      if (typeof enrollmentEntry === 'function') await enrollmentEntry(interaction);
      else await interaction.editReply({ content: noSeat(), allowedMentions: { parse: [] } });
      return true;
    }
    await interaction.editReply(await openPanel({ userId, ...seat }));
    return true;
  }
  const listener = interaction => { void handleInteraction(interaction).catch(async () => {
    report('INTERACTION_FAILED');
    const payload = { content: 'The game panel is unavailable. Reopen it to check the current state.', allowedMentions: { parse: [] } };
    try { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply({ ...payload, flags: 64 }); } catch { report('INTERACTION_REPLY_FAILED'); }
  }); };
  if (mountListener) discordClient.on('interactionCreate', listener);
  if (!mountedClients.has(discordClient)) mountedClients.set(discordClient, new Set());
  mountedClients.get(discordClient).add(mountKey);
  return Object.freeze({ enabled: true, engine: client, campaignId: config.campaignId, gmUserId: config.gmUserId, adapter, service, authorize, resolveScope, openPanel,
    onCommitted(listener) { if (typeof listener !== 'function') throw new TypeError('A commit listener is required.'); committedListeners.add(listener); return () => committedListeners.delete(listener); }, registerCommand, publishLobby, refreshPublic, acceptCommittedEvent, flushPublicFeed, handleInteraction,
    close() {
      if (closeFlight) return closeFlight;
      closed = true; admissionMembership?.close(); committedListeners.clear(); observedCommits.clear(); tableControls.clear(); renderGeneration++;
      discordClient.off('interactionCreate', listener); mountedClients.get(discordClient)?.delete(mountKey);
      // The caller owns shared storage. Drain accepted interactions before it releases that storage.
      closeFlight = Promise.allSettled([...pendingInteractions]).then(() => {});
      return closeFlight;
    } });
}
