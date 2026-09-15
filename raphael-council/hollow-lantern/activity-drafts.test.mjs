import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';
import {createActivityDraftBoundary,isActivityDraftAction} from './activity-drafts.mjs';

const scope={campaignId:'camp',userId:'player',actorId:'hero',audience:'player'};
const action=()=>({id:'inspect',type:'interact',payload:{targetId:'door'},fields:[{id:'text',multiline:true,maxLength:1500}]});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'activity-drafts-'));const store=await createInvestigationDraftStore({file:join(dir,'drafts.json')});
 t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
 let allowed=true,revision=3,actions=[action()],commands=[],hook=()=>{},commits=0;
 const service={project:async()=>({revision,actions}),command:async request=>{commands.push(structuredClone(request));await hook(request);return {commandId:request.commandId,revision:4,result:{message:'Recorded'}};}};
 const options={draftStore:store,service,authorize:async()=>allowed,gmUserId:'gm',onCommit:async({scope:committedScope,receipt})=>{assert.deepEqual(committedScope,scope);assert.equal(receipt.revision,4);commits++;}};
 const boundary=createActivityDraftBoundary(options);
 return {store,boundary,options,service,commands,get commits(){return commits;},deny(){allowed=false;},advance(){revision++;},changeAction(){actions=[{...action(),payload:{targetId:'other'}}];},hook(fn){hook=fn;},save:()=>boundary.save(scope,{entry:{revision:3,actions:[action()]},actionId:'inspect',input:{text:'Look around carefully'},expectedDraftVersion:null})};
}
test('eligibility excludes mechanical and GM/proxy contexts',async t=>{
 const f=await fixture(t);assert.equal(isActivityDraftAction(action()),true);
 for(const a of [{...action(),type:'move'},{...action(),fields:[{id:'text',kind:'select',multiline:true,maxLength:1500}]}])assert.equal(isActivityDraftAction(a),false);
 for(const s of [{...scope,userId:'gm'},{...scope,gmController:true},{...scope,audience:'public'},{...scope,actorId:''}]){assert.equal(f.boundary.enabled(s),false);await assert.rejects(()=>f.boundary.get(s),e=>e.status===403);}
});
test('save preserves old context, commands zero, stale Try requires explicit fresh save',async t=>{
 const f=await fixture(t);f.advance();const draft=await f.save();assert.equal(draft.expectedRevision,3);assert.equal(f.commands.length,0);
 await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===409);assert.equal(f.commands.length,0);
 const next=await f.boundary.save(scope,{entry:{revision:4,actions:[action()]},actionId:'inspect',input:{text:'Reviewed'},expectedDraftVersion:draft.version});
 const result=await f.boundary.tryDraft(scope,next);assert.equal(result.draft.status,'completed');assert.equal(f.commands.length,1);assert.equal(f.commits,1);
 await f.boundary.tryDraft(scope,result.draft);assert.equal(f.commands.length,1);
});
test('same revision changed payload is rejected before prepare',async t=>{
 const f=await fixture(t),draft=await f.save();f.changeAction();await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===409);assert.equal(f.commands.length,0);
});
test('lost response recovers original command across boundary instances and changed world',async t=>{
 const f=await fixture(t),draft=await f.save();f.hook(()=>{throw new Error('private engine detail');});
 await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===409&&!e.message.includes('private engine'));
 const prepared=await f.boundary.get(scope);f.advance();f.hook(()=>{});
 const other=createActivityDraftBoundary(f.options);const result=await other.tryDraft(scope,prepared);
 assert.equal(result.draft.status,'completed');assert.deepEqual(f.commands[0],f.commands[1]);
});
test('lost-response replay completes without duplicate commit notification',async t=>{
 const f=await fixture(t),draft=await f.save();f.hook(()=>{throw new Error('response lost');});
 await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===409);
 const prepared=await f.boundary.get(scope),original=f.commands[0];
 f.service.command=async request=>{assert.deepEqual(request,original);return {commandId:request.commandId,revision:4,replayed:true,result:{message:'Recorded'}};};
 const result=await f.boundary.tryDraft(scope,prepared);
 assert.equal(result.draft.status,'completed');assert.equal(result.receipt.replayed,true);assert.equal(f.commits,0);
 await f.boundary.tryDraft(scope,result.draft);assert.equal(f.commits,0);
});
test('parallel retries across instances dispatch once',async t=>{
 const f=await fixture(t),draft=await f.save(),other=createActivityDraftBoundary(f.options);
 const results=await Promise.allSettled([f.boundary.tryDraft(scope,draft),other.tryDraft(scope,draft)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length>=1,true);assert.equal(f.commands.length,1);
});
test('unconfirmed receipt remains prepared and late revocation suppresses completion',async t=>{
 const f=await fixture(t),draft=await f.save();f.service.command=async()=>({commandId:'wrong',revision:4});
 await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===409);const prepared=await f.boundary.get(scope);assert.equal(prepared.status,'prepared');
 f.service.command=async request=>{f.deny();return {commandId:request.commandId,revision:4};};
 await assert.rejects(()=>f.boundary.tryDraft(scope,prepared),e=>e.status===403);
 assert.equal((await f.store.get({...scope,role:'player',visibility:'private'})).status,'prepared');
});
test('presentation failure leaves confirmed completion and duplicate has no command',async t=>{
 const f=await fixture(t),draft=await f.save();const b=createActivityDraftBoundary({...f.options,onCommit:async()=>{throw new Error('notification unavailable');}});
 const result=await b.tryDraft(scope,draft);assert.equal(result.draft.status,'completed');assert.equal(result.receipt.commandId,f.commands[0].commandId);
 await b.tryDraft(scope,result.draft);assert.equal(f.commands.length,1);
});
test('absent or invalid receipt identity and revision never complete',async t=>{
 const f=await fixture(t),draft=await f.save();let saved=draft;
 for(const invalid of [undefined,{}, {commandId:undefined,revision:4}, {revision:-1}, {revision:1.5}, {revision:Number.MAX_SAFE_INTEGER+1}]){
  f.service.command=async request=>invalid===undefined?undefined:{commandId:request.commandId,...invalid};
  await assert.rejects(()=>f.boundary.tryDraft(scope,saved),e=>e.status===409);saved=await f.boundary.get(scope);assert.equal(saved.status,'prepared');
 }
});
test('authorization revoked during project prevents dispatch',async t=>{
 const f=await fixture(t),draft=await f.save();f.service.project=async()=>{f.deny();return {revision:3,actions:[action()]};};
 await assert.rejects(()=>f.boundary.tryDraft(scope,draft),e=>e.status===403);assert.equal(f.commands.length,0);
});
