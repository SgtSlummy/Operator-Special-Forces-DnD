import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appEnvironment} from './app-launch.mjs';
import {readProductionProfile} from './production-profile.mjs';
import {inspectProductionPath,productionPath} from './production-files.mjs';
import {composeRehearsalLaunchEnvironment,resolveRehearsalCommand} from './rehearsal-launch.mjs';
import {inspectSavedEngine} from './engine-launch.mjs';
import {createProductionSupervisor,verifyPrivateGameWorker} from './production-supervisor.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
export function runPodman(args,{spawnImpl=spawn,timeoutMs=60000,env=process.env}={}){
 return new Promise((resolve,reject)=>{
  const child=spawnImpl('podman',args,{windowsHide:true,env,stdio:['ignore','pipe','ignore']});let bytes=0,output=[],settled=false;
  const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const error=()=>Object.assign(Error('PRODUCTION_STORAGE_UNAVAILABLE'),{code:'PRODUCTION_STORAGE_UNAVAILABLE'});
  const timer=setTimeout(()=>{child.kill();end(error());},timeoutMs);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){child.kill();end(error());}else output.push(chunk);});
  child.once('error',()=>end(error()));child.once('exit',code=>code===0?end(null,Buffer.concat(output).toString()):end(error()));
 });
}
export async function inspectProductionStorage({run=runPodman,start=false}={}){
 if(start){const machines=JSON.parse(await run(['machine','inspect','podman-machine-default']));if(!Array.isArray(machines)||machines.length!==1)fail('PRODUCTION_STORAGE_UNAVAILABLE');if(machines[0].State!=='running')await run(['machine','start','podman-machine-default']);}
 const allowed=['davy-postgres','davy-redis','ops-dnd-storage-proxy'],forbidden=['deployment_postgres_1','deployment_redis_1','davy-bot-gateway'];
 const list=JSON.parse(await run(['ps','--all','--format','json']));if(!Array.isArray(list))fail('PRODUCTION_STORAGE_UNAVAILABLE');
 const named=name=>list.find(c=>(Array.isArray(c.Names)?c.Names:[c.Names]).includes(name));
 const running=c=>c?.State==='running';
 if(forbidden.some(name=>running(named(name))))fail('PRODUCTION_DUPLICATE_RUNTIME');
 for(const name of allowed){const c=named(name);if(!c)fail('PRODUCTION_STORAGE_MISSING');if(!running(c)){if(!start)fail('PRODUCTION_STORAGE_STOPPED');await run(['start',name]);}}
 if(start){const after=JSON.parse(await run(['ps','--all','--format','json']));if(forbidden.some(name=>after.some(c=>(Array.isArray(c.Names)?c.Names:[c.Names]).includes(name)&&running(c))))fail('PRODUCTION_DUPLICATE_RUNTIME');if(allowed.some(name=>!after.some(c=>(Array.isArray(c.Names)?c.Names:[c.Names]).includes(name)&&running(c))))fail('PRODUCTION_STORAGE_UNAVAILABLE');}
 return {state:'ready',containers:allowed};
}
export async function prepareProductionLaunch({descriptorFile,davyRoot,projectRoot=resolve(import.meta.dirname,'..'),loadEnvironment=appEnvironment,readProfile=readProductionProfile,resolveCommand=resolveRehearsalCommand}={}){
 await inspectProductionPath(productionPath(davyRoot),{directory:true});await inspectProductionPath(projectRoot,{directory:true});
 const infrastructureEnv=await loadEnvironment({projectRoot}),profile=await readProfile({file:descriptorFile,infrastructureEnv});
 const composed=composeRehearsalLaunchEnvironment({env:profile.env});
 const commandId=await resolveCommand({env:composed.env});
 const prepared={status:'preflight-passed',davyRoot,env:{...composed.env,HOLLOW_LANTERN_COMMAND_ID:commandId},activityEnv:{...profile.activityEnv,HOLLOW_LANTERN_COMMAND_ID:commandId},ports:composed.ports};
 return {profile,prepared,projectRoot,davyRoot};
}
export async function runProductionCli({args=process.argv.slice(2),prepare=prepareProductionLaunch,createSupervisor=createProductionSupervisor,verifyWorker=verifyPrivateGameWorker,storage=inspectProductionStorage,inspectEngine=inspectSavedEngine,write=console.log,lifecycle=process}={}){
 const options={},keys={'--descriptor':'descriptorFile','--engine':'executable','--output-root':'outputRoot','--davy-root':'davyRoot'},seen=new Set();let start=false;
 for(let n=0;n<args.length;n++){const key=args[n];if(seen.has(key))fail('PRODUCTION_ARGUMENT_INVALID');seen.add(key);if(key==='--start'||key==='--check'){if(seen.has(key==='--start'?'--check':'--start'))fail('PRODUCTION_ARGUMENT_INVALID');start=key==='--start';continue;}if(!keys[key]||!args[n+1]||args[n+1].startsWith('--'))fail('PRODUCTION_ARGUMENT_INVALID');options[keys[key]]=productionPath(args[++n]);}
 if(!options.descriptorFile||!options.davyRoot||!options.executable||!options.outputRoot)fail('PRODUCTION_ARGUMENT_INVALID');
 const built=await prepare(options);
 if(!start){await verifyWorker(built.profile);await storage();await inspectEngine({env:built.profile.env,executable:options.executable,recoveryMode:'production-held'});write(JSON.stringify({status:'preflight-passed',campaignId:built.profile.descriptor.campaignId,releaseAccepted:false}));return {exitCode:0};}
 const supervisor=createSupervisor({...built,...options,verifyWorker,ensureStorage:()=>storage({start:true})});
 const stop=()=>void supervisor.close();for(const event of ['SIGINT','SIGTERM'])lifecycle.on(event,stop);
 try{const state=await supervisor.start();write(JSON.stringify(state));if(state.status!=='ready')await supervisor.close();return await supervisor.done;}
 finally{for(const event of ['SIGINT','SIGTERM'])lifecycle.off(event,stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=(await runProductionCli()).exitCode;}catch(error){console.error(/^PRODUCTION_[A-Z_]+$/.test(error?.code??'')?error.code:'PRODUCTION_CONFIGURATION_UNAVAILABLE');process.exitCode=1;}
}
