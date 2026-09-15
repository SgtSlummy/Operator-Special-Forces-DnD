import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {startSavedEngine} from './engine-launch.mjs';
import {createEngineClient} from './engine-client.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));
const percentiles=values=>{const sorted=[...values].sort((a,b)=>a-b);return Object.fromEntries([50,95,99].map(p=>['p'+p,Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p/100)-1)]??0)]));};

/** Component capacity evidence from the real signed Unity HTTP authority.
 * Creates a fresh copy of synthetic data and never accepts a production URL.
 * This intentionally does not certify Discord OAuth, rendering, voice or AI. */
export async function runCapacityRehearsal({executable,fixtureRoot,outputRoot,port=18961,rounds=6,intervalMs=5000}={}){
  for(const path of [executable,fixtureRoot,outputRoot])if(!isAbsolute(path??'')||/(?:^|[/\\])OneDrive(?: - [^/\\]+)?(?:[/\\]|$)/i.test(path))throw Error('Canonical local paths required.');
  if(!Number.isInteger(rounds)||rounds<1||rounds>24||!Number.isInteger(intervalMs)||intervalMs<0||intervalMs>10000)throw Error('Invalid capacity bounds.');
  const fixture=JSON.parse(await readFile(join(fixtureRoot,'fixture.json'),'utf8'));
  if(fixture.synthetic!==true||fixture.campaignId!=='population'||fixture.channelId!=='table'||fixture.gmId!=='dm'||fixture.players?.length!==100||new Set(fixture.players.map(p=>p.ownerId)).size!==100||new Set(fixture.players.map(p=>p.actorId)).size!==100)throw Error('A synthetic 100-player fixture is required.');
  const output=join(outputRoot,'capacity-'+randomUUID());await mkdir(output,{recursive:true});
  for(const suffix of ['','.wal','.wal.meta'])await copyFile(join(fixtureRoot,'campaign.json'+suffix),join(output,'campaign.json'+suffix));
  const secret=randomBytes(32).toString('hex');await writeFile(join(output,'bridge.secret'),secret,{flag:'wx',mode:0o600});
  const env={HOLLOW_LANTERN_CAMPAIGN_ID:'population',HOLLOW_LANTERN_CHANNEL_ID:'table',HOLLOW_LANTERN_GM_ID:'dm',HOLLOW_LANTERN_ENGINE_URL:`http://127.0.0.1:${port}`,HOLLOW_LANTERN_STORE_FILE:join(output,'campaign.json'),HOLLOW_LANTERN_SECRET_FILE:join(output,'bridge.secret')};
  const client=createEngineClient({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:'population',channelId:'table',secret,timeoutMs:20000});
  let host,withinPollBudget=true;const latency=[],errors=[],batches=[];
  const report={kind:'unity-authority-capacity',synthetic:true,productionModified:false,players:100,campaigns:1,rounds,intervalMs,startedAt:new Date().toISOString(),status:'running',limitations:['Signed loopback game API only; real browser/Discord authentication and rendering are not load-tested.','Voice, AI inference, public network and a complete human mission are separate release gates.']};
  const gm=()=>client.project({ownerId:'dm',audience:'gm',mapLevel:'regional'});
  const command=async(type,payload)=>{const view=await gm();return client.command({ownerId:'dm',commandId:randomUUID(),expectedRevision:view.revision,type,payload});};
  try{
    host=await startSavedEngine({env,executable,outputRoot:output});if(host.summary.status!=='ready')throw Error('A fresh owned engine is required.');
    report.build={executableSha256:host.summary.executableSha256,domainSha256:host.summary.domainSha256};
    await command('gm_prepare_world',{});
    for(const [id,role,name,x,y] of [['capacity-warden','boss','The Brass Warden',18,18],['capacity-mira','shopkeeper','Mira Voss',18,19],['capacity-guide','npc','Tamsin Reed',20,20],['capacity-raider','enemy','Ironwake Raider',21,20]])await command('gm_add_npc',{characterId:id,role,name,sceneId:'signal-dungeon',x,y});
    await command('gm_npc_memory',{npcId:'capacity-mira',characterId:fixture.players[0].actorId,text:'Synthetic private ledger memory.',relationship:25});
    const travelers=new Set(fixture.players.filter((_,index)=>index%2===1).map(p=>p.actorId));
    await command('gm_scene',{sceneId:'coastal-road',actorIds:[...travelers]});
    const initial=await gm();if(initial.characters.filter(c=>c.characterType==='player').length!==100)throw Error('The engine did not retain 100 players.');
    report.continuity={prepared:initial.continuity?.prepared===true,groups:initial.continuity?.groups?.length,npcs:initial.npcs.length};
    for(let round=0;round<rounds;round++){
      const started=performance.now();
      await Promise.all(fixture.players.map(async player=>{
        const begin=performance.now();
        try{
          const view=await client.project({...player,audience:'private',mapLevel:'tactical'});
          if(view.characterId!==player.actorId||view.characters.some(c=>c.ownerId!==undefined&&c.characterId!==player.actorId))throw Object.assign(Error(),{code:'PRIVACY_FAILED'});
          if(view.continuity?.prepared!==true||view.continuity.sceneId!==(travelers.has(player.actorId)?'coastal-road':'signal-dungeon')||view.continuity.groups!==undefined||view.continuity.strategies?.length!==6)throw Object.assign(Error(),{code:'CONTINUITY_FAILED'});
          latency.push(performance.now()-begin);
        }catch(error){errors.push({round,code:error.code??'REQUEST_FAILED'});}
      }));
      const elapsed=performance.now()-started;batches.push(Math.round(elapsed));withinPollBudget=withinPollBudget&&elapsed<=5000;
      if(round<rounds-1)await pause(Math.max(0,intervalMs-elapsed));
    }
    // Receipt identity is retained across the real process restart.
    const before=await gm(),request={ownerId:'dm',commandId:randomUUID(),expectedRevision:before.revision,type:'checkpoint',payload:{}};
    const receipt=await client.command(request);await host.close();await host.done;
    host=await startSavedEngine({env,executable,outputRoot:output});
    const restored=await gm(),replay=await client.command(request);
    const restoredNpc=restored.npcs.find(n=>n.characterId==='capacity-mira');
    report.restart={passed:restored.revision===receipt.revision&&replay.replayed===true&&replay.revision===receipt.revision&&restored.characters.filter(c=>c.characterType==='player').length===100&&restoredNpc.relationships[fixture.players[0].actorId]===25&&restoredNpc.memories.some(m=>m.text==='Synthetic private ledger memory.')&&restored.continuity?.prepared===true&&restored.continuity.groups.length===2,revision:restored.revision};
    report.requests={attempted:rounds*100,succeeded:latency.length,failed:errors.length,latencyMs:percentiles(latency),batchDurationMs:batches,errors};
    report.status=errors.length===0&&report.restart.passed?'component-checks-passed':'failed';
    report.meetsFiveSecondPollBudget=errors.length===0&&withinPollBudget;
  }catch(error){report.status='failed';report.failure=error.code??'CAPACITY_REHEARSAL_FAILED';}
  finally{
    if(host)try{await host.close();await host.done;}catch{report.cleanup='owned engine still running';report.status='failed';}
    report.completedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  }
  return {output,...report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [executable,fixtureRoot,outputRoot]=process.argv.slice(2);const report=await runCapacityRehearsal({executable,fixtureRoot,outputRoot});console.log(JSON.stringify(report));if(report.status==='failed'||!report.meetsFiveSecondPollBudget)process.exitCode=1;}
  catch{console.error('Capacity fixture configuration is invalid.');process.exitCode=1;}
}
