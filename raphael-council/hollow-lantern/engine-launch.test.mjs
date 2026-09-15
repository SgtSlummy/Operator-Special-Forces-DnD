import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,mkdir,open,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {inspectSavedEngine,startSavedEngine} from './engine-launch.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'hollow-engine-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const executable=join(dir,'engine.exe');await writeFile(executable,'inert fixture');
  const state={version:2,campaignId:'fixture',channelId:'channel',gmId:'gm',revision:9,decisionOpen:false,actors:[]};
  const env={HOLLOW_LANTERN_CAMPAIGN_ID:'fixture',HOLLOW_LANTERN_CHANNEL_ID:'channel',HOLLOW_LANTERN_GM_ID:'gm',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18819',HOLLOW_LANTERN_STORE_FILE:join(dir,'campaign.json'),HOLLOW_LANTERN_SECRET_FILE:join(dir,'secret'),DISCORD_TOKEN:'must-not-forward'};
  const save=async()=>{const body=JSON.stringify(state);await writeFile(env.HOLLOW_LANTERN_STORE_FILE,JSON.stringify({body,sha256:createHash('sha256').update(body).digest('hex')}));};
  await save();await writeFile(env.HOLLOW_LANTERN_SECRET_FILE,'a'.repeat(64));
  let spawned=0,options,args;
  const child=new EventEmitter();child.pid=1234;child.kill=()=>{queueMicrotask(()=>child.emit('exit',0));return true;};
  const lifecycle=new EventEmitter();
  const client={project:async()=>({campaignId:'fixture',revision:9,decisionOpen:false})};
  const inspect=opts=>inspectSavedEngine({...opts,probePort:async()=>false,clientFactory:()=>client});
  return {dir,env,executable,state,save,client,inspect,lifecycle,outputRoot:join(dir,'backups'),spawnImpl:(file,a,o)=>{assert.equal(file,executable);spawned++;args=a;options=o;return child;},observed:()=>({spawned,args,options}),child};
}
test('recovery checkpoints the exact save and verifies the original revision with no Discord credentials in Unity',async t=>{
  const f=await fixture(t),before=await readFile(f.env.HOLLOW_LANTERN_STORE_FILE);
  const host=await startSavedEngine({...f,processEnv:{PATH:process.env.PATH,DISCORD_TOKEN:'private',RAPHAEL_OBUS_GAME_TOKEN:'private'}});
  assert.equal(host.summary.status,'ready');assert.equal(host.summary.revision,9);
  assert.deepEqual(await readFile(join(host.summary.output,'campaign.json')),before);
  assert.deepEqual(await readFile(f.env.HOLLOW_LANTERN_STORE_FILE),before);
  const {options,args}=f.observed();assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
  assert.equal(options.env.RAPHAEL_GAME_BRIDGE_SECRET,'a'.repeat(64));assert.equal(options.env.DISCORD_TOKEN,undefined);assert.equal(options.env.RAPHAEL_OBUS_GAME_TOKEN,undefined);
  assert.ok(!JSON.stringify(args).includes('a'.repeat(64)));assert.ok(!JSON.stringify(host.summary).includes('a'.repeat(64)));
  await host.close();assert.equal(await host.done,0);assert.equal(f.lifecycle.listenerCount('SIGTERM'),0);
});
test('missing, corrupt, mismatched and unpaused saves never launch',async t=>{
  const f=await fixture(t);
  for(const changes of [{campaignId:'different'},{decisionOpen:true},{revision:-1}]){
    Object.assign(f.state,{campaignId:'fixture',decisionOpen:false,revision:9},changes);await f.save();
    await assert.rejects(startSavedEngine(f),/ENGINE_/);
  }
  await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE,'{}');await assert.rejects(startSavedEngine(f),/ENGINE_SAVE_BINDING_INVALID/);
  await rm(f.env.HOLLOW_LANTERN_STORE_FILE);await assert.rejects(startSavedEngine(f));assert.equal(f.observed().spawned,0);
});
test('an authenticated existing service is reused without a second process or checkpoint',async t=>{
  const f=await fixture(t);f.inspect=opts=>inspectSavedEngine({...opts,probePort:async()=>true,clientFactory:()=>f.client});
  const host=await startSavedEngine(f);assert.equal(host.summary.status,'already-running');assert.equal(f.observed().spawned,0);
  await host.close();assert.deepEqual(await readdir(f.dir),['campaign.json','engine.exe','secret']);
});
test('an occupied port that fails campaign authentication is left alone',async t=>{
  const f=await fixture(t);f.inspect=opts=>inspectSavedEngine({...opts,probePort:async()=>true,clientFactory:()=>({project:async()=>{throw Error('private diagnostic');}})});
  await assert.rejects(startSavedEngine(f),/ENGINE_PORT_OWNED_BY_UNVERIFIED_SERVICE/);assert.equal(f.observed().spawned,0);
});
test('a startup state mismatch stops only the owned child and retains the backup',async t=>{
  const f=await fixture(t);f.client.project=async()=>({campaignId:'fixture',revision:10,decisionOpen:false});
  await assert.rejects(startSavedEngine(f),/ENGINE_STARTUP_CHANGED_STATE/);
  assert.equal(f.observed().spawned,1);assert.equal(f.lifecycle.listenerCount('SIGTERM'),0);
  const dirs=await readdir(f.outputRoot);assert.equal(dirs.length,1);assert.ok((await readdir(join(f.outputRoot,dirs[0]))).includes('campaign.json'));
});
test('a failed child never reports readiness and removes its signal listeners',async t=>{
  const f=await fixture(t),spawn=f.spawnImpl;f.spawnImpl=(...args)=>{const child=spawn(...args);queueMicrotask(()=>child.emit('error',new Error('private path')));return child;};
  await assert.rejects(startSavedEngine(f),/ENGINE_STARTUP_FAILED/);assert.equal(f.lifecycle.listenerCount('SIGINT'),0);
});
test('an unready child is stopped when its bounded recovery window expires',async t=>{
  const f=await fixture(t);let stopped=0;
  const kill=f.child.kill;f.child.kill=()=>{stopped++;return kill();};
  f.client.project=async()=>{throw Error('still validating history');};
  await assert.rejects(startSavedEngine({...f,startupTimeoutMs:10}),/ENGINE_STARTUP_FAILED/);
  assert.equal(stopped,1);assert.equal(f.lifecycle.listenerCount('SIGINT'),0);
  const [directory]=await readdir(f.outputRoot);
  assert.equal(JSON.parse(await readFile(join(f.outputRoot,directory,'failure.json'))).code,'ENGINE_STARTUP_FAILED');
  assert.equal((await readdir(join(f.outputRoot,directory))).includes('recovery.json'),false);
});
test('a save changed between inspection and launch is not started',async t=>{
  const f=await fixture(t),inspect=f.inspect;f.inspect=async opts=>{const result=await inspect(opts);f.state.revision++;await f.save();return result;};
  await assert.rejects(startSavedEngine(f),/ENGINE_SAVE_CHANGED/);assert.equal(f.observed().spawned,0);
});
test('the complete journal bundle and domain build identity are checkpointed',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.dir,'engine_Data','Managed'),{recursive:true});
  await writeFile(join(f.dir,'engine_Data','Managed','RpgIntegration.HollowLantern.dll'),'fixture game domain');
  for(const suffix of ['.bak','.wal','.wal.meta'])await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE+suffix,'fixture '+suffix);
  const host=await startSavedEngine(f);
  assert.equal(host.summary.domainSha256,createHash('sha256').update('fixture game domain').digest('hex'));
  assert.equal(host.summary.companions.length,3);
  for(const file of host.summary.companions){const bytes=await readFile(join(host.summary.output,'campaign.json'+file.suffix));assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(bytes.toString(),'fixture '+file.suffix);}
  await host.close();
});
test('an incomplete or changed journal is never launched',async t=>{
  const f=await fixture(t);await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE+'.wal','journal');
  await assert.rejects(startSavedEngine(f),/ENGINE_JOURNAL_INCOMPLETE/);
  await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE+'.wal.meta','metadata');
  const inspect=f.inspect;f.inspect=async opts=>{const result=await inspect(opts);await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE+'.wal','changed');return result;};
  await assert.rejects(startSavedEngine(f),/ENGINE_JOURNAL_CHANGED/);assert.equal(f.observed().spawned,0);
});

test('recovery accepts saves above 32 MiB up to the authority limit',async t=>{
  const f=await fixture(t);f.state.padding='x'.repeat(33*1024*1024);await f.save();
  const host=await startSavedEngine(f);assert.equal(host.summary.status,'ready');await host.close();
});

test('journals above 512 MiB are streamed into exact verified backups',async t=>{
  const f=await fixture(t),wal=f.env.HOLLOW_LANTERN_STORE_FILE+'.wal';
  const handle=await open(wal,'wx');try{await handle.truncate(513*1024*1024);await handle.write(Buffer.from('journal tail'),0,12,513*1024*1024-12);}finally{await handle.close();}
  await writeFile(f.env.HOLLOW_LANTERN_STORE_FILE+'.wal.meta','metadata');
  const inspected=await f.inspect(f);assert.equal(inspected.companions.find(x=>x.suffix==='.wal').data,undefined);
  const host=await startSavedEngine({...f,inspect:async()=>inspected});
  assert.equal((await stat(join(host.summary.output,'campaign.json.wal'))).size,513*1024*1024);
  assert.equal(host.summary.companions.find(x=>x.suffix==='.wal').sha256,inspected.companions.find(x=>x.suffix==='.wal').sha256);
  await host.close();
});


test('snapshots above the authority 128 MiB limit are rejected before launch',async t=>{
  const f=await fixture(t),file=await open(f.env.HOLLOW_LANTERN_STORE_FILE,'r+');
  try{await file.truncate(128*1024*1024+1);}finally{await file.close();}
  await assert.rejects(startSavedEngine(f),/ENGINE_FILE_INVALID/);assert.equal(f.observed().spawned,0);
});
