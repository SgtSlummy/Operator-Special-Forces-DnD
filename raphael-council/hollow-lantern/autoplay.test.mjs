import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoplay,AUTOPLAY_CAMPAIGN} from './autoplay.mjs';
function fixture({progress=true,failure=false,pending=[],completeAfter=1}={}){
 let p={campaignId:AUTOPLAY_CAMPAIGN,audience:'gm',revision:0,decisionOpen:false,currentSceneId:'briefing',phase:'exploration',mission:{complete:false},pendingActions:pending,characters:['fighter','rogue','cleric'].map(c=>({characterId:'lantern-'+c,ownerId:'ai-'+c,characterType:'player'}))},status={state:'ready'},opens=0,allowed=true;const commands=[],events=[];
 const host={campaignId:AUTOPLAY_CAMPAIGN,gmUserId:'gm',authorize:async()=>allowed,engine:{project:async()=>structuredClone(p)},service:{project:async()=>({campaignId:AUTOPLAY_CAMPAIGN,revision:p.revision,actions:[{id:'decision',type:'gm_decision',payload:{open:!p.decisionOpen}},{id:'checkpoint',type:'checkpoint'},...p.pendingActions.map(r=>({id:`ruling:${r.id}:true:note`,type:'gm_resolve'})),{id:'scene:debrief',type:'gm_scene'}]}),command:async input=>{commands.push(input);p.revision++;if(input.action==='decision'){p.decisionOpen=!p.decisionOpen;if(p.decisionOpen){opens++;if(progress)p.revision++;status={state:failure?'stopped':'complete',lastOpportunity:{id:input.commandId,status:failure?'stopped':'complete',committed:progress?1:0}};if(progress&&opens>=completeAfter)p.mission.complete=true;}else status={...status,state:'paused'};}if(input.action.startsWith('ruling:'))p.pendingActions=[];return {campaignId:AUTOPLAY_CAMPAIGN,commandId:input.commandId,revision:p.revision,success:true};}}};
 return {host,ai:{status:()=>structuredClone(status)},record:async e=>events.push(e),commands,events,get projection(){return p;},revoke:()=>{allowed=false;}};
}
const build=(f,extra={})=>createAutoplay({...f,campaignId:AUTOPLAY_CAMPAIGN,gmUserId:'gm',...extra});
test('explicit start reuses existing AI opportunities, completes and pauses without scripting party',async()=>{const f=fixture();const runner=build(f);assert.equal(f.commands.length,0);const result=await runner.start();assert.equal(result.state,'complete');assert.equal(f.projection.decisionOpen,false);assert.ok(f.commands.every(c=>c.userId==='gm'&&!c.actorId));assert.ok(f.events.some(e=>e.kind==='party-opportunity'));assert.equal(await runner.start(),await runner.start());assert.equal(f.commands.filter(c=>c.action==='checkpoint').length,1);});
test('original campaign and absent evidence writer are refused',()=>{const f=fixture();assert.throws(()=>build(f,{campaignId:'operation-hollow-lantern'}),/rehearsal-only/);assert.throws(()=>build(f,{record:null}),/evidence/);});

test('waiting Inspiration never becomes a GM ruling or an implicitly opened opportunity',async()=>{
 const f=fixture({pending:[{id:'die',kind:'inspiration',actorId:'lantern-fighter'}]});f.projection.rollPending=true;let choices=0;
 const result=await build(f,{chooseDM:async()=>{choices++;return {action:'ruling:die:true:note'};}}).start();
 assert.equal(result.reason,'inspiration-continuation-required');assert.equal(choices,0);assert.equal(f.commands.length,0);assert.equal(result.opportunities,0);
});

test('existing roll continuation is observed without scripting a choice or granting another turn',async()=>{
 const f=fixture({pending:[{id:'die',kind:'inspiration'}]});f.projection.rollPending=true;let statusReads=0,waits=0;
 f.ai.status=()=>({state:++statusReads===1?'ready':'awaiting-roll'});
 const result=await build(f,{sleep:async()=>{waits++;f.projection.rollPending=false;f.projection.pendingActions=[];f.projection.revision++;f.projection.mission.complete=true;}}).start();
 assert.equal(result.state,'complete');assert.equal(waits,1);assert.deepEqual(f.commands.map(c=>c.action),['checkpoint']);assert.equal(result.opportunities,0);
});

test('human roll and timed-out continuation stop with the pending choice intact',async()=>{
 for(const waiting of ['awaiting-human','awaiting-roll']){
  const f=fixture({pending:[{id:'die',kind:'inspiration'}]});f.projection.rollPending=true;let calls=0,clock=0;
  f.ai.status=()=>({state:++calls===1?'ready':waiting});
  const result=await build(f,{maxDurationMs:1000,now:()=>clock,sleep:async ms=>{clock+=ms;}}).start();
  assert.equal(result.reason,waiting==='awaiting-human'?'inspiration-human-required':'time-limit');assert.equal(f.commands.length,0);assert.equal(f.projection.pendingActions.length,1);
 }
});

test('opening reserves the enforced continuation window rather than only three ordinary actions',async()=>{
 const f=fixture(),status=f.ai.status;f.ai.status=()=>({...status(),opportunityCommandLimit:35});
 const result=await build(f,{maxCommands:38}).start();assert.equal(result.reason,'revision-budget');assert.equal(f.commands.length,0);
 const bad=fixture(),original=bad.ai.status;bad.ai.status=()=>({...original(),opportunityCommandLimit:100});
 assert.equal((await build(bad).start()).reason,'ai-budget-unavailable');assert.equal(bad.commands.length,0);
});

test('die choices are recorded separately from completed party intentions',async()=>{
 const f=fixture(),status=f.ai.status;f.ai.status=()=>{const s=status();if(s.lastOpportunity)s.lastOpportunity={...s.lastOpportunity,committed:3,committedIntentCount:1,choiceCount:2};return s;};
 assert.equal((await build(f).start()).state,'complete');const e=f.events.find(x=>x.kind==='party-opportunity');assert.equal(e.committed,1);assert.equal(e.choiceCount,2);
 const bad=fixture(),prior=bad.ai.status;bad.ai.status=()=>{const s=prior();if(s.lastOpportunity)s.lastOpportunity.choiceCount=33;return s;};
 assert.equal((await build(bad).start()).reason,'ai-budget-unavailable');
});
test('three empty opportunities stop, but first ordinary wait does not',async()=>{const f=fixture({progress:false});const result=await build(f).start();assert.equal(result.reason,'three-opportunities-without-progress');assert.equal(result.opportunities,3);assert.equal(f.projection.decisionOpen,false);});
test('provider failure stops before further opportunity and never steals lease',async()=>{const f=fixture({failure:true});const result=await build(f).start();assert.equal(result.reason,'party-provider-or-action-failure');assert.equal(result.opportunities,1);assert.equal(f.projection.decisionOpen,false);});
test('failed opportunity records sanitized failure metadata before stopping',async()=>{const f=fixture({failure:true});const original=f.ai.status;f.ai.status=()=>{const s=original();if(s.lastOpportunity)s.lastOpportunity.failures=[{actorId:'lantern-fighter',reason:'planning-failed',code:'AI_HTTP_503',message:'PRIVATE response token'},{actorId:'hidden npc name',reason:'PRIVATE response token',code:'token=SECRET'}];return s;};await build(f).start();const event=f.events.find(e=>e.kind==='party-opportunity');assert.equal(event.status,'stopped');assert.deepEqual(event.failures[0],{actorId:'lantern-fighter',reason:'planning-failed',code:'AI_HTTP_503'});assert.deepEqual(event.failures[1],{actorId:'unknown',reason:'unavailable',code:'unavailable'});assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE|SECRET|hidden npc/);assert.ok(f.events.indexOf(event)<f.events.findIndex(e=>e.kind==='autoplay-stop'));});
test('only engine-authored pending mission gets delegated approval; evidence contains no GM content',async()=>{const f=fixture({pending:[{id:'request',kind:'mission:rescue-technician',text:'PRIVATE hidden NPC details'}]});const result=await build(f).start();assert.equal(result.state,'complete');assert.equal(f.commands[0].action,'ruling:request:true:note');assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE|hidden NPC/);});
test('controller cannot select party actor or scene override; authorization loss denies commands',async()=>{for(const selection of [{action:'decision',actorId:'lantern-fighter'},{action:'scene:debrief'}]){const f=fixture();const r=await build(f,{chooseDM:async()=>selection}).start();assert.equal(r.state,'stopped');assert.equal(f.commands.length,0);}const f=fixture();f.revoke();const r=await build(f).start();assert.equal(r.reason,'dm-access-unavailable');assert.equal(f.commands.length,0);});
test('uncertain commit is never retried with a new identity',async()=>{const f=fixture();let calls=0;f.host.service.command=async()=>{calls++;throw Error('transport uncertain PRIVATE');};const r=await build(f).start();assert.equal(r.reason,'unconfirmed-command-or-controller-failure');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);});
test('NPC with exhausted movement ends turn instead of submitting offered but unaffordable move',async()=>{
 const f=fixture({progress:false}),p=f.projection;p.phase='combat';p.activeActorId='sentinel';p.characters.push({characterId:'sentinel',characterType:'npc',ownerId:''});
 const originalProjection=f.host.engine.project,originalView=f.host.service.project,originalCommand=f.host.service.command;
 f.host.engine.project=async scope=>scope.audience==='private'?{campaignId:AUTOPLAY_CAMPAIGN,audience:'private',characterId:'sentinel',characters:[{characterId:'sentinel',factionId:'hostile',position:{x:1,y:1},resources:{action:true,movementFeet:0}},{characterId:'lantern-fighter',factionId:'party',position:{x:5,y:1}}],availableMovement:[{x:2,y:1,costFeet:5}]}:originalProjection(scope);
 f.host.service.project=async scope=>scope.actorId?{campaignId:AUTOPLAY_CAMPAIGN,revision:p.revision,actions:p.decisionOpen?[{id:'move:2:1',type:'move',payload:{x:2,y:1}},{id:'end_turn',type:'end_turn'}]:[]}:originalView(scope);
 f.host.service.command=async input=>{if(input.action==='end_turn'){p.mission.complete=true;p.phase='exploration';}return originalCommand(input);};
 const result=await build(f).start();assert.equal(result.state,'complete');assert.ok(f.commands.some(c=>c.actorId==='sentinel'&&c.action==='end_turn'));assert.ok(!f.commands.some(c=>c.action==='move:2:1'));
});
