import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRehearsalSupervisor} from './rehearsal-supervisor.mjs';
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function fixture(mode='ready',appOverride){
 const healthPort=await freePort(),ports={healthPort,appPort:await freePort(),webPort:await freePort()},events=[];let child;
 const prepared={status:'preflight-passed',env:{},activityEnv:{},summary:{campaignId:'fixture'},ports,davyRoot:process.cwd()};
 const supervisor=createRehearsalSupervisor({prepared,projectRoot:process.cwd(),startupTimeoutMs:mode==='timeout'?120:3000,shutdownTimeoutMs:mode==='stubborn'?50:1000,
  forkImpl:(path,args,options)=>{
   assert.match(path,/owned-rehearsal\.mjs$/);assert.deepEqual(options.execArgv,[]);assert.equal(options.windowsHide,true);
   const script=`import {createServer} from 'node:http';let server;const timer=setTimeout(()=>process.exit(2),10000);process.on('message',async m=>{if(m.type==='stop'&&${JSON.stringify(mode)}==='stubborn')return;if(m.type==='stop'||m.type==='release'){if(server)await new Promise(r=>server.close(r));clearTimeout(timer);process.exit(0);}});if(${JSON.stringify(mode)}==='failed'){process.send({type:'failed'});}else if(${JSON.stringify(mode)}!=='timeout'){server=createServer((q,r)=>{r.end(JSON.stringify({service:'bot-gateway',status:'ready'}));});server.listen(${healthPort},'127.0.0.1',()=>process.send({type:'initialized'}));}`;
   child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});child.once('exit',()=>events.push('native-exit'));return child;
  },
  createApp:appOverride??(options=>{assert.equal(options.forceOnTimeout,false);return {async start(){events.push('app-start');return {status:mode==='app-failed'?'blocked':'ready'};},async close(){events.push('app-close');return {status:'stopped'};}};})
 });return {supervisor,events,get child(){return child;}};
}
test('actual owned child readiness precedes app and close drains app before native exit',async()=>{
 const f=await fixture();assert.equal((await f.supervisor.start()).status,'ready');assert.deepEqual(f.events,['app-start']);assert.equal((await f.supervisor.close()).status,'stopped');assert.deepEqual(f.events,['app-start','app-close','native-exit']);assert.equal((await f.supervisor.done).exitCode,0);
});
for(const mode of ['failed','timeout','app-failed'])test(`startup ${mode} shuts down its child and reports failure`,async()=>{
 const f=await fixture(mode);assert.equal((await f.supervisor.start()).status,'failed');assert.equal((await f.supervisor.done).exitCode,1);assert.ok(f.events.includes('native-exit'));if(mode!=='app-failed')assert.equal(f.events.includes('app-start'),false);
});
test('stop while native startup is pending never starts app',async()=>{
 const f=await fixture('timeout');const starting=f.supervisor.start();while(!f.child)await new Promise(r=>setTimeout(r,5));await f.supervisor.close();await starting;assert.equal(f.events.includes('app-start'),false);assert.equal((await f.supervisor.done).status,'stopped');
});
test('shutdown timeout remains blocked until its actual owned child exits',async()=>{
 const f=await fixture('stubborn');await f.supervisor.start();
 try{
  assert.equal((await f.supervisor.close()).status,'blocked');assert.equal(f.child.exitCode,null);
  const settled=await Promise.race([f.supervisor.done.then(()=>true),new Promise(r=>setTimeout(()=>r(false),50))]);assert.equal(settled,false);
 }finally{f.child.send({type:'release'});}
 assert.equal((await f.supervisor.done).status,'stopped');assert.deepEqual(f.events,['app-start','app-close','native-exit']);
});
test('native remains owned and running until blocked app cleanup actually finishes',async()=>{
 let release;const appDone=new Promise(resolve=>{release=resolve;});let appCloses=0;
 const f=await fixture('ready',()=>({done:appDone,start:async()=>({status:'ready'}),close:async()=>{appCloses++;return {status:'blocked'};}}));
 await f.supervisor.start();
 try{assert.equal((await f.supervisor.close()).status,'blocked');assert.equal(appCloses,1);assert.equal(f.child.exitCode,null);assert.deepEqual(f.events,[]);}finally{release({exitCode:0});}
 assert.equal((await f.supervisor.done).status,'stopped');assert.deepEqual(f.events,['native-exit']);
});
test('existing health listener is refused without spawning or adopting it',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let spawned=false;
 try{const supervisor=createRehearsalSupervisor({prepared:{status:'preflight-passed',env:{},activityEnv:{},ports:{healthPort:server.address().port,appPort:await freePort(),webPort:await freePort()},davyRoot:process.cwd()},projectRoot:process.cwd(),forkImpl:()=>{spawned=true;throw Error();}});assert.equal((await supervisor.start()).status,'failed');assert.equal(spawned,false);assert.equal(server.listening,true);}finally{await new Promise(r=>server.close(r));}
});
