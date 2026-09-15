import {randomBytes} from 'node:crypto';
import {renderArchitecturePng} from './architecture-art/png.mjs';
import {discordScene,raphaelRecall} from './table-model.mjs';
import {renderSceneCard,renderTactical,renderEncounter} from './table-cards.mjs';
const snowflake=v=>typeof v==='string'&&/^\d{17,20}$/.test(v);
const text=content=>({type:10,content});
const row=components=>({type:1,components});
const button=(label,id)=>({type:2,style:2,label,custom_id:id});
const rawCard=components=>({flags:32768,allowedMentions:{parse:[]},components:[{type:17,accent_color:0xc8a36a,components}]});
const safe=s=>String(s).replace(/([\\*_~`|<>@])/g,'\\$1');
const unavailable='This control is no longer available to you. Reopen your campaign panel.';

// Compose with the existing gateway's dispatcher; never opens a second bot login.
export function createDiscordTable({client,store,config,render={scene:renderSceneCard,tactical:renderTactical,combat:renderEncounter},now=Date.now,onError=()=>{},mountListener=false}){
 if(![config?.guildId,config?.channelId,config?.applicationId,config?.gmUserId].every(snowflake))throw Error('Explicit Discord campaign binding is required.');
 if(!Array.isArray(config.members)||config.members.some(m=>!snowflake(m.ownerId)||typeof m.actorId!=='string'))throw Error('Explicit character ownership is required.');
 if(new Set(config.members.map(m=>m.ownerId)).size!==config.members.length||new Set(config.members.map(m=>m.actorId)).size!==config.members.length)throw Error('Each player and character must have one binding.');
 const binding=structuredClone(config),owners=new Map(binding.members.map(m=>[m.ownerId,m.actorId]));
 const privateThreads=new Map();
 const threadBindings=[...(binding.dmThreadId!==undefined?[{threadId:binding.dmThreadId,ownerId:binding.gmUserId}]:[]),...binding.members.filter(m=>m.threadId!==undefined)];
 if(threadBindings.length&&!snowflake(binding.parentChannelId))throw Error('Private threads require an explicit parent channel.');
 for(const {threadId,ownerId} of threadBindings){
  if(!snowflake(threadId)||threadId===binding.channelId||threadId===binding.parentChannelId||privateThreads.has(threadId))throw Error('Each private thread must have one unique binding.');
  if(privateThreads.size&&[...privateThreads.values()].includes(ownerId))throw Error('Each account must have one private thread.');
  privateThreads.set(threadId,ownerId);
 }
 const controls=new Map(),revisions=new WeakMap();let closed=false,refreshQueue=Promise.resolve();
 const stamp=(body,revision=store.view().state.revision)=>{revisions.set(body,revision);return body;};
 const report=code=>{try{onError({code});}catch{}};
 const card=components=>stamp(rawCard(components));
 async function identity(userId){
  if(closed||client.user?.id!==binding.applicationId||!snowflake(userId))throw Error('Access denied.');
  const guild=await client.guilds.fetch(binding.guildId);
  const member=await guild.members.fetch({user:userId,force:true,cache:false});
  if(closed||member?.id!==userId||member.user?.bot)throw Error('Access denied.');
  return userId===binding.gmUserId?{role:'gm'}:owners.has(userId)?{role:'player',actorId:owners.get(userId)}:{role:'shared'};
 }
 async function authorize(userId,channelId){
  const scope=await identity(userId);
  if(channelId===binding.channelId)return scope;
  if(privateThreads.get(channelId)!==userId)throw Error('Wrong private thread.');
  const channel=await client.channels.fetch(channelId,{force:true,cache:false});
  if(channel?.id!==channelId||channel.guildId!==binding.guildId||channel.parentId!==binding.parentChannelId||channel.type!==12||channel.ownerId!==binding.applicationId||channel.invitable!==false||channel.archived!==false)throw Error('Private thread unavailable.');
  const member=await channel.members.fetch({member:userId,force:true,cache:false});
  if(closed||member?.id!==userId)throw Error('Private membership unavailable.');
  // Bind opaque controls to this thread as well as its account and character.
  return {...scope,channelId};
 }
 const token=(userId,scope,data)=>{
  for(const [key,value]of controls)if(value.expires<now())controls.delete(key);
  if(controls.size>=2000)controls.delete(controls.keys().next().value);
  const id='coast:token:'+randomBytes(18).toString('hex');controls.set(id,{userId,scope:JSON.stringify(scope),expires:now()+15*60_000,...data});return id;
 };
 function privatePanel(scope,userId,page=0){
  const view=store.view(scope);
  if(scope.role==='shared')return card([text('## Your character\nThe DM has not assigned a character to your Discord account yet.')]);
  if(scope.role==='gm'){
   const pending=view.requests.filter(r=>r.status==='pending'),index=Math.max(0,Math.min(page,pending.length-1)),request=pending[index],nav=[];
   if(index>0)nav.push(button('Previous request',token(userId,scope,{kind:'private',page:index-1})));
   if(index+1<pending.length)nav.push(button('Next request',token(userId,scope,{kind:'private',page:index+1})));
   return card([text(`## The DM desk\n**${pending.length} pending requests** · ${view.preparation.catalog.rooms.length} prepared locations`),...(request?[text(`### Request ${index+1} of ${pending.length} · ${safe(request.actorId)}\n${safe(request.text)}`)]:[]),...(nav.length?[row(nav)]:[]),...(binding.dmThreadId&&scope.channelId===binding.dmThreadId?[row([button('Reveal a location',token(userId,scope,{kind:'dmLocations',page:0})),button('Resolve room discovery',token(userId,scope,{kind:'dmDiscoveries',page:0}))])]:[])]);
  }
  const items=view.personal.items,start=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(items.length/12)-1)))*12;
  const components=[text(`## ${safe(view.party.find(p=>p.id===scope.actorId)?.name??'Your character')}\n**${view.personal.coins} coins** · Private belongings`),text(items.slice(start,start+12).map(i=>`• **${safe(i.name)}** — ${safe(i.source??'')}`).join('\n')||'Your pack is empty.')];
  const nav=[];if(start>0)nav.push(button('Previous items',token(userId,scope,{kind:'private',page:start/12-1})));if(start+12<items.length)nav.push(button('More items',token(userId,scope,{kind:'private',page:start/12+1})));if(nav.length)components.push(row(nav));
  if(view.shop){const stock=view.shop.stock.filter(i=>i.quantity>0).slice(0,25);components.push(text(`### ${safe(view.shop.name)}\nPurchases stay in your private inventory.`));if(stock.length)components.push(row([{type:3,custom_id:token(userId,scope,{kind:'buy',revision:view.state.revision,items:stock.map(i=>i.id)}),placeholder:'Choose an item to buy',min_values:1,max_values:1,options:stock.map(i=>({label:`${i.name} · ${i.price} coins`.slice(0,100),value:i.id,description:`${i.quantity} available`.slice(0,100)}))}]));}
  components.push(row([button('Describe an action',token(userId,scope,{kind:'request'})),button('Refresh my pack','coast:private'),button('Ask Raphael','coast:recall')]));
  return card(components);
 }
 function dmLocations(scope,userId,page=0){
  if(scope.role!=='gm'||!binding.dmThreadId||scope.channelId!==binding.dmThreadId)throw Error('Private DM desk required.');
  const view=store.view(scope),rooms=view.preparation.catalog.rooms.filter(r=>!view.state.roomIds[r.id]);
  const index=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(rooms.length/25)-1))),shown=rooms.slice(index*25,index*25+25);
  const components=[text('## Reveal a location\nSelecting a location adds it to the players’ discovered map. It does not move the party or reveal hidden objects.')];
  if(shown.length)components.push(row([{type:3,custom_id:token(userId,scope,{kind:'dmReveal',revision:view.state.revision,rooms:shown.map(r=>r.id)}),placeholder:'Reveal this location to the players',min_values:1,max_values:1,options:shown.map(r=>({label:r.name.slice(0,100),value:r.id}))}]));
  else components.push(text('All prepared locations have been revealed.'));
  const nav=[];if(index>0)nav.push(button('Previous locations',token(userId,scope,{kind:'dmLocations',page:index-1})));if((index+1)*25<rooms.length)nav.push(button('More locations',token(userId,scope,{kind:'dmLocations',page:index+1})));nav.push(button('DM desk','coast:private'));components.push(row(nav));return stamp(rawCard(components),view.state.revision);
 }
 function dmDiscoveries(scope,userId,page=0){
  if(scope.role!=='gm'||!binding.dmThreadId||scope.channelId!==binding.dmThreadId)throw Error('Private DM desk required.');
  const view=store.view(scope),room=view.preparation.catalog.rooms.find(r=>r.id===view.state.currentRoomId&&view.state.roomIds[r.id]);
  const pois=(room?.pois??[]).filter(p=>!view.state.poiIds[p.id]),index=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(pois.length/25)-1))),shown=pois.slice(index*25,index*25+25);
  const components=[text(`## Resolve discovery · ${safe(room?.name??'No current room')}\nDM only. Choose the object being examined, then record the interaction and resolved ability-check total. Hidden details stay private until the check succeeds.`)];
  if(shown.length)components.push(row([{type:3,custom_id:token(userId,scope,{kind:'dmCheck',revision:view.state.revision,roomId:room.id,pois:shown.map(p=>p.id)}),placeholder:'Choose the object being examined',min_values:1,max_values:1,options:shown.map(p=>({label:p.name.slice(0,100),value:p.id,description:`DC ${p.dc??0} · ${p.hidden?'Hidden':'Visible'} object`.slice(0,100)}))}]));
  else components.push(text('No unresolved discoveries in the current room.'));
  const nav=[];if(index>0)nav.push(button('Previous objects',token(userId,scope,{kind:'dmDiscoveries',page:index-1})));if((index+1)*25<pois.length)nav.push(button('More objects',token(userId,scope,{kind:'dmDiscoveries',page:index+1})));nav.push(button('DM desk','coast:private'));components.push(row(nav));return stamp(rawCard(components),view.state.revision);
 }
 async function scene(kind,roomId){
  const view=store.view(),id=roomId??view.state.currentRoomId;
  if(!view.catalog.rooms.some(r=>r.id===id))throw Error('Location not discovered.');
  const body=discordScene(view,id,{assetUrl:'attachment://scene.png'});delete body.allowed_mentions;body.allowedMentions={parse:[]};
  body.files=[{attachment:await render[kind==='tactical'?'tactical':'scene'](view,id),name:'scene.png'}];
  if(view.encounter?.roomId===id){body.files.push({attachment:await render.combat(view),name:'combat.png'});body.components[0].components.splice(-1,0,{type:12,items:[{media:{url:'attachment://combat.png'},description:`Round ${view.encounter.round}: visible combatants`} ]});}
  if(store.view().state.revision!==view.state.revision)throw Error('The scene changed while its map was being drawn. Open it again.');
  return stamp(body,view.state.revision);
 }
 function memoryPanel(scope,userId,page=0){
  const account=safe(raphaelRecall(store.view(scope),'recent').answer),pages=Math.max(1,Math.ceil(account.length/2800)),index=Math.max(0,Math.min(page,pages-1)),nav=[];
  if(index>0)nav.push(button('Earlier memories',token(userId,scope,{kind:'recall',page:index-1})));
  if(index+1<pages)nav.push(button('More memories',token(userId,scope,{kind:'recall',page:index+1})));
  return card([text(`## Raphael · The company’s memory\nPage ${index+1} of ${pages}`),text(account.slice(index*2800,(index+1)*2800)),row([...nav,button('Scene','coast:scene'),button('My character','coast:private')])]);
 }
 const architectureCuts={R01:4,R02:2.5,R05:4,R07:4};
 const architectureLayers=roomId=>['cutaway','floor-slice','low-cutaway'].map(suffix=>`${roomId.toLowerCase()}-${suffix}`);
 const architectureControls=(scope,userId,roomId)=>row(architectureLayers(roomId).map((layer,index)=>button(['Full room','Floor slice','Low cutaway'][index],token(userId,scope,{kind:'architecture',roomId,layer}))));
 async function architecturePanel(scope,userId,roomId,layer){
  const view=store.view(),room=view.catalog.rooms.find(r=>r.id===roomId);
  if(!Object.hasOwn(architectureCuts,roomId)||!room||!architectureLayers(roomId).includes(layer))throw Error('Architectural map unavailable.');
  if(view.encounter?.roomId===roomId)throw Error('Use the tactical map during combat.');
  const image=await (render.architecture??renderArchitecturePng)(view,roomId,layer);
  const body=rawCard([text(`## ${safe(room.name)} · Architectural map\n${room.width} × ${room.depth} feet · 5 ft grid\nThe ${architectureCuts[roomId]} ft slice reveals the lower part of this room; it is not another floor.`),{type:12,items:[{media:{url:'attachment://architecture.png'},description:`${room.name} — ${layer}`} ]},text('Portraits show the company’s recorded positions. Notes appear only after discovery. Local Stable Diffusion materials on measured room geometry.'),architectureControls(scope,userId,roomId),row([button('Known places','coast:atlas'),button('Room scene',token(userId,scope,{kind:'roomView',roomId,mode:'scene'})),button('Tactical map',token(userId,scope,{kind:'roomView',roomId,mode:'tactical'}))])]);
  body.files=[{attachment:image,name:'architecture.png'}];
  return stamp(body,view.state.revision);
 }
 function atlasPanel(scope,userId,page=0){
  const view=store.view(),size=20,pages=Math.max(1,Math.ceil(view.catalog.rooms.length/size)),index=Math.max(0,Math.min(Math.floor(page),pages-1)),rooms=view.catalog.rooms.slice(index*size,(index+1)*size),nav=[];
  if(index>0)nav.push(button('Previous places',token(userId,scope,{kind:'atlas',page:index-1})));
  if(index+1<pages)nav.push(button('More places',token(userId,scope,{kind:'atlas',page:index+1})));
  return card([text(`## Your charted coast\nOnly places the company has discovered or learned about appear here.\nPage ${index+1} of ${pages} · ${view.catalog.rooms.length} known places`),text(rooms.map(r=>`• **${safe(r.name)}**`).join('\n')||'No places charted yet.'),...(rooms.length?[row([{type:3,custom_id:token(userId,scope,{kind:'room',rooms:rooms.map(r=>r.id)}),placeholder:'Look at a known place',min_values:1,max_values:1,options:rooms.map(r=>({label:r.name.slice(0,100),value:r.id}))}])]:[]),...(nav.length?[row(nav)]:[]),row([button('Current scene','coast:scene'),button('Tactical map','coast:tactical')])]);
 }
 async function panel(kind,scope,userId,roomId){
  const privateThread=[...privateThreads].find(([,ownerId])=>ownerId===userId)?.[0];
  if((kind==='private'||kind==='recall')&&privateThread&&scope.channelId!==privateThread)return card([text('## Your private campaign space\nOpen your dedicated thread for belongings, requests and personal conversations with Raphael.'),row([{type:2,style:5,label:scope.role==='gm'?'Open DM thread':'Open my thread',url:`https://discord.com/channels/${binding.guildId}/${privateThread}`}])]);
  if(kind==='private')return privatePanel(scope,userId);
  if(kind==='recall')return memoryPanel(scope,userId);
  if(kind==='atlas')return atlasPanel(scope,userId);
  const current=store.view(),selected=roomId??current.state.currentRoomId;
  if(kind==='tactical'&&Object.hasOwn(architectureCuts,selected)&&current.encounter?.roomId!==selected)return architecturePanel(scope,userId,selected,`${selected.toLowerCase()}-floor-slice`);
  const body=await scene(kind,roomId),view=store.view(),id=roomId??view.state.currentRoomId;
  const bindRoomControls=components=>{for(const component of components??[]){if(component.custom_id==='coast:tactical')component.custom_id=token(userId,scope,{kind:'roomView',roomId:id,mode:'tactical'});if(component.components)bindRoomControls(component.components);}};
  bindRoomControls(body.components);
  if(Object.hasOwn(architectureCuts,id)&&view.encounter?.roomId!==id)body.components[0].components.push(architectureControls(scope,userId,id));
  return body;
 }
 async function handleInteraction(i){
  if(!i.customId?.startsWith('coast:'))return false;
  let deferred=false;
  try{
   if(closed||i.applicationId!==binding.applicationId||i.guildId!==binding.guildId||(i.channelId!==binding.channelId&&!privateThreads.has(i.channelId)))throw Error('Wrong campaign.');
   const isModal=i.isModalSubmit?.()===true,control=controls.get(i.customId);
   if(!isModal&&i.message?.author?.id!==binding.applicationId)throw Error('Wrong message origin.');
   // Acknowledge ordinary controls before the membership network round trip.
   if(!['request','dmCheck'].includes(control?.kind)||isModal){await i.deferReply({flags:64});deferred=true;}
   const scope=await authorize(i.user?.id,i.channelId);
   if(i.customId.startsWith('coast:token:')&&(!control||control.expires<now()||control.userId!==i.user.id||control.scope!==JSON.stringify(scope)))throw Error('Expired control.');
   if(control?.kind==='request'&&!isModal){
    if(scope.role!=='player')throw Error('Character required.');
    const view=store.view(scope);const custom_id=token(i.user.id,scope,{kind:'submit',revision:view.state.revision});
    await authorize(i.user.id,i.channelId);
    await i.showModal({custom_id,title:'Describe your action',components:[row([{type:4,custom_id:'description',label:'What do you do or examine?',style:2,required:true,max_length:1200}])]});return true;
   }
   if(control?.kind==='dmCheck'){
    if(isModal||scope.role!=='gm'||!binding.dmThreadId||scope.channelId!==binding.dmThreadId||i.values?.length!==1||!control.pois.includes(i.values[0]))throw Error('Invalid discovery control.');
    const revision=store.view().state.revision;if(revision!==control.revision)throw Error('Stale discovery control.');
    const custom_id=token(i.user.id,scope,{kind:'dmCheckSubmit',roomId:control.roomId,poiId:i.values[0],revision});
    await authorize(i.user.id,i.channelId);if(store.view().state.revision!==revision)throw Error('The scene changed.');
    await i.showModal({custom_id,title:'Resolve the discovery check',components:[row([{type:4,custom_id:'interaction',label:'What did the character do?',style:2,required:true,max_length:1200}]),row([{type:4,custom_id:'checkTotal',label:'Resolved ability-check total',style:1,required:true,max_length:6}])]});return true;
   }
   let body;
   if(control?.kind==='dmCheckSubmit'){
    if(!isModal||scope.role!=='gm'||!binding.dmThreadId||scope.channelId!==binding.dmThreadId)throw Error('Private DM resolution required.');
    const interaction=i.fields.getTextInputValue('interaction').trim(),total=i.fields.getTextInputValue('checkTotal').trim();
    if(!interaction||interaction.length>1200||!/^[-+]?\d{1,4}$/.test(total))throw Error('A description and integer check total are required.');
    await authorize(i.user.id,i.channelId);await store.execute(scope,{type:'discoverPoi',roomId:control.roomId,poiId:control.poiId,interaction,checkTotal:Number(total),revision:control.revision},{commandId:`discord:${i.id}`});
    const view=store.view(scope),success=Boolean(view.state.poiIds[control.poiId]);body=card([text(`## Discovery resolved\n${success?'**Success.** The discovered object and its result are now available to players.':'**Nothing new revealed.** The object’s hidden details remain private.'}`),row([button('Resolve another discovery',token(i.user.id,scope,{kind:'dmDiscoveries',page:0})),button('DM desk','coast:private')])]);
   }else if(control?.kind==='dmDiscoveries'){if(isModal)throw Error('Invalid discovery menu.');body=dmDiscoveries(scope,i.user.id,control.page);}
   else if(control?.kind==='buy'||control?.kind==='submit'){
    if(scope.role!=='player')throw Error('Character required.');
    if(control.kind==='buy'&&(isModal||i.values?.length!==1||!control.items.includes(i.values[0])))throw Error('Invalid purchase.');
    if(control.kind==='submit'&&!isModal)throw Error('Expected a description.');
    const action=control.kind==='buy'?{type:'buy',itemId:i.values[0],revision:control.revision}:{type:'request',text:i.fields.getTextInputValue('description'),revision:control.revision};
    await authorize(i.user.id,i.channelId);await store.execute(scope,action,{commandId:`discord:${i.id}`});body=privatePanel(scope,i.user.id);
   }else if(control?.kind==='dmReveal'){
    if(isModal||scope.role!=='gm'||!binding.dmThreadId||scope.channelId!==binding.dmThreadId||i.values?.length!==1||!control.rooms.includes(i.values[0]))throw Error('Invalid private revelation.');
    await authorize(i.user.id,i.channelId);
    await store.execute(scope,{type:'revealRoom',roomId:i.values[0],reason:'The DM disclosed this location from the private desk.',revision:control.revision},{commandId:`discord:${i.id}`});
    body=dmLocations(scope,i.user.id);
   }else if(control?.kind==='dmLocations'){if(isModal)throw Error('Invalid location menu.');body=dmLocations(scope,i.user.id,control.page);}
   else if(control?.kind==='private')body=privatePanel(scope,i.user.id,control.page);
   else if(control?.kind==='recall')body=memoryPanel(scope,i.user.id,control.page);
   else if(control?.kind==='atlas')body=atlasPanel(scope,i.user.id,control.page);
   else if(control?.kind==='architecture')body=await architecturePanel(scope,i.user.id,control.roomId,control.layer);
   else if(control?.kind==='roomView'){
    if(isModal||!['scene','tactical'].includes(control.mode))throw Error('Invalid room view.');
    body=await panel(control.mode,scope,i.user.id,control.roomId);
   }
   else if(control?.kind==='room'){
    if(i.values?.length!==1||!control.rooms.includes(i.values[0]))throw Error('Invalid location.');body=await panel('scene',scope,i.user.id,i.values[0]);
   }else{
    const kind=i.customId.slice(6);if(isModal||!['scene','tactical','atlas','private','recall'].includes(kind))throw Error('Unknown control.');body=await panel(kind,scope,i.user.id);
   }
   await authorize(i.user.id,i.channelId);
   if(revisions.get(body)!==store.view().state.revision)throw Error('The table changed before delivery.');
   await i.editReply(body);return true;
  }catch(error){
   report('COAST_CONTROL_UNAVAILABLE');
   const body={content:unavailable,allowedMentions:{parse:[]}};
   try{if(deferred)await i.editReply(body);else if(!i.replied&&!i.deferred)await i.reply({...body,flags:64});}catch{}
   return true;
  }
 }
 // Refresh only an explicitly bound existing public message. Never creates posts.
 async function refresh(messageId=binding.messageId){
  if(!snowflake(messageId))throw Error('An existing public message is required.');
  await identity(binding.gmUserId);
  const channel=await client.channels.fetch(binding.channelId,{force:true});
  if(channel?.guildId!==binding.guildId||channel.id!==binding.channelId)throw Error('Wrong campaign channel.');
  const message=await channel.messages.fetch({message:messageId,force:true});
  if(message.author?.id!==binding.applicationId)throw Error('Only this application’s message can be refreshed.');
  const body=await scene('scene');await identity(binding.gmUserId);if(closed)throw Error('Table is closed.');
  const revision=revisions.get(body);if(revision!==store.view().state.revision)throw Error('The scene changed before delivery.');
  await message.edit({...body,content:null,embeds:[],attachments:[]});return {messageId,revision};
 }
 const unsubscribe=binding.messageId?store.subscribe(()=>{refreshQueue=refreshQueue.then(()=>refresh()).catch(()=>report('COAST_REFRESH_UNAVAILABLE'));}):()=>{};
 const listener=i=>{void handleInteraction(i);};if(mountListener)client.on('interactionCreate',listener);
 return {handleInteraction,refresh,renderPublic:()=>scene('scene'),async close(){closed=true;unsubscribe();controls.clear();if(mountListener)client.off('interactionCreate',listener);await refreshQueue;}};
}
