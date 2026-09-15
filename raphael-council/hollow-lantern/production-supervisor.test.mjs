import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {acquireProductionSingleton,createProductionSupervisor,verifyProductionHealth} from './production-supervisor.mjs';
import {inspectProductionStorage} from './production-launch.mjs';
function fixture({open=true,valid=true,worker=true}={}){
 const calls=[],summary={revision:42,authorityEpoch:9,decisionOpen:open};let clock=0;
 const profile={descriptor:{campaignId:'camp',gmUserId:'gm',publicOrigin:'https://game.example'},env:{}};
 const health={service:'bot-gateway',checks:{production:{campaignId:'camp',storage:'ready',engine:'ready',authentication:'ready',membership:'ready',chronicle:'ready',voice:valid?'ready':'configured',publication:'ready',ai:{state:'ready',uncertain:0},admission:{state:'recovery_held',uncertain:0,needsGm:0},recovery:{held:true}}}};
 const client={recovery:async arg=>{calls.push(arg);return{held:arg.operation==='status',revision:42,authorityEpoch:9};}};
 const supervisor=createProductionSupervisor({profile,prepared:{ports:{healthPort:3010}},ensureStorage:async()=>calls.push('storage'),verifyWorker:async()=>{calls.push('worker');if(!worker)throw Object.assign(Error(),{code:'PRODUCTION_PRIVATE_WORKER_UNVERIFIED'});},acquireSingleton:async()=>async()=>calls.push('unlock'),startEngine:async options=>{assert.equal(options.recoveryMode,'production-held');calls.push('engine');return{summary,client,close:async()=>calls.push('engine-close')};},createNative:()=>({start:async()=>{calls.push('native');return{status:'ready'};},close:async()=>{calls.push('native-close');return{status:'stopped'};}}),readHealth:async()=>health,now:()=>clock,sleep:async ms=>{clock+=ms;},startupTimeoutMs:2000});
 return {supervisor,calls,health};
}
test('verified production release preserves the exact prior running or paused state',async()=>{
 for(const open of [false,true]){const f=fixture({open});const ready=await f.supervisor.start();assert.equal(ready.status,'ready');assert.equal(ready.decisionOpen,open);assert.deepEqual(f.calls.find(c=>c.operation==='release'),{ownerId:'gm',operation:'release',expectedRevision:42,authorityEpoch:9});await f.supervisor.close();assert.deepEqual(f.calls.slice(-3),['native-close','engine-close','unlock']);}
});
test('gateway availability and configured voice cannot release production authority',async()=>{
 const f=fixture({valid:false});assert.equal((await f.supervisor.start()).status,'failed');assert(!f.calls.some(c=>c.operation==='release'));assert.equal((await f.supervisor.done).exitCode,1);
 assert.equal(verifyProductionHealth({service:'bot-gateway',status:'ready'},'camp'),false);
});
test('blocked private worker causes no storage start or engine/native launch',async()=>{
 const f=fixture({worker:false});await f.supervisor.start();assert.deepEqual(f.calls,['worker','unlock']);assert.equal(f.supervisor.status().code,'PRODUCTION_PRIVATE_WORKER_UNVERIFIED');
});
test('unknown receipts and mismatched campaign fail component verification',()=>{
 const f=fixture();f.health.checks.production.admission.uncertain=1;assert.equal(verifyProductionHealth(f.health,'camp'),false);f.health.checks.production.admission.uncertain=0;assert.equal(verifyProductionHealth(f.health,'other'),false);
});
test('storage starts only canonical stopped containers and rejects competing data writers',async()=>{
 const allowed=['davy-postgres','davy-redis','ops-dnd-storage-proxy'];const list=allowed.map(name=>({Names:[name],State:'stopped'})),calls=[];
 const run=async args=>{calls.push(args);if(args[0]==='machine')return JSON.stringify([{State:'running'}]);if(args[0]==='ps')return JSON.stringify(list);if(args[0]==='start'){list.find(c=>c.Names[0]===args[1]).State='running';return'';}assert.fail();};
 assert.equal((await inspectProductionStorage({run,start:true})).state,'ready');assert.deepEqual(calls.filter(c=>c[0]==='start').map(c=>c[1]),allowed);
 list.push({Names:['deployment_postgres_1'],State:'running'});calls.length=0;await assert.rejects(inspectProductionStorage({run,start:true}),{code:'PRODUCTION_DUPLICATE_RUNTIME'});assert(!calls.some(c=>c[0]==='start'));
});


test('stop during engine startup waits for ownership before closing and unlocking',async()=>{
 let enter,finish;const entered=new Promise(r=>enter=r),pending=new Promise(r=>finish=r),calls=[];
 const supervisor=createProductionSupervisor({profile:{descriptor:{campaignId:'camp'}},prepared:{},verifyWorker:async()=>{},ensureStorage:async()=>{},acquireSingleton:async()=>async()=>calls.push('unlock'),startEngine:async()=>{enter();return pending;},createNative:()=>assert.fail('No native startup after stop')});
 const starting=supervisor.start();await entered;const stopping=supervisor.close();assert.deepEqual(calls,[]);finish({close:async()=>calls.push('engine-close')});await starting;await stopping;assert.deepEqual(calls,['engine-close','unlock']);assert.equal((await supervisor.done).exitCode,0);
});


test('OS singleton rejects a second owner and becomes reusable after release',async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const release=await acquireProductionSingleton(port);try{await assert.rejects(acquireProductionSingleton(port),{code:'PRODUCTION_ALREADY_OWNED'});}finally{await release();}
 const again=await acquireProductionSingleton(port);await again();
});
