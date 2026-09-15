import {readFile,writeFile,mkdir,copyFile,open,rename} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startSavedEngine} from './engine-launch.mjs';
import {createEngineClient} from './engine-client.mjs';
import {createCommitFollower} from './commit-events.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};

/** Large, synthetic GM history through the real Unity listener. The follower
 * delivers only to an in-memory verifier, never Discord, voice or another user. */
export async function runGmJournalRehearsal({executable,fixtureRoot,outputRoot,port=18964}={}){
  for(const path of [executable,fixtureRoot,outputRoot])check(isAbsolute(path??'')&&!/(?:^|[/\\])OneDrive(?: - [^/\\]+)?(?:[/\\]|$)/i.test(path),'LOCAL_PATH_REQUIRED');
  check(Number.isInteger(port)&&port>=1024&&port<=65535,'INVALID_PORT');
  const fixture=JSON.parse(await readFile(join(fixtureRoot,'fixture.json'),'utf8'));
  check(fixture.synthetic===true&&fixture.campaignId==='large-gm-fixture'&&fixture.channelId==='fixture-table'&&fixture.gmId==='fixture-dm'&&fixture.players?.length===100,'SYNTHETIC_FIXTURE_REQUIRED');
  const savedEnvelope=JSON.parse(await readFile(join(fixtureRoot,'campaign.json'),'utf8'));
  check(hash(savedEnvelope.body)===savedEnvelope.sha256,'FIXTURE_SAVE_INVALID');
  const savedState=JSON.parse(savedEnvelope.body),savedEntries=savedState.committedEvents;
  check(savedState.campaignId===fixture.campaignId&&savedEntries?.length===64,'FIXTURE_JOURNAL_REQUIRED');
  const output=join(outputRoot,'gm-journal-'+randomUUID());await mkdir(output,{recursive:true});
  for(const suffix of ['','.wal','.wal.meta'])await copyFile(join(fixtureRoot,'campaign.json'+suffix),join(output,'campaign.json'+suffix));
  const secret=randomBytes(32).toString('hex');await writeFile(join(output,'bridge.secret'),secret,{flag:'wx',mode:0o600});
  const env={HOLLOW_LANTERN_CAMPAIGN_ID:fixture.campaignId,HOLLOW_LANTERN_CHANNEL_ID:fixture.channelId,HOLLOW_LANTERN_GM_ID:fixture.gmId,HOLLOW_LANTERN_ENGINE_URL:`http://127.0.0.1:${port}`,HOLLOW_LANTERN_STORE_FILE:join(output,'campaign.json'),HOLLOW_LANTERN_SECRET_FILE:join(output,'bridge.secret')};
  const client=createEngineClient({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:fixture.campaignId,channelId:fixture.channelId,secret,timeoutMs:20000});
  const report={kind:'large-gm-journal',synthetic:true,productionModified:false,status:'running',startedAt:new Date().toISOString(),limitations:['Synthetic signed loopback engine and local observer only.','No live Discord delivery, AI inference, voice or public-network load.','GM views remain bounded at16MiB; other response types retain2MiB.']};
  let host,follower;const deliveries=[];
  const observer=()=>createCommitFollower({client,gmUserId:fixture.gmId,cursorFile:join(output,'observer.json'),authorize:async()=>true,onEvent:async entry=>{deliveries.push({revision:entry.revision,hash:hash(JSON.stringify(entry.publicProjection))});}});
  try{
    host=await startSavedEngine({env,executable,outputRoot:output});check(host.summary.status==='ready','FRESH_ENGINE_REQUIRED');
    report.build={domainSha256:host.summary.domainSha256};
    const gm=await client.project({ownerId:fixture.gmId,audience:'gm',mapLevel:'regional'}),entries=gm.committedEvents.entries;
    check(gm.characters.length===104&&entries.length===64&&gm.npcs.length===4&&gm.npcs.every(n=>n.memories.length===500),'LARGE_VIEW_TRUNCATED');
    check(entries.every((entry,index)=>entry.revision===savedEntries[index].revision&&hash(JSON.stringify(entry.publicProjection))===hash(JSON.stringify(savedEntries[index].publicProjection))),'SAVED_HISTORY_CHANGED');
    report.gmProjectionBytes=Buffer.byteLength(JSON.stringify(gm));check(report.gmProjectionBytes>2*1024*1024,'LARGE_VIEW_NOT_EXERCISED');
    const player=await client.project({...fixture.players[0],audience:'private',mapLevel:'regional'}),publicView=await client.project({ownerId:fixture.gmId,audience:'public',mapLevel:'regional'});
    check(!JSON.stringify(player).includes('\u8a18'.repeat(50))&&!JSON.stringify(publicView).includes('\u8a18'.repeat(50)),'PRIVATE_MEMORY_LEAK');
    // A live read-only backup must still work with the Windows owned WAL handle.
    const wal=env.HOLLOW_LANTERN_STORE_FILE+'.wal',before=hash(await readFile(wal));
    await copyFile(wal,join(output,'live-backup.wal'),1);check(hash(await readFile(join(output,'live-backup.wal')))===before&&hash(await readFile(wal))===before,'LIVE_BACKUP_FAILED');
    let writable;try{writable=await open(wal,'r+');}catch(error){check(['EPERM','EACCES','EBUSY'].includes(error.code),'WRITER_PROBE_FAILED');}
    if(writable){await writable.close();check(false,'WAL_WRITER_NOT_EXCLUDED');}
    // Probe only the isolated synthetic copy; restore immediately if exclusion fails.
    let renamed=false;try{await rename(wal,wal+'.rename-probe');renamed=true;}catch(error){check(['EPERM','EACCES','EBUSY'].includes(error.code),'RENAME_PROBE_FAILED');}
    if(renamed){await rename(wal+'.rename-probe',wal);check(false,'WAL_RENAME_NOT_EXCLUDED');}
    report.liveBackup={passed:true,externalWriterExcluded:true,externalRenameExcluded:true};
    follower=await observer();const initial=await follower.poll();check(initial.count===64&&deliveries.length===64,'JOURNAL_DELIVERY_INCOMPLETE');
    check(deliveries.every((d,index)=>d.revision===entries[index].revision&&d.hash===hash(JSON.stringify(entries[index].publicProjection))),'HISTORICAL_SNAPSHOT_CHANGED');
    check((await follower.poll()).count===0,'DUPLICATE_OBSERVER_DELIVERY');await follower.close();follower=undefined;
    await host.close();await host.done;host=await startSavedEngine({env,executable,outputRoot:output});
    follower=await observer();const resumed=await follower.poll();check(resumed.count===0&&resumed.revision===gm.revision&&deliveries.length===64,'OBSERVER_RESTART_DUPLICATED');
    report.observer={delivered:64,exactHistoricalSnapshots:true,restartDuplicates:0,revision:resumed.revision};report.status='component-checks-passed';
  }catch(error){report.status='failed';report.failure=error.code??'GM_JOURNAL_REHEARSAL_FAILED';}
  finally{
    if(follower)try{await follower.close();}catch{report.status='failed';report.observerCleanup='failed';}
    if(host)try{await host.close();await host.done;}catch{report.status='failed';report.cleanup='Owned engine still running';}
    report.completedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  }
  return {output,...report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [executable,fixtureRoot,outputRoot]=process.argv.slice(2);const report=await runGmJournalRehearsal({executable,fixtureRoot,outputRoot});console.log(JSON.stringify(report));if(report.status==='failed')process.exitCode=1;}
  catch(error){console.error(error.code??'GM_JOURNAL_CONFIGURATION_INVALID');process.exitCode=1;}
}
