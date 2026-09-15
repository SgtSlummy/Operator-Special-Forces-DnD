import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {startSavedEngine} from './engine-launch.mjs';
import {createEngineClient} from './engine-client.mjs';
import {createAdmissionService} from './admission.mjs';
import {archiveCampaign} from './production-files.mjs';

/** Disposable signed Unity/admission evidence. No Discord, OAuth, voice or model is simulated as live. */
export async function runProductionEngineRehearsal({executable,outputRoot,hostProject,port=18963}){
 for(const p of [executable,outputRoot,hostProject])if(!isAbsolute(p??'')||/OneDrive/i.test(p))throw Error('Explicit local paths required.');
 const root=join(outputRoot,'engine-acceptance-'+randomUUID());await mkdir(root,{recursive:true});
 const campaignId='acceptance-'+randomUUID(),gm='294709392798908417',channelId='1546676505780944979';
 const store=join(root,'campaign.json'),secret=randomBytes(32).toString('hex'),secretFile=join(root,'bridge.secret');await writeFile(secretFile,secret,{flag:'wx',mode:0o600});
 const env={HOLLOW_LANTERN_CAMPAIGN_ID:campaignId,HOLLOW_LANTERN_CHANNEL_ID:channelId,HOLLOW_LANTERN_GM_ID:gm,HOLLOW_LANTERN_ENGINE_URL:`http://127.0.0.1:${port}`,HOLLOW_LANTERN_STORE_FILE:store,HOLLOW_LANTERN_SECRET_FILE:secretFile};
 const report={kind:'disposable-production-engine-admission',campaignId,status:'running',players:100,limitations:['Actual Unity and durable admission service only. No real OAuth, Discord clients, Obus, voice, external network or two-hour full-stack acceptance.']};
 let engine,admission;
 const start=async()=>{engine=await startSavedEngine({env,executable,outputRoot:root,recoveryMode:'production-held'});return engine;};
 const client=createEngineClient({campaignId,channelId,secret,baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,timeoutMs:20000});
 const gmView=()=>client.project({ownerId:gm,audience:'gm',mapLevel:'regional'});
 const command=async(type,payload={})=>{const p=await gmView();return client.command({ownerId:gm,actorId:'',commandId:randomUUID(),expectedRevision:p.revision,type,payload});};
 const release=async()=>{const gate=await client.recovery({ownerId:gm});return client.recovery({ownerId:gm,operation:'release',expectedRevision:gate.revision,authorityEpoch:gate.authorityEpoch});};
 try{
  const initialized=await promisify(execFile)('dotnet',['run','--project',hostProject,'--','--profile','production','--store',store,'--campaign',campaignId,'--channel',channelId,'--gm',gm,'--initialize-only','true'],{cwd:resolve(hostProject,'..'),windowsHide:true,timeout:120000,maxBuffer:1024*1024});await writeFile(join(root,'initializer.log'),initialized.stdout);
  await start();report.build={executableSha256:engine.summary.executableSha256,domainSha256:engine.summary.domainSha256};
  let p=await gmView();assert.equal(p.characters.filter(c=>c.characterType==='player').length,0);assert.equal(p.npcs.length,7);assert.equal(p.runRequested,false);
  await assert.rejects(command('gm_decision',{open:true}),{code:'PRODUCTION_RECOVERY_HELD'});await release();
  const owners=Array.from({length:100},(_,i)=>String(900000000000000000n+BigInt(i)));
  admission=createAdmissionService({engine:client,dbPath:join(root,'admission.sqlite'),gmUserId:gm,authorize:async scope=>owners.includes(scope.userId),seatLimit:100});
  const input={presetId:'fighter',name:'Synthetic player',edition:'2024'};
  const joined=await Promise.all(owners.map((userId,i)=>admission.join({campaignId,userId},{...input,presetId:['fighter','rogue','cleric'][i%3],name:'Synthetic '+i})));
  await admission.drain();assert.equal(admission.health().enrolled,100);
  for(let i=0;i<10;i++)assert.equal((await admission.join({campaignId,userId:owners[i]},input)).characterId,joined[i].characterId);
  p=await gmView();assert.equal(p.characters.filter(c=>c.characterType==='player').length,100);assert.equal(p.npcs.length,7);
  const manifest=JSON.parse(await readFile(store,'utf8'));assert.equal(manifest.storageVersion,2);assert(manifest.checkpointSequence>=100);report.checkpointSequence=manifest.checkpointSequence;
  const players=p.characters.filter(c=>c.characterType==='player'),latency=[];
  for(let round=0;round<3;round++)await Promise.all(players.map(async actor=>{const began=performance.now();const view=await client.project({ownerId:actor.ownerId,actorId:actor.characterId,audience:'private'});assert.equal(view.characterId,actor.characterId);assert.equal(view.audience,'private');latency.push(performance.now()-began);}));
  latency.sort((a,b)=>a-b);report.privateViews={requests:latency.length,p95Ms:Math.round(latency[Math.ceil(latency.length*.95)-1]),successRate:1};
  await assert.rejects(client.project({ownerId:players[0].ownerId,actorId:players[1].characterId,audience:'private'}));
  await command('gm_decision',{open:true});const running=await gmView();assert.equal(running.runRequested,true);
  await admission.close();admission=null;await engine.close();engine=null;await start();report.runningRecoveryMs=engine.summary.recoveryElapsedMs;
  p=await gmView();assert.equal(p.revision,running.revision);assert.equal(p.decisionOpen,true);assert.equal(p.runRequested,true);assert.equal((await client.recovery({ownerId:gm})).held,true);
  await release();await command('gm_decision',{open:false});const paused=await gmView();assert.equal(paused.runRequested,false);
  await engine.close();engine=null;
  const archiveRoot=join(root,'verified-campaign-archive');const archived=await archiveCampaign({file:store,destination:archiveRoot});report.archive={manifest:join(archiveRoot,'manifest.json'),files:archived.files.length};
  await start();report.pausedRecoveryMs=engine.summary.recoveryElapsedMs;p=await gmView();assert.equal(p.revision,paused.revision);assert.equal(p.decisionOpen,false);assert.equal(p.runRequested,false);await release();
  admission=createAdmissionService({engine:client,dbPath:join(root,'admission.sqlite'),gmUserId:gm,authorize:async()=>true,seatLimit:100});assert.equal(admission.health().enrolled,100);
  assert.equal((await admission.join({campaignId,userId:owners[0]},input)).characterId,joined[0].characterId);
  await assert.rejects(admission.join({campaignId,userId:'999999999999999999'},input),{code:'PLAYER_CAPACITY'});
  report.status='passed';report.revision=p.revision;
 }catch(error){report.status='failed';report.failure={code:error.code??error.name,message:error.message};throw error;}
 finally{await admission?.close();await engine?.close();await writeFile(join(root,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({output:root,...report}));}
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [executable,outputRoot,hostProject]=process.argv.slice(2);await runProductionEngineRehearsal({executable,outputRoot,hostProject});
}
