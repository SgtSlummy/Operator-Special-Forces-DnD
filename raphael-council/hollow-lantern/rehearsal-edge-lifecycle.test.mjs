import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {createRehearsalSupervisor} from './rehearsal-supervisor.mjs';
import {createActivityEdge} from './activity-edge.mjs';
import {runRehearsalCli} from './rehearsal-launch.mjs';
const origin='https://table.example.test';
test('CLI opens the ready supervisor canonical address',async()=>{
 const lines=[];
 await runRehearsalCli({args:['--start','--binding','fixture.json'],prepare:async()=>({ports:{appPort:18796}}),createSupervisor:()=>({start:async()=>({status:'ready',url:origin}),done:Promise.resolve({status:'stopped',exitCode:0})}),input:new EventEmitter(),lifecycle:new EventEmitter(),write:line=>lines.push(line)});
 assert.deepEqual(lines,[`Open ${origin}\nType stop and press Enter to close this rehearsal.`]);
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
 const events=[],probes=[];let edge,child;
 const prepared={status:'preflight-passed',davyRoot:resolve('../Davy Jones'),env:{},activityEnv:{RAPHAEL_PUBLIC_ORIGIN:origin,DISCORD_CLIENT_ID:'1540006061099188274'},ports:{healthPort:3010,appPort:18796,webPort:18812}};
 const supervisor=createRehearsalSupervisor({prepared,projectRoot:resolve('.'),startupTimeoutMs:1000,shutdownTimeoutMs:1000,
  probePort:async port=>{probes.push(port);return options.occupied!==port;},probeGateway:async()=>true,
  forkImpl:()=>{events.push('native-start');child=new EventEmitter();child.pid=100;child.connected=true;child.send=()=>{events.push('native-stop');queueMicrotask(()=>child.emit('exit',0));};queueMicrotask(()=>child.emit('message',{type:'initialized'}));return child;},
  createApp:()=>({start:async()=>{events.push('app-start');return {status:'ready'};},close:async()=>{events.push('app-stop');return {status:'stopped'};}}),
  createEdge:config=>{assert.deepEqual(config,{port:18805,publicOrigin:origin,clientId:prepared.activityEnv.DISCORD_CLIENT_ID});edge=options.edge??createActivityEdge({...config,port:0});return {server:edge.server,start:async()=>{events.push('edge-start');return edge.start();},close:async()=>{events.push('edge-stop');return edge.close();}};}
 });
 return {supervisor,events,probes,get edge(){return edge;}};
}
test('owned rehearsal starts a real loopback edge and drains it before app and native',async()=>{
 const f=fixture();try{
  const report=await f.supervisor.start();assert.equal(report.status,'ready');assert.equal(report.url,origin);
  assert.deepEqual(f.probes,[3010,18812,18796,18805]);assert.equal(f.edge.server.address().address,'127.0.0.1');
  assert.deepEqual(f.events,['native-start','app-start','edge-start']);
  await f.supervisor.close();assert.equal((await f.supervisor.done).exitCode,0);assert.equal(f.edge.server.address(),null);
  assert.deepEqual(f.events,['native-start','app-start','edge-start','edge-stop','app-stop','native-stop']);
 }finally{await f.supervisor.close();}
});
test('occupied secure entry port is refused before creating any owned service',async()=>{
 const f=fixture({occupied:18805});assert.equal((await f.supervisor.start()).status,'failed');assert.equal((await f.supervisor.done).exitCode,1);assert.deepEqual(f.events,[]);
});
test('edge bind failure drains app and native without claiming readiness',async()=>{
 const server=new EventEmitter();const f=fixture({edge:{server,start:async()=>{throw Error('bind failed');},close:async()=>{server.emit('close');}}});
 assert.equal((await f.supervisor.start()).status,'failed');assert.equal((await f.supervisor.done).exitCode,1);
 assert.deepEqual(f.events,['native-start','app-start','edge-start','edge-stop','app-stop','native-stop']);
});
test('stop during edge startup waits for startup settlement then closes all owners',async()=>{
 const gate=deferred(),entered=deferred(),server=new EventEmitter();
 const f=fixture({edge:{server,start:async()=>{entered.resolve();await gate.promise;},close:async()=>{server.emit('close');}}});
 const starting=f.supervisor.start();await entered.promise;const closing=f.supervisor.close();assert.equal(f.events.includes('app-stop'),false);
 gate.resolve();await starting;await closing;assert.equal((await f.supervisor.done).exitCode,0);
 assert.deepEqual(f.events,['native-start','app-start','edge-start','edge-stop','app-stop','native-stop']);
});
test('unexpected edge loss stops owned app and native and reports failure',async()=>{
 const f=fixture();await f.supervisor.start();await f.edge.close();const report=await f.supervisor.done;
 assert.equal(report.exitCode,1);assert.ok(f.events.indexOf('app-stop')<f.events.indexOf('native-stop'));assert.equal(f.edge.server.address(),null);
});
