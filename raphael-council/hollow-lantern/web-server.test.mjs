import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebTable} from './web-server.mjs';
import {createServer} from 'node:net';
async function testPort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
test('table sign-in is one-use, scope-bound, origin-checked and revoked before map delivery',async()=>{
 let allowed=true,seen,revision=7;
 const scope={campaignId:'fixture',userId:'fixture-dm',audience:'gm'};
 const host={authorize:async input=>allowed&&input.userId==='fixture-dm',service:{project:async input=>{seen=input;return {revision,title:'Fixture',actions:[]};},command:async()=>assert.fail('No command expected')}};
 const table=createWebTable({getHost:()=>host,port:await testPort()});await table.start();
 try{
  const link=await table.webLink(scope),code=new URLSearchParams(new URL(link).hash.slice(1)).get('code');
  let response=await fetch(`${table.origin}/api/view`);assert.equal(response.status,401);
  response=await fetch(`${table.origin}/api/session`,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(response.status,403);
  response=await fetch(`${table.origin}/api/session`,{method:'POST',headers:{Origin:table.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  response=await fetch(`${table.origin}/api/session`,{method:'POST',headers:{Origin:table.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(response.status,401);
  response=await fetch(`${table.origin}/api/view?level=regional&userId=other`,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.deepEqual(seen,{...scope,mapLevel:'regional'});assert.equal(response.headers.get('cache-control'),'private, no-store');
  const boundView=await response.json();revision=8;
  response=await fetch(`${table.origin}/api/map?level=regional&viewToken=${boundView.viewToken}`,{headers:{Cookie:cookie}});assert.equal(response.status,409);assert.match((await response.json()).error,/scene changed/);
  allowed=false;response=await fetch(`${table.origin}/api/map`,{headers:{Cookie:cookie}});assert.equal(response.status,401);
 }finally{await table.close();}
});

test('only an authenticated DM can select an engine-listed actor, and selection never changes identity',async()=>{
 const calls=[];
 const host={authorize:async scope=>scope.userId==='dm'||(scope.userId==='player'&&scope.audience==='player'&&scope.actorId==='own'),service:{
  project:async scope=>{calls.push(scope);return {revision:3,title:'Fixture',controllableActors:scope.audience==='gm'?[{id:'own',name:'Mara'},{id:'npc',name:'Captain'}]:[],actions:[]};}
 }};
 const table=createWebTable({getHost:()=>host,port:await testPort()});await table.start();
 const signin=async scope=>{const code=new URLSearchParams(new URL(await table.webLink(scope)).hash.slice(1)).get('code');const r=await fetch(`${table.origin}/api/session`,{method:'POST',headers:{Origin:table.origin,'Content-Type':'application/json'},body:JSON.stringify({code})});return r.headers.get('set-cookie').split(';')[0];};
 const select=(cookie,actorId)=>fetch(`${table.origin}/api/actor`,{method:'POST',headers:{Origin:table.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({actorId})});
 try{
  const player=await signin({campaignId:'fixture',userId:'player',audience:'player',actorId:'own'});assert.equal((await select(player,'npc')).status,403);
  const dm=await signin({campaignId:'fixture',userId:'dm',audience:'gm'});assert.equal((await select(dm,'hidden-invalid')).status,403);assert.equal((await select(dm,'npc')).status,200);
  const response=await fetch(`${table.origin}/api/view`,{headers:{Cookie:dm}});const view=await response.json();assert.equal(view.selectedActor,'npc');assert.equal(view.dmController,true);assert(calls.some(s=>s.actorId==='npc'&&s.userId==='dm'&&s.audience==='player'));
  // Another tab selects a different actor at the SAME campaign revision.
  assert.equal((await select(dm,'own')).status,200);
  const wrongTab=await fetch(`${table.origin}/api/action`,{method:'POST',headers:{Origin:table.origin,Cookie:dm,'Content-Type':'application/json'},body:JSON.stringify({action:'move',payload:{},revision:3,commandId:'11111111-1111-4111-8111-111111111111',viewToken:view.viewToken})});assert.equal(wrongTab.status,409);
  const wrongMap=await fetch(`${table.origin}/api/map?viewToken=${view.viewToken}`,{headers:{Cookie:dm}});assert.equal(wrongMap.status,409);
  assert.equal((await select(dm,'')).status,200);
 }finally{await table.close();}
});


// Full-client ruling selection and response visibility are exercised by
// web/table.test.mjs, including the main DM map and the Review screen.
