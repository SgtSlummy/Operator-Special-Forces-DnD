export const FLAGS = { componentsV2: 32768, ephemeral: 64 };
const text = (content) => ({ type: 10, content: String(content).slice(0, 1500) });
const divider = () => ({ type: 14, divider: true, spacing: 1 });
const row = (components) => ({ type: 1, components });
const button = (label, custom_id, style = 2, disabled = false) => ({ type: 2, label: label.slice(0, 80), style, custom_id, disabled });
const safe = (value) => String(value ?? '').replace(/@/g, '@\u200b');
export function buildPanel(view, issue, { tab = 'map', page = 0, group, itemId } = {}) {
  const publicView = view.audience === 'public';
  const gm = view.audience === 'gm';
  const control = (label, data, primary = false, disabled = false) => button(label, issue(data), primary ? 1 : 2, disabled);
  const paging = (total, context = {}) => row([control('Back', { navigation: 'map' }), control('Previous', { ...context, page: Math.max(0, page - 1) }, false, page <= 0), control('Next', { ...context, page: Math.max(0, Math.min(Math.ceil(total / 3) - 1, page + 1)) }, false, (page + 1) * 3 >= total)]);
  const select = (placeholder, choices) => row([{ type: 3, custom_id: issue({ select: true }), placeholder, min_values: 1, max_values: 1, options: choices.slice(0, 25).map(([label, data]) => ({ label: label.slice(0, 100), value: issue(data) })) }]);
  const parts = [text(`## ${safe(publicView ? view.publicTitle ?? 'Operation Hollow Lantern' : view.title ?? 'Operation Hollow Lantern')}`)];
  const summary = publicView ? view.publicSummary : view.summary;
  if (summary) parts.push(text(safe(summary)));
  if(!publicView&&view.mission){
    if(view.mission.packId==='saltglass'){
      const mission=view.mission,progress=[];
      if(mission.courierFreed===true)progress.push('Courier freed');else if(mission.courierFreed===false)progress.push('Courier awaiting rescue');
      if(mission.courierExtracted===true)progress.push('Courier extracted');else if(mission.courierExtracted===false)progress.push('Extraction pending');
      if(mission.complete===true)progress.push('Mission complete');
      if(progress.length)parts.push(text(`Mission: ${progress.join(' · ')}`));
    }else parts.push(text(`Mission: ${view.mission.briefed?'Briefed':'Awaiting briefing'} · ${view.mission.technicianRescued?'Iona rescued':'Rescue pending'} · ${view.mission.signalRestored?'Signal restored':'Signal failing'}${view.mission.complete?' · Debrief complete':''}`));
  }
  if(!publicView&&view.receipt)parts.push(text(`### Action result\n${safe(view.receipt)}`));
  if(!publicView){const reactions=(view.actions??[]).filter(a=>a.group==='reaction');if(reactions.length)parts.push(text('### Reaction decision\nResolve this prompt before play continues.'),row(reactions.slice(0,2).map(a=>control(a.label,{actionId:a.id},true))));}
  if(!publicView&&view.gmController)parts.push(row([control('Return to DM table',{returnToDm:true})]));
  const art = publicView ? view.publicArtUrl : view.artUrl;
  if (art && /^(https:\/\/|attachment:\/\/)/.test(art)) parts.push({ type: 12, items: [{ media: { url: art }, description: publicView ? 'Public scene illustration' : 'Your current view' }] });
  parts.push(divider());
  if (!publicView && tab === 'map' && !group) parts.push(select('Map scale', [['Tactical · squares', { navigation: 'map', mapLevel: 'tactical' }], ['Dungeon · rooms', { navigation: 'map', mapLevel: 'dungeon' }], ['Regional · settlements', { navigation: 'map', mapLevel: 'regional' }]]));
  if (publicView) {
    parts.push(row([control('Join', { navigation: 'join' }, true), control('My Character', { navigation: 'character' }), control('Session Recap', { navigation: 'recap' })]));
  } else if (gm) {
    parts.push(text('Review the scene and pending decisions. You control the DM mode, rulings, and disclosures.'));
    if(view.dmStatus)parts.push(row([control(`Review pending rulings (${view.dmStatus.pendingRulings.length})`,{group:'rulings'})]));
    parts.push(select('DM tools', ['Rulings', 'Reveal', 'Scene', 'Pause', 'Checkpoint','Enroll'].map(label => [label, { group: label.toLowerCase() }])));
    if(view.controllableActors?.length)parts.push(select('Control a character or NPC',view.controllableActors.map(a=>[`${a.active?'▶ ':''}${a.name}${a.sceneId?` · ${a.sceneId}`:''}`,{controlActorId:a.id,navigation:'map'}])));
  } else {
    parts.push(select('Open your character menu', ['Scene', 'Map', 'Character', 'Inventory', 'Journal', 'Help'].map(label => [label, { navigation: label.toLowerCase() }])));
    if (tab === 'character') parts.push(text(`### ${safe(view.actor?.name ?? 'Character')}\n${safe(view.actor?.hp ?? '?')} / ${safe(view.actor?.maxHp ?? '?')} HP${view.actor?.conditions?.length ? ` · ${view.actor.conditions.map(safe).join(', ')}` : ''}\n${safe(view.actor?.details ?? '')}`));
    if (tab === 'character' || ['skills','features','spells','training'].includes(tab)) {
      parts.push(select('Character sheet pages', ['Character','Skills','Features','Spells','Training'].map(label => [label,{navigation:label.toLowerCase()}])));
      const sheet=view.actor?.sheet??{};
      if(tab==='skills') parts.push(text(Object.entries(view.actor?.skills??{}).map(([name,modifier])=>`**${safe(name)}** ${modifier>=0?'+':''}${safe(modifier)}`).join('\n')));
      if(tab==='features') {
        const features=sheet.features??[];
        parts.push(text(features.slice(page*3,page*3+3).map(f=>`**${safe(f.id.replaceAll('-',' '))}**\n${safe(f.description??(f.resolution==='automated'?'Included in the current character sheet or action menu.':'Ask the DM for an explicit ruling before applying this feature.'))}`).join('\n\n')));
        parts.push(paging(features.length,{navigation:'features'}));
      }
      if(tab==='spells') {
        const spell=sheet.spellcasting;
        parts.push(text(spell?Object.entries(spell).map(([key,value])=>`**${safe(key)}:** ${safe(Array.isArray(value)?value.join(', '):value)}`).join('\n'):'This character has no spellcasting.'));
      }
      if(tab==='training')parts.push(text(`**Armor:** ${safe(sheet.armorCalculation)}\n**Weapons:** ${safe(sheet.weaponProficiencies)}\n**Armor training:** ${safe(sheet.armorTraining)}\n**Tools:** ${safe((sheet.tools??[]).join(', '))}\n**Languages:** ${safe((sheet.languages??[]).join(', '))}\n**Passive Perception:** ${safe(sheet.passivePerception)}\n**Equipment:** ${safe(sheet.equipmentGrant)}`));
    }
    else if (tab === 'inventory') {
      const items = view.actor?.inventory ?? [];
      parts.push(text(items.slice(page * 3, page * 3 + 3).map(item => `**${safe(item.name)}** × ${safe(item.quantity)}${item.equipped ? ' · Equipped' : ''}\n${safe(item.description ?? '')}\nValue: ${safe(item.value ?? 'Unknown')}`).join('\n\n') || 'Your pack is empty.'));
      for (const [label, category] of [['Use Item', 'use'], ['Equip Item', 'equip'], ['Drop Item', 'drop'],['Give Item','transfer']]) {
        const choices = (view.actions ?? []).filter(a => a.group === category);
        if (choices.length) parts.push(select(label, choices.map(a => [a.label, { actionId: a.id }])));
      }
      parts.push(paging(items.length, { navigation: 'inventory' }));
    }
    else if (tab === 'journal' || tab === 'recap') parts.push(text((view.journal ?? []).slice(-5).map(safe).join('\n') || 'No discoveries recorded yet.'));
    else if (tab === 'help') parts.push(text('Choose an action to see its targets and cost. Describe Action sends your idea for a DM ruling. Your map and belongings stay private.'));
    if ((tab === 'map' || tab === 'scene') && !group && view.mode === 'shop') {
      parts.push(text('### Merchant stock\nInspect an item before purchasing. Prices and available quantities come from the current stock.'));
      for (const item of (view.stock ?? []).slice(page * 3, page * 3 + 3)) parts.push({ type: 9, components: [text(`**${safe(item.name)}**\n${safe(item.price)} gold · ${safe(item.quantity)} available`)], accessory: control('Inspect', { group: 'inspect', itemId: item.id }) });
      parts.push(select('Trade with merchant', ['Buy', 'Sell'].map(label => [label, { group: label.toLowerCase() }])));
      parts.push(paging(view.stock?.length ?? 0));
    } else if ((tab === 'map' || tab === 'scene') && !group) {
      const labels = view.mode === 'combat' ? ['Move', 'Attack', 'Magic/Abilities', 'Item', 'More Actions'] : ['Move', 'Inspect', 'Interact', 'Talk', 'Travel', 'Describe Action', 'More Actions'];
      parts.push(select('Choose your next action', labels.map(label => [label, { group: ({ 'Magic/Abilities': 'ability', 'More Actions': 'more', 'Describe Action': 'describe' })[label] ?? label.toLowerCase() }])));
      if (view.mode === 'combat') {
        const endTurn = (view.actions ?? []).find(a => a.id === 'end_turn' || a.group === 'end-turn');
        parts.push(row([control('Describe Action', { group: 'describe' }), control('End Turn', { actionId: endTurn?.id }, false, !endTurn)]));
      }
    }
  }
  if (!publicView && group && (tab === 'map' || tab === 'scene')) {
    const stockItem = group === 'inspect' && itemId ? (view.stock ?? []).find(item => item.id === itemId) : null;
    if (stockItem) {
      parts.push(divider(), text(`### ${safe(stockItem.name)}\n${safe(stockItem.description ?? 'No further description is available.')}\n${safe(stockItem.price)} gold · ${safe(stockItem.quantity)} available`));
      parts.push(row([control('Back', { navigation: 'map' }), control('Buy', { group: 'buy', itemId })]));
    } else {
    const choices = (view.actions ?? []).filter(a => (a.group === group || group === 'item' && a.group === 'use') && (!itemId || a.payload?.itemId === itemId));
    parts.push(divider(), text(`### ${safe(group.replaceAll('-', ' '))}\n${choices.length ? 'Choose an available action.' : 'No action is available here. Return to the map or ask your DM.'}`));
    if (choices.length) parts.push(select('Choose a target or action', choices.slice(page * 3, page * 3 + 3).map(action => [action.label, { actionId: action.id }])));
    for (const action of choices.slice(page * 3, page * 3 + 3)) parts.push(text(`**${safe(action.label)}**\n${safe(action.description ?? action.cost ?? 'Review and confirm this action.')}`));
    parts.push(paging(choices.length, { group, itemId }));
    }
  }
  const texts = parts.flatMap(p => p.type === 10 ? [p] : (p.components ?? []).filter(c => c.type === 10));
  const allowance = Math.floor(3900 / Math.max(1, texts.length));
  for (const t of texts) if (t.content.length > allowance) t.content = `${t.content.slice(0, allowance - 1)}…`;
  return { flags: FLAGS.componentsV2 | (publicView ? 0 : FLAGS.ephemeral), allowedMentions: { parse: [] }, components: [{ type: 17, accent_color: 0xd7b54a, components: parts }] };
}
