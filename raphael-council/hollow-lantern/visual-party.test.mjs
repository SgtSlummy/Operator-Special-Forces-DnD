import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createVisualParty} from './visual-party.mjs';
import {openVisualActionStore} from './visual-action-store.mjs';
import {createCampaignAI} from './ai-runtime.mjs';

const actors=['fighter','rogue','cleric'].map(k=>({actorId:'lantern-'+k,ownerId:'ai-'+k}));
const delay=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({choose,uncertain=false,store,eligible=actors.map(a=>a.actorId)}={}){
 const saved=new Map(),opportunities=new Set(),requests=[],clicks=[],browsers=[],leases=[],revocations=[],receipts=new Map();let open=true,member=true,revision=0,active=0,maxConcurrent=0;const ownership=new Map(actors.map(a=>[a.actorId,a.ownerId]));
 store??={get:id=>structuredClone(saved.get(id)??null),set:async(id,p)=>p===null?saved.delete(id):saved.set(id,structuredClone(p)),reserveOpportunity:async id=>{if(opportunities.has(id))return false;opportunities.add(id);return true;}};
 const client={campaignId:'fixture',project:async s=>({campaignId:'fixture',audience:s.audience,characterId:s.actorId,characters:[{characterId:s.actorId,ownerId:ownership.get(s.actorId)}],secret:'CONTROLLER ONLY GM SECRET'}),receipt:async({commandId})=>{if(!receipts.has(commandId))throw Object.assign(Error(),{code:'RECEIPT_NOT_FOUND'});return structuredClone(receipts.get(commandId));}};
 const options={client,campaignId:'fixture',actors,gmUserId:'dm',authorizeAI:async()=>member,getGate:async()=>({decisionOpen:open,eligibleActorIds:eligible}),provisionSession:async s=>leases.push(s),revokeSession:async s=>revocations.push(s),pendingStore:store,webOrigin:'http://127.0.0.1:18796',
  visionTransport:{available:async()=>true,choose:async r=>{requests.push(r);return choose?choose(r):{action:{type:'click',x:100,y:100}};}},
  browserFactory:async o=>{let closed=false;const b={ownerId:o.ownerId,revoked:()=>closed,close:async()=>{closed=true;},screenshot:async()=>({png:Buffer.from(o.ownerId+' PRIVATE PIXELS'),width:1280,height:1000}),act:async action=>{assert(!closed);return o.serializeAction(async()=>{if(!(await o.getGate()).decisionOpen||(await o.getGate()).allowAction===false)return;active++;maxConcurrent=Math.max(active,maxConcurrent);try{const pending={actorId:o.actorId,campaignId:'fixture',commandId:randomUUID(),expectedRevision:revision};await o.onPending(pending);assert.equal(store.get(o.actorId).commandId,pending.commandId);await delay();clicks.push({owner:o.ownerId,action,pending});if(uncertain)throw Error('TRANSPORT_LOST');const receipt={contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:pending.commandId,revision:++revision,success:true,replayed:false};receipts.set(receipt.commandId,receipt);await o.onCommit({receipt});await o.onPending(null);}finally{active--;}});}};browsers.push(b);return b;}
 };
 return {options,create:()=>createVisualParty(options),requests,clicks,browsers,leases,revocations,receipts,store,ownership,maxConcurrent:()=>maxConcurrent,pause:()=>open=false,revoke:()=>member=false};
}

test('three models plan concurrently from own pixels; committed actions serialize and budgets hold',async()=>{
 const barrier=deferred();let planners=0;
 const f=fixture({choose:async r=>{if(++planners===3)barrier.resolve();await barrier.promise;assert.deepEqual(Object.keys(r).sort(),['history','instructions','maxTokens','scope','screenshot','session','signal'].sort());assert(r.screenshot.png.toString().startsWith(r.scope.owner));assert(!JSON.stringify(r).includes('CONTROLLER ONLY'));assert(r.history.every(h=>h.owner===r.scope.owner));return {action:{type:'click',x:100,y:100}};}}),party=f.create();party.start();
 try{const result=await party.onDecisionOpened({opportunityId:'parallel',maxActions:2});assert.equal(planners,3);assert.equal(result.status,'complete');assert.equal(result.committed.length,2);assert.equal(f.clicks.length,2);assert.equal(f.maxConcurrent(),1);assert.equal(new Set(f.requests.map(r=>r.session)).size,3);assert.equal((await party.onDecisionOpened({opportunityId:'parallel'})).status,'already-handled');}finally{await party.close();}
});

test('DM pause while inference is outstanding prevents every late click',async()=>{
 const pending=deferred(),started=deferred();let count=0;const f=fixture({choose:async()=>{if(++count===3)started.resolve();await pending.promise;return {action:{type:'click',x:100,y:100}};}}),party=f.create();party.start();const result=party.onDecisionOpened();await started.promise;f.pause();pending.resolve();assert.equal((await result).committed.length,0);assert.equal(f.clicks.length,0);await party.close();
});

test('ownership reassignment retires its browser/session and reacquisition gets fresh history',async()=>{
 const f=fixture(),party=f.create();party.start();try{await party.onDecisionOpened({opportunityId:'first'});const old=f.leases.find(l=>l.owner==='ai-fighter').session;f.ownership.set('lantern-fighter','human');await party.syncOwnership();assert(f.browsers.find(b=>b.ownerId==='ai-fighter').revoked());assert(f.revocations.some(r=>r.session===old));f.ownership.set('lantern-fighter','ai-fighter');await party.onDecisionOpened({opportunityId:'second'});const requests=f.requests.filter(r=>r.scope.owner==='ai-fighter');assert.notEqual(requests[0].session,requests[1].session);assert.deepEqual(requests[1].history,[]);}finally{await party.close();}
});

test('unknown outcome survives controller restart and no new action occurs until exact receipt recovery',async()=>{
 const f=fixture({uncertain:true}),first=f.create();first.start();const result=await first.onDecisionOpened({opportunityId:'lost'});assert.equal(result.status,'recovery-required');assert.equal(f.clicks.length,1);const pending=f.store.get(f.clicks[0].pending.actorId);await first.close();
 const next=fixture({store:f.store}),second=next.create();second.start();try{assert.equal((await second.onDecisionOpened({opportunityId:'retry'})).status,'recovery-required');assert.equal(next.requests.length,0);next.receipts.set(pending.commandId,{contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:pending.commandId,revision:pending.expectedRevision+1,success:true,replayed:true});assert.equal((await second.onDecisionOpened({opportunityId:'lost'})).status,'already-handled');assert.equal(next.requests.length,0);assert.equal((await second.onDecisionOpened({opportunityId:'recovered'})).status,'complete');assert.equal(next.clicks.length,3);}finally{await second.close();}
});

test('close cancels an opportunity; inference that ignores abort cannot act in a later opportunity',async()=>{
 const pending=deferred(),started=deferred();let count=0;const f=fixture({choose:async()=>{if(++count===3)started.resolve();await pending.promise;return {action:{type:'click',x:100,y:100}};}}),party=f.create();party.start();const result=party.onDecisionOpened({opportunityId:'cancelled'});await started.promise;await party.close();assert.equal((await result).committed.length,0);party.start();assert.equal((await party.onDecisionOpened({opportunityId:'new'})).status,'draining');pending.resolve();await delay();assert.equal(f.clicks.length,0);f.options.visionTransport.choose=async()=>({action:{type:'click',x:100,y:100}});assert.equal((await party.onDecisionOpened({opportunityId:'new'})).committed.length,3);assert.equal(f.clicks.length,3);await party.close();
});

test('missing installed vision capability fails before campaign leases or browsers',async()=>{
 let controlCalls=0;await assert.rejects(createCampaignAI({host:{engine:{},onCommitted(){}},campaignId:'fixture',gmUserId:'dm',artDirectory:join(tmpdir(),'visual-capability'),serviceToken:'a'.repeat(64),hostControlToken:'b'.repeat(64),control:new Proxy({},{get:()=>()=>controlCalls++}),visionTransport:{available:async()=>{throw Error('SCREENSHOT_CAPABILITY_MISSING');}}}),/SCREENSHOT_CAPABILITY_MISSING/);assert.equal(controlCalls,0);
});

test('recovery journal persists parallel seats atomically and rejects corrupt or foreign campaign records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'visual-recovery-')),file=join(dir,'pending.json');try{const options={file,campaignId:'fixture',actors},store=await openVisualActionStore(options),entries=actors.map(a=>({actorId:a.actorId,campaignId:'fixture',commandId:randomUUID(),expectedRevision:2}));assert.equal(await store.reserveOpportunity('dm-window'),true);await Promise.all(entries.map(p=>store.set(p.actorId,p)));const restored=await openVisualActionStore(options);assert.equal(await restored.reserveOpportunity('dm-window'),false);for(const p of entries)assert.deepEqual(restored.get(p.actorId),p);await restored.set(entries[0].actorId,null);const reopened=await openVisualActionStore(options);assert.equal(await reopened.reserveOpportunity('dm-window'),false);assert.equal(reopened.get(entries[0].actorId),null);assert.equal(reopened.get(entries[1].actorId).commandId,entries[1].commandId);assert(!await readFile(file,'utf8').then(s=>s.includes('PRIVATE PIXELS')));await assert.rejects(openVisualActionStore({...options,campaignId:'different'}));await writeFile(file,'broken');await assert.rejects(openVisualActionStore(options));}finally{await rm(dir,{recursive:true,force:true});}
});

test('revocation while the final ownership projection is in flight never reaches the model',async()=>{
 const f=fixture({eligible:['lantern-fighter']}),party=f.create(),waiting=deferred(),release=deferred();let projections=0;const project=f.options.client.project;
 f.options.client.project=async scope=>{const p=await project(scope);if(++projections===1){waiting.resolve();await release.promise;}return p;};
 party.start();const result=party.onDecisionOpened({opportunityId:'revoked-during-view'});await waiting.promise;await party.close();release.resolve();await result;await delay();assert.equal(f.requests.length,0);assert.equal(f.clicks.length,0);
});

test('pending roll stays in one durable budget and only its roller can resolve it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'visual-roll-')),file=join(dir,'actions.json');const store=await openVisualActionStore({file,campaignId:'fixture',actors});
 const f=fixture({store});let pending=null,original=null,revision=0;const dispatched=[];
 f.options.getGate=async()=>({decisionOpen:true,rollPending:Boolean(pending),hasPendingRulings:Boolean(pending),inspirationPending:pending,eligibleActorIds:pending?actors.map(a=>a.actorId):['lantern-fighter']});
 f.options.browserFactory=async o=>({revoked:()=>false,close:async()=>{},screenshot:async()=>({png:Buffer.from(o.ownerId),width:1280,height:1000}),act:async()=>o.serializeAction(async()=>{const gate=await o.getGate();if(!gate.decisionOpen||!gate.allowAction)return;const commandId=randomUUID(),choice=Boolean(pending);if(choice){assert.equal(o.actorId,'lantern-cleric');assert.deepEqual(gate.allowedActionIds,[`inspiration:roll-one:0:keep`,`inspiration:roll-one:0:reroll`]);}await o.onPending({actorId:o.actorId,campaignId:'fixture',commandId,expectedRevision:revision});dispatched.push(o.actorId);let result;if(!choice){original=commandId;pending={actorId:'lantern-cleric',pendingId:'roll-one',dieId:0,originalCommandId:original};result={status:'pending-roll',originalCommandId:original};}else{pending=null;result={status:'resolved',originalCommandId:original};}await o.onCommit({receipt:{contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId,revision:++revision,success:true,result}});await o.onPending(null);})});
 const party=f.create();party.start();try{const result=await party.onDecisionOpened({opportunityId:'one-roll'});assert.deepEqual(dispatched,['lantern-fighter','lantern-cleric']);assert.equal(result.committedIntentCount,1);assert.equal(result.choiceCount,1);const saved=store.getOpportunity();assert(saved.closed);assert.equal(saved.actions.length,1);assert.equal(saved.choices.length,1);assert.equal((await party.resumePendingOpportunity()).status,'idle');}finally{await party.close();await rm(dir,{recursive:true,force:true});}
});

test('expired durable opportunity cannot authorize fresh input after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'visual-expired-')),store=await openVisualActionStore({file:join(dir,'actions.json'),campaignId:'fixture',actors});await store.beginOpportunity({id:'expired',deadline:Date.now()-1,maxActions:3,maxChoices:32,actions:[],choices:[],closed:false});const f=fixture({store}),party=f.create();party.start();try{assert.equal((await party.resumePendingOpportunity()).status,'expired');assert.equal(f.requests.length,0);}finally{await party.close();await rm(dir,{recursive:true,force:true});}
});

test('restart resumes only associated die within original deadline and cancels window durably',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'visual-resume-')),file=join(dir,'actions.json'),store=await openVisualActionStore({file,campaignId:'fixture',actors}),original=randomUUID(),deadline=Date.now()+60000;await store.beginOpportunity({id:'resume',deadline,maxActions:3,maxChoices:32,actions:[{actorId:'lantern-fighter',commandId:original}],choices:[],closed:false});const f=fixture({store});let pending=true,sends=0;
 f.options.getGate=async()=>({decisionOpen:true,rollPending:pending,inspirationPending:pending?{actorId:'lantern-cleric',pendingId:'resume-roll',dieId:0,originalCommandId:original}:null,eligibleActorIds:actors.map(a=>a.actorId)});
 f.options.browserFactory=async o=>({revoked:()=>false,close:async()=>{},screenshot:async()=>({png:Buffer.from(o.ownerId),width:1280,height:1000}),act:async()=>o.serializeAction(async()=>{const gate=await o.getGate();if(!gate.decisionOpen)return;assert.equal(o.actorId,'lantern-cleric');const commandId=randomUUID();await o.onPending({actorId:o.actorId,campaignId:'fixture',commandId,expectedRevision:1});sends++;pending=false;await o.onCommit({receipt:{contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId,revision:2,success:true,result:{status:'resolved',originalCommandId:original}}});await o.onPending(null);})});
 const party=f.create();party.start();try{const result=await party.resumePendingOpportunity();assert.equal(sends,1);assert.equal(result.committedIntentCount,1);assert.equal(result.choiceCount,1);const saved=(await openVisualActionStore({file,campaignId:'fixture',actors})).getOpportunity();assert.equal(saved.deadline,deadline);assert.equal(saved.closed,true);assert.equal(saved.actions.length,1);}finally{await party.close();await rm(dir,{recursive:true,force:true});}
});

test('durable choice budget cannot reset or overspend after reopening the store',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'visual-choice-cap-')),file=join(dir,'actions.json'),options={file,campaignId:'fixture',actors};try{let store=await openVisualActionStore(options);await store.beginOpportunity({id:'bounded',deadline:Date.now()+60000,maxActions:3,maxChoices:2,actions:[],choices:[],closed:false});await store.reserveCommand('bounded','lantern-fighter',randomUUID(),true);store=await openVisualActionStore(options);await store.reserveCommand('bounded','lantern-fighter',randomUUID(),true);await assert.rejects(store.reserveCommand('bounded','lantern-fighter',randomUUID(),true),/BUDGET/);await store.closeOpportunity('bounded');await assert.rejects(store.reserveCommand('bounded','lantern-fighter',randomUUID(),true),/CLOSED/);}finally{await rm(dir,{recursive:true,force:true});}
});
