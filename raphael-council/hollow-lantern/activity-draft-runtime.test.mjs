import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createActivityRuntime} from './activity-runtime.mjs';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';

const origin='https://123456789012345678.discordsays.com';
const text='I study the inscription before touching the mechanism.';
const scope={campaignId:'hollow',userId:'player',actorId:'one',role:'player',visibility:'private'};
async function fixture(t,{enabled=true,revokeAt}={}){
 const directory=await mkdtemp(join(tmpdir(),'activity-draft-runtime-'));
 const store=await createInvestigationDraftStore({file:join(directory,'drafts.json')});
 t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true});});
 let revision=0,member=true,signedIn=true,clock=1000,loseResponse=false;
 const calls=[],commits=[],receipts=new Map();
 const identity={campaign:'hollow',owner:'player',role:'player'};
 const auth={config:{activityOrigin:origin},authenticate:async()=>member&&signedIn?{...identity}:null,member:async()=>member?{...identity}:null};
 const client={campaignId:'hollow',project:async request=>({projectionVersion:2,campaignId:'hollow',revision,audience:request.audience,characterId:request.actorId,currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[{characterId:request.actorId,ownerId:'player',characterType:'player',displayName:'Actor',primaryHealth:10,primaryHealthMaximum:10,position:{x:12,y:12},factionId:'party',resources:{movementFeet:30}}],pendingActions:[]}),command:async request=>{
  calls.push(structuredClone(request));
  if(receipts.has(request.commandId))return {...receipts.get(request.commandId),replayed:true};
  const receipt={revision:++revision,commandId:request.commandId,replayed:false,result:{message:'Recorded'}};receipts.set(request.commandId,receipt);
  if(loseResponse){loseResponse=false;throw new Error('Simulated lost response');}
  return receipt;
 },receipt:async request=>{if(receipts.has(request.commandId))return {...receipts.get(request.commandId),replayed:true};const error=new Error('No receipt');error.code='RECEIPT_NOT_FOUND';throw error;}};
 const borrowedStore={...store};
 for(const operation of ['get','save','prepare','complete'])borrowedStore[operation]=async(...args)=>{const result=await store[operation](...args);if(revokeAt===operation)signedIn=false;return result;};
 const runtime=createActivityRuntime({auth,client,gmUserId:'dm',draftStore:enabled?borrowedStore:undefined,now:()=>clock,onCommit:async event=>commits.push(event)});
 async function request(operation,body,options={}){
  const url=new URL(`${origin}/api/hollow-lantern/${operation}`);url.searchParams.set('actorId',options.actorId??'one');url.searchParams.set('level',options.level??'tactical');
  const response=await runtime.handle(operation,new Request(url,{method:body===undefined?'GET':'POST',headers:{Cookie:options.cookie??'session=a',Origin:options.origin??origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,headers:response.headers,body:await response.json()};
 }
 async function view(options){const result=await request('view',undefined,options);assert.equal(result.status,200);return result.body;}
 async function save(view,extra={},options){return request('draft-save',{viewToken:view.viewToken,actionId:'interact',input:{text},expectedDraftVersion:null,...extra},options);}
 return {store,request,view,save,calls,commits,receipts,identity,advance:()=>revision++,expire:()=>clock+=16*60000,revoke:()=>member=false,lose:()=>loseResponse=true};
}

test('Activity HTTP boundary saves privately into the borrowed store and submits explicitly once',async t=>{
 const f=await fixture(t),view=await f.view();assert.equal(view.draftEnabled,true);assert.ok(view.actions.some(a=>a.id==='interact'));
 const saved=await f.save(view);assert.equal(saved.status,200);assert.equal(saved.body.draft.input.text,text);assert.equal(f.calls.length,0);
 assert.equal((await f.store.get(scope)).input.text,text);
 const reloaded=await f.request('draft');assert.equal(reloaded.body.draft.draftId,saved.body.draft.draftId);assert.equal(reloaded.headers.get('cache-control'),'private, no-store');
 const body={draftId:saved.body.draft.draftId,version:saved.body.draft.version};
 const tried=await f.request('draft-try',body);assert.equal(tried.status,200);assert.equal(tried.body.draft.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.commits.length,1);assert.equal(f.commits[0].scope.userId,'player');
 assert.equal((await f.request('draft-try',body)).status,200);assert.equal(f.calls.length,1);
});

test('Activity draft tokens cannot cross cookies, characters, origins or forged identities',async t=>{
 const f=await fixture(t),view=await f.view();
 assert.equal((await f.save(view,{}, {cookie:'session=b'})).status,409);
 assert.equal((await f.save(view,{}, {actorId:'two'})).status,409);
 assert.equal((await f.save(view,{}, {origin:'https://other.example'})).status,403);
 assert.equal((await f.save(view,{userId:'dm'})).status,400);
 assert.equal((await f.request('draft-try',{draftId:'forged',version:1,actorId:'one'})).status,400);
 assert.equal(await f.store.get(scope),null);assert.equal(f.calls.length,0);
 f.expire();assert.equal((await f.save(view)).status,409);
});

test('changed world keeps saved writing but requires an explicit fresh-context save before Try',async t=>{
 const f=await fixture(t),old=await f.view();f.advance();
 const saved=await f.save(old);assert.equal(saved.status,200);assert.equal(saved.body.draft.expectedRevision,old.revision);
 assert.equal((await f.request('draft-try',{draftId:saved.body.draft.draftId,version:saved.body.draft.version})).status,409);assert.equal(f.calls.length,0);
 const fresh=await f.view(),updated=await f.save(fresh,{expectedDraftVersion:saved.body.draft.version});assert.equal(updated.status,200);
 assert.equal((await f.request('draft-try',{draftId:updated.body.draft.draftId,version:updated.body.draft.version})).status,200);assert.equal(f.calls.length,1);
});

test('lost Activity response recovers the persisted original command without another effect',async t=>{
 const f=await fixture(t),saved=await f.save(await f.view());const body={draftId:saved.body.draft.draftId,version:saved.body.draft.version};
 f.lose();const failed=await f.request('draft-try',body);assert.notEqual(failed.status,200);assert.equal(f.receipts.size,1);
 const prepared=await f.store.get(scope);assert.equal(prepared.status,'prepared');f.advance();
 const recovered=await f.request('draft-try',body);assert.equal(recovered.status,200);assert.equal(recovered.body.draft.status,'completed');assert.equal(f.receipts.size,1);
 assert.ok(f.calls.every(c=>c.commandId===prepared.intent.commandId));assert.ok(f.calls.every(c=>c.expectedRevision===prepared.intent.expectedRevision));
});

test('drafts exclude host, absent store and revoked membership',async t=>{
 const f=await fixture(t);f.identity.owner='dm';f.identity.role='host';
 assert.equal((await f.view()).draftEnabled,false);assert.equal((await f.request('draft')).status,403);
 f.identity.owner='player';f.identity.role='player';const view=await f.view();f.revoke();assert.equal((await f.save(view)).status,401);assert.equal(f.calls.length,0);
 const disabled=await fixture(t,{enabled:false});assert.equal((await disabled.view()).draftEnabled,false);assert.equal((await disabled.request('draft')).status,403);
});

test('session-only logout during persistence blocks dispatch or suppresses private delivery',async t=>{
 for(const stage of ['get','save','prepare','complete']){
  const f=await fixture(t,{revokeAt:stage}),view=await f.view();
  if(stage==='get'){const result=await f.request('draft');assert.equal(result.status,401);assert.equal(result.body.draft,undefined);continue;}
  const saved=await f.save(view);
  if(stage==='save'){assert.equal(saved.status,401);assert.equal(saved.body.draft,undefined);assert.equal((await f.store.get(scope)).input.text,text);assert.equal(f.calls.length,0);continue;}
  assert.equal(saved.status,200);
  const result=await f.request('draft-try',{draftId:saved.body.draft.draftId,version:saved.body.draft.version});
  assert.equal(result.status,401);assert.equal(result.body.draft,undefined);assert.equal(result.body.receipt,undefined);
  assert.equal(f.calls.length,stage==='prepare'?0:1);assert.equal((await f.store.get(scope)).status,stage==='prepare'?'prepared':'completed');
 }
});

test('private written actions cannot bypass Save and Try via the ordinary action route',async t=>{
 const f=await fixture(t),view=await f.view();
 const result=await f.request('action',{viewToken:view.viewToken,revision:view.revision,commandId:'11111111-1111-4111-8111-111111111111',action:'interact',payload:{text}});
 assert.equal(result.status,409);assert.match(result.body.error,/Save and review/);assert.equal(f.calls.length,0);
});
