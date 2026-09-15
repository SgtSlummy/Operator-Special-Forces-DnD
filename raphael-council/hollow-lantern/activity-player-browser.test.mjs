import test,{afterEach} from 'node:test';import assert from 'node:assert/strict';
import {createPlayerRequestBoundary,validatePlayerAction} from './activity-player-browser.mjs';
function fixture(options={}){let active=true,open=true,time=0,commands=0;const requests=[];const client={campaignId:'fixture',project:async s=>{requests.push(s);return {projectionVersion:2,campaignId:'fixture',revision:0,audience:s.audience,characterId:s.actorId,currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[{characterId:'lantern-fighter',ownerId:'ai-fighter',displayName:'Mara',primaryHealth:31,primaryHealthMaximum:31,position:{x:2,y:2},resources:{movementFeet:30},abilities:[]}],pendingActions:[]};},command:async()=>{commands++;return {};},receipt:async()=>({success:true,replayed:true,revision:0})};
 const b=createPlayerRequestBoundary({client,ownerId:'ai-fighter',actorId:'lantern-fighter',gmUserId:'dm',authorizeAI:async()=>active,getGate:async()=>({decisionOpen:open}),webOrigin:'http://127.0.0.1:19999',now:()=>time,ttlMs:1000,fetchImpl:async()=>new Response('shell'),...options});return {b,client,requests,revoke:()=>active=false,pause:()=>open=false,expire:()=>time=1001,commands:()=>commands};}
const testResponses=new Set();
afterEach(async()=>{for(const response of testResponses)if(response.body&&!response.bodyUsed)await response.body.cancel().catch(()=>{});testResponses.clear();});
const request=async(f,path,method='GET',body)=>{const response=await f.b.request({url:f.b.origin+path,method,headers:{cookie:f.b.cookie},body});testResponses.add(response);return response;};
function terminalResolution(body,kind='cancelled'){
 const identity={contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:body.commandId,ownerId:'ai-fighter',actorId:'lantern-fighter',originalExpectedRevision:body.revision,revision:body.revision+1};
 return {...identity,success:true,replayed:false,resolution:kind,...(kind==='cancelled'?{rejection:{...identity,code:'COMMAND_CANCELLED',terminal:true}}:{receipt:{contract:identity.contract,campaignId:identity.campaignId,commandId:identity.commandId,revision:identity.revision,success:true,replayed:true}})};
}
async function uncertain(f){const body=await actionRequest(f);f.client.command=async()=>{throw Error('lost response');};await request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body));return body;}
const resolveBody=body=>JSON.stringify({commandId:body.commandId,expectedRevision:body.revision});
test('isolated recovery resolves exact pending identity while paused without repeating gameplay',async()=>{
 for(const kind of ['cancelled','committed']){const changes=[],f=fixture({onPending:async p=>changes.push(p)}),body=await uncertain(f),calls=[];f.pause();f.client.resolveUncertain=async value=>{calls.push(value);return terminalResolution(body,kind);};
 const response=await request(f,'/api/hollow-lantern/resolve?campaignId=fixture','POST',resolveBody(body));assert.equal(response.status,200);assert.equal(f.b.pendingAction(),null);assert.equal(changes.at(-1),null);assert.deepEqual(calls,[{ownerId:'ai-fighter',actorId:'lantern-fighter',commandId:body.commandId,expectedRevision:0}]);}
});
test('isolated recovery refuses unknown pending identities and cross-campaign requests',async()=>{
 const f=fixture();let calls=0;f.client.resolveUncertain=async()=>{calls++;};assert.equal((await request(f,'/api/hollow-lantern/resolve','POST',resolveBody({commandId:'55555555-5555-4555-8555-555555555555',revision:0}))).status,409);
 const body=await uncertain(f);for(const [path,value] of [['/api/hollow-lantern/resolve',{commandId:body.commandId,expectedRevision:1}],['/api/hollow-lantern/resolve',{commandId:'66666666-6666-4666-8666-666666666666',expectedRevision:0}],['/api/hollow-lantern/resolve?campaignId=other',{commandId:body.commandId,expectedRevision:0}]]){assert.ok((await request(f,path,'POST',JSON.stringify(value))).status>=400);assert(f.b.pendingAction());}assert.equal(calls,0);
});
test('invalid terminal proofs and failed durable clears never return success to the browser',async()=>{
 let failClear=true;const f=fixture({onPending:async p=>{if(p===null&&failClear)throw Error('disk');}}),body=await uncertain(f);
 f.client.resolveUncertain=async()=>({...terminalResolution(body),ownerId:'other'});assert.equal((await request(f,'/api/hollow-lantern/resolve','POST',resolveBody(body))).status,502);assert(f.b.pendingAction());
 f.client.resolveUncertain=async()=>terminalResolution(body);const failed=await request(f,'/api/hollow-lantern/resolve','POST',resolveBody(body));assert.equal(failed.status,503);assert.equal((await failed.json()).resolution,undefined);assert(f.b.pendingAction());
 failClear=false;assert.equal((await request(f,'/api/hollow-lantern/resolve','POST',resolveBody(body))).status,200);assert.equal(f.b.pendingAction(),null);
});
test('resolution waits for in-flight action and retains pending after access revocation',async()=>{
 const f=fixture(),body=await actionRequest(f);let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);f.client.command=async()=>{started();await gate;throw Error('lost');};let calls=0;f.client.resolveUncertain=async()=>{calls++;return terminalResolution(body);};
 const action=request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body));await ready;const recovery=request(f,'/api/hollow-lantern/resolve','POST',resolveBody(body));f.revoke();release();const actionResponse=await action;await actionResponse.arrayBuffer();const recoveryResponse=await recovery;assert.ok(recoveryResponse.status>=400);await recoveryResponse.arrayBuffer();assert.equal(calls,0);assert(f.b.pendingAction());
});
test('machine seat binds empty actor to self and rejects another actor before GM projection',async()=>{const f=fixture();assert.equal((await request(f,'/api/hollow-lantern/view?actorId=other')).status,403);assert.equal(f.requests.length,0);const r=await request(f,'/api/hollow-lantern/view');assert.equal(r.status,200);assert.equal((await r.json()).selectedActor,'lantern-fighter');assert(f.requests.every(s=>s.audience==='private'&&s.actorId==='lantern-fighter'));});
test('cross-session cookies, forbidden routes and origins cannot touch gameplay',async()=>{const f=fixture(),other=fixture();assert.equal((await f.b.request({url:f.b.origin+'/api/hollow-lantern/view',headers:{cookie:other.b.cookie}})).status,403);for(const path of ['/api/auth/session','/api/game','/hollow-lantern/activity-runtime.mjs','/assets/source.map'])assert.equal((await request(f,path)).status,403);assert.equal((await f.b.request({url:'http://127.0.0.1:1234/api/hollow-lantern/view',headers:{cookie:f.b.cookie}})).status,403);assert.equal(f.requests.length,0);});
test('pause denies commands while receipt recovery remains scoped and revocation closes access',async()=>{const f=fixture();f.pause();assert.equal((await request(f,'/api/hollow-lantern/action','POST','{}')).status,409);assert.equal(f.commands(),0);assert.equal((await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:'11111111-1111-4111-8111-111111111111'}))).status,200);f.revoke();assert.equal((await request(f,'/api/hollow-lantern/view')).status,403);});
test('expiration and explicit revocation reject old screenshots/API scope',async()=>{const f=fixture();f.expire();assert.equal(await f.b.allowed(),false);assert.equal((await request(f,'/hollow-lantern')).status,403);f.b.revoke();assert.equal(f.b.revoked(),true);});
test('visible controls use bounded pixel contracts without script or selector input',()=>{assert(validatePlayerAction({type:'select',x:10,y:20,option:'Map'},1280,1000));assert(validatePlayerAction({type:'type',x:10,y:20,text:'hello'},1280,1000));for(const a of [{type:'click',x:1280,y:20},{type:'select',x:1,y:1,text:'Map'},{type:'wait',ms:2001},{type:'click',x:1,y:1,selector:'body'}])assert.throws(()=>validatePlayerAction(a,1280,1000));});
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createActivityPlayerBrowser} from './activity-player-browser.mjs';
test('disposable network-none browser renders actual compiled table with synthetic AI scope',{skip:process.env.HOLLOW_BROWSER_FIXTURE!=='1',timeout:90000},async()=>{
 const {startProdServer}=await import('../node_modules/vinext/dist/server/prod-server.js');const p=JSON.parse(await readFile('C:/Users/Hermes/LocalFiles/hollow-lantern/map-routes-verification-20260910/attempt2/tactical.json','utf8'));p.characters.find(c=>c.characterId===p.characterId).ownerId='ai-fighter';
 const server=await startProdServer({outDir:fileURLToPath(new URL('../dist',import.meta.url)),host:'127.0.0.1',port:0,silent:true});let browser;
 try{browser=await createActivityPlayerBrowser({client:{campaignId:p.campaignId,project:async scope=>{assert.equal(scope.actorId,p.characterId);assert.equal(scope.audience,'private');return structuredClone(p);},command:async()=>assert.fail('No gameplay command in boundary smoke')},ownerId:'ai-fighter',actorId:p.characterId,gmUserId:'fixture-dm',authorizeAI:async()=>true,getGate:async()=>({decisionOpen:false}),webOrigin:'http://127.0.0.1:'+server.port});const proof=await browser.proof(),screen=await browser.screenshot();assert.equal(proof.network,'none');assert.equal(proof.hostMounts,0);assert(screen.png.length>1000);assert.equal(screen.width,1280);await browser.act({type:'wait',ms:100});const dir='C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/player-browser-boundary';await mkdir(dir,{recursive:true});await writeFile(dir+'/screen.png',screen.png);await writeFile(dir+'/proof.json',JSON.stringify({...proof,evidence:'Real isolated browser; synthetic engine identity and copied Unity projection; no model or live action'},null,2));}finally{await browser?.close();await new Promise(resolve=>server.server.close(resolve));}
});


async function actionRequest(f,id='55555555-5555-4555-8555-555555555555'){
 const view=await(await request(f,'/api/hollow-lantern/view')).json(),action=view.actions.find(a=>a.fields.length===0);assert(action);
 return {viewToken:view.viewToken,revision:view.revision,commandId:id,action:action.id,payload:{}};
}
test('uncertain action remains blocked until its exact committed recovery receipt is proven',async()=>{
 const f=fixture(),body=await actionRequest(f);f.client.command=async()=>{throw Error('transport lost');};
 await request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body));assert.equal(f.b.pendingAction().commandId,body.commandId);
 for(const r of [{contract:'rpg-core-runtime-bridge-v1',campaignId:'wrong',commandId:body.commandId,success:true,replayed:true,revision:1},{contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:body.commandId,success:false,replayed:true,revision:1}]){f.client.receipt=async()=>r;await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:body.commandId}));assert(f.b.pendingAction());}
 assert.equal((await request(f,'/api/hollow-lantern/action','POST',JSON.stringify({...body,commandId:'66666666-6666-4666-8666-666666666666'}))).status,409);
 f.pause();f.client.receipt=async()=>({contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:body.commandId,success:true,replayed:true,revision:1});await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:body.commandId}));assert.equal(f.b.pendingAction(),null);
});
test('global serialization rechecks shared budget after preceding committed callback',async()=>{
 let tail=Promise.resolve(),commits=0,sends=0;const serializeAction=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
 const options={serializeAction,getGate:async()=>({decisionOpen:true,allowAction:commits===0}),onCommit:async()=>{commits++;}};
 const a=fixture(options),b=fixture(options),ab=await actionRequest(a),bb=await actionRequest(b,'66666666-6666-4666-8666-666666666666');
 for(const f of [a,b])f.client.command=async r=>{sends++;await new Promise(resolve=>setTimeout(resolve,10));return {contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:r.commandId,success:true,revision:1};};
 const responses=await Promise.all([request(a,'/api/hollow-lantern/action','POST',JSON.stringify(ab)),request(b,'/api/hollow-lantern/action','POST',JSON.stringify(bb))]);assert.deepEqual(responses.map(r=>r.status),[200,409]);assert.equal(sends,1);assert.equal(a.b.pendingAction(),null);assert.equal(b.b.pendingAction(),null);
});
test('startup cancellation waits for create then removes the exact container before any attach',async()=>{
 let resolveCreate;const created=new Promise(resolve=>{resolveCreate=resolve;}),calls=[];const controller=new AbortController();const f=fixture();
 const pending=createActivityPlayerBrowser({client:f.client,ownerId:'ai-fighter',actorId:'lantern-fighter',gmUserId:'dm',authorizeAI:async()=>true,getGate:async()=>({decisionOpen:false}),webOrigin:'http://127.0.0.1:19999',signal:controller.signal,runImpl:async(_cmd,args)=>{calls.push(args);if(args[0]==='create')await created;return {stdout:''};},spawnImpl:()=>assert.fail('Cancelled container must never attach')});
 controller.abort();resolveCreate();await assert.rejects(pending,/CANCELLED/);assert.equal(calls[0][0],'create');assert.equal(calls[1][0],'rm');assert.equal(calls[1].at(-1),calls[0][calls[0].indexOf('--name')+1]);
});

test('durable pending callback precedes dispatch and matching recovery clears durable record first',async()=>{
 const order=[];const f=fixture({onPending:async p=>order.push(p?'persist':'clear')});const body=await actionRequest(f);f.client.command=async()=>{order.push('dispatch');throw Error('uncertain');};await request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body));assert.deepEqual(order,['persist','dispatch']);
 f.client.receipt=async()=>({contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:body.commandId,success:true,replayed:true,revision:1});await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:body.commandId}));assert.deepEqual(order,['persist','dispatch','clear']);assert.equal(f.b.pendingAction(),null);
});
test('journal persistence failure prevents dispatch and failed clear retains pending',async()=>{
 let failSave=true,failClear=true;const f=fixture({onPending:async p=>{if(p&&failSave||!p&&failClear)throw Error('disk');}});const body=await actionRequest(f);await assert.rejects(()=>request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body)),/disk/);assert.equal(f.commands(),0);assert(f.b.pendingAction());
 failSave=false;f.client.receipt=async()=>({contract:'rpg-core-runtime-bridge-v1',campaignId:'fixture',commandId:body.commandId,success:true,replayed:true,revision:1});await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:body.commandId}));assert(f.b.pendingAction());failClear=false;await request(f,'/api/hollow-lantern/receipt','POST',JSON.stringify({commandId:body.commandId}));assert.equal(f.b.pendingAction(),null);
});
test('matching attested pre-dispatch rejection clears durable and in-memory pending',async()=>{const changes=[],f=fixture({onPending:async p=>changes.push(p)}),body=await actionRequest(f);f.client.receipt=async()=>{throw Object.assign(Error('missing'),{code:'RECEIPT_NOT_FOUND'});};const response=await request(f,'/api/hollow-lantern/action','POST',JSON.stringify({...body,payload:{unsupported:'field'}}));assert((await response.json()).rejection);assert.equal(f.commands(),0);assert.equal(f.b.pendingAction(),null);assert.equal(changes.length,2);assert.equal(changes[0].commandId,body.commandId);assert.equal(changes[1],null);});

test('ordinary type replaces prefilled editable text and refuses a non-editable coordinate',{skip:process.env.HOLLOW_BROWSER_FIXTURE!=='1',timeout:60000},async()=>{
 const f=fixture(),changes=[];let browser;try{
 browser=await createActivityPlayerBrowser({client:f.client,ownerId:'ai-fighter',actorId:'lantern-fighter',gmUserId:'dm',authorizeAI:async()=>true,getGate:async()=>({decisionOpen:false}),webOrigin:'http://127.0.0.1:19999',fetchImpl:async url=>{
 if(new URL(url).pathname==='/hollow-lantern')return new Response(`<html><body><input aria-label="Quantity" value="123" style="position:absolute;left:20px;top:20px;width:300px;height:50px" oninput="fetch('/assets/value-'+encodeURIComponent(this.value)+'.png')"></body></html>`,{headers:{'content-type':'text/html'}});
 changes.push(new URL(url).pathname);return new Response('',{status:200});
 }});
 await browser.act({type:'type',x:60,y:40,text:'7'});assert(changes.includes('/assets/value-7.png'));assert(!changes.some(p=>p.includes('1237')));
 await browser.act({type:'type',x:60,y:40,text:'42'});assert(changes.includes('/assets/value-42.png'));assert(!changes.some(p=>p.includes('742')));
 const count=changes.length;await assert.rejects(()=>browser.act({type:'type',x:600,y:600,text:'oops'}),/OPERATION_FAILED/);assert.equal(changes.length,count);
 }finally{await browser?.close();}
});

test('die whitelist blocks ordinary and copied controls before persistence',async()=>{let writes=0;const f=fixture({getGate:async()=>({decisionOpen:true,allowedActionIds:['inspiration:exact:0:keep','inspiration:exact:0:reroll']}),onPending:async()=>writes++});const body=await actionRequest(f);for(const action of [body.action,'inspiration:other:0:keep','inspiration:exact:1:keep'])assert.equal((await request(f,'/api/hollow-lantern/action','POST',JSON.stringify({...body,action}))).status,409);assert.equal(writes,0);assert.equal(f.commands(),0);});

test('pause during durable write prevents dispatch and clears unsubmitted pending',async()=>{let open=true;const f=fixture({getGate:async()=>({decisionOpen:open}),onPending:async p=>{if(p)open=false;}});const body=await actionRequest(f);assert.equal((await request(f,'/api/hollow-lantern/action','POST',JSON.stringify(body))).status,409);assert.equal(f.commands(),0);assert.equal(f.b.pendingAction(),null);});
