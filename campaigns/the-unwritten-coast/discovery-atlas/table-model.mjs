import {initialState,project,applyAction,positionOnFloor} from './model.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const clone=structuredClone;
export function createTable(catalog){return {...initialState(catalog),table:{encounter:null,personal:Object.fromEntries(catalog.party.map(p=>[p.id,{items:[],coins:0,hp:null,maxHp:null}])),requests:[],shops:{},journal:[]}};}
export function tableProject(catalog,state,identity={role:'shared'}){
 const gm=identity.role==='gm',own=identity.role==='player'?catalog.party.find(p=>p.id===identity.actorId):null;
 need(identity.role!=='player'||own,'Unknown character.');
 const base=project(catalog,state,gm?'gm':'player');
 // The scene adapter never receives preparation fields, even in the DM browser.
 const publicView=project(catalog,state,'player');
 const gallery=publicView.catalog.rooms.find(r=>r.id==='R07');
 if(gallery)gallery.narration=[
  'The Reflection Gallery stretches ahead in a long ribbon of slate and pale stone. Brass-framed mirrors stand along one side, their supports fitted with pivots. Lanterns pick out a warm edge here, a cold silver surface there; the same small light seems to return from much farther away than it should.',
  'Above the steady floor, the mirrored ceiling carries the movement of machinery. Looking down offers a reassuring line of tiles. Looking up gives you motion without an obvious place to put it. The gallery is broad enough to walk through together, but its length makes the two display tables feel like separate stops along the way.',
  'At one table lie viewpoint diagrams, their lines visible before their meaning is clear. Farther along, a plate and a paper copy sit side by side. Neither demands your attention. The mirrors, the tables, and the open walking space leave you room to choose where to pause and what to examine.',
  'You can approach either display, look over the adjustable mirror frames, or continue through the gallery. Describe what you do and what you are trying to learn; closer inspection may give you something worth marking on the map.'
 ];
 // Opening copy is already public Discord narration, not DM preparation.
 // Stop using it after play advances; revisiting the ferry must not reset the story.
 const opening=state.table?.opening;
 if(state.currentRoomId==='f-deck'&&!(state.history?.length)&&typeof opening?.description==='string'&&opening.description.trim()){
  const room=publicView.catalog.rooms.find(r=>r.id==='f-deck');
  if(room)room.narration=opening.description.trim().split(/\n\s*\n/);
 }
 const encounter=state.table?.encounter;
 const safeEncounter=encounter&&publicView.catalog.rooms.some(r=>r.id===encounter.roomId)?{
  roomId:encounter.roomId,round:encounter.round,terrain:encounter.terrain,surprise:encounter.surprise,
  enemies:encounter.enemies.filter(e=>gm||e.visible).map(e=>({id:e.id,name:e.name,art:e.art==='harbor-lookout'?'harbor-lookout':'sentinel',x:e.x,y:e.y,...(gm||e.healthKnown?{hp:e.hp,maxHp:e.maxHp}:{healthUnknown:true})}))
 }:null;
 const personal=own?clone(state.table?.personal?.[own.id]??{items:[],coins:0}):null;
 const journal=(state.table?.journal??[]).filter(e=>gm||e.audience==='shared'||own&&e.audience===own.id).map(({text,at})=>({text,at}));
 const shop=own&&state.table?.shops?.[state.currentRoomId];
 return {catalog:publicView.catalog,state:publicView.state,identity:{role:identity.role,actorId:own?.id??null},personal,encounter:safeEncounter,
 party:publicView.state.party.map(p=>({...p,art:p.id,...(state.table?.personal?.[p.id]?{hp:state.table.personal[p.id].hp,maxHp:state.table.personal[p.id].maxHp}:{})})),
 shop:shop?{name:shop.name,stock:shop.stock.map(({id,name,price,quantity})=>({id,name,price,quantity}))}:null,
 journal,requests:gm?clone(state.table?.requests??[]):(state.table?.requests??[]).filter(r=>r.actorId===own?.id).map(({id,text,status,answer})=>({id,text,status,answer})),
 ...(gm?{preparation:base,table:clone(state.table)}:{})};
}
export function tableAction(catalog,state,identity,action){
 need(action&&typeof action==='object','Choose an action.');need(Number.isInteger(action.revision)&&action.revision===state.revision,'The table changed. Refresh and try again.');
 const gm=identity.role==='gm',actor=catalog.party.find(p=>p.id===identity.actorId);
 need(gm||identity.role==='player'&&actor,'Open your private character link.');
 let next=clone(state);next.table??={encounter:null,personal:{},requests:[],shops:{},journal:[]};
 const log=(text,audience='shared')=>next.table.journal.push({text,audience,at:new Date().toISOString()});
 const text=(s,max=1200)=>{need(typeof s==='string'&&s.trim().length>0&&s.length<=max,'Enter a short description.');return s.trim();};
 if(action.type==='request'){
  need(!gm,'Use a player view to submit an action.');need(next.table.requests.filter(r=>r.status==='pending').length<100,'The DM needs to resolve pending requests first.');
  next.table.requests.push({id:crypto.randomUUID(),actorId:actor.id,roomId:state.currentRoomId,text:text(action.text),status:'pending'});
 }else if(action.type==='buy'){
  need(actor&&!gm,'Use your own character to shop.');const shop=next.table.shops[state.currentRoomId];need(shop,'No shop is available here.');const item=shop.stock.find(i=>i.id===action.itemId),p=next.table.personal[actor.id];need(item&&item.quantity>0,'This item is unavailable.');need(p&&p.coins>=item.price,'You do not have enough coin.');p.coins-=item.price;item.quantity--;p.items.push({id:crypto.randomUUID(),name:item.name,source:shop.name});log(`${actor.name} purchased ${item.name}.`,actor.id);
 }else if(action.type==='shareItem'){
  need(actor&&!gm,'Use your own inventory.');const item=next.table.personal[actor.id]?.items.find(i=>i.id===action.itemId);need(item,'That item is not in your inventory.');log(`${actor.name} shows the company ${item.name}.`);
 }else{
  need(gm,'Only the DM can resolve this action.');
  if(action.type==='answer') {const r=next.table.requests.find(r=>r.id===action.requestId);need(r&&r.status==='pending','This request is no longer pending.');r.status='answered';r.answer=text(action.answer);log(r.answer,action.share===true?'shared':r.actorId);}
  else if(action.type==='award') {need(catalog.party.some(p=>p.id===action.actorId),'Choose a character.');const p=next.table.personal[action.actorId];need(p,'Character record unavailable.');p.items.push({id:crypto.randomUUID(),name:text(action.name,100),source:text(action.source,100)});log(`Received ${action.name}.`,action.actorId);}
  else if(action.type==='setVitals') {need(next.table.personal[action.actorId],'Choose a character.');need(Number.isInteger(action.hp)&&Number.isInteger(action.maxHp)&&action.maxHp>0&&action.hp>=0&&action.hp<=action.maxHp,'Enter valid health.');Object.assign(next.table.personal[action.actorId],{hp:action.hp,maxHp:action.maxHp});}
  else if(action.type==='encounter') {
   need(state.roomIds[action.roomId],'Encounter room must be discovered.');need(['room','hallway'].includes(action.terrain),'Choose room or hallway.');need(Array.isArray(action.enemies)&&action.enemies.length>0&&action.enemies.length<=12,'Use one to twelve enemies.');
   const enemies=action.enemies.map((e,i)=>{need(e.art===undefined||['sentinel','harbor-lookout'].includes(e.art),'Choose an available opponent illustration.');need(Number.isInteger(e.hp)&&Number.isInteger(e.maxHp)&&e.maxHp>0&&e.hp>=0&&e.hp<=e.maxHp,'Invalid enemy health.');return {id:`enemy-${i}`,name:text(e.name,60),art:e.art??'sentinel',hp:e.hp,maxHp:e.maxHp,visible:e.visible===true,healthKnown:e.healthKnown===true,...positionOnFloor(catalog.rooms.find(r=>r.id===action.roomId),{x:.7+(i%2)*.12,y:.25+Math.floor(i/2)*.12})};});
   next.table.encounter={roomId:action.roomId,terrain:action.terrain,surprise:text(action.surprise||'No surprise declared',120),round:1,enemies};log(`An encounter begins in ${catalog.rooms.find(r=>r.id===action.roomId).name}.`);
  }else if(action.type==='round') {const e=next.table.encounter;need(e,'No encounter is active.');e.round++;log(`Round ${e.round} begins.`);}
  else if(action.type==='enemy') {const e=next.table.encounter?.enemies.find(e=>e.id===action.enemyId);need(e,'Choose an enemy.');if(action.hp!==undefined){need(Number.isInteger(action.hp)&&action.hp>=0&&action.hp<=e.maxHp,'Invalid health.');e.hp=action.hp;}if(action.visible!==undefined)e.visible=action.visible===true;if(action.healthKnown!==undefined)e.healthKnown=action.healthKnown===true;}
  else if(action.type==='endEncounter') {next.table.encounter=null;log('The encounter ends.');}
  else {next=applyAction(catalog,state,action);next.table??=clone(state.table);if(['visitRoom','travelRoad'].includes(action.type)&&next.currentRoomId!==state.currentRoomId){const destination=catalog.rooms.find(r=>r.id===next.currentRoomId);need(destination,'Arrival room is unavailable.');for(const p of next.party)if(p.roomId===state.currentRoomId)Object.assign(p,{roomId:destination.id,...positionOnFloor(destination,p)});}return next;}
 }
 next.revision++;next.table.journal=next.table.journal.slice(-300);return next;
}
export function raphaelRecall(view,query='recent'){
 const q=String(query).toLowerCase().trim().slice(0,200),recent=/recent|last|happened|recap|summary/.test(q);
 const entries=[...view.state.history.map(e=>({text:e.summary,at:e.at})),...view.journal];
 const selected=entries.filter(e=>recent||e.text.toLowerCase().includes(q)).sort((a,b)=>String(a.at).localeCompare(String(b.at))).slice(-6);
 return selected.length?{answer:selected.map(e=>e.text).join('\n\n'),sources:selected.map(e=>({at:e.at,text:e.text}))}:{answer:'I have no recorded memory of that in the accounts available to you. Tell me a place, person, or discovery to look for.',sources:[]};
}
export function threadPlan(members){
 need(Array.isArray(members)&&members.every(m=>/^\d+$/.test(m.ownerId)&&m.actorId),'Discord owners and characters are required.');
 need(new Set(members.map(m=>m.ownerId)).size===members.length,'One personal thread per player; duplicate owner.');
 return [{key:'dm',name:'The Unwritten Coast · DM',private:true,invitable:false},...members.map(m=>({key:`player:${m.ownerId}`,name:`${m.name} · Private`,private:true,invitable:false,ownerId:m.ownerId,actorId:m.actorId}))];
}
// Pure adapter: caller must resolve Discord identity through existing campaign membership.
export function discordScene(view,roomId,{assetUrl}={}){
 const room=view.catalog.rooms.find(r=>r.id===roomId);need(room,'Room is not discovered.');
 const control=(label,id)=>({type:2,style:2,label,custom_id:`coast:${id}`});
 const children=[{type:10,content:`## ${room.name}\n${(room.narration??[room.flavor,room.description]).join('\n\n')}`},
  ...(assetUrl?[{type:12,items:[{media:{url:assetUrl},description:room.name}]}]:[]),
  {type:10,content:`### Around you\n${room.visibleFeatures.map(f=>`• ${f}`).join('\n')}`},
  {type:14,divider:true,spacing:1},
  {type:10,content:`### Recorded discoveries\n${room.pois.filter(p=>view.state.poiIds[p.id]).map(p=>`**${p.name}** — ${p.description}`).join('\n')||'None yet. Describe what you examine; your DM resolves the result.'}`},
  {type:1,components:[control('Scene','scene'),control('Tactical map','tactical'),control('Atlas','atlas'),control('My character','private'),control('Raphael','recall')]}];
 if(view.encounter?.roomId===roomId)children.splice(-1,0,{type:10,content:`### Round ${view.encounter.round} · ${view.encounter.surprise}\n${view.encounter.enemies.map(e=>`**${e.name}** · ${e.healthUnknown?'HP ?':`${e.hp}/${e.maxHp} HP`}`).join('\n')||'No opponent is visible.'}`});
 return {flags:32768,allowed_mentions:{parse:[]},components:[{type:17,accent_color:0xc8a36a,components:children}]};
}
