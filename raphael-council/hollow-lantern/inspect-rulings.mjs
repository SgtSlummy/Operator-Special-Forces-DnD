// One read-only, isolated DM participant slice against the named disposable
// Unity fixture. This controller never resolves the pending request.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createEngineClient} from './engine-client.mjs';
import {createGameService} from './service.mjs';
import {createWebTable} from './web-server.mjs';
import {fixtureAuthorize} from './fixture-web.mjs';
import {createIsolatedBrowser,createVisualParticipant,runPanelInspection} from './isolated-interactive-rehearsal.mjs';

const fixture='C:/Users/Hermes/LocalFiles/HollowLanternUI-20260909';
const outputRoot='C:/Users/Hermes/LocalFiles/hollow-lantern/validation';
if(process.argv.slice(2).some(arg=>arg!=='--phone'))throw Error('Only --phone is supported.');
const viewport=process.argv.includes('--phone')?'phone':'desktop';
const snapshot=()=>readFile(join(fixture,'campaign.json'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=await snapshot(),state=JSON.parse(JSON.parse(before.toString()).body);
if(state.campaignId!=='fixture-hollow-ui'||state.channelId!=='fixture-ui'||state.gmId!=='fixture-dm'||state.revision!==7||state.pendingActions.length!==1)throw Error('Expected populated disposable fixture is unavailable; nothing was started.');
const client=createEngineClient({campaignId:state.campaignId,channelId:state.channelId,baseUrl:'http://127.0.0.1:18794',secret:(await readFile(join(fixture,'bridge-secret'),'utf8')).trim()});
const service=createGameService({client,authorize:fixtureAuthorize}),art=resolve('../campaign-art/hollow-lantern');
const table=createWebTable({getHost:()=>({service,authorize:fixtureAuthorize}),port:18795,renderAssets:{portraits:{'lantern-fighter':join(art,'mara.png'),'lantern-rogue':join(art,'kestrel.png'),'lantern-cleric':join(art,'ash.png'),'lantern-sentinel':join(art,'sentinel-sd.png')},terrainTextures:{floor:join(art,'stone-floor-sd.png')}}});
let browser,participant;
try {
 await table.start();
 const loginUrl=await table.webLink({campaignId:state.campaignId,userId:state.gmId,audience:'gm'});
 browser=await createIsolatedBrowser({loginUrl,readOnly:true,viewport});
 participant=createVisualParticipant();
 const result=await runPanelInspection({browser,participant,identity:`disposable DM (${viewport})`,outputRoot,
  tasks:['Open the pending-rulings view and describe the request that is waiting. Inspect the available responses and explain what each would do. Do not submit or confirm a ruling.'],
  audit:async({observation})=>{
   const unchanged=digest(await snapshot())===digest(before);
   const namesBoth=/\bapprove\b/i.test(observation)&&/\bdecline\b/i.test(observation);
   const describesRequest=/ledger|convoy/i.test(observation);
   // Naming buttons alone does not establish understanding of their effects.
   // Preserve these subchecks for an independent screenshot/semantic review;
   // never award a full pass from keyword matches.
   return {passed:false,recognitionCandidate:unchanged&&namesBoth&&describesRequest,unchanged,namesBoth,describesRequest,observation,independentScreenshotReviewRequired:true};
  }});
 browser=undefined;participant=undefined;
 const unchanged=digest(await snapshot())===digest(before);
 await writeFile(join(result.directory,'controller-save-check.json'),JSON.stringify({campaignId:state.campaignId,revision:state.revision,viewport,beforeSha256:digest(before),afterSha256:digest(await snapshot()),unchanged,readOnly:true,maxParticipantActions:10,modelDeadlineMs:90000,liveCampaign:false},null,2));
 console.log(JSON.stringify({...result,unchanged,independentScreenshotReviewRequired:true}));
 if(!unchanged)process.exitCode=1;
} finally {
 await Promise.allSettled([browser?.close(),participant?.close()]);await table.close();
}
