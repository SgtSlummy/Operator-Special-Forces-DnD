import {spawn} from 'node:child_process';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat} from 'node:fs/promises';
import {activityEnvironment,prepareActivityRelease,selectedActivityCampaign} from './activity-launch.mjs';
import {inspectStartup} from './startup-status.mjs';

const root = resolve(import.meta.dirname,'..');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const validPort = port => Number.isInteger(port) && port > 0 && port <= 65535;
const blocked = message => ({status:'blocked',message});

/** An occupied port is never treated as permission to replace its process. */
export async function inspectWeb({port,campaignId,clientId,instance,fetchImpl=fetch,timeoutMs=2500}) {
  if (!validPort(port)) return blocked('Choose a valid local web port.');
  const occupied = await new Promise(resolve => {
    const socket = net.createConnection({host:'127.0.0.1',port});
    const finish = value => {socket.destroy();resolve(value);};
    socket.setTimeout(timeoutMs,()=>finish(true));
    socket.once('connect',()=>finish(true));
    socket.once('error',error=>finish(error.code !== 'ECONNREFUSED'));
  });
  if (!occupied) return {status:'stopped',message:'The web app can be started.'};
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),cache:'no-store'});
    // Read a bounded body even if another local service owns the chosen port.
    const reader = response.body?.getReader();
    if (!reader || !response.ok) {await response.body?.cancel();return blocked('The web port is occupied by an unavailable or different app.');}
    let size=0;const chunks=[];
    try {for (;;) {const {value,done}=await reader.read();if(done)break;if((size+=value.length)>4096)throw new Error();chunks.push(Buffer.from(value));}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    const body=JSON.parse(Buffer.concat(chunks).toString());
    if (body.service!=='hollow-lantern-web'||body.version!==1||body.status!=='listening'||body.campaignId!==campaignId||body.clientId!==clientId||(instance&&body.instance!==instance)) return blocked('This web port belongs to a different campaign or app.');
    return {status:'running',message:'The selected campaign web app is responding.'};
  } catch {return blocked('The web port is occupied, but its campaign connection could not be verified.');}
}

export async function inspectApp({env,projectRoot=root,port=18796,readiness=inspectStartup,probeWeb=inspectWeb}) {
  if (!validPort(port)) return blocked('Choose a valid local web port.');
  const report=await readiness({env});
  if(report.status!=='ready')return {...report,message:'The app needs attention before it can start.'};
  const web=await probeWeb({port,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID,clientId:env.DISCORD_CLIENT_ID});
  if(web.status==='blocked')return {...report,...web,web};
  if(web.status==='running')return {...report,status:'already-running',web,message:'The existing app is available. Its process and release were left in place.'};
  try {
    const entries=await Promise.all(['dist/server/index.js','dist/client','node_modules/vinext/dist/server/prod-server.js'].map(p=>stat(join(projectRoot,p))));
    if(!entries[0].isFile()||!entries[1].isDirectory()||!entries[2].isFile())throw new Error();
  } catch {return {...report,...blocked('Build the web app before starting it.'),web};}
  return {...report,status:'ready-to-start',web,message:'The saved campaign and engine are available. The web app is ready to start.'};
}

/** Starts at most one web child, and reaches ready only after its own IPC
 * handshake and a matching HTTP campaign response. No dependency is restarted. */
export function createAppHost({env,projectRoot=root,port=18796,inspect=inspectApp,probeWeb=inspectWeb,
  prepare=prepareActivityRelease,spawnImpl=spawn,lifecycle=process,startupTimeoutMs=20000,shutdownTimeoutMs=5000,forceOnTimeout=true}={}) {
  if(typeof forceOnTimeout!=='boolean')throw new Error('Invalid app shutdown policy.');
  let child,exited=false,starting,closing,stopRequested=false,report={status:'idle'},exitCode=0;
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const instance=randomUUID(),signals=new Map();
  const finish=()=>{for(const [name,fn]of signals)lifecycle.removeListener(name,fn);signals.clear();resolveDone({exitCode,status:report.status});};
  async function close() {
    if(closing)return closing;
    stopRequested=true;
    closing=(async()=>{
      report={...report,status:'stopping'};
      if(child&&!exited){
        try {if(child.connected)child.send({type:'stop'},()=>{});else if(forceOnTimeout)child.kill('SIGTERM');}catch{/* Exit is observed below. */}
        const deadline=Date.now()+shutdownTimeoutMs;
        while(!exited&&Date.now()<deadline)await delay(20);
        if(!exited&&forceOnTimeout){try{child.kill('SIGTERM');}catch{/* Never assume termination. */}
          const forceDeadline=Date.now()+1000;while(!exited&&Date.now()<forceDeadline)await delay(20);
        }
      }
      if(child&&!exited){exitCode=1;report=blocked('The owned web app has not stopped yet. Its exit is still being observed.');return report;}
      report={...report,status:'stopped'};finish();return report;
    })().finally(()=>{closing=null;});return closing;
  }
  function start(){
    if(starting)return starting;
    if(report.status==='stopping'||report.status==='stopped')return Promise.resolve(blocked('This app launcher has already stopped.'));
    starting=(async()=>{
      report={status:'checking'};
      for(const name of ['SIGINT','SIGTERM']){const fn=()=>{void close();};signals.set(name,fn);lifecycle.on(name,fn);}
      const checked=await inspect({env,projectRoot,port});
      if(stopRequested)return report;
      report=checked;
      if(checked.status!=='ready-to-start'){exitCode=checked.status==='already-running'?0:1;finish();return report;}
      const release=await prepare({projectRoot});
      if(stopRequested)return report;
      const ready=new Promise((resolveReady,rejectReady)=>{
        const timer=setTimeout(()=>rejectReady(new Error()),startupTimeoutMs);
        const settle=(ok)=>{clearTimeout(timer);if(ok)resolveReady();else rejectReady(new Error());};
        try {child=spawnImpl(process.execPath,[join(projectRoot,'hollow-lantern/app-server.mjs')],{
          cwd:projectRoot,env:{...env,HOLLOW_APP_PORT:String(port),HOLLOW_APP_RELEASE_DIR:release.outDir,HOLLOW_APP_INSTANCE:instance},
          stdio:['ignore','ignore','ignore','ipc'],shell:false,windowsHide:true,
        });}catch{clearTimeout(timer);throw new Error();}
        child.on('message',message=>{
          if(message?.type==='listening'&&message.instance===instance&&message.port===port)settle(true);
          if(message?.type==='failed')settle(false);
        });
        child.on('error',()=>{if(!child.pid){exited=true;exitCode=1;}settle(false);});
        child.once('exit',code=>{exited=true;if(exitCode===0)exitCode=code??1;settle(false);
          if(!closing){const wasReady=report.status==='ready';report=blocked('The web app stopped. Check its connection before reopening the table.');if(wasReady||stopRequested){if(wasReady)exitCode=1;finish();}}
        });
      });
      await ready;
      if(exited){exitCode=1;finish();return report;}
      if(stopRequested)return report;
      const web=await probeWeb({port,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID,clientId:env.DISCORD_CLIENT_ID,instance});
      if(exited){exitCode=1;finish();return report;}
      if(stopRequested)return report;
      if(web.status!=='running')throw new Error();
      report={...checked,status:'ready',web,url:`http://127.0.0.1:${port}`,releaseId:release.id,message:'The app is running. Sign in with your enrolled Discord account to open the table.'};
      return report;
    })().catch(async()=>{const cancelled=stopRequested;if(!cancelled)exitCode=1;await close();if(!cancelled)report=blocked('The web app could not complete startup. Existing game services were left in place.');return report;});
    return starting;
  }
  return {start,close,done,status:()=>structuredClone(report)};
}

export async function appEnvironment({projectRoot=root,inherited=process.env}={}){
  const davy=resolve(projectRoot,'../../Davy Jones/deployment');
  const campaignFile=await selectedActivityCampaign({projectRoot,explicitFile:inherited.HOLLOW_ACTIVITY_CAMPAIGN_ENV_FILE});
  return activityEnvironment({baseFile:inherited.HOLLOW_ACTIVITY_BASE_ENV_FILE||join(davy,'.env'),nativeFile:inherited.HOLLOW_ACTIVITY_NATIVE_ENV_FILE||join(davy,'.env.native-gateway'),campaignFile,inherited});
}

async function main(){
  const args=process.argv.slice(2);
  if(args.some(a=>a!=='--check'))throw new Error();
  const env=await appEnvironment();
  const host=args.includes('--check')?null:createAppHost({env});
  const result=host?await host.start():await inspectApp({env});
  console.log(`Campaign: ${env.HOLLOW_LANTERN_CAMPAIGN_ID}`);
  for(const check of result.checks??[])console.log(`${check.label}: ${check.message}`);
  console.log(result.message);
  if(result.url)console.log(`Open ${result.url}`);
  if(result.status==='blocked')process.exitCode=1;
  if(result.status==='ready'){console.log('Press Ctrl+C to close this web app. The campaign and shared services stay available.');process.exitCode=(await host.done).exitCode;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error(error.message?.startsWith('Saved Activity campaign selection is invalid.')?error.message:'App setup is incomplete. Check the protected Davy configuration files and the selected campaign binding.');process.exitCode=1;}
}
