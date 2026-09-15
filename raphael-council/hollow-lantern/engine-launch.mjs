import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,realpath,open} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {isAbsolute,resolve,join,dirname,basename,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {appEnvironment} from './app-launch.mjs';
import {createEngineClient} from './engine-client.mjs';
import {isRehearsalPortOccupied} from './rehearsal-launch.mjs';
import {readCampaignSummary} from './campaign-summary.mjs';
import {campaignBundleFiles} from './production-files.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const local=path=>typeof path==='string'&&isAbsolute(path)&&!/[\x00-\x1f]/.test(path)&&!/^[/\\]{2}/.test(path)&&!/(?:^|[/\\])OneDrive(?: - [^/\\]+)?(?:[/\\]|$)/i.test(path);
const SAVE_LIMIT=128*1024*1024; // LanternStore maximum snapshot size.
async function regularInfo(path,limit=Infinity){
  if(!local(path))fail('ENGINE_LOCAL_PATH_REQUIRED');
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>limit||(await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())fail('ENGINE_FILE_INVALID');
  return info;
}
async function regular(path,limit){
  await regularInfo(path,limit);
  const bytes=await readFile(path);if(bytes.length>limit)fail('ENGINE_FILE_INVALID');return bytes;
}
// Journal size grows with campaign history. Never materialize it as a Buffer.
async function streamFile(path,destination){
  const before=await regularInfo(path),file=await open(path,'r');
  try{
    const opened=await file.stat();
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('ENGINE_JOURNAL_CHANGED');
    const digest=createHash('sha256');
    const source=file.createReadStream({autoClose:false});
    if(destination){
      const hashing=new Transform({transform(chunk,encoding,callback){digest.update(chunk);callback(null,chunk);}});
      await pipeline(source,hashing,createWriteStream(destination,{flags:'wx',mode:0o600}));
    }else{for await(const chunk of source)digest.update(chunk);}
    const after=await regularInfo(path);
    if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)fail('ENGINE_JOURNAL_CHANGED');
    return digest.digest('hex');
  }finally{await file.close();}
}

/** Recovery loads an existing paused save. It never creates a campaign or silently
 * picks a build, changes a binding, upgrades the save, or retries a game command. */
export async function inspectSavedEngine({env,executable,clientFactory=createEngineClient,probePort=isRehearsalPortOccupied,recoveryMode='paused-only'}={}){
  if(!['paused-only','production-held'].includes(recoveryMode))fail('ENGINE_RECOVERY_POLICY_INVALID');
  if(!env||!local(executable))fail('ENGINE_CONFIGURATION_INVALID');
  const executableBytes=await regular(executable,256*1024*1024);
  const domainFile=join(dirname(executable),basename(executable,extname(executable))+'_Data','Managed','RpgIntegration.HollowLantern.dll');
  let domainSha256=null;
  try{domainSha256=hash(await regular(domainFile,32*1024*1024));}catch(error){if(error.code!=='ENOENT')throw error;}
  const bytes=await regular(env.HOLLOW_LANTERN_STORE_FILE,SAVE_LIMIT);
  let state;
  try{
    const summary=readCampaignSummary(env.HOLLOW_LANTERN_STORE_FILE);if(!summary.bytes.equals(bytes))throw Error();state=summary.state;
    if(state.version!==2||state.campaignId!==env.HOLLOW_LANTERN_CAMPAIGN_ID||state.channelId!==env.HOLLOW_LANTERN_CHANNEL_ID||state.gmId!==env.HOLLOW_LANTERN_GM_ID||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.actors)||typeof state.decisionOpen!=='boolean')throw Error();
  }catch{fail('ENGINE_SAVE_BINDING_INVALID');}
  const secret=(await regular(env.HOLLOW_LANTERN_SECRET_FILE,1024)).toString('utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(secret))fail('ENGINE_SECRET_INVALID');
  const client=clientFactory({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:state.campaignId,channelId:state.channelId,secret,timeoutMs:2000});
  const address=new URL(env.HOLLOW_LANTERN_ENGINE_URL),port=Number(address.port);
  // Unity's standalone authority listens on IPv4 loopback, at an explicit port.
  if(address.hostname!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535)fail('ENGINE_PORT_INVALID');
  const summary={status:'ready-to-start',campaignId:state.campaignId,revision:state.revision,decisionOpen:state.decisionOpen,authorityEpoch:state.authorityEpoch??0,storageVersion:state.storageVersion??1,recoveryMode,port,saveSha256:hash(bytes),executable:resolve(executable),executableSha256:hash(executableBytes),domainSha256};
  if(await probePort(port)){
    if(recoveryMode==='production-held')fail('ENGINE_PRODUCTION_PORT_OCCUPIED');
    try{await client.project({ownerId:state.gmId,audience:'public',mapLevel:'regional'});}
    catch{fail('ENGINE_PORT_OWNED_BY_UNVERIFIED_SERVICE');}
    return {summary:{...summary,status:'already-running'},client};
  }
  if(state.decisionOpen&&recoveryMode!=='production-held')fail('ENGINE_RECOVERY_REQUIRES_PAUSED_SAVE');
  const companions=[];
  // v2 recovery must not scan all immutable history before bounded engine startup.
  // This captures a recovery marker; separately verified archives contain the full bundle.
  const markerOnly=state.storageVersion===2&&recoveryMode==='production-held';summary.backupKind=markerOnly?'recovery-manifest-marker':'complete-campaign-bundle';
  const suffixes=markerOnly?[]:state.storageVersion===2?(await campaignBundleFiles(env.HOLLOW_LANTERN_STORE_FILE)).slice(1).map(path=>path.slice(env.HOLLOW_LANTERN_STORE_FILE.length)):['.bak','.wal','.wal.meta'];
  for(const suffix of suffixes){
    try{const sha256=await streamFile(env.HOLLOW_LANTERN_STORE_FILE+suffix);companions.push({suffix,sha256});}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(companions.some(f=>f.suffix==='.wal')!==companions.some(f=>f.suffix==='.wal.meta'))fail('ENGINE_JOURNAL_INCOMPLETE');
  summary.companions=companions.map(({suffix,sha256})=>({suffix,sha256}));
  return {summary,client,secret,bytes,state,companions};
}

/** Starts only after checkpointing. Credentials travel in the child environment;
 * Discord, Obus and other application credentials are not forwarded to Unity. */
export async function startSavedEngine({env,executable,outputRoot,spawnImpl=spawn,inspect=inspectSavedEngine,startupTimeoutMs=60000,lifecycle=process,processEnv=process.env,recoveryMode='paused-only'}={}){
  // A measured 100-player journal takes about 30 seconds to validate on restart.
  // Preserve full validation and bound readiness; never declare an unready child healthy.
  const recoveryBegan=Date.now();
  if(!local(outputRoot)||!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1||startupTimeoutMs>120000)fail('ENGINE_CONFIGURATION_INVALID');
  const checked=await inspect({env,executable,recoveryMode});
  if(checked.summary.status==='already-running')return {summary:checked.summary,close:async()=>{},done:Promise.resolve(0)};
  await mkdir(outputRoot,{recursive:true});
  if((await realpath(outputRoot)).toLowerCase()!==resolve(outputRoot).toLowerCase())fail('ENGINE_LOCAL_PATH_REQUIRED');
  const output=join(outputRoot,'engine-'+randomUUID());await mkdir(output);
  await writeFile(join(output,'campaign.json'),checked.bytes,{flag:'wx',mode:0o600});
  for(const file of checked.companions??[]){
    const source=env.HOLLOW_LANTERN_STORE_FILE+file.suffix,backup=join(output,'campaign.json'+file.suffix);
    await mkdir(dirname(backup),{recursive:true});
    if(await streamFile(source,backup)!==file.sha256||await streamFile(backup)!==file.sha256||await streamFile(source)!==file.sha256)fail('ENGINE_JOURNAL_CHANGED');
  }
  if(hash(await readFile(join(output,'campaign.json')))!==checked.summary.saveSha256)fail('ENGINE_BACKUP_INVALID');
  // Refuse a save that changed while its backup was being prepared.
  if(hash(await regular(env.HOLLOW_LANTERN_STORE_FILE,SAVE_LIMIT))!==checked.summary.saveSha256)fail('ENGINE_SAVE_CHANGED');
  const childEnv=Object.fromEntries(Object.entries(processEnv).filter(([key])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramData|COMSPEC|PATHEXT)$/i.test(key)));
  Object.assign(childEnv,{HOLLOW_LANTERN_UNITY:'1',HOLLOW_LANTERN_STORE:env.HOLLOW_LANTERN_STORE_FILE,HOLLOW_LANTERN_GM:env.HOLLOW_LANTERN_GM_ID,HOLLOW_LANTERN_CHANNEL:env.HOLLOW_LANTERN_CHANNEL_ID,HOLLOW_LANTERN_CAMPAIGN:env.HOLLOW_LANTERN_CAMPAIGN_ID,HOLLOW_LANTERN_PORT:String(checked.summary.port),RAPHAEL_GAME_BRIDGE_SECRET:checked.secret});
  if(recoveryMode==='production-held')childEnv.HOLLOW_LANTERN_RECOVERY_GATE='1';
  let child,exited=false,stopping=false,exitCode=1,closeFlight;
  let resolveDone;const done=new Promise(done=>{resolveDone=done;});
  const finish=code=>{if(exited)return;exited=true;exitCode=code??1;for(const signal of ['SIGINT','SIGTERM'])lifecycle.removeListener(signal,stop);resolveDone(exitCode);};
  const close=()=>closeFlight??=(async()=>{
    stopping=true;
    if(child&&!exited){child.kill('SIGTERM');let timer;try{await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);}if(!exited)fail('ENGINE_OWNED_PROCESS_STILL_RUNNING');}
  })().finally(()=>{closeFlight=undefined;});
  const stop=()=>{void close().catch(()=>{});};
  try{
    child=spawnImpl(executable,['-batchmode','-nographics','-logFile',join(output,'engine.log')],{cwd:dirname(executable),env:childEnv,windowsHide:true,stdio:'ignore',shell:false});
    child.once('exit',finish);child.once('error',()=>finish(1));
    for(const signal of ['SIGINT','SIGTERM'])lifecycle.on(signal,stop);
    const startupBegan=Date.now(),deadline=startupBegan+startupTimeoutMs;let view;
    while(!stopping&&!exited&&Date.now()<deadline){
      try{view=await checked.client.project({ownerId:env.HOLLOW_LANTERN_GM_ID,audience:'gm',mapLevel:'regional'});break;}
      catch{await delay(100);}
    }
    if(stopping||exited||!view)fail('ENGINE_STARTUP_FAILED');
    if(view.campaignId!==checked.summary.campaignId||view.revision!==checked.summary.revision||view.decisionOpen!==checked.summary.decisionOpen||hash(await regular(env.HOLLOW_LANTERN_STORE_FILE,SAVE_LIMIT))!==checked.summary.saveSha256)fail('ENGINE_STARTUP_CHANGED_STATE');
    if(recoveryMode==='production-held'){
      const gate=await checked.client.recovery({ownerId:env.HOLLOW_LANTERN_GM_ID,operation:'status'});
      if(gate.held!==true||gate.revision!==checked.summary.revision||gate.authorityEpoch!==checked.summary.authorityEpoch)fail('ENGINE_RECOVERY_GATE_UNVERIFIED');
    }
    const summary={...checked.summary,status:'ready',pid:child.pid,output,startedAt:new Date().toISOString(),startupTimeoutMs,startupElapsedMs:Date.now()-startupBegan,recoveryElapsedMs:Date.now()-recoveryBegan};
    await writeFile(join(output,'recovery.json'),JSON.stringify(summary,null,2),{flag:'wx',mode:0o600});
    return {summary,close,done,client:checked.client};
  }catch(error){
    await close();
    await writeFile(join(output,'failure.json'),JSON.stringify({status:'failed',code:error.code??'ENGINE_STARTUP_FAILED'}),{flag:'wx',mode:0o600});
    fail(error.code??'ENGINE_STARTUP_FAILED');
  }
}

async function main(){
  const args=process.argv.slice(2),options={},seen=new Set();let check=false;
  for(let i=0;i<args.length;i++){
    const key=args[i];if(seen.has(key))fail('ENGINE_ARGUMENT_INVALID');seen.add(key);
    if(key==='--check'){check=true;continue;}
    const name={'--executable':'executable','--output':'outputRoot'}[key],value=args[++i];
    if(!name||!value||value.startsWith('--'))fail('ENGINE_ARGUMENT_INVALID');options[name]=value;
  }
  const env=await appEnvironment();
  if(check){console.log(JSON.stringify((await inspectSavedEngine({env,...options})).summary));return;}
  const host=await startSavedEngine({env,...options});console.log(JSON.stringify(host.summary));
  if(host.summary.status==='ready')process.exitCode=await host.done;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main();}catch(error){console.error(error.code?.startsWith('ENGINE_')?error.code:'ENGINE_CONFIGURATION_INVALID');process.exitCode=1;}
}
