import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {startSavedEngine} from './engine-launch.mjs';
import {createRehearsalSupervisor} from './rehearsal-supervisor.mjs';
import {ObusTransport} from '../ai/obus.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function acquireProductionSingleton(port=18806){
 if(!Number.isInteger(port)||port<1024||port>65535)fail('PRODUCTION_SINGLETON_PORT_INVALID');
 const server=net.createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',()=>reject(Object.assign(Error('PRODUCTION_ALREADY_OWNED'),{code:'PRODUCTION_ALREADY_OWNED'})));server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});
 return ()=>new Promise(resolve=>server.close(resolve));
}
export function verifyProductionHealth(value,campaignId,{held=true}={}){
 const p=value?.checks?.production;
 if(value?.service!=='bot-gateway'||!p||p.campaignId!==campaignId)return false;
 return ['storage','engine','authentication','membership','chronicle','voice','publication'].every(k=>p[k]==='ready')&&p.ai?.state==='ready'&&p.ai.uncertain===0&&['ready','recovery_held'].includes(p.admission?.state)&&p.admission.uncertain===0&&p.admission.needsGm===0&&p.recovery?.held===held;
}
export async function readProductionHealth(port,{fetchImpl=fetch}={}){
 const response=await fetchImpl(`http://127.0.0.1:${port}/health/ready`,{redirect:'error',signal:AbortSignal.timeout(2500),cache:'no-store'});
 if(!response.body)fail('PRODUCTION_HEALTH_UNAVAILABLE');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>32768)fail('PRODUCTION_HEALTH_INVALID');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString());
}
export async function verifyPrivateGameWorker(profile){
 if(profile.descriptor.obusUrl!=='http://127.0.0.1:38178')fail('PRODUCTION_OBUS_BINDING_INVALID');
 const serviceToken=(await readFile(profile.descriptor.serviceTokenFile,'utf8')).trim();
 try{await new ObusTransport({url:profile.descriptor.obusUrl,serviceToken}).capabilities();}catch{fail('PRODUCTION_PRIVATE_WORKER_UNVERIFIED');}
}

/** Children are always newly owned; a failed launch cannot adopt or kill others. */
export function createProductionSupervisor({profile,prepared,projectRoot,davyRoot,executable,outputRoot,ensureStorage,verifyWorker=verifyPrivateGameWorker,startEngine=startSavedEngine,createNative=createRehearsalSupervisor,readHealth=readProductionHealth,acquireSingleton=acquireProductionSingleton,now=Date.now,sleep=wait,startupTimeoutMs=300000}={}){
 if(!profile?.descriptor||typeof ensureStorage!=='function')fail('PRODUCTION_SUPERVISOR_CONFIGURATION_INVALID');
 let monitor,monitorFlight,engine,native,unlock,startFlight,closeFlight,stopping=false,starting=false,terminal=false,failureCode=null,report={status:'idle'};let resolveDone;
 const done=new Promise(resolve=>{resolveDone=resolve;});
 const status=()=>structuredClone(report);
 async function close({fromStart=false}={}){
  stopping=true;clearInterval(monitor);if(starting&&!fromStart){if(native)void Promise.resolve().then(()=>native.close()).catch(()=>{});return startFlight.then(()=>close({fromStart:true}));}if(closeFlight)return closeFlight;
  closeFlight=(async()=>{let clean=true;if(native){try{const result=await native.close();if(!['stopped','failed'].includes(result?.status))clean=false;}catch{clean=false;}}
   if(!clean){report={status:'blocked',code:'PRODUCTION_CHILD_SHUTDOWN_PENDING'};closeFlight=null;return status();}
   if(engine){try{await engine.close();}catch{clean=false;}}
   if(!clean){report={status:'blocked',code:'PRODUCTION_ENGINE_SHUTDOWN_PENDING'};closeFlight=null;return status();}
   await unlock?.();unlock=null;const previous=report;report={status:failureCode?'failed':'stopped',...(failureCode?{code:failureCode}:previous.code?{code:previous.code}:{})};if(!terminal){terminal=true;resolveDone({...report,exitCode:report.status==='failed'?1:0});}return status();
  })();return closeFlight;
 }
 function start(){if(startFlight)return startFlight;if(stopping)return Promise.resolve(status());starting=true;startFlight=(async()=>{
  try{
   const began=now(),deadline=began+startupTimeoutMs;report={status:'checking'};unlock=await acquireSingleton(profile.descriptor.supervisorPort??18806);closeFlight=null;if(stopping)return close({fromStart:true});
   await verifyWorker(profile);if(stopping)return close({fromStart:true});await ensureStorage();if(stopping)return close({fromStart:true});
   if(now()>=deadline)fail('PRODUCTION_STARTUP_TIMEOUT');
   engine=await startEngine({env:profile.env,executable,outputRoot,recoveryMode:'production-held',startupTimeoutMs:Math.min(60000,Math.max(1,deadline-now()))});closeFlight=null;
   if(stopping)return close({fromStart:true});
   native=createNative({prepared,projectRoot,davyRoot,startupTimeoutMs:Math.min(Math.max(1,deadline-now()),120000)});closeFlight=null;
   const nativeStarted=await native.start();if(stopping)return close({fromStart:true});if(nativeStarted.status!=='ready')fail('PRODUCTION_NATIVE_START_FAILED');
   report={status:'verifying'};let verified=false;
   while(!stopping&&now()<deadline){try{verified=verifyProductionHealth(await readHealth(prepared.ports.healthPort),profile.descriptor.campaignId);}catch{}if(verified)break;await sleep(1000);}
   if(stopping)return close({fromStart:true});if(!verified)fail('PRODUCTION_COMPONENT_READINESS_FAILED');
   const gate=await engine.client.recovery({ownerId:profile.descriptor.gmUserId,operation:'status'});if(stopping)return close({fromStart:true});
   if(!gate.held||gate.revision!==engine.summary.revision||gate.authorityEpoch!==engine.summary.authorityEpoch)fail('PRODUCTION_RECOVERY_STATE_CHANGED');
   await engine.client.recovery({ownerId:profile.descriptor.gmUserId,operation:'release',expectedRevision:gate.revision,authorityEpoch:gate.authorityEpoch});
   report={status:'ready',campaignId:profile.descriptor.campaignId,url:profile.descriptor.publicOrigin,decisionOpen:engine.summary.decisionOpen,startupElapsedMs:now()-began,releaseAccepted:false};
   let failures=0;monitor=setInterval(()=>{if(stopping||monitorFlight)return;monitorFlight=(async()=>{let healthy=false;try{healthy=verifyProductionHealth(await readHealth(prepared.ports.healthPort),profile.descriptor.campaignId,{held:false});}catch{}if(stopping)return;failures=healthy?0:failures+1;if(failures>=2){failureCode='PRODUCTION_COMPONENT_LOST';report={status:'failed',code:failureCode};await close();}})().finally(()=>{monitorFlight=null;});},5000);monitor.unref?.();
   for(const child of [engine,native])if(child.done)void child.done.then(()=>{if(!stopping){failureCode='PRODUCTION_CHILD_EXITED';report={status:'failed',code:failureCode};void close();}});
   return status();
  }catch(error){failureCode=/^PRODUCTION_/.test(error?.code??'')?error.code:'PRODUCTION_START_FAILED';report={status:'failed',code:failureCode};await close({fromStart:true});return status();}
 })().finally(()=>{starting=false;});return startFlight;}
 return Object.freeze({start,close,status,done});
}
