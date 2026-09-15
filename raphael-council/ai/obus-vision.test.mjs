import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {createCanvas} from '@napi-rs/canvas';
import {ObusVisionTransport,VISION_CONTRACT,VISION_MODEL,validateVisionAction} from './obus-vision.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const scope={campaign:'test-game',owner:'ai-fighter',role:'player'},session='player-fighter';
const runtime={contract:'raph-obus-game-runtime-v1',bootEpoch:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',sessionPolicyRevision:1};
const screenshot={png:createCanvas(16,16).toBuffer('image/png'),width:16,height:16};
function fixture(mutate=()=>{}){
 let sent,runtimes=0,fetches=0;const transport={url:'http://127.0.0.1:38178',headers:()=>({'X-Test':'fixture'}),capabilities:async()=>({screenshot_vision:{contract:VISION_CONTRACT,endpoint:'/api/game/vision',supported:true,model:VISION_MODEL,destination:'local',coordinateSpace:'screenshot-pixels',tools:false,retrieval:false,personal_memory:false,auto_memory:false,actions:['click','select','type','scroll','wait']}}),runtime:async()=>{runtimes++;return runtime;},fetch:async(url,options)=>{assert.equal(url,'http://127.0.0.1:38178/api/game/vision');fetches++;sent=JSON.parse(options.body);const action={type:'select',x:3,y:4,option:'Inventory'};const r={contract:VISION_CONTRACT,status:'completed',replayed:false,requestId:sent.requestId,scope,session,runtime,action,receipt:{provider:'ollama',model:VISION_MODEL,endpoint:'http://127.0.0.1:11434/api/chat',destination:'local',completion_tokens:20,finish_reason:'stop',screenshotSha256:sha(screenshot.png),normalizedSha256:sha(screenshot.png),width:16,height:16,coordinateSpace:'screenshot-pixels',actionValidated:true,actionSha256:sha(JSON.stringify({option:'Inventory',type:'select',x:3,y:4})),tools:false,retrieval:false,personal_memory:false,auto_memory:false,request_evidence_persisted:false,history_persisted:false,general_memory_writes:false,route_journal_writes:false,game_receipt_persisted:true}};mutate(r);return Response.json(r);}};
 return {transport,vision:new ObusVisionTransport({transport}),sent:()=>sent,fetches:()=>fetches,runtimes:()=>runtimes};
}
const job={scope,session,screenshot,instructions:'Choose from your visible game table only.'};
test('visual choice uses only the private local screenshot route and validates provenance',async()=>{
 const f=fixture(),r=await f.vision.choose(job);assert.equal(r.action.option,'Inventory');assert.equal(f.fetches(),1);assert.equal(f.runtimes(),2);const sent=f.sent();assert.equal(sent.policy.tools,false);assert.equal(sent.policy.exportable,false);assert.equal(sent.evidence,undefined);assert.equal(sent.screenshot.image_base64,screenshot.png.toString('base64'));assert.deepEqual(sent.history,[]);
});
test('wrong owner, scope, pixels, model, memory or action provenance can never become a click',async()=>{
 for(const change of [r=>r.scope={...scope,owner:'ai-rogue'},r=>r.session='other-session',r=>r.runtime={...runtime,sessionPolicyRevision:2},r=>r.receipt.model='general-model',r=>r.receipt.destination='free',r=>r.receipt.screenshotSha256='0'.repeat(64),r=>r.receipt.actionSha256='0'.repeat(64),r=>r.receipt.personal_memory=true,r=>r.receipt.route_journal_writes=true,r=>r.action.x=17,r=>r.receipt.finish_reason='length',r=>r.sources=['hidden-memory']])await assert.rejects(fixture(change).vision.choose(job),/could not be verified/);
});
test('old worker capability and mixed history fail before screenshot dispatch',async()=>{
 const f=fixture();f.transport.capabilities=async()=>({});await assert.rejects(f.vision.choose(job),/needs screenshot support/);assert.equal(f.fetches(),0);
 const g=fixture();await assert.rejects(g.vision.choose({...job,history:[{owner:'ai-rogue',action:{type:'wait',ms:1},outcome:'secret'}]}),/Only this character/);assert.equal(g.fetches(),0);
 await assert.rejects(g.vision.choose({...job,scope:{...scope,role:'host'}}),/scoped visual/);
});
test('changed game generation after inference discards the returned action',async()=>{
 const f=fixture();let calls=0;f.transport.runtime=async()=>({...runtime,sessionPolicyRevision:++calls});await assert.rejects(f.vision.choose(job),/authority changed/);
});
test('ordinary actions reject hidden commands, invalid dimensions and unbounded interactions',()=>{
 for(const action of [{type:'click',x:0,y:0,command:'attack'},{type:'scroll',x:0,y:0,deltaY:0},{type:'type',x:-1,y:0,text:'x'},{type:'select',x:0,y:0,option:''},{type:'wait',ms:2001}])assert.throws(()=>validateVisionAction(action,16,16));
 assert.deepEqual(validateVisionAction({type:'type',x:0,y:0,text:'I inspect the door.'},16,16),{type:'type',x:0,y:0,text:'I inspect the door.'});
});
