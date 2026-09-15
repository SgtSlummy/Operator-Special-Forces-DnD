import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCoastActivity} from './table-activity.mjs';
import {openTableStore} from './table-store.mjs';
import {previewState} from './table-server.mjs';
import {createDiscordTable} from './table-discord.mjs';
import {CATALOG} from './catalog.mjs';
const origin='https://coast.example',config={guildId:'111111111111111111',channelId:'222222222222222222',applicationId:'333333333333333333',gmUserId:'444444444444444444',members:[{ownerId:'555555555555555555',actorId:'mara'},{ownerId:'666666666666666666',actorId:'ivo'}]};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'coast-activity-')),store=await openTableStore({catalog:CATALOG,stateFile:join(dir,'state.json'),seed:previewState});
 const sessions=new Map([['mara',{owner:config.members[0].ownerId,role:'player',campaign:'the-unwritten-coast'}],['ivo',{owner:config.members[1].ownerId,role:'player',campaign:'the-unwritten-coast'}],['gm',{owner:config.gmUserId,role:'host',campaign:'the-unwritten-coast'}]]);
 const allowed=new Set([...sessions.values()].map(s=>s.owner));
 const client={
  user:{id:config.applicationId},
  guilds:{fetch:async()=>({
   members:{fetch:async({user,force,cache})=>{
    assert.equal(force,true);assert.equal(cache,false);
    if(!allowed.has(user))throw Object.assign(Error('removed'),{status:403});
    return {id:user,user:{bot:false}};
   }}
  })}
 };
 const render={scene:async()=>Buffer.from('scene'),tactical:async()=>Buffer.from('map'),combat:async()=>Buffer.from('combat'),architecture:async()=>'<svg/>'};
 const runtime=createCoastActivity({store,client,config,origin,render,auth:{authenticate:async request=>sessions.get(request.headers.get('cookie'))}});
 const discord=createDiscordTable({client,store,config,render});
 t.after(async()=>{runtime.close();await discord.close();await store.close();await rm(dir,{recursive:true,force:true});});
 const call=(op,{owner='mara',query='',body,headers={}}={})=>runtime.handle(op,new Request(origin+'/api/'+op+query,{method:body?'POST':'GET',headers:{cookie:owner,...(body?{origin,'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}));
 const gm=action=>store.execute({role:'gm'},{...action,revision:store.view().state.revision});
 return{store,runtime,discord,call,gm,render,sessions,allowed};
}
test('authenticated view excludes other loot and DM preparation; query cannot choose another actor',async t=>{
 const f=await fixture(t);await f.gm({type:'award',actorId:'ivo',name:'Ivo secret gem',source:'Private'});
 const response=await f.call('view',{query:'?actorId=ivo&role=gm'}),view=await response.json();
 assert.equal(response.status,200);assert.equal(view.identity.actorId,'mara');assert.equal(view.preview,false);assert.equal(view.preparation,undefined);assert.doesNotMatch(JSON.stringify(view),/Ivo secret gem/);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('web purchase updates the same Discord inventory and a retry spends once',async t=>{
 const f=await fixture(t),view=await(await f.call('view')).json(),body={viewToken:view.viewToken,commandId:'11111111-1111-4111-8111-111111111111',action:{type:'buy',itemId:'rope',revision:view.state.revision}};
 assert.equal((await f.call('action',{body})).status,200);assert.equal((await f.call('action',{body})).status,200);
 let reply;await f.discord.handleInteraction({customId:'coast:private',...config,user:{id:config.members[0].ownerId},message:{author:{id:config.applicationId}},deferReply:async()=>{},editReply:async body=>{reply=body;}});
 assert.match(JSON.stringify(reply),/19 coins/);assert.match(JSON.stringify(reply),/50 feet of hemp rope/);assert.equal(f.store.view({role:'player',actorId:'ivo'}).personal.coins,20);
});
test('copied session token and cross-origin action cannot mutate state',async t=>{
 const f=await fixture(t),view=await(await f.call('view')).json(),body={viewToken:view.viewToken,commandId:'11111111-1111-4111-8111-111111111112',action:{type:'buy',itemId:'rope',revision:view.state.revision}};
 assert.equal((await f.call('action',{owner:'ivo',body})).status,409);assert.equal((await f.call('action',{body,headers:{origin:'https://elsewhere.example'}})).status,403);assert.equal(f.store.view().state.revision,view.state.revision);
 f.sessions.set('second-mara',f.sessions.get('mara'));assert.equal((await f.call('action',{owner:'second-mara',body})).status,409);
});
test('hidden map is rejected and revoked membership discards rendered bytes',async t=>{
 const f=await fixture(t),view=await(await f.call('view')).json();
 assert.equal((await f.call('card',{query:'?viewToken='+view.viewToken+'&room=R18'})).status,404);
 f.render.scene=async()=>{f.allowed.delete(config.members[0].ownerId);return Buffer.from('must not deliver');};
 const response=await f.call('card',{query:'?viewToken='+view.viewToken+'&room=t-tavern'});assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/must not deliver/);
});
test('Raphael stays scoped and old illustrations require a refreshed view',async t=>{
 const f=await fixture(t),view=await(await f.call('view')).json();await f.gm({type:'award',actorId:'ivo',name:'Private ruby',source:'Hidden reward'});
 assert.equal((await f.call('card',{query:'?viewToken='+view.viewToken})).status,409);
 const newer=await(await f.call('view')).json(),recall=await f.call('recall',{query:'?viewToken='+newer.viewToken});assert.equal(recall.status,200);assert.doesNotMatch(await recall.text(),/Private ruby|Hidden reward/);
});
test('wrong campaign, absent sign-in and non-host DM session are refused',async t=>{
 const f=await fixture(t);assert.equal((await f.call('view',{owner:''})).status,401);
 f.sessions.get('mara').campaign='operation-hollow-lantern';assert.equal((await f.call('view')).status,401);
 f.sessions.get('gm').role='player';assert.equal((await f.call('view',{owner:'gm'})).status,403);
});
