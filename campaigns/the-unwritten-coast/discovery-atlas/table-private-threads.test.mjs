import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDiscordTable} from './table-discord.mjs';
import {openTableStore} from './table-store.mjs';
import {previewState} from './table-server.mjs';
import {CATALOG} from './catalog.mjs';
const id={guildId:'1463393482306486387',channelId:'1548204446838689882',parentChannelId:'1546676505780944979',applicationId:'1540006061099188274',gmUserId:'1230264975533281312',dmThreadId:'333333333333333333',player:'123456789012345678',thread:'444444444444444444',other:'223456789012345678'};
const config=()=>({...id,members:[{ownerId:id.player,actorId:'mara',threadId:id.thread},{ownerId:id.other,actorId:'ivo'}]});
const walk=b=>b.components.flatMap(c=>[c,...(c.components??[]).flatMap(x=>[x,...(x.components??[])])]);
let serial=0;
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'coast-private-'));
 const store=await openTableStore({catalog:CATALOG,stateFile:join(dir,'state.json'),seed:previewState});
 const threads=new Map(),members=new Set([id.player,id.gmUserId]);let checks=0;
 for(const threadId of[id.thread,id.dmThreadId])threads.set(threadId,{id:threadId,guildId:id.guildId,parentId:id.parentChannelId,type:12,ownerId:id.applicationId,invitable:false,archived:false,members:{fetch:async opts=>{assert.equal(opts.force,true);assert.equal(opts.cache,false);checks++;if(!members.has(opts.member))throw Error('Removed');return{id:opts.member};}}});
 const client={user:{id:id.applicationId},guilds:{fetch:async()=>({members:{fetch:async opts=>({id:opts.user,user:{bot:false}})}})},channels:{fetch:async(channelId,opts)=>{assert.equal(opts.force,true);assert.equal(opts.cache,false);return threads.get(channelId);}}};
 const render={scene:async()=>Buffer.from('scene'),tactical:async()=>Buffer.from('tactical'),combat:async()=>Buffer.from('combat')};
 const controller=createDiscordTable({client,store,config:config(),render});
 t.after(async()=>{await controller.close();await store.close();await rm(dir,{recursive:true,force:true});});
 const interaction=(customId='coast:private',userId=id.player,channelId=id.thread,extra={})=>{const replies=[];return{id:String(100000000000000000n+BigInt(++serial)),customId,user:{id:userId},channelId,guildId:id.guildId,applicationId:id.applicationId,message:{author:{id:id.applicationId}},replies,deferReply:async function(body){this.ack=body;this.deferred=true;},reply:async b=>replies.push(b),editReply:async b=>replies.push(b),...extra};};
 return{controller,store,threads,members,render,interaction,client,checks:()=>checks};
}
test('owner can shop from their private thread with fresh checks and private replies',async t=>{
 const f=await fixture(t),i=f.interaction();await f.controller.handleInteraction(i);
 assert.equal(i.ack.flags,64);const buy=walk(i.replies[0]).find(c=>c.type===3);assert.ok(buy);
 const action=f.interaction(buy.custom_id,id.player,id.thread,{values:['rope']});await f.controller.handleInteraction(action);
 assert.equal(f.store.view({role:'player',actorId:'mara'}).personal.coins,19);assert.ok(f.checks()>=5);
});
test('DM desk works only for designated DM in its bound thread',async t=>{
 const f=await fixture(t),dm=f.interaction('coast:private',id.gmUserId,id.dmThreadId);await f.controller.handleInteraction(dm);assert.match(JSON.stringify(dm.replies),/DM desk/);
 for(const [user,thread]of[[id.player,id.dmThreadId],[id.other,id.thread],[id.gmUserId,id.thread]]){
  const i=f.interaction('coast:private',user,thread);await f.controller.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);assert.doesNotMatch(JSON.stringify(i.replies),/DM desk|coins/);
 }
});
test('public private-panel buttons lead to the one assigned thread without private content',async t=>{
 const f=await fixture(t);
 for(const [owner,thread]of[[id.player,id.thread],[id.gmUserId,id.dmThreadId]])for(const kind of['private','recall']){
  const i=f.interaction('coast:'+kind,owner,id.channelId);await f.controller.handleInteraction(i);
  const link=walk(i.replies[0]).find(c=>c.style===5);assert.equal(link.url,`https://discord.com/channels/${id.guildId}/${thread}`);
  assert.doesNotMatch(JSON.stringify(i.replies),/coins|prepared locations|pending requests/);
 }
});
test('private controls cannot be replayed in public even by their owner',async t=>{
 const f=await fixture(t),i=f.interaction();await f.controller.handleInteraction(i);const buy=walk(i.replies[0]).find(c=>c.type===3);
 const replay=f.interaction(buy.custom_id,id.player,id.channelId,{values:['rope']});await f.controller.handleInteraction(replay);
 assert.match(JSON.stringify(replay.replies),/no longer available/);assert.equal(f.store.view({role:'player',actorId:'mara'}).personal.coins,20);
});
test('wrong parent, public type, foreign owner, invites and archives reject access',async t=>{
 const f=await fixture(t),thread=f.threads.get(id.thread);
 for(const [key,value]of[['parentId',id.channelId],['type',11],['ownerId',id.player],['invitable',true],['archived',true]]){
  const old=thread[key];thread[key]=value;const i=f.interaction();await f.controller.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);thread[key]=old;
 }
});
test('removal while rendering discards the image before delivery',async t=>{
 const f=await fixture(t);f.render.scene=async()=>{f.members.delete(id.player);return Buffer.from('private scene');};
 const i=f.interaction('coast:scene');await f.controller.handleInteraction(i);assert.match(JSON.stringify(i.replies),/no longer available/);assert.ok(!i.replies.some(r=>r.files));
});
test('duplicate thread and missing parent bindings fail at mount',async t=>{
 const f=await fixture(t);
 for(const bad of[{...config(),dmThreadId:id.thread},{...config(),parentChannelId:undefined},{...config(),dmThreadId:id.channelId}])assert.throws(()=>createDiscordTable({client:f.client,store:f.store,config:bad}),/thread|parent/i);
});
