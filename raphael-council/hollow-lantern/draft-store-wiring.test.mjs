import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';
import {createActivityDraftStore,createActivityRuntime} from './activity-runtime.mjs';
import {createWebTable} from './web-server.mjs';
import {activityRoute} from './activity-edge.mjs';

const secret='dedicated-shared-draft-fixture-credential-0123456789';
const privateScope={campaignId:'hollow',userId:'player',actorId:'one',role:'player',visibility:'private'};
const scope={campaignId:'hollow',userId:'player',actorId:'one',audience:'player',mapLevel:'tactical'};
async function freePort(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'shared-draft-wiring-')),file=join(directory,'drafts.json'),secretFile=join(directory,'rpc-secret.txt');
 await writeFile(secretFile,secret);const store=await createInvestigationDraftStore({file});
 const port=await freePort();let allowed=true,revision=3,host;
 const table=createWebTable({port,getHost:()=>host,draftStore:store,draftRpc:{secret,campaignId:'hollow',gmUserId:'dm'}});
 t.after(async()=>{await table.close();await store.close();await rm(directory,{recursive:true,force:true});});
 const remote=createActivityDraftStore({HOLLOW_LANTERN_DRAFT_RPC_URL:table.origin,HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:secretFile},'hollow');
 const commands=[],origin='https://123456789012345678.discordsays.com',identity={campaign:'hollow',owner:'player',role:'player'};
 const client={campaignId:'hollow',project:async request=>({projectionVersion:2,campaignId:'hollow',revision,audience:request.audience,characterId:request.actorId??'one',currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[{characterId:'one',ownerId:'player',characterType:'player',displayName:'Hero',primaryHealth:10,primaryHealthMaximum:10,position:{x:12,y:12},factionId:'party',resources:{movementFeet:30}}],pendingActions:[]}),command:async request=>{commands.push(structuredClone(request));return {revision:++revision,commandId:request.commandId,replayed:false,result:{message:'You examine the known inscription.'}};}};
 const auth={config:{activityOrigin:origin},authenticate:async()=>allowed?identity:null,member:async()=>allowed?identity:null};
 const activity=createActivityRuntime({auth,client,gmUserId:'dm',draftStore:remote});
 host={gmUserId:'dm',authorize:async candidate=>allowed&&candidate.campaignId==='hollow'&&candidate.userId==='player'&&candidate.actorId==='one'&&candidate.audience==='player',service:activity.service};
 await table.start();
 const link=await table.webLink(scope),code=new URL(link).hash.slice('#code='.length);
 const login=await fetch(`${table.origin}/api/session`,{method:'POST',headers:{Origin:table.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 async function web(path,body){const response=await fetch(`${table.origin}${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:table.origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
 async function request(operation,body){const response=await activity.handle(operation,new Request(`${origin}/api/hollow-lantern/${operation}?actorId=one&level=tactical`,{method:body===undefined?'GET':'POST',headers:{Cookie:'activity-session=fixture',Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return {status:response.status,body:await response.json()};}
 return {table,store,remote,web,request,commands,file,secretFile,revoke:()=>allowed=false};
}

test('Activity and web table exchange and complete one private intention through the sole store owner',async t=>{
 const f=await fixture(t),view=await f.request('view');assert.equal(view.status,200);assert.equal(view.body.draftEnabled,true);
 const saved=await f.request('draft-save',{viewToken:view.body.viewToken,actionId:'interact',input:{text:'I read the inscription.'},expectedDraftVersion:null});assert.equal(saved.status,200);assert.equal(f.commands.length,0);
 const inWeb=await f.web('/api/draft');assert.equal(inWeb.status,200);assert.equal(inWeb.body.draft.draftId,saved.body.draft.draftId);assert.equal(inWeb.body.draft.input.text,'I read the inscription.');
 const webView=await f.web('/api/view'),updated=await f.web('/api/draft/save',{viewToken:webView.body.viewToken,actionId:'interact',input:{text:'I compare the inscription with the known journal.'},expectedDraftVersion:saved.body.draft.version});assert.equal(updated.status,200);
 const inActivity=await f.request('draft');assert.equal(inActivity.status,200);assert.equal(inActivity.body.draft.version,updated.body.draft.version);assert.equal(inActivity.body.draft.input.text,updated.body.draft.input.text);
 const tried=await f.request('draft-try',{draftId:updated.body.draft.draftId,version:updated.body.draft.version});assert.equal(tried.status,200);assert.equal(tried.body.draft.status,'completed');assert.equal(f.commands.length,1);
 assert.equal((await f.web('/api/draft')).body.draft.status,'completed');assert.equal((await f.store.get(privateScope)).status,'completed');
 assert.equal((await f.request('draft-try',{draftId:updated.body.draft.draftId,version:updated.body.draft.version})).status,200);assert.equal(f.commands.length,1);
});

test('remote adapter opens no second writer and closing it leaves the owner usable',async t=>{
 const f=await fixture(t);await assert.rejects(createInvestigationDraftStore({file:f.file}));
 const saved=await f.remote.save(privateScope,{actionId:'interact',actionPayload:{},input:{text:'A draft from the Activity connection.'},expectedRevision:3},null);
 assert.equal((await f.store.get(privateScope)).draftId,saved.draftId);
 if(f.remote.close)await f.remote.close();assert.equal((await f.store.get(privateScope)).input.text,saved.input.text);
});

test('a separate Activity process reads the same owner-held draft through authenticated HTTP',{timeout:15000},async t=>{
 const f=await fixture(t),saved=await f.store.save(privateScope,{actionId:'interact',actionPayload:{},input:{text:'One draft shared between processes.'},expectedRevision:3},null);
 const script=`import {createRemoteDraftStore} from ${JSON.stringify(new URL('./draft-store-rpc.mjs',import.meta.url).href)};let text='';for await(const chunk of process.stdin)text+=chunk;const {scope,...config}=JSON.parse(text);const remote=createRemoteDraftStore(config);const draft=await remote.get(scope);console.log(JSON.stringify({pid:process.pid,draftId:draft.draftId,text:draft.input.text}));await remote.close?.();`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill();});
 let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`Draft client child failed: ${errors}`)));});
 child.stdin.end(JSON.stringify({baseUrl:f.table.origin,secret,campaignId:'hollow',scope:privateScope}));await completion;
 const result=JSON.parse(output);assert.notEqual(result.pid,process.pid);assert.equal(result.draftId,saved.draftId);assert.equal(result.text,saved.input.text);assert.equal((await f.store.get(privateScope)).draftId,saved.draftId);
});

test('internal draft endpoint rejects unsigned browsers and stays outside the public Activity edge',async t=>{
 const f=await fixture(t);
 for(const headers of [{},{Origin:f.table.origin},{Cookie:'hollow_session=forged'}]){
  const response=await fetch(`${f.table.origin}/_internal/draft-store`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
 }
 assert.ok(!activityRoute('POST','/_internal/draft-store'));assert.ok(!activityRoute('GET','/_internal/draft-store'));assert.equal(await f.store.get(privateScope),null);
 f.revoke();await assert.rejects(f.remote.get(privateScope));assert.equal(f.commands.length,0);
});

test('Activity shared storage requires a dedicated local credential and a complete loopback configuration',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'activity-draft-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'secret.txt');await writeFile(path,secret);
 assert.equal(createActivityDraftStore({}),undefined);
 for(const env of [{HOLLOW_LANTERN_DRAFT_RPC_URL:'http://127.0.0.1:18792'},{HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path},{HOLLOW_LANTERN_DRAFT_RPC_URL:'https://example.com',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path},{HOLLOW_LANTERN_DRAFT_RPC_URL:'http://[::1]:18792',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path},{HOLLOW_LANTERN_DRAFT_RPC_URL:'http://127.0.0.1:18792',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path,HOLLOW_LANTERN_SECRET_FILE:path},{HOLLOW_LANTERN_DRAFT_RPC_URL:'http://127.0.0.1:18792',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path,DISCORD_BOT_TOKEN:secret}])assert.throws(()=>createActivityDraftStore(env));
 for(const invalid of ['short',`${secret} embedded space`,`${'\n'.repeat(4097)}${secret}`]){await writeFile(path,invalid);assert.throws(()=>createActivityDraftStore({HOLLOW_LANTERN_DRAFT_RPC_URL:'http://127.0.0.1:18792',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:path}));}
 for(const invalidPath of [directory,'//network-host/share/credential.txt'])assert.throws(()=>createActivityDraftStore({HOLLOW_LANTERN_DRAFT_RPC_URL:'http://127.0.0.1:18792',HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:invalidPath}));
 assert.throws(()=>createWebTable({getHost:()=>null,draftRpc:{secret,campaignId:'hollow',gmUserId:'dm'}}),/configuration/);
});
