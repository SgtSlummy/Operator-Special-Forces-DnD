import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRoute,createActivityEdge} from './activity-edge.mjs';
const path='/api/hollow-lantern/resolve';
const query='?actorId=scout&level=tactical&campaignId=rehearsal';
const body=JSON.stringify({commandId:'original-command',expectedRevision:17});
test('saved-action resolution is exposed only on its exact POST route',()=>{
 assert.equal(activityRoute('POST',path+query),path+query);
 for(const method of ['GET','HEAD','PUT','PATCH','DELETE','OPTIONS'])assert.equal(activityRoute(method,path),null);
 for(const address of [path+'/',path+'/admin','/api/hollow-lantern/%72esolve','/api/hollow-lantern/../resolve','/_internal/draft-store','/api/admin'])assert.equal(activityRoute('POST',address),null);
});
test('resolution forwards original command and scope once, preserving backend authorization failures',async()=>{
 const calls=[];
 const edge=createActivityEdge({port:0,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({error:'Sign in required.'},{status:401});}});
 await edge.start();
 try{
  const r=await fetch('http://127.0.0.1:'+edge.server.address().port+path+query,{method:'POST',headers:{'content-type':'application/json',origin:'https://table.example.test',cookie:'session=test-only','x-forwarded-user':'forged-user'},body});
  assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Sign in required.'});assert.equal(calls.length,1);
  const {url,options}=calls[0];assert.equal(url,'http://127.0.0.1:18796'+path+query);assert.equal(options.method,'POST');assert.equal(options.body.toString(),body);assert.equal(options.headers.get('origin'),'https://table.example.test');assert.equal(options.headers.get('cookie'),'session=test-only');assert.equal(options.headers.get('x-forwarded-user'),null);assert.equal(options.redirect,'manual');
 }finally{await edge.close();}
});
test('a lost resolution response does not resend or substitute a new action',async()=>{
 let calls=0;const edge=createActivityEdge({port:0,fetchImpl:async()=>{calls++;throw Error('response lost');}});await edge.start();
 try{const r=await fetch('http://127.0.0.1:'+edge.server.address().port+path+query,{method:'POST',body});assert.equal(r.status,503);assert.match((await r.json()).error,/not automatically retried/);assert.equal(calls,1);}finally{await edge.close();}
});
