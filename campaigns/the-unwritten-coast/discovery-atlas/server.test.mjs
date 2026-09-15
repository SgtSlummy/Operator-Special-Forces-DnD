import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {initialState} from './model.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServers} from './server.mjs';
import {fixture} from './fixture.mjs';
test('separate public server cannot expose source, secrets or mutate; GM checks and atomic queue',async()=>{
 const root=await mkdtemp(join(tmpdir(),'discovery-atlas-test-'));const stateFile=join(root,'state.json');const servers=await startServers({catalog:fixture,root,stateFile,gmPort:0,publicPort:0});
 try{const gm=`http://127.0.0.1:${servers.gm.address().port}`,pub=`http://127.0.0.1:${servers.public.address().port}`;
 await mkdir(join(root,'art'));await writeFile(join(root,'art','entry.png'),'PUBLIC_IMAGE');await writeFile(join(root,'art','secret-room-CANARY.png'),'SECRET_IMAGE_CANARY');
 assert.equal(await(await fetch(pub+'/art/room/entry.png')).text(),'PUBLIC_IMAGE');assert.equal((await fetch(pub+'/art/room/secret-room-CANARY.png')).status,404);assert.equal((await fetch(pub+'/art/secret-room-CANARY.png')).status,404);assert.equal(await(await fetch(gm+'/art/room/secret-room-CANARY.png')).text(),'SECRET_IMAGE_CANARY');
 assert(!(await(await fetch(gm+'/api/player-state')).text()).includes('CANARY'));
 await writeFile(join(root,'index.html'),'<!doctype html><title>Atlas fixture</title>');for(const base of [gm,pub]){const response=await fetch(base+'/');assert.equal(response.status,200);const policy=response.headers.get('content-security-policy');const directives=new Map(policy.split(';').map(d=>d.trim().split(/\s+/)).filter(p=>p[0]).map(([name,...values])=>[name,values]));assert.deepEqual(directives.get('img-src'),["'self'",'data:','blob:']);for(const name of ['default-src','script-src','style-src','connect-src'])assert.deepEqual(directives.get(name),["'self'"]);assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);}
 const initial=await(await fetch(gm+'/api/state')).json();assert(initial.capability);const player=await(await fetch(pub+'/api/state?audience=gm')).text();assert(!player.includes('CANARY'));assert(!player.includes(initial.capability));
 for(const path of ['/catalog.mjs','/model.mjs','/server.mjs','/state.json','/../catalog.mjs','/%2e%2e/catalog.mjs','/api/state/secret','/art/secret.png']){const r=await fetch(pub+path);assert.equal(r.status,404,path);assert(!(await r.text()).includes('CANARY'));}
 const body=JSON.stringify({type:'revealRoom',roomId:'next',reason:'Test'});const headers={'content-type':'application/json',origin:gm,'x-atlas-capability':initial.capability};
 assert.equal((await fetch(pub+'/api/action',{method:'POST',headers:{...headers,origin:pub},body})).status,404);
 assert.equal((await fetch(gm+'/api/action',{method:'POST',headers:{...headers,origin:'http://evil.invalid'},body})).status,403);
 assert.equal((await fetch(gm+'/api/action',{method:'POST',headers:{...headers,'x-atlas-capability':'bad'},body})).status,403);
 assert.equal((await fetch(gm+'/api/action',{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,415);
 assert.equal(await new Promise((yes,no)=>http.get(gm+'/api/state',{headers:{host:'evil.invalid'}},r=>{r.resume();yes(r.statusCode);}).on('error',no)),403);
 assert.equal((await fetch(pub+'/api/discord?room=secret-room-CANARY')).status,400);
 const results=await Promise.all(Array.from({length:5},()=>fetch(gm+'/api/action',{method:'POST',headers,body})));assert(results.every(r=>r.status===200));
 const saved=JSON.parse(await readFile(stateFile,'utf8'));assert.equal(saved.revision,5);assert.equal(saved.history.length,5);
 const after=await(await fetch(pub+'/api/state')).text();assert(!after.includes('CANARY'));assert(!after.includes(initial.capability));
 }finally{await servers.close();await rm(root,{recursive:true,force:true});}
});
test('transient Windows locks retry atomically; exhausted locks preserve saved and in-memory state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-lock-test-')),stateFile=join(root,'state.json');await writeFile(stateFile,JSON.stringify(initialState(fixture)));let attempts=0,blocked=false;
 const servers=await startServers({catalog:fixture,root,stateFile,gmPort:0,publicPort:0,renameFile:async(from,to)=>{attempts++;const disk=JSON.parse(await readFile(to,'utf8'));assert.equal(disk.revision,blocked?1:0);if(blocked||attempts<=3){const error=new Error('SECRET_ABSOLUTE_PATH '+to);error.code=['EBUSY','EPERM','EACCES'][(attempts-1)%3];throw error;}await rename(from,to);}});
 try{const gm=`http://127.0.0.1:${servers.gm.address().port}`;const initial=await(await fetch(gm+'/api/state')).json();const headers={origin:gm,'content-type':'application/json','x-atlas-capability':initial.capability};const send=()=>fetch(gm+'/api/action',{method:'POST',headers,body:JSON.stringify({type:'revealRoom',roomId:'next',reason:'Test'})});const success=await send();assert.equal(success.status,200);assert.equal(attempts,4);assert.equal(JSON.parse(await readFile(stateFile,'utf8')).revision,1);blocked=true;const failure=await send();assert.equal(failure.status,400);const message=await failure.text();assert(message.includes('not applied'));assert(!message.includes('SECRET_ABSOLUTE_PATH'));assert(!message.includes(root));assert.equal(attempts,10);assert.equal(JSON.parse(await readFile(stateFile,'utf8')).revision,1);assert.equal((await(await fetch(gm+'/api/state')).json()).state.revision,1);
 }finally{await servers.close();await rm(root,{recursive:true,force:true});}
});
test('Discord webhook delivery is GM-only, origin checked, destination fixed, projected and idempotent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'discovery-discord-test-'));let calls=0,observed;let fail=false;
 const servers=await startServers({catalog:fixture,root,stateFile:join(root,'state.json'),gmPort:0,publicPort:0,deliveryFetch:async(url,options)=>{calls++;observed={url,options};await new Promise(r=>setTimeout(r,30));if(fail)throw new Error('SECRET_TOKEN_CANARY '+url);return {ok:true,json:async()=>({id:'123456789'})};}});
 try{await mkdir(join(root,'art'));await writeFile(join(root,'art','entry.png'),'PUBLIC_SCENE');const gm=`http://127.0.0.1:${servers.gm.address().port}`,pub=`http://127.0.0.1:${servers.public.address().port}`;const initial=await(await fetch(gm+'/api/state')).json();assert.deepEqual(initial.discord,{configured:false});const headers={origin:gm,'content-type':'application/json','x-atlas-capability':initial.capability};const post=(path,body,h=headers,base=gm)=>fetch(base+path,{method:'POST',headers:h,body:JSON.stringify(body)});
 const endpoint='https://discord.com/api/webhooks/123456/SECRET_TOKEN_CANARY';
 for(const webhookUrl of ['http://discord.com/api/webhooks/1/token','https://evil.invalid/api/webhooks/1/token',endpoint+'?x=1',endpoint+'#x',endpoint.replace('discord.com','discord.com:443'),endpoint.replace('discord.com','discord.com@evil.invalid')])assert.equal((await post('/api/discord/connect',{webhookUrl})).status,400);
 assert.equal((await post('/api/discord/connect',{webhookUrl:endpoint},{...headers,origin:pub},pub)).status,404);
 assert.equal((await post('/api/discord/connect',{webhookUrl:endpoint},{...headers,origin:'https://evil.invalid'})).status,403);
 assert.deepEqual(await(await post('/api/discord/connect',{webhookUrl:endpoint})).json(),{configured:true});
 const gmState=await(await fetch(gm+'/api/state')).text(),publicState=await(await fetch(pub+'/api/state')).text();assert(!gmState.includes('SECRET_TOKEN'));assert(!publicState.includes('configured'));assert(!publicState.includes('SECRET_TOKEN'));
 const action={roomId:'entry',threadId:'1548380866386858175',idempotencyKey:'request_000000000001'};
 assert.equal((await post('/api/discord/send',action,{...headers,origin:pub},pub)).status,404);
 assert.equal((await post('/api/discord/send',{...action,threadId:'999999'})).status,400);
 assert.equal((await post('/api/discord/send',{...action,roomId:'secret-room-CANARY'})).status,400);
 assert.equal((await post('/api/discord/send',{...action,roomId:'../entry'})).status,400);
 const replies=await Promise.all(Array.from({length:3},()=>post('/api/discord/send',action).then(r=>r.json())));assert.equal(calls,1);assert(replies.every(r=>r.messageId==='123456789'));assert.equal(replies[0].link,'https://discord.com/channels/1463393482306486387/1548380866386858175/123456789');
 assert.equal(observed.options.redirect,'error');assert.equal(observed.url,endpoint+'?wait=true&thread_id=1548380866386858175');const payload=JSON.parse(observed.options.body.get('payload_json'));assert(!JSON.stringify(payload).includes('CANARY'));assert.equal(payload.content,'Atlas presentation preview · no new player actions');assert.deepEqual(payload.allowed_mentions.parse,[]);assert.equal(await observed.options.body.get('files[0]').text(),'PUBLIC_SCENE');assert.equal(observed.options.body.get('files[0]').name,'entry-scene.png');
 assert.equal((await post('/api/discord/send',{...action,threadId:'1548204446838689882'})).status,400);assert.equal(calls,1);
 fail=true;const uncertain={...action,idempotencyKey:'request_000000000002'};for(let i=0;i<2;i++){const response=await post('/api/discord/send',uncertain);assert.equal(response.status,400);const text=await response.text();assert(!text.includes('SECRET_TOKEN'));assert(!text.includes('discord.com/api'));assert(text.includes('unknown'));}assert.equal(calls,2);
 }finally{await servers.close();await rm(root,{recursive:true,force:true});}
});
