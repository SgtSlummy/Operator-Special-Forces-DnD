import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {startTable,previewState} from './table-server.mjs';
import {openTableStore} from './table-store.mjs';
import {createDiscordTable} from './table-discord.mjs';
import {CATALOG} from './catalog.mjs';
const ids={guildId:'1463393482306486387',channelId:'1548204446838689882',applicationId:'1540006061099188274',gmUserId:'1230264975533281312',mara:'123456789012345678',ivo:'223456789012345678'};
const walk=body=>body.components.flatMap(c=>[c,...(c.components??[]).flatMap(x=>[x,...(x.components??[])])]);
let serial=1;
test('location revelations require the private DM thread and preserve positions and secrets',async t=>{
 const f=await fixture(t),dmThreadId='333333333333333333',parentChannelId='444444444444444444';
 f.client.channels.fetch=async()=>({id:dmThreadId,guildId:ids.guildId,parentId:parentChannelId,type:12,ownerId:ids.applicationId,invitable:false,archived:false,members:{fetch:async({member})=>({id:member})}});
 const adapter=createDiscordTable({client:f.client,store:f.table.store,config:{...ids,dmThreadId,parentChannelId,members:[{ownerId:ids.mara,actorId:'mara'}]},render:f.render});t.after(()=>adapter.close());
 const open=async()=>{const desk=f.interaction('coast:private',ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(desk);const button=walk(desk.replies[0]).find(c=>c.label==='Reveal a location');assert.ok(button);const menu=f.interaction(button.custom_id,ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(menu);return walk(menu.replies[0]).find(c=>c.type===3);};
 const shared=f.interaction('coast:private',ids.gmUserId);await adapter.handleInteraction(shared);assert.doesNotMatch(JSON.stringify(shared.replies),/prepared locations|Reveal a location/);
 const menu=await open();assert.ok(menu.options.length>0&&menu.options.length<=25);const roomId=menu.options[0].value,before=f.table.store.view();
 for(const [userId,channelId] of [[ids.mara,dmThreadId],[ids.gmUserId,ids.channelId]]){const i=f.interaction(menu.custom_id,userId,{channelId,values:[roomId]});await adapter.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);}
 assert.equal(f.table.store.view().state.revision,before.state.revision);
 const reveal=f.interaction(menu.custom_id,ids.gmUserId,{channelId:dmThreadId,values:[roomId]});await adapter.handleInteraction(reveal);await adapter.handleInteraction(reveal);
 const after=f.table.store.view();assert.equal(after.state.revision,before.state.revision+1);assert.ok(after.state.roomIds[roomId]);assert.equal(after.state.currentRoomId,before.state.currentRoomId);assert.deepEqual(after.state.party,before.state.party);assert.deepEqual(after.state.poiIds,before.state.poiIds);
 const stale=await open();await f.gm({type:'setVitals',actorId:'mara',hp:20,maxHp:28});const revision=f.table.store.view().state.revision;
 const rejected=f.interaction(stale.custom_id,ids.gmUserId,{channelId:dmThreadId,values:[stale.options[0].value]});await adapter.handleInteraction(rejected);assert.match(JSON.stringify(rejected.replies),/no longer available/);assert.equal(f.table.store.view().state.revision,revision);
});
test('private DM discovery checks reveal only success and reject copied, invalid and stale forms',async t=>{
 const f=await fixture(t),dmThreadId='333333333333333333',parentChannelId='444444444444444444';
 f.client.channels.fetch=async()=>({id:dmThreadId,guildId:ids.guildId,parentId:parentChannelId,type:12,ownerId:ids.applicationId,invitable:false,archived:false,members:{fetch:async({member})=>({id:member})}});
 const adapter=createDiscordTable({client:f.client,store:f.table.store,config:{...ids,dmThreadId,parentChannelId,members:[{ownerId:ids.mara,actorId:'mara'}]},render:f.render});t.after(()=>adapter.close());
 const room=CATALOG.rooms.find(r=>r.pois?.some(p=>(p.dc??0)>0&&!f.table.store.view().state.poiIds[p.id]));assert.ok(room);
 const poi=room.pois.find(p=>(p.dc??0)>0&&!f.table.store.view().state.poiIds[p.id]);
 await f.gm({type:'visitRoom',roomId:room.id,override:true,reason:'Isolated discovery test'});
 const open=async()=>{const desk=f.interaction('coast:private',ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(desk);const button=walk(desk.replies[0]).find(c=>c.label==='Resolve room discovery');assert.ok(button);const menu=f.interaction(button.custom_id,ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(menu);const select=walk(menu.replies[0]).find(c=>c.type===3);assert.ok(select.options.some(o=>o.value===poi.id));const choose=f.interaction(select.custom_id,ids.gmUserId,{channelId:dmThreadId,values:[poi.id]});await adapter.handleInteraction(choose);assert.ok(choose.modal);assert.equal(choose.deferred,undefined);return choose.modal;};
 const submit=(modal,total,extra={})=>f.interaction(modal.custom_id,ids.gmUserId,{channelId:dmThreadId,message:undefined,isModalSubmit:()=>true,fields:{getTextInputValue:key=>key==='interaction'?'Mara examines the object carefully.':String(total)},...extra});
 const visible=()=>f.table.store.view().catalog.rooms.find(r=>r.id===room.id).pois.find(p=>p.id===poi.id)?.description===(poi.result||poi.interaction||poi.description);
 assert.equal(visible(),false);const first=await open(),before=f.table.store.view().state.revision;
 for(const invalid of [submit(first,poi.dc,{user:{id:ids.mara}}),submit(first,poi.dc,{channelId:ids.channelId}),submit(first,'NaN'),submit(first,'1e3'),submit(first,'')]){await adapter.handleInteraction(invalid);assert.match(JSON.stringify(invalid.replies),/no longer available/);}
 assert.equal(f.table.store.view().state.revision,before);assert.equal(visible(),false);
 const fail=submit(first,poi.dc-1);await adapter.handleInteraction(fail);await adapter.handleInteraction(fail);assert.match(JSON.stringify(fail.replies),/Nothing new revealed/);assert.equal(f.table.store.view().state.revision,before+1);assert.equal(visible(),false);
 const stale=await open();await f.gm({type:'setVitals',actorId:'mara',hp:19,maxHp:28});const staleSubmit=submit(stale,poi.dc);await adapter.handleInteraction(staleSubmit);assert.match(JSON.stringify(staleSubmit.replies),/no longer available/);assert.equal(visible(),false);
 const success=submit(await open(),poi.dc),prior=f.table.store.view().state;await adapter.handleInteraction(success);await adapter.handleInteraction(success);
 assert.match(JSON.stringify(success.replies),/Success/);assert.equal(visible(),true);const current=f.table.store.view().state;assert.equal(current.revision,prior.revision+1);assert.deepEqual(current.party,prior.party);assert.equal(current.currentRoomId,prior.currentRoomId);assert.ok(current.poiIds[poi.id]);
 const browser=await(await fetch(f.url+'/api/view')).json();assert.ok(browser.state.poiIds[poi.id]);assert.ok(browser.catalog.rooms.find(r=>r.id===room.id).pois.some(p=>p.id===poi.id));assert.ok(browser.state.history.every(e=>!Object.hasOwn(e,'gm')));
});
test('a synthetic hidden object stays absent until its DM check succeeds',async t=>{
 const f=await fixture(t),catalog=structuredClone(CATALOG),room=catalog.rooms.find(r=>r.id==='R05');
 room.pois.push({id:'hidden-test-cache',name:'Concealed test cache',hidden:true,dc:14,x:.4,y:.6,result:'A blue test token rests inside.'});
 const seed=previewState();seed.currentRoomId=room.id;seed.roomIds[room.id]={learned:true,visited:true};
 const store=await openTableStore({catalog,stateFile:f.file+'.hidden',seed:()=>seed}),dmThreadId='333333333333333333',parentChannelId='444444444444444444';
 f.client.channels.fetch=async()=>({id:dmThreadId,guildId:ids.guildId,parentId:parentChannelId,type:12,ownerId:ids.applicationId,invitable:false,archived:false,members:{fetch:async({member})=>({id:member})}});
 const adapter=createDiscordTable({client:f.client,store,config:{...ids,dmThreadId,parentChannelId,members:[]},render:f.render});
 try{
  const open=async()=>{const desk=f.interaction('coast:private',ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(desk);const b=walk(desk.replies[0]).find(c=>c.label==='Resolve room discovery'),menu=f.interaction(b.custom_id,ids.gmUserId,{channelId:dmThreadId});await adapter.handleInteraction(menu);const select=walk(menu.replies[0]).find(c=>c.type===3),choice=f.interaction(select.custom_id,ids.gmUserId,{channelId:dmThreadId,values:['hidden-test-cache']});await adapter.handleInteraction(choice);return choice.modal;};
  assert.ok(!JSON.stringify(store.view()).includes('Concealed test cache'));
  for(const total of ['13','14']){const modal=await open();assert.ok(modal);const i=f.interaction(modal.custom_id,ids.gmUserId,{channelId:dmThreadId,message:undefined,isModalSubmit:()=>true,fields:{getTextInputValue:key=>key==='interaction'?'Search beneath the loose board.':total}});await adapter.handleInteraction(i);assert.equal(JSON.stringify(store.view()).includes('Concealed test cache'),total==='14');}
  assert.ok(JSON.stringify(store.view()).includes('A blue test token rests inside.'));
 }finally{await adapter.close();await store.close();}
});
async function fixture(t,{realArt=false,watch=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'coast-discord-')),file=join(dir,'state.json');
 const table=await startTable({gmPort:0,playerPort:0,stateFile:file});
 const client=new EventEmitter();client.user={id:ids.applicationId};
 const allowed=new Set([ids.gmUserId,ids.mara,ids.ivo]),edits=[];let memberHook=async()=>{};
 client.guilds={fetch:async id=>{assert.equal(id,ids.guildId);return{members:{fetch:async opts=>{assert.equal(opts.force,true);assert.equal(opts.cache,false);await memberHook(opts.user);if(!allowed.has(opts.user))throw Error('Not a member');return{id:opts.user,user:{bot:false}};}}};}};
 client.channels={fetch:async()=>({id:ids.channelId,guildId:ids.guildId,messages:{fetch:async()=>({author:{id:ids.applicationId},edit:async body=>{edits.push(body);}})}})};
 const config={...ids,members:[{ownerId:ids.mara,actorId:'mara'},{ownerId:ids.ivo,actorId:'ivo'}],...(watch?{messageId:'1548406532729741579'}:{})};
 const render=realArt?undefined:{scene:async()=>Buffer.from('scene'),tactical:async()=>Buffer.from('tactical'),combat:async()=>Buffer.from('combat')};
 const errors=[];const discord=createDiscordTable({client,store:table.store,config,render,onError:e=>errors.push(e)});
 t.after(async()=>{await discord.close();await table.close();await rm(dir,{recursive:true,force:true});});
 function interaction(customId='coast:private',userId=ids.mara,extra={}){
  const replies=[];return {id:String(100000000000000000n+BigInt(serial++)),customId,user:{id:userId},applicationId:ids.applicationId,guildId:ids.guildId,channelId:ids.channelId,message:{author:{id:ids.applicationId}},replies,
   deferReply:async function(body){this.deferred=true;this.ack=body;},reply:async body=>replies.push(body),editReply:async body=>replies.push(body),showModal:async function(body){this.modal=body;},...extra};
 }
 const gm=async action=>table.store.execute({role:'gm'},{...action,revision:table.store.view().state.revision});
 return {table,discord,client,allowed,render,errors,edits,file,interaction,gm,setMemberHook:fn=>{memberHook=fn;},url:`http://127.0.0.1:${table.player.address().port}`};
}

test('Discord purchase changes the browser authority and a retry charges once',async t=>{
 const f=await fixture(t),i=f.interaction();await f.discord.handleInteraction(i);assert.equal(i.ack.flags,64);
 const buy=walk(i.replies[0]).find(c=>c.type===3);assert.ok(buy);
 const purchase=f.interaction(buy.custom_id,ids.mara,{values:['rope']});await f.discord.handleInteraction(purchase);await f.discord.handleInteraction(purchase);
 const own=f.table.store.view({role:'player',actorId:'mara'});assert.equal(own.personal.coins,19);assert.equal(own.personal.items.filter(x=>x.name==='50 feet of hemp rope').length,1);
 const browser=await(await fetch(f.url+'/api/view')).json();assert.equal(browser.state.revision,own.state.revision);assert.equal(browser.personal,null);assert.ok(!JSON.stringify(browser).includes('purchased'));
 assert.equal(f.table.store.view({role:'player',actorId:'ivo'}).personal.coins,20);
});
test('private loot and Raphael memories do not cross player identities',async t=>{
 const f=await fixture(t);await f.gm({type:'award',actorId:'mara',name:'Hidden sapphire',source:'Private reward'});
 const own=f.interaction('coast:private'),other=f.interaction('coast:private',ids.ivo),recall=f.interaction('coast:recall',ids.ivo);
 for(const i of[own,other,recall])await f.discord.handleInteraction(i);
 assert.match(JSON.stringify(own.replies),/Hidden sapphire/);assert.doesNotMatch(JSON.stringify(other.replies),/Hidden sapphire/);assert.doesNotMatch(JSON.stringify(recall.replies),/Hidden sapphire/);
});
test('copied controls, cross-channel input, and spoofed message authors cannot act',async t=>{
 const f=await fixture(t),own=f.interaction();await f.discord.handleInteraction(own);const buy=walk(own.replies[0]).find(c=>c.type===3);
 const before=f.table.store.view().state.revision;
 for(const i of[f.interaction(buy.custom_id,ids.ivo,{values:['rope']}),f.interaction('coast:private',ids.mara,{channelId:'999999999999999999'}),f.interaction('coast:private',ids.mara,{message:{author:{id:ids.mara}}})]){await f.discord.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);}
 assert.equal(f.table.store.view().state.revision,before);
});
test('a stale shop menu cannot spend money',async t=>{
 const f=await fixture(t),i=f.interaction();await f.discord.handleInteraction(i);const buy=walk(i.replies[0]).find(c=>c.type===3);
 await f.gm({type:'setVitals',actorId:'mara',hp:20,maxHp:28});const purchase=f.interaction(buy.custom_id,ids.mara,{values:['rope']});await f.discord.handleInteraction(purchase);
 assert.equal(f.table.store.view({role:'player',actorId:'mara'}).personal.coins,20);assert.match(JSON.stringify(purchase.replies),/no longer available/);
});
test('action modal creates one private request visible to the DM',async t=>{
 const f=await fixture(t),i=f.interaction();await f.discord.handleInteraction(i);const request=walk(i.replies[0]).find(c=>c.label==='Describe an action');
 const open=f.interaction(request.custom_id);await f.discord.handleInteraction(open);assert.equal(open.modal.title,'Describe your action');
 const submit=f.interaction(open.modal.custom_id,ids.mara,{message:undefined,isModalSubmit:()=>true,fields:{getTextInputValue:()=> 'Inspect the worn hinge.'}});
 await f.discord.handleInteraction(submit);await f.discord.handleInteraction(submit);
 assert.equal(f.table.store.view({role:'gm'}).requests.length,1);assert.equal(f.table.store.view({role:'player',actorId:'ivo'}).requests.length,0);
});
test('public round updates omit hidden enemies and unknown health even for the DM',async t=>{
 const f=await fixture(t);await f.gm({type:'encounter',roomId:'t-tavern',terrain:'room',enemies:[{name:'Visible guardian',hp:37,maxHp:50,visible:true},{name:'Hidden ambusher',hp:22,maxHp:30,visible:false}]});
 const i=f.interaction('coast:scene',ids.gmUserId);await f.discord.handleInteraction(i);const body=i.replies[0];assert.equal(body.files.length,2);
 const rendered=JSON.stringify(body);assert.match(rendered,/HP \?/);assert.doesNotMatch(rendered,/Hidden ambusher|37\/50|22\/30/);
 await f.gm({type:'enemy',enemyId:'enemy-0',healthKnown:true});await f.gm({type:'round'});const newer=await f.discord.renderPublic();assert.match(JSON.stringify(newer),/Round 2/);assert.match(JSON.stringify(newer),/37\/50 HP/);
});
test('revoked guild membership after rendering prevents delivery',async t=>{
 const f=await fixture(t);f.render.scene=async()=>{f.allowed.delete(ids.mara);return Buffer.from('scene');};
 const i=f.interaction('coast:scene');await f.discord.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);assert.ok(!i.replies.some(r=>r.files));
});
test('a scene changed during rendering is discarded',async t=>{
 const f=await fixture(t);f.render.scene=async()=>{await f.gm({type:'setVitals',actorId:'mara',hp:20,maxHp:28});return Buffer.from('old map');};
 const i=f.interaction('coast:scene');await f.discord.handleInteraction(i);assert.ok(!i.replies.some(r=>r.files));
});
test('known-place controls reject undiscovered rooms',async t=>{
 const f=await fixture(t),i=f.interaction('coast:atlas');await f.discord.handleInteraction(i);const choice=walk(i.replies[0]).find(c=>c.type===3);
 assert.ok(!choice.options.some(o=>o.value==='R18'));const forged=f.interaction(choice.custom_id,ids.mara,{values:['R18']});await f.discord.handleInteraction(forged);assert.ok(!forged.replies.some(r=>r.files));
});
test('shared authority serializes simultaneous purchases and persists replay receipts',async t=>{
 const f=await fixture(t),scope={role:'player',actorId:'mara'},action={type:'buy',itemId:'rope',revision:f.table.store.view().state.revision};
 const results=await Promise.all(Array.from({length:8},()=>f.table.store.execute(scope,action,{commandId:'same-purchase'})));assert.equal(results.filter(r=>!r.replayed).length,1);
 await assert.rejects(f.table.store.execute({role:'player',actorId:'ivo'},action,{commandId:'same-purchase'}),/different action/);
 await f.discord.close();await f.table.close();const reopened=await openTableStore({catalog:CATALOG,stateFile:f.file,seed:previewState});
 try{const retry=await reopened.execute(scope,action,{commandId:'same-purchase'});assert.equal(retry.replayed,true);assert.equal(reopened.view(scope).personal.coins,19);}finally{await reopened.close();}
});
test('second writer is refused and subscription contains no private data',async t=>{
 const f=await fixture(t);await assert.rejects(openTableStore({catalog:CATALOG,stateFile:f.file,seed:previewState}),/writer reservation/);
 const notices=[];f.table.store.subscribe(e=>notices.push(e));await f.gm({type:'award',actorId:'mara',name:'Private item',source:'Secret'});assert.deepEqual(Object.keys(notices[0]),['revision']);
});
test('actual scene renderer returns a PNG attachment suitable for Discord',async t=>{
 const f=await fixture(t,{realArt:true}),body=await f.discord.renderPublic();assert.equal(body.flags,32768);assert.equal(body.files[0].attachment.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(body.files[0].name,'scene.png');
});
test('ordinary controls acknowledge before fetching guild membership',async t=>{
 const f=await fixture(t),i=f.interaction('coast:scene');f.setMemberHook(async()=>assert.equal(i.deferred,true));await f.discord.handleInteraction(i);assert.ok(i.replies[0].files);
});
test('state changes during the final permission check discard a prepared response',async t=>{
 const f=await fixture(t);let calls=0;f.setMemberHook(async()=>{if(++calls===2)await f.gm({type:'setVitals',actorId:'mara',hp:19,maxHp:28});});
 const i=f.interaction('coast:scene');await f.discord.handleInteraction(i);assert.ok(!i.replies.some(r=>r.files));assert.match(JSON.stringify(i.replies),/no longer available/);
});
test('long private requests and memories stay readable through bounded pages',async t=>{
 const f=await fixture(t);for(let n=0;n<6;n++){
  await f.table.store.execute({role:'player',actorId:'mara'},{type:'request',text:'*'.repeat(1199),revision:f.table.store.view().state.revision});
  const request=f.table.store.view({role:'gm'}).requests.at(-1);
  if(n<5)await f.gm({type:'answer',requestId:request.id,answer:'*'.repeat(1199)});
 }
 const dm=f.interaction('coast:private',ids.gmUserId);await f.discord.handleInteraction(dm);assert.ok(walk(dm.replies[0]).filter(c=>c.type===10).reduce((n,c)=>n+c.content.length,0)<4000);
 const recall=f.interaction('coast:recall');await f.discord.handleInteraction(recall);assert.ok(walk(recall.replies[0]).filter(c=>c.type===10).reduce((n,c)=>n+c.content.length,0)<4000);
 const next=walk(recall.replies[0]).find(c=>c.label==='More memories');assert.ok(next);const follow=f.interaction(next.custom_id);await f.discord.handleInteraction(follow);assert.match(JSON.stringify(follow.replies),/Page 2/);
});

test('browsed architectural rooms retain their own tactical and scene destinations',async t=>{
 const f=await fixture(t),rendered=[];
 f.render.architecture=async(view,roomId,layer)=>{rendered.push({roomId,layer});return Buffer.from(layer);};
 const partyRoom=f.table.store.view().state.currentRoomId;
 await f.gm({type:'revealRoom',roomId:'R02',reason:'A maintenance chart names the valve room.'});
 const revision=f.table.store.view().state.revision;
 for(const roomId of ['R01','R02']){
  const atlas=f.interaction('coast:atlas');await f.discord.handleInteraction(atlas);
  const menu=walk(atlas.replies[0]).find(c=>c.type===3);
  const selected=f.interaction(menu.custom_id,ids.mara,{values:[roomId]});await f.discord.handleInteraction(selected);
  const full=walk(selected.replies[0]).find(c=>c.label==='Full room');assert.ok(full);
  const architecture=f.interaction(full.custom_id);await f.discord.handleInteraction(architecture);
  const tactical=walk(architecture.replies[0]).find(c=>c.label==='Tactical map');
  const copied=f.interaction(tactical.custom_id,ids.ivo);await f.discord.handleInteraction(copied);assert.ok(!copied.replies.some(r=>r.files));
  const map=f.interaction(tactical.custom_id);await f.discord.handleInteraction(map);
  assert.deepEqual(rendered.at(-1),{roomId,layer:roomId.toLowerCase()+'-floor-slice'});
  assert.ok(map.replies[0].files);
  const back=walk(map.replies[0]).find(c=>c.label==='Room scene');
  let returned;f.render.scene=async(view,id)=>{returned=id;return Buffer.from(id);};
  await f.discord.handleInteraction(f.interaction(back.custom_id));assert.equal(returned,roomId);
 }
 assert.equal(f.table.store.view().state.currentRoomId,partyRoom);
 assert.equal(f.table.store.view().state.revision,revision);
});

test('gallery controls deliver real architectural PNGs and recheck membership',async t=>{
 const f=await fixture(t,{realArt:true}),before=f.table.store.view().state.revision;
 const atlas=f.interaction('coast:atlas');await f.discord.handleInteraction(atlas);
 const menu=walk(atlas.replies[0]).find(c=>c.type===3);
 const selected=f.interaction(menu.custom_id,ids.mara,{values:['R07']});await f.discord.handleInteraction(selected);
 const controls=walk(selected.replies[0]).filter(c=>c.type===2);
 const full=controls.find(c=>c.label==='Full room');assert.ok(full,JSON.stringify(controls));
 const opened=f.interaction(full.custom_id);await f.discord.handleInteraction(opened);
 const choices=walk(opened.replies[0]).filter(c=>c.type===2);
 const layers=choices.filter(c=>/Full room|cutaway|slice/i.test(c.label));
 assert.equal(layers.length,3,JSON.stringify(choices));
 for(const choice of layers){
  const i=f.interaction(choice.custom_id);await f.discord.handleInteraction(i);
  const png=i.replies[0]?.files?.[0]?.attachment;assert.ok(Buffer.isBuffer(png),JSON.stringify(i.replies));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),2048);assert.equal(png.readUInt32BE(20),1024);
  const copied=f.interaction(choice.custom_id,ids.ivo);await f.discord.handleInteraction(copied);assert.ok(!copied.replies.some(r=>r.files));
 }
 let calls=0;f.setMemberHook(async()=>{if(++calls===2)f.allowed.delete(ids.mara);});
 const revoked=f.interaction(full.custom_id);await f.discord.handleInteraction(revoked);assert.ok(!revoked.replies.some(r=>r.files));
 f.allowed.add(ids.mara);f.setMemberHook(async()=>{});
 const originalView=f.table.store.view;
 f.table.store.view=(...args)=>{const v=originalView(...args);v.catalog.rooms=v.catalog.rooms.filter(r=>r.id!=='R07');return v;};
 try{const withdrawn=f.interaction(full.custom_id);await f.discord.handleInteraction(withdrawn);assert.ok(!withdrawn.replies.some(r=>r.files));assert.match(JSON.stringify(withdrawn.replies),/no longer available/);}finally{f.table.store.view=originalView;}
 assert.equal(f.table.store.view().state.revision,before);
});

test('a saved public message refreshes on a committed browser action without creating posts',async t=>{
 const f=await fixture(t,{watch:true});await f.gm({type:'setVitals',actorId:'mara',hp:20,maxHp:28});
 for(let n=0;n<30&&!f.edits.length;n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(f.edits.length,1);assert.equal(f.edits[0].files[0].name,'scene.png');assert.deepEqual(f.edits[0].attachments,[]);
});
