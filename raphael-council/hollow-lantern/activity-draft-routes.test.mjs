import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityEdge} from './activity-edge.mjs';

const endpoints=[['/api/hollow-lantern/draft','GET','draft'],['/api/hollow-lantern/draft/save','POST','draft-save'],['/api/hollow-lantern/draft/try','POST','draft-try']];
async function startEdge(t,fetchImpl){const edge=createActivityEdge({port:0,fetchImpl});await edge.start();t.after(()=>edge.close());return {edge,origin:`http://127.0.0.1:${edge.server.address().port}`};}
test('draft edge routes forward exact methods, query, credentials and body without widening the allowlist',async t=>{
 const calls=[];const {origin}=await startEdge(t,async(url,options)=>{calls.push({url,options});return Response.json({draft:null},{headers:{'Cache-Control':'private, no-store'}});});
 for(const [path,method]of endpoints){
  const payload=method==='POST'?JSON.stringify({input:{text:'Read the ancient inscription 秘密'},draftId:'saved',version:1}):undefined;
  const response=await fetch(origin+path+'?campaignId=one&actorId=hero',{method,headers:{Origin:'https://123456789012345678.discordsays.com',Cookie:'session=private','Content-Type':'application/json'},body:payload});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{draft:null});assert.equal(response.headers.get('cache-control'),'no-store');
  const call=calls.at(-1);assert.equal(call.url,'http://127.0.0.1:18796'+path+'?campaignId=one&actorId=hero');assert.equal(call.options.method,method);assert.equal(call.options.headers.get('cookie'),'session=private');assert.equal(call.options.headers.get('origin'),'https://123456789012345678.discordsays.com');assert.equal(call.options.body?.toString(),payload);assert.equal(call.options.redirect,'manual');
 }
 for(const [path,method]of [['/api/hollow-lantern/draft','POST'],['/api/hollow-lantern/draft/save','GET'],['/api/hollow-lantern/draft/try','GET'],['/api/hollow-lantern/draft/delete','POST'],['/api/hollow-lantern/draft/save/extra','POST']]){const response=await fetch(origin+path,{method});assert.equal(response.status,404);await response.arrayBuffer();}
 assert.equal(calls.length,3);
 const oversized=await fetch(origin+'/api/hollow-lantern/draft/save',{method:'POST',body:'x'.repeat(32769)});assert.equal(oversized.status,413);await oversized.arrayBuffer();assert.equal(calls.length,3);
});

test('actual Next draft exports dispatch the correct Activity operation through the edge',{skip:process.execArgv.includes('--experimental-test-module-mocks')?false:'Run with --experimental-test-module-mocks to verify actual Next route exports'},async t=>{
 const calls=[];
 t.mock.module(new URL('./activity-runtime.mjs',import.meta.url).href,{namedExports:{activityHttp:operation=>async request=>{calls.push({operation,request,body:request.method==='POST'?await request.text():undefined});return Response.json({operation},{status:207});}}});
 const routes=new Map();
 for(const [path,method,operation]of endpoints){const suffix=path.slice('/api/hollow-lantern/'.length);const module=await import(new URL('../app/api/hollow-lantern/'+suffix+'/route.ts',import.meta.url));assert.equal(module.runtime,'nodejs');assert.equal(typeof module[method],'function');assert.equal(module[method==='GET'?'POST':'GET'],undefined);routes.set(path,{module,operation});}
 const {origin}=await startEdge(t,async(url,options)=>{const request=new Request(url,options);return routes.get(new URL(url).pathname).module[request.method](request);});
 for(const [path,method,operation]of endpoints){const payload=method==='POST'?JSON.stringify({draftId:'own-draft',version:3}):undefined;const response=await fetch(origin+path+'?campaignId=two&actorId=own',{method,headers:{Cookie:'session=bound',Origin:'https://123456789012345678.discordsays.com','Content-Type':'application/json'},body:payload});assert.equal(response.status,207);assert.deepEqual(await response.json(),{operation});const call=calls.at(-1);assert.equal(call.operation,operation);assert.equal(new URL(call.request.url).search,'?campaignId=two&actorId=own');assert.equal(call.request.headers.get('cookie'),'session=bound');assert.equal(call.request.headers.get('origin'),'https://123456789012345678.discordsays.com');assert.equal(call.body,payload);}
 assert.equal(calls.length,3);
});
