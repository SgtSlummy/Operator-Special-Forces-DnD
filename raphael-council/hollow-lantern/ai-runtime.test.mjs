import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCampaignAI} from './ai-runtime.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(options={}){
 const directory=await mkdtemp(join(tmpdir(),'hollow-ai-runtime-')),states=new Map(),events=[],plans=[],renderAssets={publicSceneArts:{}};let observer,open=false,member=true,partyOptions,imageOptions,revision=4,scene='briefing';
 const blank=()=>({bootEpoch:'11111111-1111-4111-8111-111111111111',generation:null,sessionPolicyRevision:0,leaseExpiresAtMs:null});
 const state=session=>states.get(session)??blank();
 const control={
  getRuntime:async({session})=>({...state(session)}),
  register:async input=>{const result={...state(input.session),generation:input.generation,leaseExpiresAtMs:Date.now()+30000};states.set(input.session,result);events.push(['register',input.session]);return result;},
  configure:async input=>{const result={...state(input.session),sessionPolicyRevision:state(input.session).sessionPolicyRevision+1,effectivePolicy:input.policy};states.set(input.session,result);events.push(['policy',input.policy.enabled]);return result;},
  renew:async input=>({...state(input.session),leaseExpiresAtMs:Date.now()+30000}),
  release:async input=>{const previous=state('campaign');if(previous.generation!==input.generation||previous.sessionPolicyRevision!==input.expectedSessionPolicyRevision)throw new Error('release conflict');events.push(['release','campaign']);for(const session of states.keys())states.set(session,{...blank(),sessionPolicyRevision:state(session).sessionPolicyRevision+1});return {...state('campaign')};},
  revoke:async input=>{events.push(['revoke',input.session]);states.set(input.session,blank());},
 };
 const host={engine:{campaignId:'fixture',project:async input=>({audience:input.audience,currentSceneId:scene,revision,decisionOpen:open,pendingActions:[],characters:options.characters??[{characterId:'lantern-fighter',ownerId:'ai-fighter'},{characterId:'lantern-rogue',ownerId:'ai-rogue'},{characterId:'lantern-cleric',ownerId:'ai-cleric'}],secret:'NEVER ART INPUT'})},authorize:async()=>member,
  onCommitted:fn=>{observer=fn;return()=>{observer=null;};},refreshPublic:async input=>{events.push(['public',input]);return true;},
 };
 const transport={runtime:async()=>({contract:'raph-obus-game-runtime-v1',...state('campaign')})};
 const partyFactory=input=>{partyOptions=input;return {start:()=>events.push(['start']),close:()=>events.push(['close']),getPrivateIntents:()=>[],onDecisionOpened:async input=>{plans.push(input);return {status:'complete',committed:[]};}};};
 const imageFactory=input=>{imageOptions=input;return {request:async request=>{events.push(['image',request]);if(options.generate){const receipt={sha256:'c'.repeat(64)};await input.commit({scope:request.scope,image:Buffer.from('fixture candidate bytes'),receipt});return {status:'applied',receipt};}return {status:'retained',reason:'fixture'};}};};
 if(options.active)states.set('campaign',{...blank(),generation:'22222222-2222-4222-8222-222222222222',leaseExpiresAtMs:Date.now()+30000});
 return {directory,events,plans,states,renderAssets,create:()=>createCampaignAI({host,campaignId:'fixture',gmUserId:'dm',baseUrl:'http://127.0.0.1:38178',serviceToken:'a'.repeat(64),hostControlToken:'b'.repeat(64),artDirectory:directory,renderAssets,control,transport,partyFactory,imageFactory}),get partyOptions(){return partyOptions;},get imageOptions(){return imageOptions;},emit:async scope=>{await observer?.({scope,receipt:{commandId:'gm-open-4',revision,success:true,replayed:scope.replayed}});await settle();await settle();},setOpen:value=>open=value,setMember:value=>member=value,setRevision:value=>revision=value,setScene:value=>scene=value,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
test('AI startup is inert; only a fresh human DM opening can schedule the three-seat opportunity',async()=>{
 const f=await fixture();let ai;
 try{ai=await f.create();assert.equal(f.plans.length,0);f.setOpen(true);
  await f.emit({userId:'ai-fighter',audience:'player',action:'decision'});assert.equal(f.plans.length,0);
  await f.emit({userId:'dm',audience:'gm',action:'decision',replayed:true});assert.equal(f.plans.length,0);
  await f.emit({userId:'dm',audience:'gm',action:'decision'});assert.equal(f.plans.length,1);assert.equal(f.plans[0].opportunityId,'gm-open-4');
  assert.equal(await f.partyOptions.authorizeAI({actorId:'lantern-rogue',userId:'ai-fighter'}),false);
  f.setMember(false);assert.deepEqual(await f.partyOptions.getGate(),{decisionOpen:false});
 }finally{await ai?.close();await f.cleanup();}
});
test('scene art uses the public view and approved brief without secret projection data',async()=>{
 const f=await fixture();let ai;
 try{ai=await f.create();await ai.requestSceneArt();const request=f.events.find(e=>e[0]==='image')[1];assert.equal(request.scope.audience,'public');assert.equal(request.scope.characterId,'');
  assert.equal(await f.imageOptions.authorize({...request.scope,audience:'gm'}),false);
  const brief=f.imageOptions.prepare(request.scope);assert.equal(brief.approved,true);assert(!JSON.stringify(brief).includes('NEVER ART INPUT'));
  assert.equal(f.imageOptions.prepare({...request.scope,sceneId:'secret-vault'}).approved,false);
  const headers=f.imageOptions.hostHeaders({...request,contract:'raph-obus-game-image-v1'});assert.match(headers['X-Obus-Game-Host-Signature'],/^[0-9a-f]{64}$/);
 }finally{await ai?.close();assert(f.events.some(e=>e[0]==='revoke'));assert.deepEqual(f.events.at(-1),['release','campaign']);await f.cleanup();}
});
test('a second runtime cannot replace another live campaign AI generation',async()=>{
 const f=await fixture({active:true});try{await assert.rejects(f.create(),/still active/);assert.equal(f.events.length,0);}finally{await f.cleanup();}
});

test('graceful close releases its master immediately; delayed old close never releases a replacement',async()=>{
 const f=await fixture();let first,second;
 try{first=await f.create();const generation=f.states.get('campaign').generation;await first.close();assert.equal(first.status().leaseReleased,true);assert.equal(f.states.get('campaign').generation,null);
  second=await f.create();assert.notEqual(f.states.get('campaign').generation,generation);const replacement=f.states.get('campaign').generation;await first.close();assert.equal(f.states.get('campaign').generation,replacement);
  // A still-open older instance can also observe that another generation now owns the host.
  f.states.set('campaign',{...f.states.get('campaign'),generation:'44444444-4444-4444-8444-444444444444'});const releases=f.events.filter(e=>e[0]==='release').length;await second.close();assert.equal(f.events.filter(e=>e[0]==='release').length,releases);assert.equal(f.states.get('campaign').generation,'44444444-4444-4444-8444-444444444444');
 }finally{await first?.close();await second?.close();await f.cleanup();}
});

test('authored travel queues one public candidate per committed scene change, not per action label',async()=>{
 const f=await fixture();let ai;
 try{ai=await f.create();assert.equal(f.events.filter(e=>e[0]==='image').length,0);
  f.setScene('coastal-road');f.setRevision(5);await f.emit({userId:'dm',audience:'gm',action:'ruling:travel-accepted'});
  assert.equal(f.events.filter(e=>e[0]==='image').length,1);const request=f.events.find(e=>e[0]==='image')[1];assert.equal(request.scope.sceneId,'coastal-road');assert.equal(request.scope.revision,5);assert(!JSON.stringify(request).includes('NEVER ART INPUT'));
  await f.emit({userId:'dm',audience:'gm',action:'ruling:travel-accepted'});f.setRevision(6);await f.emit({userId:'dm',audience:'gm',action:'checkpoint'});
  assert.equal(f.events.filter(e=>e[0]==='image').length,1);assert.equal(f.plans.length,0);
 }finally{await ai?.close();await f.cleanup();}
});

test('revoked membership never queues travel art, and restart retains approved art without an initial job',async()=>{
 const f=await fixture();let ai;
 try{f.renderAssets.publicSceneArts.briefing='approved-original.png';ai=await f.create();assert.equal(f.events.filter(e=>e[0]==='image').length,0);
  f.setMember(false);f.setScene('coastal-road');f.setRevision(5);await f.emit({userId:'dm',audience:'gm',action:'ruling:travel'});assert.equal(f.events.filter(e=>e[0]==='image').length,0);
  f.setMember(true);await ai.close();ai=await f.create();assert.equal(f.events.filter(e=>e[0]==='image').length,0);assert.equal(f.renderAssets.publicSceneArts.briefing,'approved-original.png');
  f.setScene('briefing');f.setRevision(6);await f.emit({userId:'dm',audience:'gm',action:'ruling:return'});assert.equal(f.events.filter(e=>e[0]==='image').length,0);
 }finally{await ai?.close();await f.cleanup();}
});

test('a late travel illustration cannot stage or install pixels after a newer scene commits',async()=>{
 const f=await fixture();let ai;
 try{ai=await f.create();f.setScene('coastal-road');f.setRevision(5);await f.emit({userId:'dm',audience:'gm',action:'ruling:travel'});
  const old=f.events.find(e=>e[0]==='image')[1];f.setScene('signal-dungeon');f.setRevision(6);await f.emit({userId:'dm',audience:'gm',action:'ruling:travel-again'});
  assert.equal(f.events.filter(e=>e[0]==='image').length,2);assert.equal(await f.imageOptions.commit({scope:old.scope,image:Buffer.from('late'),receipt:{}}),false);assert.equal((await ai.getArtReview({userId:'dm'})).status,'empty');assert.deepEqual(f.renderAssets.publicSceneArts,{});
 }finally{await ai?.close();await f.cleanup();}
});

test('generation stages a private candidate; only one current DM approval publishes its pixels',async()=>{
 const f=await fixture({generate:true});let ai;
 try{ai=await f.create();const result=await ai.requestSceneArt();assert.equal(result.status,'awaiting-review');assert.deepEqual(f.renderAssets.publicSceneArts,{});assert.equal(f.events.filter(e=>e[0]==='public').length,0);
  const review=await ai.getArtReview({userId:'dm'});assert.equal(review.candidateId,result.candidateId);assert(Buffer.isBuffer(review.image));assert(!('file'in review));
  await assert.rejects(ai.getArtReview({userId:'player'}),/current DM/);await assert.rejects(ai.approveArt({userId:'player',candidateId:review.candidateId}),/current DM/);
  const results=await Promise.allSettled([ai.approveArt({userId:'dm',candidateId:review.candidateId}),ai.approveArt({userId:'dm',candidateId:review.candidateId})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(f.renderAssets.publicSceneArts.briefing,/candidate-/);assert.deepEqual(f.events.filter(e=>e[0]==='public'),[['public',{committedRevision:4,forcePresentation:true}]]);
  assert.equal((await ai.getArtReview({userId:'dm'})).status,'empty');
 }finally{await ai?.close();await f.cleanup();}
});

test('stale, changed-scene, and revoked art candidates cannot replace approved art',async()=>{
 for(const change of ['revision','scene','membership']){const f=await fixture({generate:true});let ai;
  try{ai=await f.create();const result=await ai.requestSceneArt();f.renderAssets.publicSceneArts.briefing='approved-original.png';
   if(change==='revision')f.setRevision(5);else if(change==='scene')f.setScene('coastal-road');else f.setMember(false);
   await assert.rejects(ai.approveArt({userId:'dm',candidateId:result.candidateId}));assert.equal(f.renderAssets.publicSceneArts.briefing,'approved-original.png');assert.equal(f.events.filter(e=>e[0]==='public').length,0);
  }finally{await ai?.close();await f.cleanup();}
 }
});

test('keeping current artwork declines the candidate without publishing',async()=>{
 const f=await fixture({generate:true});let ai;
 try{ai=await f.create();const result=await ai.requestSceneArt();assert.equal((await ai.declineArt({userId:'dm',candidateId:result.candidateId})).status,'retained');assert.deepEqual(f.renderAssets.publicSceneArts,{});await assert.rejects(ai.approveArt({userId:'dm',candidateId:result.candidateId}));assert.equal(f.events.filter(e=>e[0]==='public').length,0);
 }finally{await ai?.close();await f.cleanup();}
});

test('authoritative mixed ownership reduces roster and revokes only the retired child lease',async()=>{const f=await fixture({characters:[{characterId:'lantern-fighter',ownerId:'human'},{characterId:'lantern-rogue',ownerId:'ai-rogue'},{characterId:'lantern-cleric',ownerId:'ai-cleric'}]});let ai;try{ai=await f.create();const gate=await f.partyOptions.getGate();assert.deepEqual(gate.eligibleActorIds,['lantern-rogue','lantern-cleric']);assert.equal(gate.characters,undefined);await f.partyOptions.provisionSession({session:'retired-fighter'});await f.partyOptions.revokeSession({session:'retired-fighter'});assert.ok(f.events.some(e=>e[0]==='revoke'&&e[1]==='retired-fighter'));assert.ok(f.states.get('campaign').generation);}finally{await ai?.close();await f.cleanup();}});
