import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {appHealth} from './app-health.mjs';
import {createAppHost,inspectWeb,inspectApp,appEnvironment} from './app-launch.mjs';

const env={...process.env,HOLLOW_LANTERN_CAMPAIGN_ID:'fixture-app',RAPHAEL_CAMPAIGN_ID:'fixture-app',DISCORD_CLIENT_ID:'1540006061099188274'};
const available={status:'ready-to-start',checks:[]};
const readyWeb=async()=>({status:'running'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('normal app configuration preserves saved campaign after a fresh launcher read',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'app-selection-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const baseFile=join(dir,'base.env'),nativeFile=join(dir,'native.env'),campaignFile=join(dir,'campaign.env');
 await writeFile(baseFile,'DISCORD_TOKEN=fixture\nDISCORD_CLIENT_ID=1540006061099188274\nDISCORD_CLIENT_SECRET=fixture\n');
 const common={HOLLOW_LANTERN_CAMPAIGN_ID:'original',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18791',HOLLOW_LANTERN_SECRET_FILE:join(dir,'secret'),HOLLOW_LANTERN_STORE_FILE:join(dir,'store'),HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(dir,'auth'),HOLLOW_LANTERN_ART_ROOT:join(dir,'art'),HOLLOW_LANTERN_CHANNEL_ID:'1546676505780944979',HOLLOW_LANTERN_GUILD_ID:'1463393482306486387',HOLLOW_LANTERN_GM_ID:'1230264975533281312'};
 const serialize=value=>Object.entries(value).map(([key,value])=>`${key}='${value}'`).join('\n');
 await writeFile(nativeFile,serialize(common));
 await writeFile(campaignFile,serialize({...common,HOLLOW_LANTERN_CAMPAIGN_ID:'rehearsal',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18810',HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(dir,'rehearsal-auth')}));
 const options={projectRoot:dir,inherited:{HOLLOW_ACTIVITY_BASE_ENV_FILE:baseFile,HOLLOW_ACTIVITY_NATIVE_ENV_FILE:nativeFile}};
 assert.equal((await appEnvironment(options)).HOLLOW_LANTERN_CAMPAIGN_ID,'original');
 await mkdir(join(dir,'.runtime/hollow-lantern'),{recursive:true});await writeFile(join(dir,'.runtime/hollow-lantern/activity-selection.json'),JSON.stringify({version:1,campaignFile}));
 for(let i=0;i<2;i++){const actual=await appEnvironment(options);assert.equal(actual.HOLLOW_LANTERN_CAMPAIGN_ID,'rehearsal');assert.equal(actual.HOLLOW_LANTERN_ENGINE_URL,'http://127.0.0.1:18810');assert.equal(actual.HOLLOW_LANTERN_ACTIVITY_DATA_DIR,join(dir,'rehearsal-auth'));}
 assert.equal((await appEnvironment({...options,inherited:{...options.inherited,HOLLOW_ACTIVITY_CAMPAIGN_ENV_FILE:nativeFile}})).HOLLOW_LANTERN_CAMPAIGN_ID,'original');
});
async function server(t,handler){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return server.address().port;}
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function options(extra={}){
 const lifecycle=new EventEmitter(),calls=[];let child;
 const result={env,port:18797,lifecycle,inspect:async()=>available,prepare:async()=>({id:'fixture-release',outDir:'fixture-output'}),probeWeb:readyWeb,startupTimeoutMs:100,shutdownTimeoutMs:30,
 spawnImpl:(_node,args,opts)=>{
  calls.push({args,opts});child=new EventEmitter();child.pid=123;child.connected=true;
  child.send=(message,callback)=>{assert.deepEqual(message,{type:'stop'});callback?.();queueMicrotask(()=>child.emit('exit',0));};
  child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};
  queueMicrotask(()=>child.emit('message',{type:'listening',instance:opts.env.HOLLOW_APP_INSTANCE,port:Number(opts.env.HOLLOW_APP_PORT)}));return child;
 },...extra};return {options:result,calls,get child(){return child;}};
}

test('liveness returns bounded public identifiers without opening authorization or revealing configuration',async()=>{
 const response=appHealth({...env,DISCORD_CLIENT_SECRET:'secret',HOLLOW_LANTERN_STORE_FILE:'private-path'}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.status,'listening');assert.equal(body.instance,null);
 assert.equal(JSON.stringify(body).includes('secret'),false);assert.equal(JSON.stringify(body).includes('private-path'),false);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(appHealth({...env,RAPHAEL_CAMPAIGN_ID:'different'}).status,503);
});
test('an occupied unrelated port cannot be mistaken for a stopped or ready app',async t=>{
 const port=await server(t,(_req,res)=>{res.end('private unexpected body');});
 const result=await inspectWeb({port,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID,clientId:env.DISCORD_CLIENT_ID});
 assert.equal(result.status,'blocked');assert.equal(JSON.stringify(result).includes('private unexpected'),false);
});
test('HTTP readiness verifies campaign and the owned instance, without calling auth endpoints',async t=>{
 const calls=[];const port=await server(t,async(req,res)=>{calls.push(req.url);const response=appHealth({...env,HOLLOW_APP_INSTANCE:'00000000-0000-0000-0000-000000000001'});res.setHeader('content-type','application/json');res.end(await response.text());});
 const input={port,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID,clientId:env.DISCORD_CLIENT_ID};
 assert.equal((await inspectWeb(input)).status,'running');assert.equal((await inspectWeb({...input,campaignId:'wrong'})).status,'blocked');assert.equal((await inspectWeb({...input,instance:'wrong'})).status,'blocked');
 assert.deepEqual(calls,['/api/health','/api/health','/api/health']);
});
test('stalled and oversized web readiness responses fail within the deadline',async t=>{
 const port=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});
 assert.equal((await inspectWeb({port,timeoutMs:25})).status,'blocked');
 const large=await server(t,(_req,res)=>res.end('x'.repeat(5000)));
 assert.equal((await inspectWeb({port:large})).status,'blocked');
});
test('read-only checks stop at a failed prerequisite and never prepare a build',async()=>{
 const result=await inspectApp({env,readiness:async()=>({status:'blocked',checks:[{id:'save'}]}),probeWeb:()=>{throw Error('must not call');}});
 assert.equal(result.status,'blocked');assert.deepEqual(result.checks,[{id:'save'}]);
 assert.equal((await inspectApp({env,readiness:async()=>({status:'ready'}),probeWeb:async()=>({status:'running'})})).status,'already-running');
 assert.equal((await inspectApp({env,projectRoot:join(tmpdir(),'missing-app-'+Date.now()),readiness:async()=>({status:'ready'}),probeWeb:async()=>({status:'stopped'})})).status,'blocked');
});
test('existing app and failed prerequisites start no child or release snapshot',async()=>{
 for(const status of ['already-running','blocked']){
  const f=options({inspect:async()=>({status}),prepare:()=>{throw Error('must not snapshot');}}),host=createAppHost(f.options);
  assert.equal((await host.start()).status,status);assert.equal(f.calls.length,0);assert.equal((await host.done).exitCode,status==='blocked'?1:0);assert.equal(f.options.lifecycle.listenerCount('SIGINT'),0);
 }
});
test('start is idempotent and graceful stop targets only the child it created',async()=>{
 const f=options(),host=createAppHost(f.options);const [a,b]=await Promise.all([host.start(),host.start()]);
 assert.equal(a.status,'ready');assert.deepEqual(a,b);assert.equal(f.calls.length,1);assert.equal(f.calls[0].opts.shell,false);assert.equal(f.calls[0].opts.windowsHide,true);
 assert.equal((await host.close()).status,'stopped');assert.equal((await host.done).exitCode,0);assert.equal(f.options.lifecycle.listenerCount('SIGTERM'),0);
});
test('cancelling a pending prerequisite or snapshot cannot create a late web child',async()=>{
 for(const phase of ['inspect','prepare']){
  let release,entered;const began=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});
  const f=options({[phase]:async()=>{entered();return pending;}}),host=createAppHost(f.options),starting=host.start();await began;await host.close();
  release(phase==='inspect'?available:{id:'late',outDir:'late'});assert.equal((await starting).status,'stopped');assert.equal(f.calls.length,0);assert.equal((await host.done).exitCode,0);
 }
});
test('failed spawn and missing handshake do not report ready or retain owned processes',async()=>{
 for(const mode of ['throw','error','silent']){
  let kills=0;const f=options({spawnImpl:()=>{
   if(mode==='throw')throw Error('private exception');
   const child=new EventEmitter();child.pid=mode==='error'?undefined:123;child.connected=false;
   child.kill=()=>{kills++;queueMicrotask(()=>child.emit('exit',0));return true;};
   if(mode==='error')queueMicrotask(()=>child.emit('error',Error('private failure')));return child;
  },startupTimeoutMs:25}),host=createAppHost(f.options);
  const result=await host.start();assert.equal(result.status,'blocked');assert.equal((await host.done).exitCode,1);assert.equal(JSON.stringify(result).includes('private failure'),false);if(mode==='silent')assert.equal(kills,1);
 }
});
test('failed HTTP handshake stops the owned child and unexpected clean exit is still a failure',async()=>{
 const f=options({probeWeb:async()=>({status:'blocked'})}),host=createAppHost(f.options);assert.equal((await host.start()).status,'blocked');assert.equal((await host.done).exitCode,1);
 const g=options(),running=createAppHost(g.options);await running.start();g.child.emit('exit',0);assert.equal((await running.done).exitCode,1);assert.equal(running.status().status,'blocked');
});
test('exit during the HTTP readiness probe settles completion and releases signal handlers',async()=>{
 let release,entered;const began=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});
 const f=options({probeWeb:async()=>{entered();return pending;}}),host=createAppHost(f.options),starting=host.start();await began;
 f.child.emit('exit',0);release({status:'running'});assert.equal((await starting).status,'blocked');assert.equal((await host.done).exitCode,1);assert.equal(f.options.lifecycle.listenerCount('SIGTERM'),0);
});
test('late child exit completes cleanup after a shutdown timeout without claiming an early stop',async()=>{
 const f=options({shutdownTimeoutMs:5}),host=createAppHost(f.options);await host.start();
 f.child.send=(_message,callback)=>callback?.();f.child.kill=()=>true;
 assert.equal((await host.close()).status,'blocked');let complete=false;void host.done.then(()=>{complete=true;});await pause(5);assert.equal(complete,false);
 f.child.emit('exit',0);assert.equal((await host.done).exitCode,1);assert.equal(f.options.lifecycle.listenerCount('SIGTERM'),0);
});

async function builtFixture(t){
 const directory=await mkdtemp(join(tmpdir(),'hollow app execution '));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const name of ['dist/server','dist/client','hollow-lantern'])await mkdir(join(directory,name),{recursive:true});
 await writeFile(join(directory,'hollow-lantern/app-server.mjs'),`import ${JSON.stringify(new URL('./app-server.mjs',import.meta.url).href)};`);
 await writeFile(join(directory,'dist/server/index.js'),`export default request=>new URL(request.url).pathname==='/api/health'?Response.json({service:'hollow-lantern-web',version:1,status:'listening',campaignId:process.env.HOLLOW_LANTERN_CAMPAIGN_ID,clientId:process.env.DISCORD_CLIENT_ID,instance:process.env.HOLLOW_APP_INSTANCE}):new Response('<!doctype html><h1>Disposable app</h1>',{headers:{'Content-Type':'text/html'}});`);
 await writeFile(join(directory,'dist/client/fixture.js'),'// disposable client asset');return directory;
}
test('real immutable Vinext child starts, serves HTTP, refuses duplication, and closes',async t=>{
 const projectRoot=await builtFixture(t),port=await freePort(),lifecycle=new EventEmitter();
 const host=createAppHost({env,projectRoot,port,lifecycle,inspect:async()=>available,startupTimeoutMs:15000});t.after(()=>host.close());
 const result=await host.start();assert.equal(result.status,'ready');assert.match(await(await fetch(result.url)).text(),/Disposable app/);
 const second=createAppHost({env,projectRoot,port,lifecycle,inspect:args=>inspectApp({...args,readiness:async()=>({status:'ready'})})});
 assert.equal((await second.start()).status,'already-running');await second.close();assert.equal((await fetch(result.url)).status,200);
 await host.close();assert.equal((await host.done).exitCode,0);assert.equal((await inspectWeb({port})).status,'stopped');
});
test('parent disconnect while the real server imports closes any late-created listener',async t=>{
 const projectRoot=await builtFixture(t),port=await freePort();
 await writeFile(join(projectRoot,'dist/server/index.js'),`await new Promise(resolve=>setTimeout(resolve,150));export default()=>new Response('fixture');`);
 const child=spawn(process.execPath,[join(projectRoot,'hollow-lantern/app-server.mjs')],{cwd:projectRoot,env:{...env,HOLLOW_APP_PORT:String(port),HOLLOW_APP_RELEASE_DIR:join(projectRoot,'dist'),HOLLOW_APP_INSTANCE:'00000000-0000-0000-0000-000000000001'},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,shell:false});
 t.after(()=>{if(child.exitCode===null)child.kill();});const exit=once(child,'exit');await once(child,'spawn');child.disconnect();
 const timeout=setTimeout(()=>child.kill(),10000);try{await exit;}finally{clearTimeout(timeout);}
 await pause(30);assert.equal(child.signalCode,null);assert.equal((await inspectWeb({port})).status,'stopped');
});
