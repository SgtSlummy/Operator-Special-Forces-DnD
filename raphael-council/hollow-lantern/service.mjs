import {EngineError} from './engine-client.mjs';
import {createHash} from 'node:crypto';
import {abilityDescription,standardActionDescription,featureDescription} from './action-guide.mjs';
import {parseHealingAllocation} from './healing-allocation.mjs';

const names=Object.freeze({briefing:'Vesper Quay · Mission briefing','coastal-road':'Lantern Road','signal-dungeon':'The Signal House',rescue:'Lantern Chamber','harbor-shop':'Vesper Quay · Quartermaster',debrief:'Vesper Quay · Debrief'});
const label=id=>String(id??'').replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
const distance=(a,b)=>Math.max(Math.abs(a.position.x-b.position.x),Math.abs(a.position.y-b.position.y));
const field=(id,label,multiline=false)=>({id,label,multiline,maxLength:multiline?1500:12});
const audience=value=>value==='player'?'private':value;
const skillAbilities={'acrobatics':'dexterity','animal handling':'wisdom',arcana:'intelligence',athletics:'strength',deception:'charisma',history:'intelligence',insight:'wisdom',intimidation:'charisma',investigation:'intelligence',medicine:'wisdom',nature:'intelligence',perception:'wisdom',performance:'charisma',persuasion:'charisma',religion:'intelligence','sleight of hand':'dexterity',stealth:'dexterity',survival:'wisdom'};

/** Only already filtered authoritative data reaches a presentation surface. */
export function presentProjection(p){
 if(p?.projectionVersion!==2||!['public','private','gm'].includes(p.audience))throw new EngineError('INVALID_VIEW','The engine view is not supported.');
 const publicView=p.audience==='public',gm=p.audience==='gm',own=!publicView&&p.characters?.find(c=>c.characterId===p.characterId),resources=own?.resources??{},items=p.inventory?.items??[],actions=[];
 const add=(id,group,text,type,payload={},description='',fields=[])=>actions.push({id,group,label:text,type,payload,description,fields});
 const scene=names[p.currentSceneId]??'Operation Hollow Lantern',recent=(p.publicEvents??[]).slice(-5).map(e=>e.text);
 const rulings=(p.pendingActions??[]).filter(r=>!['reaction','inspiration'].includes(r.kind));
 const dmStatus=gm?{decisionOpen:p.decisionOpen===true,pendingRulings:rulings.map((r,i)=>({id:r.id,text:`${rulings.length>1?`Request ${i+1}: `:''}${r.text??r.kind}`}))}:undefined;
 const summary=publicView?(recent.slice(-1)[0]??'A convoy is missing. The coastal signal network is failing. The team assembles at Vesper Quay.'):gm?`Player decisions: ${dmStatus.decisionOpen?'OPEN':'PAUSED'}\nPending rulings: ${dmStatus.pendingRulings.length}`:`${p.decisionOpen?(p.phase==='combat'?`Round ${p.round} · ${p.activeActorId===p.characterId?'Your turn':'Waiting for the active combatant'}`:'Choose your next action'):'The DM is preparing the scene. Decisions are paused.'}${own?`\n${own.displayName} · ${own.primaryHealth}/${own.primaryHealthMaximum} HP · ${resources.movementFeet??0} ft movement`:''}`;
 if(gm&&!p.decisionOpen){
  if(p.continuity?.prepared===false)add('prepare-world','scene','Prepare alternate paths','gm_prepare_world',{},'Prepare responses for split groups, alternate routes, negotiation, retreat, delays and unexpected intentions. Existing positions and story progress are preserved.');
  if(p.directorMode==='ai_dm')add('director:human','pause','Human DM','gm_director_mode',{mode:'human_gm'},'Take over rulings yourself. Pending player choices are preserved. Resume decisions when ready.');
  else add('director:ai','pause','AI DM','gm_director_mode',{mode:'ai_dm'},'Use the private AI for narrative rulings. Mechanical effects still use supported game actions. Resume decisions when ready.');
 }
 if(gm&&p.rollPending&&p.decisionOpen)add('decision','pause','Pause decisions','gm_decision',{open:false},'Stop autonomous choices while retaining the pending die and saved action. The die can still be resolved manually.');
 if(gm&&!p.rollPending){
  if(p.canPrepareInspiration===true)add('prepare-inspiration','scene','Enable Inspiration rerolls','gm_prepare_inspiration',{version:1},'Enable private choices to keep or reroll each eligible die before its outcome is applied. The engine verifies that this campaign is paused with no unresolved action.');
  if(p.canPrepareEquipment===true)add('prepare-equipment','scene','Prepare owned armor','gm_prepare_equipment',{version:1},'Convert this validated legacy mission loadout to owned armor and shield slots. The engine verifies the paused campaign and records the conversion once.');
  if(p.canPrepareTerrain===true)add('prepare-terrain','scene','Enable cover and fog','gm_prepare_terrain',{version:1},'Prepare the authored cover barriers and fog for this fresh campaign. This changes terrain rules; it is only available before the first decision.');
  for(const presetId of ['fighter','rogue','cleric'])add(`enroll:${presetId}`,'enroll',`Assign prepared ${label(presetId)}`,'gm_enroll_preset',{presetId},'Assign this prepared seat to a Discord user ID or scoped AI identity. Existing possessions and progress remain intact.',[{...field('ownerId','Discord user ID or AI seat'),maxLength:128}]);
  if(p.canAddPopulation===true){
   if(p.canAddPlayers===true&&p.playerCount<p.playerLimit)for(const presetId of ['fighter','rogue','cleric'])add(`player:add:${presetId}`,'enroll',`Add ${label(presetId)} player`,'gm_add_player',{presetId},`${p.playerCount} of ${p.playerLimit} player seats occupied. Creates a new supported character with a permanent identity.`,[{...field('characterId','Permanent character ID'),maxLength:128},{...field('ownerId','Discord user ID'),maxLength:128},{...field('name','Character name'),maxLength:80}]);
   for(const role of ['npc','boss','shopkeeper','enemy'])add(`npc:add:${role}`,'scene',`Add named ${role}`,'gm_add_npc',{role},'Creates a persistent character using the supported role template. Health, possessions and defeat survive scene changes and restarts.',[{...field('characterId','Permanent NPC ID'),maxLength:128},{...field('name','NPC name'),maxLength:80},{...field('sceneId','Authored scene ID'),maxLength:80},field('column','Column (1–25)'),field('row','Row (1–25)')]);
  }
  for(const npc of p.npcs??[])add(`npc:note:${npc.characterId}`,'scene',`Remember · ${npc.name}`,'gm_npc_memory',{npcId:npc.characterId},'Save a private GM note for this NPC. Only the GM can read this note.',[field('text','NPC memory',true)]);
  add('decision','pause',p.decisionOpen?'Pause decisions':'Open decisions','gm_decision',{open:!p.decisionOpen},'Control when the AI party may act.');
  add('checkpoint','checkpoint','Save checkpoint','checkpoint',{},'Commit the current campaign state and recovery copy.');
  for(const [id,name] of Object.entries(names))if(id!==p.currentSceneId)add(`scene:${id}`,'scene',name,'gm_scene',{sceneId:id},'DM scene override. Outstanding combat and rulings must be resolved first.');
  if(p.phase!=='combat')add('combat','scene','Begin encounter','gm_combat',{},'The engine rolls initiative for current participants.');
  for(const [index,pending] of rulings.entries())for(const approved of [true,false]){
   if(approved&&pending.kind==='npc-conversation'){
    add(`ruling:${pending.id}:true`,'rulings',`Reply to conversation${rulings.length>1?` ${index+1}`:''}`,'gm_resolve',{pendingId:pending.id,approved:true},'The reply becomes a private memory shared by this NPC and the speaking character.',[{...field('text','NPC reply',true),maxLength:700}]);
    continue;
   }
   const requestedEffect=/^(mission|travel|rest|feature|equipment):/.exec(pending.kind)?.[1];
   const description=!approved?'Decline and clear this request. Its requested effect will not be applied.':requestedEffect?`Approve the requested ${requestedEffect}. The game validates its requirements, applies its effects and costs, and clears the request if accepted.`:'Record approval and clear this request. Rolls, discoveries, and resource changes still need their appropriate game actions.';
   const name=`${approved?'Approve':'Decline'} request${rulings.length>1?` ${index+1}`:''}`;
   add(`ruling:${pending.id}:${approved}`,'rulings',name,'gm_resolve',{pendingId:pending.id,approved},description);
   add(`ruling:${pending.id}:${approved}:note`,'rulings',`${name} with explanation`,'gm_resolve',{pendingId:pending.id,approved},`${description} Enter your ruling before confirming.`,[field('text','DM ruling',true)]);
   if(!approved&&requestedEffect==='equipment'&&Number.isSafeInteger(pending.durationMinutes)&&pending.durationMinutes>0){
    const elapsed={...field('elapsedMinutes',`Minutes spent (0–${pending.durationMinutes})`),maximum:pending.durationMinutes};
    const timing='Record elapsed world time without completing the armor change. The engine validates the minutes; equipped armor stays unchanged.';
    add(`ruling:${pending.id}:false:elapsed`,'rulings',`${name} with time spent`,'gm_resolve',{pendingId:pending.id,approved:false},timing,[elapsed]);
    add(`ruling:${pending.id}:false:elapsed:note`,'rulings',`${name} with time and explanation`,'gm_resolve',{pendingId:pending.id,approved:false},timing,[elapsed,field('text','DM ruling',true)]);
   }
  }
  for(const actor of p.characters??[]){
   if(p.map?.terrainRulesVersion===1){
    add(`sight:${actor.characterId}`,'rulings',`${actor.displayName}: sight Perception`,'gm_check',{actorId:actor.characterId,ability:'wisdom',skill:'perception',kind:'check'},'Examine a specific square by sight. The engine applies obscurement; this is not a hearing check.',[field('dc','Difficulty'),field('sightColumn','Target column (1–25)'),field('sightRow','Target row (1–25)')]);
    for(const origin of p.characters??[])if(origin.characterId!==actor.characterId&&origin.sceneId===actor.sceneId)add(`cover-save:${actor.characterId}:${origin.characterId}`,'rulings',`${actor.displayName}: Dexterity save from ${origin.displayName}`,'gm_check',{actorId:actor.characterId,ability:'dexterity',kind:'save',originActorId:origin.characterId},'The engine checks cover from this source to the target and applies the strongest supported cover bonus.',[field('dc','Difficulty')]);
   }
   for(const skill of Object.keys(actor.skills??{}))if(skillAbilities[skill])add(`skill:${actor.characterId}:${skill}`,'rulings',`${actor.displayName}: ${label(skill)}`,'gm_check',{actorId:actor.characterId,ability:skillAbilities[skill],skill,kind:'check'},'Set the difficulty; the engine uses this character’s trained skill modifier.',[field('dc','Difficulty')]);
   for(const ability of ['strength','dexterity','constitution','intelligence','wisdom','charisma'])for(const kind of ['check','save'])add(`check:${actor.characterId}:${ability}:${kind}`,'rulings',`${actor.displayName}: ${label(ability)} ${kind}`,'gm_check',{actorId:actor.characterId,ability,kind},'Set the difficulty; the engine calculates the roll and supported modifiers.',[field('dc','Difficulty')]);
   for(const condition of ['prone','grappled','restrained','poisoned','blinded','incapacitated','stunned','paralyzed'])for(const active of [true,false])add(`condition:${actor.characterId}:${condition}:${active}`,'reveal',`${active?'Apply':'Remove'} ${condition}: ${actor.displayName}`,'gm_condition',{actorId:actor.characterId,condition,active},'Apply an explicit DM condition ruling to this character.');
  }
 }
 if(own&&p.rollPending){
  for(const pending of p.pendingActions??[]){
   if(pending.kind!=='inspiration'||pending.actorId!==own.characterId||!Number.isSafeInteger(pending.sides)||pending.sides<2||!Number.isSafeInteger(pending.value)||pending.value<1||pending.value>pending.sides)continue;
   for(const choice of ['keep','reroll'])add(`inspiration:${pending.id}:${pending.dieId}:${choice}`,'reaction',choice==='keep'?`Keep ${pending.value} on d${pending.sides}`:`Reroll d${pending.sides} · Spend Inspiration`,'inspiration_choice',{pendingId:pending.id,dieId:pending.dieId,choice},choice==='keep'?'Keep this die and continue resolving the action. No Inspiration is spent.':'Spend your Heroic Inspiration to reroll this die. You must use the replacement, even if it is lower. The action continues after this choice.');
  }
 }
 if(own&&p.decisionOpen&&!p.rollPending){
  const pendingReactions=(p.pendingActions??[]).filter(r=>r.kind==='reaction');
  for(const reaction of pendingReactions.filter(r=>r.reactors?.includes(own.characterId)))for(const take of [true,false])add(`reaction:${reaction.id}:${take}`,'reaction',take?'Take opportunity attack':'Decline reaction','reaction',{pendingId:reaction.id,take},'Resolve this prompted reaction before play continues.');
  if(!pendingReactions.length&&(p.phase!=='combat'||p.activeActorId===own.characterId)){
   if(own.primaryHealth<=0){if(p.phase==='combat')add('end_turn','end-turn','End Turn','end_turn',{},'Your start-of-turn death save has already resolved. Advance to the next combatant.');}
   else{
    const allies=(p.characters??[]).filter(c=>c.factionId===own.factionId&&c.position),hostiles=(p.characters??[]).filter(c=>c.factionId!==own.factionId&&c.factionId!=='neutral'&&!c.defeated&&c.position);
    const movementBlocked=own.conditions?.some(c=>['grappled','restrained','incapacitated','stunned','paralyzed','unconscious'].includes(c));
    for(const move of p.availableMovement??[]){
     // These are engine-projected destinations/costs; presentation only removes
     // offers the current sheet cannot afford. Unity still validates the command.
     const cost=move.costFeet*(own.conditions?.includes('prone')?2:1);
     if(movementBlocked||!Number.isFinite(cost)||cost<=0||(p.phase==='combat'&&!(resources.movementFeet>=cost||resources.criticalMoveFeet>=cost)))continue;
     add(`move:${move.x}:${move.y}`,'move',`Move to ${move.x+1}, ${move.y+1}`,'move',{x:move.x,y:move.y},`${cost} feet.${p.phase==='combat'?'':' One exploration minute.'} The engine checks terrain, occupancy and reactions.`);
    }
    add('inspect','inspect','Search your surroundings','inspect',{targetId:'surroundings'},'Examine the area you can currently see.');
    for(const type of ['interact','talk','describe'])add(type,type,type==='describe'?'Describe Action':label(type),type,{},type==='describe'?'Propose another approach, a detour, or a split from the group. Your own location, knowledge and earlier rulings guide the response; movement and uncertain effects still require their supported actions.':'Describe your intention. The DM reviews uncertain actions before any unsupported effect is applied.',[field('text','Your intention',true)]);
    for(const ability of [...(p.phase==='combat'&&resources.action===false?[]:['dash','disengage','dodge']),...(own.conditions?.includes('prone')?['stand']:[])])add(`standard:${ability}`,'more',label(ability),'ability',{abilityId:ability},standardActionDescription(ability));
    for(const item of items){
     if(item.usable)for(const target of allies.filter(c=>distance(own,c)<=1))add(`use:${item.itemId}:${target.characterId}`,'use',`${label(item.displayName)} → ${target.displayName}`,'use_item',{itemId:item.itemId,targetId:target.characterId},`${item.description} Use one on yourself or an adjacent companion. You have ${item.quantity}.`);
     const weapon=item.slot===undefined||item.slot==='weapon';
     const equipmentCost=minutes=>minutes>0?`${minutes} world minutes after DM approval; an interrupted change does not complete.`:p.phase==='combat'?'Costs your action.':'The engine validates the owned loadout.';
     if((item.canEquip===true||(item.slot===undefined&&item.equippable))&&!item.equipped)add(`equip:${item.itemId}`,'equip',`Equip ${label(item.displayName)}`,'equip',{itemId:item.itemId},equipmentCost(item.equipMinutes));
     if(item.canUnequip===true&&item.equipped)add(`unequip:${item.itemId}`,'equip',`Remove ${label(item.displayName)}`,'unequip',{itemId:item.itemId},equipmentCost(item.unequipMinutes));
     if(p.targeting?.availableLocationAttack===true&&p.targeting.coordinateBase===0&&p.phase==='combat'&&resources.action!==false&&item.equipped&&weapon)add(`attack-location:${item.itemId}`,'attack',`${label(item.displayName)} → chosen square`,'attack_location',{weaponId:item.itemId},'Costs your action and any required ammunition, even if the square is empty. Enter a map square to attack an unseen target; the engine applies range, cover and unseen attack rules. An unobserved outcome stays unconfirmed.',[field('column','Column (1–25)'),field('row','Row (1–25)')]);
     if(item.canTransfer!==false)add(`drop:${item.itemId}`,'drop',`Drop ${label(item.displayName)}`,'drop',{itemId:item.itemId},`Place an owned quantity on your current square. You have ${item.quantity}.`,[field('quantity','Quantity')]);
     if(item.canTransfer!==false)for(const target of allies.filter(c=>c.characterId!==own.characterId&&distance(own,c)<=1))add(`transfer:${item.itemId}:${target.characterId}`,'transfer',`${label(item.displayName)} → ${target.displayName}`,'transfer',{itemId:item.itemId,targetId:target.characterId},`Give an adjacent companion an owned item. You have ${item.quantity}.`,[field('quantity','Quantity')]);
     if(p.phase==='combat'&&resources.action!==false&&item.equipped&&weapon)for(const target of hostiles)add(`attack:${target.characterId}:${item.itemId}`,'attack',`${label(item.displayName)} → ${target.displayName}`,'attack',{targetId:target.characterId,weaponId:item.itemId},'Costs your action. The engine validates range and rolls the attack and damage.');
    }
    for(const actionId of p.mission?.availableActions??[])add(`mission:${actionId}`,'interact',label(actionId),'mission_action',{actionId},`${actionId==='rescue-technician'?'Ten world minutes after approval. ':actionId==='repair-signal'?'Twenty world minutes after approval. ':''}Approach the mission object. The DM approves; the engine rechecks prerequisites and commits the outcome once.`);
    if(p.mission?.canScout)add('scout-route','inspect','Scout the convoy route','scout_route',{},'Spend 10 world minutes. Roll Perception against 12; a discovered route stays private until shared.');
    for(const route of p.travelOptions??[])add(`travel:${route.destinationId}`,'travel',`Travel to ${names[route.destinationId]??label(route.destinationId)}`,'travel',{destinationId:route.destinationId},`${route.minutes} world minutes after DM approval. The party must gather within 30 feet of you.`);
    if(p.canChooseTravelGroup)for(const route of p.travelOptions??[])for(const group of combinations(allies.filter(c=>distance(own,c)<=6).slice(0,8),3).filter(g=>g.some(c=>c.characterId===own.characterId)))add(`travel-group:${route.destinationId}:${group.map(c=>c.characterId).join(',')}`,'travel',`DM subgroup: ${group.map(c=>c.displayName).join(', ')} → ${names[route.destinationId]??label(route.destinationId)}`,'travel',{destinationId:route.destinationId,actorIds:group.map(c=>c.characterId)},`${route.minutes} world minutes after approval. Only these named nearby travellers move.`);
    if(own.abilities?.includes('preserve-life')&&p.preserveLife&&Number.isSafeInteger(p.preserveLife.pool)&&p.preserveLife.pool>0&&Array.isArray(p.preserveLife.targets)&&p.preserveLife.targets.length&&(p.phase!=='combat'||resources.action!==false)&&resources.channelDivinity>0){
     const choices=p.preserveLife.targets.map(t=>({id:t.characterId,label:t.displayName}));
     add('preserve-life:divide','ability','Preserve Life · Divide healing','ability',{abilityId:'preserve-life'},`Magic action. Spend one Channel Divinity to divide up to ${p.preserveLife.pool} HP among selected recipients. The engine checks eligibility and caps each recipient at half maximum HP. Unused healing is not redirected.`,[{id:'allocations',kind:'healing-allocation',label:'Divide healing',maxLength:4000,pool:p.preserveLife.pool,choices}]);
    }
    for(const ability of own.abilities??[]){
     if(ability==='preserve-life'&&p.preserveLife)continue;
     if(p.phase==='combat'&&resources.action===false&&['sacred-flame','cure-wounds','bless','guiding-bolt','aid','spare-the-dying','divine-spark-heal','divine-spark-radiant','preserve-life'].includes(ability))continue;
     if(p.phase!=='combat'&&['sacred-flame','guiding-bolt'].includes(ability))continue;
     if(['champion-critical','sneak-attack','savage-attacker','defense','disciple-of-life','divine-order-protector','human-resourceful','human-skillful','skilled','trance','expertise','keen-senses'].includes(ability))continue;
     const targets=['sacred-flame','guiding-bolt','divine-spark-radiant'].includes(ability)?hostiles:['cure-wounds','healing-word','bless','aid','lesser-restoration','divine-spark-heal','preserve-life','spare-the-dying','initiate-healing-word'].includes(ability)?allies:[own];
     const spells=['cure-wounds','healing-word','bless','guiding-bolt'].includes(ability),dm=own.sheet?.features?.find(f=>f.id===ability)?.resolution==='dm-mediated';
     for(const target of targets)for(const slotLevel of ['aid','lesser-restoration'].includes(ability)?[2]:spells?[1,...(resources.spellSlots2>0?[2]:[])]:[undefined])add(`ability:${ability}:${target.characterId}${slotLevel===2?':level2':''}`,'ability',`${dm?'Ask DM: ':''}${label(ability)}${slotLevel?` · Level ${slotLevel}`:''}${target!==own?` → ${target.displayName}`:''}`,'ability',{abilityId:ability,targetId:target.characterId,...(slotLevel?{slotLevel}:{})},abilityDescription(ability,{slotLevel,resources,dm}));
     if(ability==='bless'||ability==='aid')for(const slotLevel of ability==='aid'?[2]:[1,...(resources.spellSlots2>0?[2]:[])])for(const group of combinations(allies.filter(c=>distance(own,c)<=6).slice(0,8),ability==='aid'?3:slotLevel+2).filter(g=>g.length>1))add(`${ability}:${slotLevel}:${group.map(t=>t.characterId).join(',')}`,'ability',`${label(ability)} ${group.map(t=>t.displayName).join(', ')} · Level ${slotLevel}`,'ability',{abilityId:ability,targetIds:group.map(t=>t.characterId),slotLevel},abilityDescription(ability,{slotLevel,resources,dm}));
    }
    for(const object of p.objects??[])for(const item of object.items??[])if(item.quantity>0)add(`loot:${object.id}:${item.itemId}`,'interact',`Take ${label(item.itemId)} · ${object.label}`,'loot',{sourceId:object.id,itemId:item.itemId},`${item.quantity} available. You must be within reach.`,[field('quantity','Quantity')]);
    for(const discoveryId of p.discoveries??[])for(const companion of allies.filter(c=>c.characterId!==own.characterId&&distance(own,c)<=6))add(`share:${discoveryId}:${companion.characterId}`,'talk',`Tell ${companion.displayName}: ${label(discoveryId)}`,'share',{targetId:companion.characterId,discoveryId},'Explicitly share this discovery with one nearby companion.');
    if(p.phase==='combat')add('end_turn','end-turn','End Turn','end_turn',{},'Finish your turn. The next combatant becomes active.');
    else for(const kind of ['short','long'])add(`rest:${kind}`,'more',`${label(kind)} rest`,'rest',{kind},`${kind==='long'?`${own.sheet?.ancestry==='high-elf'?'Four hours of Trance':'Eight hours'} and one ration; once per 24 hours`:'One hour; spend one hit die if injured'}. The DM must confirm that the rest was uninterrupted.`);
    if(p.shop){for(const item of p.shop.filter(i=>i.quantity>0))add(`buy:${item.itemId}`,'buy',`Buy ${label(item.itemId)}`,'buy',{itemId:item.itemId},`${item.price} gold each · ${item.quantity} available. Your wallet: ${p.inventory.currency} gold.`,[field('quantity','Quantity')]);for(const item of items.filter(i=>i.canTransfer!==false))add(`sell:${item.itemId}`,'sell',`Sell ${item.displayName}`,'sell',{itemId:item.itemId},`${Math.floor(item.value/2)} gold each · ${item.quantity} owned.`,[field('quantity','Quantity')]);}
    for(const npc of (p.npcs??[]).filter(n=>!n.defeated)){
     const character=p.characters?.find(c=>c.characterId===npc.characterId);if(character?.position&&distance(own,character)<=6)add(`npc:talk:${npc.characterId}`,'talk',`Talk to ${npc.name}`,'npc_talk',{npcId:npc.characterId},'The DM answers in character. An accepted exchange becomes this character’s private NPC memory.',[{...field('text','What do you say?',true),maxLength:700}]);
    }
    for(const npc of (p.npcs??[]).filter(n=>n.role==='shopkeeper'&&!n.defeated&&Array.isArray(n.stock))){
     for(const item of npc.stock.filter(i=>i.quantity>0))add(`merchant:buy:${npc.characterId}:${item.itemId}`,'buy',`${npc.name} · Buy ${label(item.itemId)}`,'buy',{merchantId:npc.characterId,itemId:item.itemId},`${item.price} gold each · ${item.quantity} in this shopkeeper's stock.`,[field('quantity','Quantity')]);
     for(const item of items.filter(i=>i.canTransfer!==false))add(`merchant:sell:${npc.characterId}:${item.itemId}`,'sell',`${npc.name} · Sell ${item.displayName}`,'sell',{merchantId:npc.characterId,itemId:item.itemId},`${Math.floor(item.value/2)} gold each. The shopkeeper must have enough gold.`,[field('quantity','Quantity')]);
    }
   }
  }
 }
 const modeSummary=`Mode: ${p.directorMode==='ai_dm'?'AI DM':'Human DM'}\n${summary}`;
 const history=publicView?[]:(p.privateHistory??[]).filter(e=>gm||e.characterId===p.characterId).map(e=>({sequence:e.sequence,revision:e.revision,characterId:e.characterId,kind:e.kind,text:presentReceipt({revision:e.revision,result:e.result})}));
 const map=!publicView&&p.map?{...p.map,viewerCharacterId:gm?undefined:own?.characterId,tokens:(p.map.tokens??[]).map(t=>({...t,hostile:t.team==='hostile'})),objects:p.objects??[],nodes:(p.map.nodes??[]).map((n,i,all)=>({...n,name:n.label,discovered:true,x:n.x!==undefined?n.x/25:(i+1)/(all.length+1),y:n.y!==undefined?n.y/25:.5})),edges:(p.map.edges??[]).map(e=>({...e,discovered:true})),currentId:p.map.nodes?.find(n=>n.current)?.id}:undefined;
 return {campaignId:p.campaignId,sceneId:p.currentSceneId,revision:p.revision,audience:p.audience==='private'?'player':p.audience,title:scene,publicTitle:`Operation Hollow Lantern · ${scene}`,summary:!publicView&&p.rollPending?`${modeSummary}\nA die choice is waiting. Other game actions resume after it is resolved.`:modeSummary,publicSummary:modeSummary,mode:p.phase==='combat'?'combat':p.shop?'shop':'exploration',map,actions,dmStatus,mission:!publicView?p.mission:undefined,
  controllableActors:gm?(p.characters??[]).map(c=>({id:c.characterId,name:c.displayName,sceneId:c.sceneId,active:c.characterId===p.activeActorId})):[],
  actor:own?{equipment:own.equipment,id:own.characterId,name:own.displayName,hp:own.primaryHealth,maxHp:own.primaryHealthMaximum,conditions:own.conditions,deathSaves:own.deathSaves,sheet:own.sheet?{...own.sheet,features:(own.sheet.features??[]).map(f=>({...f,description:featureDescription(f.id,resources,{inspirationRulesVersion:p.inspirationRulesVersion,preserveLife:p.preserveLife})}))}:undefined,skills:own.skills,saves:own.saveProficiencies,
   details:`Level ${own.level} ${label(own.classId)}${own.sheet?` · ${label(own.sheet.subclass)} · ${label(own.sheet.ancestry)} · ${label(own.sheet.background)}`:''} · AC ${own.armorClass}\n${Object.entries(own.scores??{}).map(([k,v])=>`${k.slice(0,3).toUpperCase()} ${v}`).join(' · ')}\n${p.inventory?.currency??0} gold · ${resources.hitDice??0} Hit Dice · Spell slots: level 1 × ${resources.spellSlots1??0}, level 2 × ${resources.spellSlots2??0} · Channel Divinity ${resources.channelDivinity??0}\nSaves: ${(own.saveProficiencies??[]).map(label).join(', ')}\n${own.sheet?.armorCalculation??''}\n${(own.abilities??[]).map(label).join(' · ')}`,
   inventory:items.map(i=>({id:i.itemId,name:label(i.displayName),quantity:i.quantity,value:`${i.value} gold`,description:i.description,equipped:i.equipped,slot:i.slot}))}:undefined,
  history, journal:publicView?recent:[...recent,...(p.npcs??[]).flatMap(n=>(n.memories??[]).map(m=>`${n.name}: ${m.text}`)),...(p.discoveries??[]).map(id=>`Discovered: ${label(id)}`),...(p.pendingActions??[]).map(r=>`Awaiting ruling: ${r.text}`),...history.map(e=>e.text)],stock:!publicView?(p.shop??[]).map(i=>({id:i.itemId,name:label(i.itemId),quantity:i.quantity,price:i.price})):[],publicParticipants:publicView?(p.characters??[]).map(c=>({characterId:c.characterId,name:c.displayName,publiclyVisible:true,hostile:c.factionId==='hostile'})):[]};
}

function combinations(items,maximum){const groups=[];function visit(index,group){if(group.length)groups.push(group);if(group.length===maximum)return;for(let i=index;i<items.length;i++)visit(i+1,[...group,items[i]]);}visit(0,[]);return groups;}
export function presentReceipt(receipt){if(receipt?.result?.status==="pending-roll")return `Action waiting for a private die choice. Its outcome has not been applied.${Number.isSafeInteger(receipt?.revision)?`\nRevision ${receipt.revision}${receipt.replayed?" · Original pending receipt recovered":""}`:""}`;const raw=receipt?.result??{},result=raw.status==="resolved"&&raw.outcome&&typeof raw.outcome==="object"?raw.outcome:raw,lines=[];if(typeof result.message==='string')lines.push(result.message.slice(0,1000));for(const [key,name] of [['roll','Roll'],['total','Total'],['dc','Difficulty'],['damage','Damage'],['healing','Healing'],['primaryHealth','Your HP'],['deathSuccesses','Death save successes'],['deathFailures','Death save failures']])if(Number.isFinite(result[key]))lines.push(`${name}: ${result[key]}`);for(const [key,name] of [['passed','Passed'],['hit','Hit'],['critical','Critical'],['stable','Stable'],['dead','Dead']])if(typeof result[key]==='boolean')lines.push(`${name}: ${result[key]?'yes':'no'}`);for(const row of Array.isArray(result.allocations)?result.allocations.slice(0,15):[]){if(typeof row?.displayName==='string'&&row.displayName.trim()&&Number.isSafeInteger(row.amount)&&row.amount>0&&Number.isSafeInteger(row.healing)&&row.healing>=0&&row.healing<=row.amount)lines.push(row.displayName.replace(/[\r\n]/g,' ').slice(0,100)+': '+row.healing+' HP restored ('+row.amount+' allocated)');}if(Number.isSafeInteger(receipt?.revision))lines.push(`Revision ${receipt.revision}${receipt.replayed?' · Original result recovered':''}`);return lines.join('\n').replace(/@/g,'@\u200b');}

/** Cache only fully validated intentions. A missing stale cache entry permits receipt READ, never mutation. */
export function createGameService({client,authorize}){
 if(!client?.project||!client?.command||typeof authorize!=='function')throw new Error('Engine client and current authorization required.');
 async function raw(scope){if(scope.campaignId!==client.campaignId||!await authorize(scope))throw new EngineError('ACCESS_DENIED','You no longer have access to this campaign.',403);return client.project({ownerId:scope.userId,actorId:scope.actorId,audience:audience(scope.audience),mapLevel:scope.mapLevel??'tactical'});}
 const intents=new Map(),fingerprint=scope=>JSON.stringify([scope.campaignId,scope.userId,scope.actorId??'',scope.audience,scope.expectedRevision,scope.action,stable(scope.payload??{})]);
 return Object.freeze({async project(scope){return presentProjection(await raw(scope));},async receipt(scope){
  if(scope.campaignId!==client.campaignId||!await authorize(scope))throw new EngineError('ACCESS_DENIED','You no longer have access to this campaign.',403);
  if(typeof scope.commandId!=='string'||!/^[0-9a-f-]{36}$/.test(scope.commandId)||typeof client.receipt!=='function')throw new EngineError('INVALID_INPUT','A saved command identity is required.',400);
  const receipt=await client.receipt({ownerId:scope.userId,actorId:scope.actorId??'',commandId:scope.commandId});
  if(!await authorize(scope))throw new EngineError('ACCESS_DENIED','Your access changed before the receipt was delivered.',403);
  return receipt;
 },async resolve(scope){
  if(scope.campaignId!==client.campaignId||!await authorize(scope))throw new EngineError('ACCESS_DENIED','You no longer have access to this campaign.',403);
  if(typeof scope.commandId!=='string'||!/^[0-9a-f-]{36}$/.test(scope.commandId)||!Number.isSafeInteger(scope.expectedRevision)||scope.expectedRevision<0||scope.expectedRevision>=Number.MAX_SAFE_INTEGER||scope.targetOwnerId!==undefined||typeof client.resolveUncertain!=='function')throw new EngineError('INVALID_INPUT','A saved command identity and original revision are required.',400);
  const resolution=await client.resolveUncertain({ownerId:scope.userId,actorId:scope.actorId??'',commandId:scope.commandId,expectedRevision:scope.expectedRevision});
  if(!await authorize(scope))throw new EngineError('ACCESS_DENIED','Your access changed before recovery was delivered.',403);
  return resolution;
 },async command(scope,{onDispatch=()=>{}}={}){
  if(scope.campaignId!==client.campaignId||!await authorize(scope))throw new EngineError('ACCESS_DENIED','You no longer have access to this campaign.',403);
  if(typeof scope.commandId!=='string'||!scope.commandId)throw new EngineError('INVALID_INPUT','A command identity is required.',400);
  const signature=fingerprint(scope),cached=intents.get(scope.commandId);if(cached){if(cached.signature!==signature)throw new EngineError('COMMAND_COLLISION','This action identity belongs to a different intention.',409);onDispatch();return client.command(structuredClone(cached.request));}
  const p=await raw(scope);if(p.revision!==scope.expectedRevision){if(typeof client.receipt==='function'){try{return await client.receipt({ownerId:scope.userId,actorId:scope.actorId??'',commandId:scope.commandId});}catch(error){if(error.code!=='RECEIPT_NOT_FOUND')throw error;}}throw new EngineError('STALE_REVISION','The scene changed. Refresh before acting.',409);}
  const action=presentProjection(p).actions.find(a=>a.id===scope.action);if(!action)throw new EngineError('UNAVAILABLE_ACTION','This action is no longer available.',409);
  const input=scope.payload??{},fields=new Set(action.fields.map(f=>f.id));for(const key of Object.keys(input))if(!fields.has(key)&&(!Object.hasOwn(action.payload,key)||JSON.stringify(stable(input[key]))!==JSON.stringify(stable(action.payload[key]))))throw new EngineError('INVALID_INPUT','This action contains unsupported details.',400);
  const payload={...action.payload};for(const f of action.fields){const value=input[f.id];if(typeof value!=='string'||!value.trim()||value.length>f.maxLength)throw new EngineError('INVALID_INPUT',`Check ${f.label}.`,400);if(f.kind==='healing-allocation'){try{payload[f.id]=parseHealingAllocation(value,f);}catch{throw new EngineError('INVALID_INPUT','Choose distinct recipients and whole healing amounts within the available pool.',400);}}else if(['column','row','sightColumn','sightRow'].includes(f.id)){const n=Number(value.trim()),x=/column/i.test(f.id),size=x?p.map?.width:p.map?.height;if(!/^\d+$/.test(value.trim())||!Number.isInteger(n)||!Number.isInteger(size)||n<1||n>size)throw new EngineError('INVALID_INPUT',`Enter a map coordinate for ${f.label}.`,400);if(f.id.startsWith('sight')){payload.sightTarget??={};payload.sightTarget[x?'x':'y']=n-1;}else payload[x?'x':'y']=n-1;}else if(['quantity','dc','elapsedMinutes'].includes(f.id)){if(!/^\d+$/.test(value.trim()))throw new EngineError('INVALID_INPUT',`Enter a whole number for ${f.label}.`,400);const amount=Number(value.trim());if(f.id==='elapsedMinutes'&&(!Number.isSafeInteger(amount)||amount>f.maximum))throw new EngineError('INVALID_INPUT',`Check ${f.label}.`,400);payload[f.id]=amount;}else payload[f.id]=value.trim();}
  if(action.type==='gm_director_mode'&&payload.mode==='ai_dm')payload.aiDirectorId=/^ai-director:[A-Za-z0-9_.:-]{1,116}$/.test(p.aiDirectorId??'')?p.aiDirectorId:'ai-director:'+createHash('sha256').update(p.campaignId).digest('hex');
  const request={ownerId:scope.userId,actorId:scope.actorId,commandId:scope.commandId,expectedRevision:scope.expectedRevision,type:action.type,payload};const raced=intents.get(scope.commandId);if(raced&&raced.signature!==signature)throw new EngineError('COMMAND_COLLISION','This action identity belongs to a different intention.',409);if(intents.size>=10000)intents.delete(intents.keys().next().value);intents.set(scope.commandId,{signature,request:structuredClone(request)});onDispatch();return client.command(request);
 }});
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}




