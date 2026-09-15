import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';
import {createDraftStoreRpcHandler,createRemoteDraftStore} from './draft-store-rpc.mjs';
const secret='dedicated-draft-secret-12345678901234567890',campaignId='camp',scope={campaignId,userId:'player',actorId:'hero',role:'player',visibility:'private'};
const value={actionId:'inspect',actionPayload:{targetId:'door'},input:{text:'I study the lock'},expectedRevision:3};
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'draft-rpc-')),store=await createInvestigationDraftStore({file:join(directory,'draft.json')});let allowed=true,authorizations=0;
 const handler=createDraftStoreRpcHandler({draftStore:store,secret,campaignId,gmUserId:'gm',authorize:async s=>{assert.deepEqual(s,{campaignId,userId:'player',actorId:'hero',audience:'player',mapLevel:'tactical'});authorizations++;return allowed;}});
 const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await store.close();await rm(directory,{recursive:true,force:true});});
 return {store,server,baseUrl,handler,get authorizations(){return authorizations;},deny(){allowed=false;},remote:createRemoteDraftStore({baseUrl,secret,campaignId})};
}
function signed(body,extra={}){const raw=JSON.stringify(body),timestamp=String(Date.now());return {method:'POST',headers:{'content-type':'application/json','x-hollow-draft-timestamp':timestamp,'x-hollow-draft-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex'),...extra},body:raw};}
const envelope=(operation='get',args={},s=scope)=>({contract:'hollow-draft-store-v1',requestId:randomUUID(),operation,scope:s,args});
test('real HTTP adapter shares borrowed durable store through save prepare complete',async t=>{
 const f=await fixture(t);assert.equal(await f.remote.get(scope),null);const draft=await f.remote.save(scope,value,null);assert.deepEqual(await f.store.get(scope),draft);
 const prepared=await f.remote.prepare(scope,{draftId:draft.draftId,version:draft.version,currentRevision:3,availableActionIds:['inspect']});assert.equal(prepared.status,'prepared');
 const completed=await f.remote.complete(scope,{draftId:draft.draftId,commandId:prepared.intent.commandId,receipt:{result:'Recorded'}});assert.equal(completed.status,'completed');assert.deepEqual(completed.scope,scope);
 await f.remote.close();assert.equal((await f.store.get(scope)).status,'completed');assert.equal(f.authorizations,8);
});
test('forgery browser headers replay stale timestamps and foreign scope are rejected',async t=>{
 const f=await fixture(t),url=f.baseUrl+'/_internal/draft-store',body=envelope(),request=signed(body);
 assert.equal((await fetch(url,request)).status,200);assert.equal((await fetch(url,request)).status,409);
 assert.equal((await fetch(url,signed({...body,requestId:body.requestId.toUpperCase()}))).status,409);
 for(const extra of [{origin:'http://127.0.0.1'},{cookie:'hollow_session=x'},{'x-hollow-draft-signature':'0'.repeat(64)},{'x-hollow-draft-timestamp':'1'}])assert.equal((await fetch(url,signed(envelope(),extra))).status,403);
 for(const s of [{...scope,userId:'gm'},{...scope,campaignId:'other'},{...scope,role:'gm'},{...scope,extra:true}])assert.equal((await fetch(url,signed(envelope('get',{},s)))).status,403);
 assert.equal((await fetch(url+'?extra=1',signed(envelope()))).status,404);
 assert.equal((await fetch(url,signed(envelope('get',{value})))).status,400);
});
test('current access denied and errors do not leak storage details',async t=>{
 const f=await fixture(t);f.deny();await assert.rejects(()=>f.remote.get(scope),e=>e.status===403&&!e.message.includes('hero'));
});
test('lost prepare response recovers identical persisted identity with a new RPC request',async t=>{
 const f=await fixture(t),draft=await f.remote.save(scope,value,null);let lost=true,calls=0;
 const remote=createRemoteDraftStore({baseUrl:f.baseUrl,secret,campaignId,fetchImpl:async(...args)=>{calls++;const result=await fetch(...args);if(lost){lost=false;await result.text();throw Error('response lost');}return result;}});
 const args={draftId:draft.draftId,version:draft.version,currentRevision:3,availableActionIds:['inspect']};
 await assert.rejects(()=>remote.prepare(scope,args),e=>e.status===503);assert.equal(calls,1);
 const disk=await f.store.get(scope),recovered=await remote.prepare(scope,args);assert.deepEqual(recovered.intent,disk.intent);assert.equal(calls,2);
});
async function invoke(handler,body,headers={},remoteAddress='127.0.0.1'){
 const init=signed(body,headers),request=Readable.from([Buffer.from(init.body)]);request.url='/_internal/draft-store';request.method='POST';request.headers=init.headers;request.socket={remoteAddress};let status,result;
 await handler(request,{writeHead(code){status=code;},end(text){result=JSON.parse(text);}});return {status,result};
}
test('replay reservation precedes authorization await and denies remote sockets',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),borrowed={get:async()=>null,save(){},prepare(){},complete(){}};
 const handler=createDraftStoreRpcHandler({draftStore:borrowed,secret,campaignId,gmUserId:'gm',authorize:async()=>{calls++;await gate;return true;}}),body=envelope();
 const first=invoke(handler,body);await new Promise(resolve=>setImmediate(resolve));assert.equal((await invoke(handler,body)).status,409);release();assert.equal((await first).status,200);assert.equal(calls,2);
 assert.equal((await invoke(handler,envelope(),{},'192.168.1.2')).status,403);
});
test('live replay entries are not evicted when cache reaches its bound',async()=>{
 const at=Date.now(),borrowed={get:async()=>null,save(){},prepare(){},complete(){}},handler=createDraftStoreRpcHandler({draftStore:borrowed,secret,campaignId,gmUserId:'gm',authorize:async()=>true,now:()=>at}),first=envelope();
 assert.equal((await invoke(handler,first)).status,200);
 for(let i=1;i<4096;i++)assert.equal((await invoke(handler,envelope())).status,200);
 assert.equal((await invoke(handler,envelope())).status,429);assert.equal((await invoke(handler,first)).status,409);
});
test('authorization revoked during storage suppresses private response',async()=>{
 let allowed=true;const borrowed={get:async()=>{allowed=false;return null;},save(){},prepare(){},complete(){}};
 const handler=createDraftStoreRpcHandler({draftStore:borrowed,secret,campaignId,gmUserId:'gm',authorize:async()=>allowed});const result=await invoke(handler,envelope());assert.equal(result.status,403);assert.equal(Object.hasOwn(result.result,'draft'),false);
});
test('server rejects oversize signed body before storage and unknown fields',async t=>{
 const f=await fixture(t),url=f.baseUrl+'/_internal/draft-store';const large=envelope('save',{value:{...value,input:{text:'x'.repeat(33000)}},expectedDraftVersion:null});
 assert.equal((await fetch(url,signed(large))).status,413);assert.equal(f.authorizations,0);
 assert.equal((await fetch(url,signed({...envelope(),extra:'denied'}))).status,400);
});
test('real redirect is never followed',async t=>{
 let destinationCalls=0;const server=createServer((req,res)=>{if(req.url==='/destination'){destinationCalls++;res.end('{}');}else{res.writeHead(302,{location:'/destination'});res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const remote=createRemoteDraftStore({baseUrl:`http://127.0.0.1:${server.address().port}`,secret,campaignId});await assert.rejects(()=>remote.get(scope),e=>e.status===503);assert.equal(destinationCalls,0);
});
test('timeout is bounded and never retries even if injected transport ignores abort',async()=>{
 let calls=0;const remote=createRemoteDraftStore({baseUrl:'http://127.0.0.1',secret,campaignId,timeoutMs:100,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});
 await assert.rejects(()=>remote.get(scope),e=>e.status===503);assert.equal(calls,1);
});
test('client rejects unsafe endpoints redirects oversized and invalid responses without retry',async()=>{
 for(const baseUrl of ['http://[::1]:18792','https://example.com','http://localhost:1234','http://127.1:1234','http://127.0.0.1/path','http://user@127.0.0.1','http://127.0.0.1?x=1'])assert.throws(()=>createRemoteDraftStore({baseUrl,secret,campaignId}));
 assert.throws(()=>createRemoteDraftStore({baseUrl:'http://127.0.0.1',secret:'short',campaignId}));
 let calls=0;const remote=createRemoteDraftStore({baseUrl:'http://127.0.0.1',secret,campaignId,fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response('x'.repeat(100000));}});
 await assert.rejects(()=>remote.get(scope),e=>e.status===503);assert.equal(calls,1);
 const invalid=createRemoteDraftStore({baseUrl:'http://127.0.0.1',secret,campaignId,fetchImpl:async()=>new Response(JSON.stringify({contract:'wrong',draft:null}))});await assert.rejects(()=>invalid.get(scope));
});
