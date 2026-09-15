// Developer-only deterministic browser transport reproduction. No participant,
// model, Unity process, real identity or saved game is used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createIsolatedBrowser} from './isolated-interactive-rehearsal.mjs';
import {createWebTable} from './web-server.mjs';
import {presentProjection} from './service.mjs';
const output=join('C:/Users/Hermes/LocalFiles/hollow-lantern/validation','browser-transport-'+randomUUID());await mkdir(output);
const campaignId='fixture-ruling-browser',userId='fixture-dm';
const scope={campaignId,userId,audience:'gm'};
const projection={projectionVersion:2,campaignId,revision:7,audience:'gm',currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[],pendingActions:[{id:'request-1',kind:'ruling',text:'Inspect the expedition records before moving them.'}],map:{width:1,height:1,level:'tactical',cells:[{x:0,y:0,visibility:'visible',terrain:'floor'}],tokens:[]}};
const commands=[];const authorize=s=>s.campaignId===campaignId&&s.userId===userId&&s.audience==='gm';
const service={project:async()=>presentProjection(projection),command:async request=>{assert.equal(request.action,'ruling:request-1:false');assert.equal(commands.length,0);commands.push(request);projection.revision++;projection.pendingActions=[];return {success:true,campaignId,commandId:request.commandId,revision:8,replayed:false,result:{message:'Fixture request declined.'}};}};
const table=createWebTable({port:18795,getHost:()=>({authorize,service})});let browser,stage='startup',failure;const screens=[];
const screenshot=async name=>{stage=`screenshot-${name}`;const screen=await browser.screenshot();assert.equal(screen.png.readUInt32BE(16),1280);assert.equal(screen.png.readUInt32BE(20),1000);await writeFile(join(output,name+'.png'),screen.png);screens.push(name);};
try{
 await table.start();browser=await createIsolatedBrowser({loginUrl:await table.webLink(scope)});await writeFile(join(output,'isolation.json'),JSON.stringify(await browser.proof(),null,2));
 await screenshot('01-entry');stage='open-review';await browser.act({kind:'click',x:163,y:487});await screenshot('02-review');
 stage='choose-decline';await browser.act({kind:'select',x:1079,y:535,text:'Decline request'});await screenshot('03-selected');
 stage='confirm';await browser.act({kind:'click',x:1079,y:668});await screenshot('04-result');assert.equal(commands.length,1);
}catch(error){failure={stage,type:error.name,code:error.message==='browser-operation-failed'?error.message:'developer-check-failed',detail:error.code};process.exitCode=1;}
finally{await browser?.close();await table.close();await writeFile(join(output,'result.json'),JSON.stringify({developerOnly:true,actualParticipant:false,modelCalls:0,unityCommands:0,syntheticCommands:commands.length,screens,failure,passed:!failure},null,2));console.log(JSON.stringify({output,failure,syntheticCommands:commands.length}));}
