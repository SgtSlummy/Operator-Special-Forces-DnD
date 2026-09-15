import {fork} from 'node:child_process';
import net from 'node:net';
import {isAbsolute,join} from 'node:path';
import {createAppHost} from './app-launch.mjs';
import {createActivityEdge} from './activity-edge.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function portFree(port){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.once('connect',()=>finish(false));socket.once('error',error=>finish(error.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>finish(false));});}
async function gatewayReady(port){
 try{
  const response=await fetch(`http://127.0.0.1:${port}/health/ready`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(1000)});
  if(response.status!==200){await response.body?.cancel();return false;}
  const reader=response.body?.getReader();if(!reader)return false;let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>8192)return false;chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=JSON.parse(Buffer.concat(chunks).toString());return body.service==='bot-gateway'&&body.status==='ready';
 }catch{return false;}
}

/** Owns only newly created children. Never adopts listeners, force-kills, or clears locks. */
export function createRehearsalSupervisor({prepared,davyRoot=prepared?.davyRoot,projectRoot,forkImpl=fork,createApp=createAppHost,createEdge=createActivityEdge,probePort=portFree,probeGateway=gatewayReady,startupTimeoutMs=30000,shutdownTimeoutMs=12000}={}){
 const ports={...prepared?.ports},nativeEnv={...prepared?.env},activityEnv={...prepared?.activityEnv};
 if(prepared?.status!=='preflight-passed'||!prepared.env||!prepared.activityEnv||!isAbsolute(davyRoot??'')||!isAbsolute(projectRoot??'')||!ports||![ports.healthPort,ports.appPort,ports.webPort].every(port=>Number.isInteger(port)&&port>0&&port<=65535)||new Set([ports.healthPort,ports.appPort,ports.webPort]).size!==3||![startupTimeoutMs,shutdownTimeoutMs].every(ms=>Number.isSafeInteger(ms)&&ms>0))throw Error('Invalid rehearsal supervisor configuration.');
 let publicOrigin;
 if(activityEnv.RAPHAEL_PUBLIC_ORIGIN){
  const url=new URL(activityEnv.RAPHAEL_PUBLIC_ORIGIN);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||ports.appPort!==18796||[ports.healthPort,ports.webPort,ports.appPort].includes(18805)||!/^\d{17,20}$/.test(activityEnv.DISCORD_CLIENT_ID??''))throw Error('Invalid rehearsal edge configuration.');
  publicOrigin=url.origin;
 }
 let edge,edgeStarting,edgeStopped=true;
 let child,app,starting,closing,requested=false,initialized=false,childFailed=false,exited=false,appStopped=true,failed=false,finished=false,report={status:'idle'};
 let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
 const status=()=>structuredClone(report);
 const terminal=()=>{
  if(finished||!requested||!edgeStopped||!appStopped||(child&&!exited))return;
  finished=true;report={status:failed?'failed':'stopped',message:failed?'Rehearsal startup or runtime failed; owned processes have stopped.':'Owned rehearsal processes have stopped.'};resolveDone({...report,exitCode:failed?1:0});
 };
 async function close(){
  requested=true;if(closing)return closing;if(finished)return status();
  closing=(async()=>{
   report={status:'stopping'};
   if(edge&&!edgeStopped){
    await edgeStarting?.catch(()=>{});
    try{await edge.close();edgeStopped=true;}catch{failed=true;}
    if(!edgeStopped){report={status:'blocked',message:'The owned entry service has not stopped.'};return status();}
   }
   if(app&&!appStopped){try{const result=await app.close();appStopped=result?.status==='stopped';}catch{appStopped=false;failed=true;}}
   if(!appStopped){report={status:'blocked',message:'The owned web app has not stopped. Native shutdown will follow its observed exit.'};return status();}
   if(child&&!exited&&child.connected){try{child.send({type:'stop'},()=>{});}catch{/* Still observe the owned child's exit. */}}
   const until=Date.now()+shutdownTimeoutMs;
   while(child&&!exited&&Date.now()<until)await delay(20);
   terminal();
   if(!finished)report={status:'blocked',message:'An owned rehearsal process has not stopped. Its exit is still being observed.'};
   return status();
  })().finally(()=>{closing=undefined;});return closing;
 }
 function start(){
  if(starting)return starting;if(requested)return Promise.resolve(status());
  starting=(async()=>{
   report={status:'checking'};
   for(const port of [ports.healthPort,ports.webPort,ports.appPort,...(publicOrigin?[18805]:[])]){if(!await probePort(port))throw Error();if(requested)return status();}
   if(requested)return status();
   report={status:'starting-native'};
   child=forkImpl(join(davyRoot,'apps/bot-gateway/owned-rehearsal.mjs'),[],{cwd:davyRoot,env:nativeEnv,execArgv:[],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
   child.on('message',message=>{if(message?.type==='initialized')initialized=true;if(message?.type==='failed')childFailed=true;});
   child.on('error',()=>{childFailed=true;if(!child.pid){exited=true;terminal();}});
   child.once('exit',code=>{exited=true;if(!requested){failed=true;void close();}else{if(code!==0)failed=true;terminal();}});
   const until=Date.now()+startupTimeoutMs;
   let ready=false;
   while(!requested&&!exited&&!childFailed&&Date.now()<until){if(initialized&&await probeGateway(ports.healthPort)){ready=true;break;}await delay(25);}
   if(requested)return status();if(!ready||exited||childFailed)throw Error();
   report={status:'starting-app'};app=createApp({env:activityEnv,projectRoot,port:ports.appPort,forceOnTimeout:false});appStopped=false;
   if(app.done)void app.done.then(result=>{appStopped=true;if(result?.exitCode)failed=true;if(requested){if(child&&!exited)void close();else terminal();}else{failed=true;void close();}},()=>{failed=true;void close();});
   const result=await app.start();
   if(requested)return status();if(result?.status!=='ready'||exited)throw Error();
   if(publicOrigin){
    report={status:'starting-edge'};
    edge=createEdge({port:18805,publicOrigin,clientId:activityEnv.DISCORD_CLIENT_ID});edgeStopped=false;
    edge.server?.once('close',()=>{edgeStopped=true;if(!requested){failed=true;void close();}});
    edge.server?.on('error',()=>{failed=true;void close();});
    edgeStarting=Promise.resolve().then(()=>edge.start());await edgeStarting;
    if(requested)return status();if(edgeStopped||exited)throw Error();
   }
   report={status:'ready',url:publicOrigin??`http://127.0.0.1:${ports.appPort}`,message:'The owned rehearsal services are ready.'};
   return status();
  })().catch(async()=>{if(!requested)failed=true;await close();return status();});return starting;
 }
 return Object.freeze({start,close,done,status});
}
