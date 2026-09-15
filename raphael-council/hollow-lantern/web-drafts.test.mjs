import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWebTable} from './web-server.mjs';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';
const scope={campaignId:'fixture',userId:'player',actorId:'hero',audience:'player'};
const storedScope={campaignId:'fixture',userId:'player',actorId:'hero',role:'player',visibility:'private'};
const action={id:'describe',type:'describe',group:'describe',label:'Describe Action',payload:{},fields:[{id:'text',label:'Your intention',multiline:true,maxLength:1500}]};
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'web-drafts-')),store=await createInvestigationDraftStore({file:join(directory,'drafts.json')});
 const f={store,revision:2,allowed:true,commands:[],actions:[structuredClone(action)],fail:false};
 f.host={gmUserId:'dm',authorize:async()=>f.allowed,service:{project:async s=>({campaignId:'fixture',revision:f.revision,sceneId:'room',audience:s.audience,actions:f.actions,controllableActors:[{id:'hero'}],map:{level:'dungeon',nodes:[],edges:[]}}),command:async input=>{f.commands.push(input);if(f.fail)throw Error('NETWORK_UNCERTAIN');return {commandId:input.commandId,revision:++f.revision,result:{message:'Recorded'}};}}};
 f.start=async(draftStore=store)=>{f.table=createWebTable({getHost:()=>f.host,port:await port(),draftStore});await f.table.start();};await f.start();
 f.signin=async(s=scope)=>{const link=await f.table.webLink(s),code=new URLSearchParams(new URL(link).hash.slice(1)).get('code');const r=await fetch(f.table.origin+'/api/session',{method:'POST',headers:{Origin:f.table.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 f.cookie=await f.signin();
 f.request=async(path,input,cookie=f.cookie,origin=f.table.origin)=>{const r=await fetch(f.table.origin+path,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,value:await r.json()};};
 f.view=async()=>{const r=await f.request('/api/view');assert.equal(r.status,200);return r.value;};
 f.save=async(view,text='I examine the markings.',version=null)=>f.request('/api/draft/save',{viewToken:view.viewToken,actionId:'describe',input:{text},expectedDraftVersion:version});
 t.after(async()=>{await f.table.close();await store.close();await rm(directory,{recursive:true,force:true});});return f;
}
test('HTTP draft save and map viewing make no commands; stale context requires explicit rebase',async t=>{
 const f=await fixture(t),view=await f.view();assert.equal(view.draftEnabled,true);f.revision=3;
 const saved=await f.save(view);assert.equal(saved.status,200);assert.equal(saved.value.draft.expectedRevision,2);assert.equal(saved.value.draft.scope,undefined);
 const next=await f.view();const read=await f.request('/api/draft');assert.equal(read.value.draft.expectedRevision,2);assert.equal(f.commands.length,0);
 const map=await fetch(f.table.origin+'/api/map?level=dungeon&viewToken='+(await f.request('/api/view?level=dungeon')).value.viewToken,{headers:{Cookie:f.cookie}});assert.equal(map.status,200);await map.arrayBuffer();assert.equal(f.commands.length,0);
 const rejected=await f.request('/api/draft/try',{draftId:saved.value.draft.draftId,version:saved.value.draft.version});assert.equal(rejected.status,409);assert.equal((await f.request('/api/draft')).value.draft.status,'editing');
 const rebased=await f.save(next,'I examine the markings.',saved.value.draft.version);assert.equal(rebased.status,200);assert.equal(rebased.value.draft.expectedRevision,3);assert.equal(f.commands.length,0);
});
test('HTTP uses saved view snapshots, optimistic versions and current allowed input fields',async t=>{
 const f=await fixture(t),view=await f.view();f.actions[0].payload={changed:true};
 const saved=await f.save(view,'秘密'.repeat(500));assert.equal(saved.status,200);assert.deepEqual(saved.value.draft.actionPayload,{});
 assert.equal((await f.save(view,'competing edit')).status,409);
 assert.equal((await f.request('/api/draft/save',{viewToken:view.viewToken,actionId:'describe',input:{text:'text',actorId:'other'},expectedDraftVersion:saved.value.draft.version})).status,400);
 assert.equal((await f.request('/api/draft/try',{draftId:saved.value.draft.draftId,version:saved.value.draft.version})).status,409);assert.equal(f.commands.length,0);
});
test('HTTP draft authority comes only from private session; CSRF, body identity, public and DM actor denied',async t=>{
 const f=await fixture(t),view=await f.view();const body={viewToken:view.viewToken,actionId:'describe',input:{text:'secret'},expectedDraftVersion:null};
 assert.equal((await f.request('/api/draft/save',body,f.cookie,'https://foreign.example')).status,403);
 assert.equal((await f.request('/api/draft/save',{...body,userId:'other'})).status,400);
 const saved=await f.save(view);assert.equal(saved.status,200);
 const other=await f.signin({...scope,userId:'other'});assert.equal((await f.request('/api/draft',undefined,other)).value.draft,null);
 assert.equal((await f.request('/api/draft/try',{draftId:saved.value.draft.draftId,version:saved.value.draft.version},other)).status,409);
 const otherSeat=await f.signin({...scope,actorId:'other'});assert.equal((await f.request('/api/draft',undefined,otherSeat)).value.draft,null);
 for(const s of [{...scope,actorId:'npc',gmController:true},{...scope,audience:'public'},{...scope,userId:'dm',audience:'player'},{...scope,userId:'dm',audience:'gm',actorId:undefined}]){const c=await f.signin(s);assert.equal((await f.request('/api/draft',undefined,c)).status,403);assert.equal((await f.request('/api/view',undefined,c)).value.draftEnabled,false);assert.equal((await f.request('/api/draft/save',body,c)).status,403);assert.equal((await f.request('/api/draft/try',{draftId:saved.value.draft.draftId,version:saved.value.draft.version},c)).status,403);if(s.audience==='gm'){assert.equal((await f.request('/api/actor',{actorId:'hero'},c)).status,200);assert.equal((await f.request('/api/draft',undefined,c)).status,403);}}
 f.allowed=false;assert.equal((await f.request('/api/draft')).status,401);assert.equal(f.commands.length,0);
});
test('HTTP prepared retry after session restart preserves native intent identity and completed repeats do not command',async t=>{
 const f=await fixture(t);const saved=await f.store.save(storedScope,{actionId:'describe',actionPayload:{},input:{text:'Native saved intention'},expectedRevision:2});
 const prepared=await f.store.prepare(storedScope,{draftId:saved.draftId,version:saved.version,currentRevision:2,availableActionIds:['describe']});
 f.revision=3;f.fail=true;const input={draftId:prepared.draftId,version:prepared.version};assert.equal((await f.request('/api/draft/try',input)).status,400);
 await f.table.close();await f.start();f.cookie=await f.signin();assert.equal((await f.request('/api/draft')).value.draft.status,'prepared');
 f.fail=false;const completed=await f.request('/api/draft/try',input);assert.equal(completed.status,200);assert.equal(completed.value.draft.status,'completed');assert.ok(completed.value.draft.receipt.result);
 assert.equal(f.commands.length,2);assert.equal(f.commands[0].commandId,prepared.intent.commandId);assert.deepEqual(f.commands[1],f.commands[0]);assert.equal(f.commands[1].expectedRevision,2);
 assert.equal((await f.request('/api/draft/try',input)).status,200);assert.equal(f.commands.length,2);
});
test('revocation after preparing or dispatching preserves the original uncertain draft without delivery',async t=>{
 for(const after of ['prepare','command']){
  const f=await fixture(t);
  if(after==='prepare'){await f.table.close();await f.start({...f.store,prepare:async(...args)=>{const d=await f.store.prepare(...args);f.allowed=false;return d;}});f.cookie=await f.signin();}
  else f.host.service.command=async input=>{f.commands.push(input);f.allowed=false;return {commandId:input.commandId,revision:3,result:{message:'Recorded'}};};
  const saved=(await f.save(await f.view())).value.draft;
  assert.equal((await f.request('/api/draft/try',{draftId:saved.draftId,version:saved.version})).status,403);
  assert.equal((await f.store.get(storedScope)).status,'prepared');assert.equal(f.commands.length,after==='prepare'?0:1);
 }
});
test('unidentified receipts remain prepared and concurrent Try requests reuse one dispatch',async t=>{
 const f=await fixture(t),saved=(await f.save(await f.view())).value.draft,input={draftId:saved.draftId,version:saved.version};
 f.host.service.command=async command=>{f.commands.push(command);return {ok:true};};
 assert.equal((await f.request('/api/draft/try',input)).status,409);assert.equal((await f.store.get(storedScope)).status,'prepared');
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.host.service.command=async command=>{f.commands.push(command);enter();await gate;return {commandId:command.commandId,revision:3,result:{message:'Recorded'}};};
 const first=f.request('/api/draft/try',input);await entered;const second=f.request('/api/draft/try',input);await new Promise(r=>setTimeout(r,20));release();
 assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(f.commands.length,2);assert.equal(f.commands[0].commandId,f.commands[1].commandId);
});
test('logout during a dispatched intention suppresses delivery and retains recovery state',async t=>{
 const f=await fixture(t),saved=(await f.save(await f.view())).value.draft;
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.host.service.command=async input=>{enter();await gate;return {commandId:input.commandId,revision:3,result:{message:'Recorded'}};};
 const trying=f.request('/api/draft/try',{draftId:saved.draftId,version:saved.version});await entered;
 assert.equal((await f.request('/api/logout',{})).status,200);release();assert.equal((await trying).status,403);
 assert.equal((await f.store.get(storedScope)).status,'prepared');
});
test('configured private written actions cannot bypass review; ordinary mechanics retain direct route',async t=>{
 const f=await fixture(t);f.actions.push({id:'move',type:'move',payload:{x:1,y:2},fields:[]});const view=await f.view();
 const command={action:'describe',payload:{text:'bypass'},revision:2,commandId:'11111111-1111-4111-8111-111111111111',viewToken:view.viewToken};assert.equal((await f.request('/api/action',command)).status,409);assert.equal(f.commands.length,0);
 assert.equal((await f.request('/api/action',{...command,action:'move',payload:{x:1,y:2}})).status,200);assert.equal(f.commands.length,1);
});
