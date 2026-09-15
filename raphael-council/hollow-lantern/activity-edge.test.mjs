import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRoute,createActivityEdge,allowedAuthRedirect} from './activity-edge.mjs';

test('public edge excludes management, legacy mechanics, source maps and alternate path encodings',()=>{
 for(const path of ['/api/game','/api/ai','/play','/.env','/api/auth/start','/api/health','/_next/static/app.js.map','//other.invalid/','/api/%68ollow-lantern/view','/api/game/../hollow-lantern/view','/_next/static/../server.js','/_next/static/a\\b.js'])assert.equal(activityRoute('GET',path),null,path);
 assert.equal(activityRoute('POST','/api/hollow-lantern/view'),null);
 assert.equal(activityRoute('GET','/api/hollow-lantern/action'),null);
 assert.equal(activityRoute('GET','/api/hollow-lantern/illustration?kind=scene&viewToken=scoped'),'/api/hollow-lantern/illustration?kind=scene&viewToken=scoped');
 for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal(activityRoute(method,'/api/hollow-lantern/illustration'),null);
 assert.equal(activityRoute('GET','/?frame_id=123'),'/?frame_id=123');
 assert.equal(activityRoute('GET','/activity?frame_id=123'),'/activity?frame_id=123');
 assert.equal(activityRoute('GET','/hollow-lantern'),'/hollow-lantern');
 for(const path of ['/api/auth/session','/api/auth/discord/start','/api/auth/discord/callback'])assert.equal(activityRoute('GET',path),path);
 assert.equal(activityRoute('POST','/api/auth/logout'),'/api/auth/logout');assert.equal(activityRoute('GET','/api/auth/logout'),null);
 assert.equal(activityRoute('GET','/_next/static/client-ab123.js'),'/_next/static/client-ab123.js');
});
test('edge forwards exact scoped intent once and strips injected proxy identities',async()=>{
 let calls=0,seen;const edge=createActivityEdge({port:0,fetchImpl:async(url,options)=>{calls++;seen={url,options};return new Response('{"error":"Sign in"}',{status:401,headers:{'Content-Type':'application/json'}});}});await edge.start();
 try{const origin=`http://127.0.0.1:${edge.server.address().port}`;const body=JSON.stringify({commandId:'original',action:'move'});const r=await fetch(origin+'/api/hollow-lantern/action?actorId=lantern-fighter',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://1540006061099188274.discordsays.com','X-Forwarded-User':'gm','X-Forwarded-Host':'evil.invalid'},body});assert.equal(r.status,401);assert.equal(calls,1);assert.equal(seen.url,'http://127.0.0.1:18796/api/hollow-lantern/action?actorId=lantern-fighter');assert.equal(seen.options.body.toString(),body);assert.equal(seen.options.headers.has('X-Forwarded-User'),false);assert.equal(seen.options.headers.has('X-Forwarded-Host'),false);assert.equal(seen.options.headers.get('Origin'),'https://1540006061099188274.discordsays.com');}finally{await edge.close();}
});
test('uncertain upstream response never retries the action',async()=>{
 let calls=0;const edge=createActivityEdge({port:0,fetchImpl:async()=>{calls++;throw Error('lost response');}});await edge.start();try{const r=await fetch(`http://127.0.0.1:${edge.server.address().port}/api/hollow-lantern/action`,{method:'POST',body:'{}'});assert.equal(r.status,503);assert.match(r.headers.get('content-type'),/application\/json/);assert.deepEqual(await r.json(),{error:'The game connection is unavailable. Your action was not automatically retried.'});assert.equal(calls,1);}finally{await edge.close();}
});

const publicOrigin='https://table.example',clientId='1540006061099188274';
const authorization=()=>new URL('https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:publicOrigin+'/api/auth/discord/callback',scope:'identify',state:'a'.repeat(64)}));
test('only the exact configured Discord browser authorization and local recovery targets may redirect',()=>{
 const input={route:'/api/auth/discord/start',status:302,publicOrigin,clientId};
 assert.equal(allowedAuthRedirect({...input,location:authorization().href}),true);
 for(const change of [u=>u.hostname='evil.example',u=>u.username='leak',u=>u.searchParams.set('scope','identify email'),u=>u.searchParams.set('redirect_uri','https://evil.example/callback'),u=>u.searchParams.set('client_id','123456789012345678'),u=>u.searchParams.append('state','duplicate'),u=>u.searchParams.set('token','private')]){const u=authorization();change(u);assert.equal(allowedAuthRedirect({...input,location:u.href}),false);}
 assert.equal(allowedAuthRedirect({...input,route:'/api/hollow-lantern/action',location:authorization().href}),false);
 assert.equal(allowedAuthRedirect({...input,location:'/?connection=host_configuration',status:303}),true);
 assert.equal(allowedAuthRedirect({...input,location:'//evil.example/?connection=retry',status:303}),false);
 assert.equal(allowedAuthRedirect({...input,route:'/api/auth/discord/callback',location:publicOrigin+'/hollow-lantern'}),true);
 assert.equal(allowedAuthRedirect({...input,route:'/api/auth/discord/callback',location:publicOrigin+'/hollow-lantern?token=private'}),false);
 assert.equal(allowedAuthRedirect({...input,route:'/api/auth/discord/callback',location:'/play'}),false);
});
test('edge relays approved OAuth redirect and state cookie without following it',async()=>{
 let calls=0;const edge=createActivityEdge({port:0,publicOrigin,clientId,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{Location:authorization().href,'Set-Cookie':'raph_oauth_state=fixture; HttpOnly; Secure; Path=/api/auth'}});}});await edge.start();
 try{const r=await fetch(`http://127.0.0.1:${edge.server.address().port}/api/auth/discord/start`,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),authorization().href);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.equal(calls,1);}finally{await edge.close();}
});
test('unapproved redirects fail without disclosing their location or cookies',async()=>{
 const edge=createActivityEdge({port:0,publicOrigin,clientId,fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/?private=secret','Set-Cookie':'private=secret'}})});await edge.start();
 try{const r=await fetch(`http://127.0.0.1:${edge.server.address().port}/api/auth/discord/start`,{redirect:'manual'});assert.equal(r.status,502);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('set-cookie'),null);assert.match(r.headers.get('content-type'),/application\/json/);assert.deepEqual(await r.json(),{error:'The game connection returned an unexpected redirect.'});}finally{await edge.close();}
});


test('page forwarding failures remain plain text while API rejection keeps its status',async()=>{
 const edge=createActivityEdge({port:0,fetchImpl:async()=>{throw Error('secret upstream diagnostic');}});await edge.start();
 try{
  const base=`http://127.0.0.1:${edge.server.address().port}`;
  const page=await fetch(base+'/hollow-lantern');assert.equal(page.status,503);assert.match(page.headers.get('content-type'),/text\/plain/);assert.equal(await page.text(),'The game connection is unavailable. Your action was not automatically retried.');
  const rejected=await fetch(base+'/api/game');assert.equal(rejected.status,404);assert.match(rejected.headers.get('content-type'),/application\/json/);assert.deepEqual(await rejected.json(),{error:'This address serves only the Hollow Lantern Activity.'});
 }finally{await edge.close();}
});

test('rejected API POST redirect does not retry or forward cookies',async()=>{
 let calls=0;const edge=createActivityEdge({port:0,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://private.invalid/secret','Set-Cookie':'private=secret'}});}});await edge.start();
 try{const response=await fetch(`http://127.0.0.1:${edge.server.address().port}/api/hollow-lantern/action`,{method:'POST',body:'{}'});assert.equal(response.status,502);assert.equal(calls,1);assert.deepEqual(await response.json(),{error:'The game connection returned an unexpected redirect.'});assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('location'),null);}finally{await edge.close();}
});


test('opt-in Activity diagnostics log only route metadata and generic failure',async()=>{
 const previous=process.env.HOLLOW_ACTIVITY_DIAGNOSTICS,log=console.log,records=[];process.env.HOLLOW_ACTIVITY_DIAGNOSTICS='1';console.log=value=>records.push(JSON.parse(value));
 try{
  for(const failure of ['upstream','redirect']){
   const edge=createActivityEdge({port:0,fetchImpl:async()=>{if(failure==='upstream')throw Error('SECRET failure');return new Response(null,{status:302,headers:{Location:'https://secret.invalid'}});}});await edge.start();
   try{await fetch(`http://127.0.0.1:${edge.server.address().port}/api/hollow-lantern/view?viewToken=SECRET&actorId=SECRET`,{headers:{Cookie:'SECRET'}});}finally{await edge.close();}
  }
  assert.equal(records.length,2);
  for(const [i,record]of records.entries()){assert.deepEqual(Object.keys(record).sort(),['durationMs','event','forwardingFailure','operation','responseFormat','status']);assert.equal(record.operation,'/api/hollow-lantern/view');assert.equal(record.responseFormat,'json');assert.equal(record.status,i===0?503:502);assert.equal(record.forwardingFailure,i===0?'upstream':'redirect');assert(Number.isFinite(record.durationMs));assert(!JSON.stringify(record).includes('SECRET'));}
 }finally{console.log=log;if(previous===undefined)delete process.env.HOLLOW_ACTIVITY_DIAGNOSTICS;else process.env.HOLLOW_ACTIVITY_DIAGNOSTICS=previous;}
});


test('Activity diagnostics classify forwarded content types without raw headers or body',async()=>{
 const previous=process.env.HOLLOW_ACTIVITY_DIAGNOSTICS,log=console.log,records=[];process.env.HOLLOW_ACTIVITY_DIAGNOSTICS='1';console.log=value=>records.push(JSON.parse(value));
 try{
  for(const type of ['application/json; charset=utf-8','text/html; SECRET=private','image/png','text/plain']){
   const edge=createActivityEdge({port:0,fetchImpl:async()=>new Response('SECRET BODY',{status:200,headers:{'Content-Type':type}})});await edge.start();
   try{await fetch(`http://127.0.0.1:${edge.server.address().port}/api/hollow-lantern/view`);}finally{await edge.close();}
  }
  assert.deepEqual(records.map(r=>r.responseFormat),['json','html','png','other']);assert(records.every(r=>r.status===200));assert(!JSON.stringify(records).includes('SECRET'));assert(!JSON.stringify(records).includes('charset'));
 }finally{console.log=log;if(previous===undefined)delete process.env.HOLLOW_ACTIVITY_DIAGNOSTICS;else process.env.HOLLOW_ACTIVITY_DIAGNOSTICS=previous;}
});
