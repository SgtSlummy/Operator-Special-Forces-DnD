// One disposable ruling execution. Controller expectations and stores never
// enter the screenshot participant channel. Existing fixtures are only read.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {createEngineClient,EngineError} from './engine-client.mjs';
import {createGameService} from './service.mjs';
import {createWebTable} from './web-server.mjs';
import {fixtureAuthorize} from './fixture-web.mjs';
import {createIsolatedBrowser,createVisualParticipant,runPanelInspection} from './isolated-interactive-rehearsal.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>JSON.parse(JSON.parse(b.toString()).body);
const mechanics=s=>Object.fromEntries(Object.entries(s).filter(([k])=>!['revision','pendingActions','receipts','publicEvents'].includes(k)));
export function evaluateRulingCommit({before,after,attempts,receipts,approved=false,requireExplanation=false}){
 const expected=before.pendingActions[0]?.id;
 const singleRequestedRuling=attempts.length===1&&attempts[0].type==='gm_resolve'&&attempts[0].payload?.pendingId===expected&&attempts[0].payload?.approved===approved;
 const singleDecline=singleRequestedRuling&&approved===false;
 const receipt=receipts[0];
 const committed=singleRequestedRuling&&receipts.length===1&&receipt.success===true&&receipt.campaignId===before.campaignId&&receipt.commandId===attempts[0].commandId&&receipt.revision===before.revision+1;
 const persisted=committed&&after.receipts?.[receipt.commandId]?.response?.success===true&&isDeepStrictEqual(after.receipts[receipt.commandId].response,receipt);
 const explanation=attempts[0]?.payload?.text;
 const explanationRecorded=!requireExplanation||(typeof explanation==='string'&&explanation.trim().length>0&&receipt?.result?.message===(approved?'DM approved: ':'DM declined or interrupted: ')+explanation.trim());
 const cleared=after.pendingActions.length===0&&after.revision===before.revision+1;
 const mechanicsUnchanged=isDeepStrictEqual(mechanics(before),mechanics(after));
 return {passed:Boolean(committed&&persisted&&cleared&&mechanicsUnchanged&&explanationRecorded),singleRequestedRuling,singleDecline,explanationRecorded,committed:Boolean(committed),persisted:Boolean(persisted),cleared,mechanicsUnchanged};
}
async function freePort(){const server=createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});const port=server.address().port;await new Promise(r=>server.close(r));return port;}

export async function exerciseRuling({approvalWithExplanation=false}={}){
 if(typeof approvalWithExplanation!=='boolean')throw Error('UNKNOWN_RULING_EXERCISE');
 const expectation={approved:approvalWithExplanation,requireExplanation:approvalWithExplanation};
 const project='C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons';
 const source='C:/Users/Hermes/LocalFiles/HollowLanternUI-20260909/campaign.json';
 const originalLive=join(project,'raphael-council/.runtime/hollow-lantern/live/campaign.json');
 const sourceBytes=await readFile(source),before=decode(sourceBytes),liveHash=digest(await readFile(originalLive));
 if(before.campaignId!=='fixture-hollow-ui'||before.channelId!=='fixture-ui'||before.gmId!=='fixture-dm'||before.revision!==7||before.pendingActions.length!==1||before.pendingActions[0].kind!=='describe')throw Error('EXACT_DISPOSABLE_FIXTURE_REQUIRED');
 const root='C:/Users/Hermes/LocalFiles/hollow-lantern/validation';
 const directory=join(root,'ruling-execution-'+randomUUID());await mkdir(directory);
 const buildFiles=['hollow-lantern/exercise-ruling.mjs','hollow-lantern/isolated-interactive-rehearsal.mjs','hollow-lantern/service.mjs','hollow-lantern/web-server.mjs','hollow-lantern/web/table.js','hollow-lantern/web/table.css','hollow-lantern/web/table.html'];
 const buildHashes=async()=>Object.fromEntries(await Promise.all(buildFiles.map(async file=>[file,digest(await readFile(join(project,'raphael-council',file)))])));
 const buildBefore=await buildHashes();
 const store=join(directory,'campaign.json');await writeFile(store,sourceBytes,{flag:'wx'});await writeFile(join(directory,'before-campaign.json'),sourceBytes,{flag:'wx'});
 const executable='C:/Users/Hermes/LocalFiles/HollowLanternUnity-Mission/HollowLantern.exe';
 const port=await freePort(),secret=randomBytes(32).toString('hex');
 const engine=spawn(executable,['-batchmode','-nographics','-logFile',join(directory,'unity.log')],{cwd:project,windowsHide:true,stdio:'ignore',env:{...process.env,HOLLOW_LANTERN_UNITY:'1',HOLLOW_LANTERN_STORE:store,HOLLOW_LANTERN_CAMPAIGN:before.campaignId,HOLLOW_LANTERN_CHANNEL:before.channelId,HOLLOW_LANTERN_GM:before.gmId,HOLLOW_LANTERN_PORT:String(port),HOLLOW_FIGHTER_OWNER:'ai-fighter',HOLLOW_ROGUE_OWNER:'ai-rogue',HOLLOW_CLERIC_OWNER:'ai-cleric',RAPHAEL_GAME_BRIDGE_SECRET:secret}});
 let launchError;engine.on('error',e=>{launchError=e;});
 const client=createEngineClient({baseUrl:`http://127.0.0.1:${port}`,campaignId:before.campaignId,channelId:before.channelId,secret,timeoutMs:1500});
 const attempts=[],receipts=[];let browser,participant,table,result,guardFailure;
 const snapshot=async()=>decode(await readFile(store));
 const writeJson=(name,data)=>writeFile(join(directory,name),JSON.stringify(data,null,2));
 try{
  await writeJson('controller-build.json',{before:buildBefore});
  await writeJson('controller-runtime.json',{campaignId:before.campaignId,viewer:before.gmId,cloneOf:source,store,enginePid:engine.pid,enginePort:port,executable,executableSha256:digest(await readFile(executable)),sourceSha256:digest(sourceBytes),liveBeforeSha256:liveHash,realDiscord:false,fullMission:false,maxParticipantActions:10,modelDeadlineMs:90000,exercise:approvalWithExplanation?'approve-with-explanation':'decline'});
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){if(launchError||engine.exitCode!==null)throw Error('DISPOSABLE_ENGINE_LAUNCH_FAILED');try{const p=await client.project({ownerId:before.gmId,audience:'gm'});if(p.revision!==before.revision)throw Error('WRONG_FIXTURE_REVISION');ready=true;break;}catch(error){if(error.code!=='ENGINE_UNAVAILABLE')throw error;await delay(250);}}
  if(!ready)throw Error('DISPOSABLE_ENGINE_START_TIMEOUT');
  const guarded={...client,command:async request=>{
   if(request.type!=='gm_resolve'||request.payload.pendingId!==before.pendingActions[0].id||attempts.length){guardFailure='OUTSIDE_SINGLE_RULING';throw new EngineError('REHEARSAL_BOUNDARY','This rehearsal permits one response to the existing request.',403);}
   attempts.push(structuredClone(request));await writeJson('controller-submissions.json',attempts);
   const receipt=await client.command(request);receipts.push(receipt);await writeJson('controller-receipts.json',receipts);return receipt;
  }};
  const service=createGameService({client:guarded,authorize:fixtureAuthorize}),art=join(project,'campaign-art/hollow-lantern');
  table=createWebTable({getHost:()=>({service,authorize:fixtureAuthorize}),port:18795,renderAssets:{portraits:{'lantern-fighter':join(art,'mara.png'),'lantern-rogue':join(art,'kestrel.png'),'lantern-cleric':join(art,'ash.png'),'lantern-sentinel':join(art,'sentinel-sd.png')},terrainTextures:{floor:join(art,'stone-floor-sd.png')}}});
  await table.start();browser=await createIsolatedBrowser({loginUrl:await table.webLink({campaignId:before.campaignId,userId:before.gmId,audience:'gm'})});participant=createVisualParticipant();
  const act=browser.act;browser.act=async action=>{
   try{await act(action);}catch(error){guardFailure='BROWSER_ACTION_FAILED';throw error;}
   let after;try{after=await snapshot();}catch(error){guardFailure='STATE_READ_FAILED';throw error;}
   if(guardFailure||after.revision>before.revision+1||after.pendingActions.some(p=>p.id!==before.pendingActions[0].id)||!isDeepStrictEqual(mechanics(before),mechanics(after))){guardFailure??='UNEXPECTED_STATE_CHANGE';throw Error('REHEARSAL_GUARD_STOP');}
  };
  const task=approvalWithExplanation?'Open the waiting request. Approve it with a brief written explanation using the ordinary controls, then inspect the result and describe what changed. Do not take any other game action. If the result is unclear, stop.':'Open the waiting request. Decline it using the ordinary controls, then inspect the result and describe what changed. Do not take any other game action. If the result is unclear, stop.';
  result=await runPanelInspection({browser,participant,identity:'disposable DM ruling execution',outputRoot:directory,tasks:[task],audit:async({observation})=>({...evaluateRulingCommit({before,after:await snapshot(),attempts,receipts,...expectation}),observation,independentScreenshotReviewRequired:true})});
  browser=undefined;participant=undefined;
 }catch(error){await writeJson('controller-failure.json',{error:error.message,guardFailure});throw error;}
 finally{
  await Promise.allSettled([browser?.close(),participant?.close()]);await table?.close();
  if(engine.exitCode===null&&!launchError){engine.kill();await Promise.race([new Promise(r=>engine.once('exit',r)),delay(5000)]);}
  const after=await snapshot();await writeJson('controller-result.json',{result,guardFailure,...evaluateRulingCommit({before,after,attempts,receipts,...expectation}),sourceFixtureUnchanged:digest(await readFile(source))===digest(sourceBytes),originalLiveUnchanged:digest(await readFile(originalLive))===liveHash,engineStopped:engine.exitCode!==null||engine.signalCode!==null,revisionBefore:before.revision,revisionAfter:after.revision});
  const buildAfter=await buildHashes();await writeJson('controller-build.json',{before:buildBefore,after:buildAfter,unchanged:isDeepStrictEqual(buildBefore,buildAfter)});
 }
 console.log(JSON.stringify({directory,participantEvidence:result?.directory,outcome:result?.outcome}));return {directory,result};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--approve-with-explanation')||args.length>1)throw Error('UNKNOWN_RULING_EXERCISE');
 await exerciseRuling({approvalWithExplanation:args.includes('--approve-with-explanation')});
}
