import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {startSavedEngine} from './engine-launch.mjs';
import {createEngineClient} from './engine-client.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
const percentiles=values=>{const sorted=[...values].sort((a,b)=>a-b);return Object.fromEntries([50,95,99].map(p=>['p'+p,Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p/100)-1)]??0)]));};
const requireCheck=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};

/** Synthetic signed-engine workload only. No production URL or credentials are
 * accepted. Losing revision races are measured, never silently called success.
 * Subsequent actions are explicit refreshed synthetic intentions; unknown command
 * outcomes stop the writer and are not retried. */
export async function runConcurrentRehearsal({executable,fixtureRoot,outputRoot,port=18963,rounds=6,intervalMs=5000}={}){
  for(const path of [executable,fixtureRoot,outputRoot])requireCheck(isAbsolute(path??'')&&!/(?:^|[/\\])OneDrive(?: - [^/\\]+)?(?:[/\\]|$)/i.test(path),'LOCAL_PATH_REQUIRED');
  requireCheck(Number.isInteger(port)&&port>=1024&&port<=65535&&Number.isInteger(rounds)&&rounds>=1&&rounds<=12&&Number.isInteger(intervalMs)&&intervalMs>=0&&intervalMs<=10000,'INVALID_BOUNDS');
  const fixture=JSON.parse(await readFile(join(fixtureRoot,'fixture.json'),'utf8'));
  requireCheck(fixture.synthetic===true&&fixture.campaignId==='population'&&fixture.channelId==='table'&&fixture.gmId==='dm'&&fixture.players?.length===100&&new Set(fixture.players.map(p=>p.ownerId)).size===100&&new Set(fixture.players.map(p=>p.actorId)).size===100,'SYNTHETIC_FIXTURE_REQUIRED');
  const output=join(outputRoot,'concurrent-'+randomUUID());await mkdir(output,{recursive:true});
  for(const suffix of ['','.wal','.wal.meta'])await copyFile(join(fixtureRoot,'campaign.json'+suffix),join(output,'campaign.json'+suffix));
  const secret=randomBytes(32).toString('hex');await writeFile(join(output,'bridge.secret'),secret,{flag:'wx',mode:0o600});
  const env={HOLLOW_LANTERN_CAMPAIGN_ID:'population',HOLLOW_LANTERN_CHANNEL_ID:'table',HOLLOW_LANTERN_GM_ID:'dm',HOLLOW_LANTERN_ENGINE_URL:`http://127.0.0.1:${port}`,HOLLOW_LANTERN_STORE_FILE:join(output,'campaign.json'),HOLLOW_LANTERN_SECRET_FILE:join(output,'bridge.secret')};
  const client=createEngineClient({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:'population',channelId:'table',secret,timeoutMs:20000});
  const report={kind:'unity-concurrent-actions',synthetic:true,productionModified:false,players:100,campaigns:1,startedAt:new Date().toISOString(),status:'running',limitations:['Signed loopback API, not browser/Discord OAuth or public-network capacity.','Freeform intentions remain pending; no AI referee or voice is exercised.','One global revision intentionally accepts one winner from a stale simultaneous action wave; subsequent intentions are explicitly refreshed.']};
  const receipts=[],requests=[],readLatency=[],writeLatency=[],readErrors=[];let host,reads,readAttempts=0,stage='setup',lastAttempt;
  const view=(audience='public')=>client.project({ownerId:'dm',audience,mapLevel:'regional'});
  const gm=async(type,payload)=>{const current=await view();return client.command({ownerId:'dm',commandId:randomUUID(),expectedRevision:current.revision,type,payload});};
  const describe=(player,revision)=>({...player,commandId:randomUUID(),expectedRevision:revision,type:'describe',payload:{text:`Synthetic personal intention for ${player.actorId}.`}});
  try{
    host=await startSavedEngine({env,executable,outputRoot:output});requireCheck(host.summary.status==='ready','FRESH_ENGINE_REQUIRED');
    report.build={domainSha256:host.summary.domainSha256};
    await gm('gm_prepare_world',{});await gm('gm_decision',{open:true});
    const start=await view(),wave=fixture.players.map(player=>describe(player,start.revision));
    stage='simultaneous revision race';
    const collisions=await Promise.all(wave.map(async request=>{try{return {request,receipt:await client.command(request)};}catch(error){return {request,code:error.code??'REQUEST_FAILED'};}}));
    const winners=collisions.filter(row=>row.receipt),stale=collisions.filter(row=>row.code==='STALE_REVISION');
    report.contention={attempted:100,committed:winners.length,staleRejected:stale.length,otherErrors:collisions.filter(row=>row.code&&row.code!=='STALE_REVISION').map(row=>row.code)};
    requireCheck(winners.length===1&&stale.length===99,'REVISION_RACE_FAILED');
    receipts.push(winners[0].receipt);requests.push(winners[0].request);
    reads=(async()=>{for(let round=0;round<rounds;round++){
      const began=performance.now();
      await Promise.all(fixture.players.map(async player=>{readAttempts++;const since=performance.now();try{
        const privateView=await client.project({...player,audience:'private',mapLevel:'tactical'});
        requireCheck(privateView.characterId===player.actorId&&privateView.pendingActions.every(p=>p.actorId===player.actorId),'PRIVATE_SCOPE_FAILED');
        requireCheck(privateView.privateHistory.every(h=>h.characterId===player.actorId),'HISTORY_SCOPE_FAILED');
        readLatency.push(performance.now()-since);
      }catch(error){readErrors.push({round,code:error.code??'REQUEST_FAILED'});}}));
      if(round<rounds-1)await pause(Math.max(0,intervalMs-(performance.now()-began)));
    }})();
    for(const player of fixture.players.filter(p=>p.actorId!==winners[0].request.actorId)){
      stage='refresh next private view';
      const current=await client.project({...player,audience:'private',mapLevel:'regional'}),request=describe(player,current.revision),since=performance.now();
      stage='concurrent duplicate delivery';lastAttempt={ownerId:request.ownerId,actorId:request.actorId,commandId:request.commandId,expectedRevision:request.expectedRevision};
      const copies=await Promise.all([client.command(request),client.command(request)]);
      requireCheck(copies[0].revision===copies[1].revision&&copies.filter(r=>r.replayed===false).length===1&&copies.filter(r=>r.replayed===true).length===1,'DUPLICATE_ACTION_FAILED');
      writeLatency.push(performance.now()-since);receipts.push(copies[0]);requests.push(request);
    }
    stage='pause and restart';await reads;await gm('gm_decision',{open:false});
    const before=await view('gm');
    requireCheck(before.pendingActions.length===100&&new Set(before.pendingActions.map(p=>p.actorId)).size===100,'PENDING_ACTIONS_LOST');
    report.gmViewBytes=Buffer.byteLength(JSON.stringify(before));
    await host.close();await host.done;host=await startSavedEngine({env,executable,outputRoot:output});
    const restored=await view('gm');
    requireCheck(restored.revision===before.revision&&!restored.decisionOpen&&restored.pendingActions.length===100&&new Set(restored.pendingActions.map(p=>p.actorId)).size===100&&JSON.stringify(restored.pendingActions)===JSON.stringify(before.pendingActions),'RESTART_ACTIONS_LOST');
    await Promise.all(fixture.players.map(async player=>{
      const own=await client.project({...player,audience:'private',mapLevel:'regional'}),request=requests.find(r=>r.actorId===player.actorId);
      requireCheck(own.revision===restored.revision&&own.characterId===player.actorId&&own.characters.find(c=>c.characterId===player.actorId)?.ownerId===player.ownerId,'RESTART_OWNERSHIP_FAILED');
      requireCheck(own.pendingActions.length===1&&own.pendingActions[0].id===request.commandId&&own.pendingActions[0].actorId===player.actorId&&own.privateHistory.every(h=>h.characterId===player.actorId),'RESTART_PRIVACY_FAILED');
    }));
    // The oldest receipt must still replay after the 64-event presentation window
    // has rolled over; a receipt lookup never reapplies an intention.
    for(const request of [requests[0],requests[49],requests[99]]){
      const replay=await client.receipt({ownerId:request.ownerId,actorId:request.actorId,commandId:request.commandId});
      requireCheck(replay.replayed&&replay.revision===request.expectedRevision+1,'RESTART_RECEIPT_FAILED');
    }
    requireCheck((await view()).revision===restored.revision,'RECEIPT_MUTATED_STATE');
    report.restart={passed:true,revision:restored.revision,pendingIntentions:100,privateOwnersVerified:100,oldReceiptsVerified:3,startupTimeoutMs:host.summary.startupTimeoutMs,startupElapsedMs:host.summary.startupElapsedMs,recoveryElapsedMs:host.summary.recoveryElapsedMs};
    report.status=readErrors.length===0?'component-checks-passed':'failed';
  }catch(error){report.status='failed';report.failure=error.code??'CONCURRENT_REHEARSAL_FAILED';report.failureStage=stage;if(stage==='concurrent duplicate delivery')report.unconfirmedAttempt=lastAttempt;}
  finally{
    if(reads)await reads.catch(()=>{});
    report.reads={planned:rounds*100,attempted:readAttempts,succeeded:readLatency.length,failed:readErrors.length,latencyMs:percentiles(readLatency),errors:readErrors};
    report.actions={workload:'100-owner race, then 99 sequential refreshed intentions with two concurrent duplicate deliveries each',confirmedDistinctActions:receipts.length,duplicatePairsVerified:writeLatency.length,latencyMs:percentiles(writeLatency)};
    if(host)try{await host.close();await host.done;}catch{report.cleanup='Owned engine still running';report.status='failed';}
    report.completedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  }
  return {output,...report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [executable,fixtureRoot,outputRoot]=process.argv.slice(2);const report=await runConcurrentRehearsal({executable,fixtureRoot,outputRoot});console.log(JSON.stringify(report));if(report.status==='failed')process.exitCode=1;}
  catch(error){console.error(error.code??'CONCURRENT_CONFIGURATION_INVALID');process.exitCode=1;}
}
