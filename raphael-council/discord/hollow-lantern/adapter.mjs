import { randomBytes, randomUUID } from 'node:crypto';
import { buildPanel, FLAGS } from './components.mjs';
import { renderTacticalMap, renderIllustratedOverview, renderPublicCombatCard, renderSceneIllustration } from './renderers.mjs';
import { selectSceneArt } from '../../hollow-lantern/scene-art.mjs';
import { presentReceipt } from '../../hollow-lantern/service.mjs';
import { allocationField, handleAllocation } from './healing-allocation.mjs';
import { createInvestigationDraftFlow } from './investigation-draft.mjs';

export class ControlStore {
  constructor({ ttlMs = 900000, capacity = 10000, now = Date.now } = {}) { Object.assign(this, { ttlMs, capacity, now }); this.entries = new Map(); }
  issue(data) {
    for (const [key, value] of this.entries) if (value.expires <= this.now()) this.entries.delete(key);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value);
    const id = `hl:${randomBytes(18).toString('base64url')}`;
    this.entries.set(id, { ...data, expires: this.now() + this.ttlMs }); return id;
  }
  get(id) { const value = this.entries.get(id); return value?.expires > this.now() ? value : null; }
}

// authorize must consult current membership/ownership, never merely the token.
export function createHollowLanternAdapter({ engine, authorize, resolveActor, resolveScope, onJoin, campaignId, renderAssets = {}, tokenStore = new ControlStore(), draftStore }) {
  if (!engine?.project || !engine?.command || !authorize || (!resolveActor && !resolveScope) || !campaignId) throw new Error('Engine, current authorization, scope resolver and campaign are required.');
  const drafts = createInvestigationDraftFlow({draftStore,engine,authorize,tokenStore});
  const render = async (view, scope, options = {}) => {
    let image;
    const sceneSource = view.audience === 'player' && scope.actorId && options.tab === 'scene' ? selectSceneArt(view, renderAssets) : undefined;
    if (sceneSource) image = await renderSceneIllustration(sceneSource);
    const tactical = view.audience === 'player' && scope.actorId && view.map?.level === 'tactical' && (!options.tab || options.tab === 'map');
    const canDetail = tactical && view.map.viewerCharacterId === scope.actorId && view.map.tokens?.some(t => t.characterId === scope.actorId && view.map.cells?.some(c => c.x === t.x && c.y === t.y && c.visibility === 'visible'));
    const detail = Boolean(canDetail && options.mapDetail === 'nearby');
    if (view.audience !== 'public' && view.map && (!options.tab || options.tab === 'map')) {
      image = view.map.level === 'dungeon' || view.map.level === 'regional'
        ? await renderIllustratedOverview({ ...view.map, title: view.title ?? 'Your discovered routes' }, { roomVignettes: renderAssets.dungeonVignettes })
        : await renderTacticalMap(view.map, { title: view.title ?? 'Your view', portraits: renderAssets.portraits, terrainTextures:renderAssets.terrainTextures, terrainTexturesByScene:renderAssets.terrainTexturesByScene, background: renderAssets.tacticalBackgrounds?.[view.map.id], detail });
    }
    if (view.audience === 'public' && (renderAssets.publicSceneArts?.[view.sceneId] || renderAssets.publicSceneArt || view.publicParticipants?.length)) image = await renderPublicCombatCard({ title: view.publicTitle, summary: view.publicSummary, participants: view.publicParticipants }, { portraits: renderAssets.portraits, sceneArt: renderAssets.publicSceneArts?.[view.sceneId] ?? renderAssets.publicSceneArt });
    const name = view.audience === 'public' ? 'public-scene.png' : sceneSource ? 'character-scene.png' : 'character-map.png';
    const rendered={...view,gmController:Boolean(scope.gmController),...(image?{[view.audience==='public'?'publicArtUrl':'artUrl']:`attachment://${name}`}:{})};
    const payload = buildPanel(rendered, data => tokenStore.issue({ ...scope, revision: view.revision, mapDetail: detail ? 'nearby' : 'full', ...data, ...(data.actionId?{commandId:randomUUID()}:{}), opensModal: Boolean(view.actions?.find(a => a.id === data.actionId)?.fields?.length) }), options);
    if (canDetail) {
      const parts = payload.components[0].components;
      const gallery = parts.findIndex(c => c.type === 12);
      parts.splice(gallery + 1, 0, { type: 1, components: [['Full map', 'full'], ['Nearby detail', 'nearby']].map(([label, mapDetail]) => ({ type: 2, style: (detail ? 'nearby' : 'full') === mapDetail ? 1 : 2, label, custom_id: tokenStore.issue({ ...scope, revision: view.revision, navigation: 'map', mapDetail }) })) });
    }
    await drafts?.resume(payload,scope,view);
    if (image) payload.files = [{ attachment: image, name }];
    if (!await authorize(scope)) throw new Error('Access changed before private delivery');
    if (sceneSource) {
      const after = await engine.project(scope);
      if (after.revision !== view.revision || after.sceneId !== view.sceneId || selectSceneArt(after, renderAssets) !== sceneSource) throw new Error('Scene changed before private delivery');
      if (!await authorize(scope)) throw new Error('Access changed before private delivery');
    }
    return payload;
  };
  async function panel({ userId, actorId, audience = 'player', mapLevel = 'tactical', ...options }) {
    if (!['tactical', 'dungeon', 'regional'].includes(mapLevel)) throw new Error('Invalid map level');
    if (options.mapDetail !== undefined && !['full', 'nearby'].includes(options.mapDetail)) throw new Error('Invalid map detail');
    const scope = { campaignId, userId, actorId, audience, mapLevel };
    if (!await authorize(scope)) throw new Error('Access denied');
    const view = await engine.project(scope);
    return render({ ...view, audience }, scope, options);
  }
  async function handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('hl:')) return false;
    let acknowledged = false;
    let activeToken;
    try {
    const reject = async message => { const payload = { content: message, allowedMentions: { parse: [] } }; if (acknowledged) await interaction.editReply(payload); else await interaction.reply({ ...payload, flags: FLAGS.ephemeral }); return true; };
    let token = tokenStore.get(interaction.customId);
    if (token?.select) {
      const selected = tokenStore.get(interaction.values?.[0]);
      if (!selected || ['campaignId', 'userId', 'actorId', 'audience', 'revision'].some(key => selected[key] !== token[key])) return reject('That choice is not valid for this panel.');
      token = selected;
    }
    if (!token) return reject('This control expired. Open the game panel again.');
    if (token.mapDetail !== undefined && !['full', 'nearby'].includes(token.mapDetail)) return reject('That map view is not available.');
    activeToken=token;
    if (token.campaignId !== campaignId) return reject('This control belongs to another campaign.');
    const userId = interaction.user.id;
    if (token.audience !== 'public' && token.userId !== userId) return reject('This control belongs to another player. Open My Character.');
    if (!(token.audience === 'public' && token.navigation === 'join' && onJoin) && (!token.opensModal || interaction.isModalSubmit?.())) {
      await interaction.deferReply({ flags: FLAGS.ephemeral });
      acknowledged = true;
    }
    if (token.mapLevel && !['tactical', 'dungeon', 'regional'].includes(token.mapLevel)) return reject('That map level is not available.');
    let scope = { campaignId, userId, actorId: token.actorId, audience: token.audience, mapLevel: token.mapLevel ?? 'tactical',gmController:Boolean(token.gmController) };
    if (token.audience === 'public') {
      if (!await authorize({ campaignId, userId, audience: 'public' })) return reject('You do not have access to this campaign.');
      if (token.navigation === 'join' && onJoin) { await onJoin(interaction, { campaignId, userId, navigation: 'join' }); return true; }
      const seat = resolveScope ? await resolveScope({ campaignId, userId, navigation: token.navigation }) : { actorId: await resolveActor({ campaignId, userId }), audience: 'player' };
      if (!seat || !['player', 'gm'].includes(seat.audience) || (seat.audience === 'player' && !seat.actorId)) return reject('You do not have a character seat yet. Ask your DM to enroll you, then open My Character.');
      scope = { ...scope, actorId: seat.actorId, audience: seat.audience };
    }
    if (!await authorize(scope)) return reject('You no longer have access to this character or campaign.');
    if(token.controlActorId){if(scope.audience!=='gm')return reject('Only the DM can select another actor.');scope={...scope,audience:'player',actorId:token.controlActorId,gmController:true};}
    if(token.returnToDm){scope={...scope,audience:'gm',actorId:undefined,gmController:false};}
    if(!await authorize(scope))return reject('You no longer have access to this character or campaign.');
    const view = await engine.project(scope);
    if (drafts && await drafts.handle({token,scope,view,interaction,reject,render,send:async payload=>{if(acknowledged)await interaction.editReply(payload);else{await interaction.reply({...payload,flags:payload.flags|FLAGS.ephemeral});acknowledged=true;}}})) return true;
    if (!token.intent && token.audience !== 'public' && token.revision !== view.revision) return reject('The scene changed. Open the game panel again for current choices.');
    const action = token.intent ? token.actionSnapshot : (view.actions ?? []).find(a => a.id === token.actionId);
    if (token.actionId && !action) return reject('That action is no longer available. Open the game panel again.');
    let allocationInput;
    if (!token.intent && (token.healingAllocation || allocationField(action))) {
      const result = await handleAllocation({ token, action, scope, view, interaction, tokenStore, authorize, reject,
        send: async payload => { if (acknowledged) await interaction.editReply(payload); else { await interaction.reply({ ...payload, flags: payload.flags | FLAGS.ephemeral }); acknowledged = true; } } });
      if (result.handled) return true;
      allocationInput = result.input;
    }
    if (!allocationInput && !token.intent && action?.fields?.length && !interaction.isModalSubmit?.()) {
      if(!await authorize(scope))return reject('You no longer have access to this character or campaign.');
      await interaction.showModal({ title: String(action.label ?? action.id).slice(0, 45), custom_id: tokenStore.issue({ ...token, commandId: randomUUID() }), components: action.fields.slice(0, 5).map(field => ({ type: 18, label: field.label.slice(0, 45), component: { type: 4, custom_id: field.id, style: field.multiline ? 2 : 1, required: field.required !== false, max_length: Math.min(field.maxLength ?? 500, 4000) } })) });
      return true;
    }
    const input = allocationInput ?? {};
    const savedAllocation = Boolean(token.healingAllocation && token.intent);
    for (const field of token.retryOriginal || savedAllocation || allocationInput ? [] : action?.fields ?? []) {
      const value = interaction.fields.getTextInputValue(field.id);
      if ((field.required !== false && !value.trim()) || value.length > Math.min(field.maxLength ?? 500, 4000)) return reject(`Check ${field.label}: enter ${field.required === false ? 'up to' : '1 to'} ${Math.min(field.maxLength ?? 500, 4000)} characters.`);
      input[field.id] = value;
    }
    if (!acknowledged) { await interaction.deferReply({ flags: FLAGS.ephemeral }); acknowledged = true; }
      if (action) {
        const requested={ ...scope, expectedRevision: token.intent?.expectedRevision??view.revision, commandId: token.commandId ?? interaction.id, action: action.id, payload: token.retryOriginal||savedAllocation?token.intent.payload:{ ...action.payload, ...input } };
        if(!token.intent){token.intent=structuredClone(requested);token.actionSnapshot=structuredClone(action);}
        if (!(token.healingAllocation && token.receipt)) {
          const receipt=await engine.command(requested);
          token.receipt=presentReceipt(receipt);
        }
      }
      const next = action ? await engine.project(scope) : view;
      const rendered=await render({ ...next, audience: scope.audience,receipt:action?token.receipt:undefined }, scope, { tab: token.navigation ?? 'map', group: token.group, page: token.page ?? 0, itemId: token.itemId, mapDetail: token.mapDetail });
      if(!await authorize(scope))return reject('You no longer have access to this character or campaign.');
      await interaction.editReply(rendered);
    return true;
    } catch (error) {
      const knownEngineError = error?.name === 'EngineError' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code ?? '') && typeof error.message === 'string';
      const message = knownEngineError
        ? `${error.message.slice(0, 300).replace(/@/g, '@\u200b')} (${error.code}). Reopen the panel to check the current state before trying again.`
        : 'The game panel could not be refreshed. Reopen it to check the current state before trying again.';
      const retry=activeToken?.intent?{type:1,components:[{type:2,style:1,label:'Recover original action',custom_id:tokenStore.issue({...activeToken,opensModal:false,retryOriginal:true})}]}:null;
      if (acknowledged || interaction.deferred || interaction.replied) await interaction.editReply({ flags: FLAGS.componentsV2, components: [{ type: 10, content: message },...(retry?[retry]:[])], attachments: [], allowedMentions: { parse: [] } });
      else await interaction.reply({ content: message, flags: FLAGS.ephemeral, allowedMentions: { parse: [] } });
      return true;
    }
  }
  return { panel, handleInteraction };
}

