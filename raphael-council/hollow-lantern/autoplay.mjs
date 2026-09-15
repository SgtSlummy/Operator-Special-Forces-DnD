import {randomUUID} from 'node:crypto';
export const AUTOPLAY_CAMPAIGN='hollow-lantern-rehearsal-20260910';
const seats=['fighter','rogue','cleric'];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Delegated DM only. Party choices are made exclusively by the existing scoped AI runtime. */
export function createAutoplay({host,ai,campaignId,gmUserId,record,chooseDM,maxCommands=90,maxOpportunities=30,maxDurationMs=1200000,onStatus=()=>{},now=Date.now,sleep=pause}={}){
 if(campaignId!==AUTOPLAY_CAMPAIGN||host?.campaignId!==campaignId||host.gmUserId!==gmUserId||typeof host.authorize!=='function'||!host.engine||!host.service||typeof ai?.status!=='function'||typeof record!=='function')throw new Error('Explicit rehearsal-only host, existing AI and private evidence writer are required.');
 if(!Number.isInteger(maxCommands)||maxCommands<2||maxCommands>120||!Number.isInteger(maxOpportunities)||maxOpportunities<1||maxOpportunities>30||!Number.isInteger(maxDurationMs)||maxDurationMs<1000||maxDurationMs>1200000)throw new Error('Autoplay bounds are invalid.');
 const gm={campaignId,userId:gmUserId,audience:'gm'};
 let flight,stop=false,started=0,initialRevision,commands=0,opportunities=0,noProgress=0;
 let state={state:'idle',reason:null,commands:0,opportunities:0};
 const report=(next,reason=null)=>{state={...state,state:next,reason,commands,opportunities};try{onStatus(structuredClone(state));}catch{}};
 const error=code=>Object.assign(new Error(code),{code});
 const bounded=()=>{if(stop)throw error('requested-stop');if(now()-started>=maxDurationMs)throw error('time-limit');if(commands>=maxCommands)throw error('command-limit');};
 async function snapshot(){
  if(!await host.authorize(gm))throw error('dm-access-unavailable');
  const p=await host.engine.project({ownerId:gmUserId,audience:'gm',mapLevel:'tactical'});
  if(p.campaignId!==campaignId||p.audience!=='gm'||!Number.isSafeInteger(p.revision)||!Array.isArray(p.characters))throw error('projection-scope-failure');
  if(seats.some(c=>!p.characters.some(a=>a.characterId==='lantern-'+c&&a.ownerId==='ai-'+c)))throw error('party-ownership-changed');
  if(!await host.authorize(gm))throw error('dm-access-unavailable');return p;
 }
 async function command(selection,{closing=false}={}){
  if(!closing)bounded();if(!await host.authorize(gm))throw error('dm-access-unavailable');
  const scope=selection.actorId?{...gm,actorId:selection.actorId,audience:'player'}:gm;
  const view=await host.service.project(scope);
  if(view.campaignId!==campaignId||!Number.isSafeInteger(view.revision))throw error('projection-scope-failure');
  const offered=view.actions.find(a=>a.id===selection.action);if(!offered)throw error('dm-action-unavailable');
  if(selection.desiredOpen!==undefined&&offered.payload?.open!==selection.desiredOpen)throw error('decision-gate-changed');
  if(selection.actorId){const roster=await snapshot();if(!roster.characters.some(a=>a.characterId===selection.actorId&&a.characterType==='npc'))throw error('dm-cannot-script-party');}
  else if(!['gm_decision','gm_resolve','gm_combat','gm_check','checkpoint'].includes(offered.type))throw error('dm-action-outside-rehearsal-policy');
  const commandId=randomUUID();await record({kind:'dm-intent',campaignId,commandId,revision:view.revision,actionType:offered.type,actorId:selection.actorId??'',at:new Date(now()).toISOString()});
  const receipt=await host.service.command({...scope,expectedRevision:view.revision,commandId,action:selection.action,payload:selection.payload??{}});
  if(receipt.campaignId!==campaignId||receipt.success!==true||!Number.isSafeInteger(receipt.revision))throw error('receipt-scope-failure');
  commands++;state.lastRevision=receipt.revision;await record({kind:'dm-committed',campaignId,commandId,revision:receipt.revision,actionType:offered.type,at:new Date(now()).toISOString()});return receipt;
 }
 async function stopGate(){try{const p=await snapshot();if(p.decisionOpen)await command({action:'decision',desiredOpen:false},{closing:true});}catch{state.pauseUnconfirmed=true;}}
 async function openParty(){
  if(opportunities>=maxOpportunities)throw error('opportunity-limit');
  const prior=ai.status();if(!['ready','complete','paused'].includes(prior.state))throw error('ai-unavailable');
  let p=await snapshot();
  const windowLimit=prior.opportunityCommandLimit??3;
  if(!Number.isSafeInteger(windowLimit)||windowLimit<1||windowLimit>35)throw error('ai-budget-unavailable');
  // Reserve the entire enforced AI window, plus close/open/checkpoint/stop.
  // Die continuations cannot silently exceed the rehearsal's revision budget.
  if(maxCommands-(p.revision-initialRevision)<windowLimit+4)throw error('revision-budget');
  if(p.decisionOpen){
   await command({action:'decision',desiredOpen:false});
   // The existing runtime processes its closing snapshot asynchronously. Let it
   // observe the closed gate before opening again, so the old receipt cannot start a new plan.
   const closedDeadline=now()+10000;while(ai.status().state!=='paused'){bounded();if(now()>=closedDeadline)throw error('party-provider-unavailable');await sleep(100);}
  }
  const receipt=await command({action:'decision',desiredOpen:true});opportunities++;report('party-thinking');
  const deadline=now()+125000;
  while(true){
   bounded();const current=ai.status();
   if(current.lastOpportunity?.id===receipt.commandId){
    const n=current.lastOpportunity.committedIntentCount??current.lastOpportunity.committed??0;
    const choiceCount=current.lastOpportunity.choiceCount??0;
    if(!Number.isSafeInteger(n)||n<0||n>3||!Number.isSafeInteger(choiceCount)||choiceCount<0||choiceCount>32)throw error('ai-budget-unavailable');
    const safeLabel=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)?value:'unavailable';
    const failures=(Array.isArray(current.lastOpportunity.failures)?current.lastOpportunity.failures:[]).slice(0,3).map(f=>({actorId:seats.some(c=>'lantern-'+c===f.actorId)?f.actorId:'unknown',reason:safeLabel(f.reason),code:safeLabel(f.code)}));
    await record({kind:'party-opportunity',campaignId,commandId:receipt.commandId,committed:n,choiceCount,status:safeLabel(current.lastOpportunity.status),failures,at:new Date(now()).toISOString()});
    if(current.lastOpportunity.status!=='complete')throw error('party-provider-or-action-failure');noProgress=n?0:noProgress+1;break;
   }
   if(['closed','stopped','timed-out'].includes(current.state)||now()>=deadline)throw error('party-provider-unavailable');
   await sleep(250);
  }
  if(noProgress>=3)throw error('three-opportunities-without-progress');
 }
 async function npcChoice(p){
  const pending=(p.pendingActions??[]).find(r=>r.kind==='reaction');
  const npcId=pending?.reactors?.find(id=>p.characters.some(a=>a.characterId===id&&a.characterType==='npc'))??(p.phase==='combat'&&p.characters.find(a=>a.characterId===p.activeActorId&&a.characterType==='npc')?.characterId);
  if(!npcId)return null;
  const scope={...gm,actorId:npcId,audience:'player'},view=await host.service.project(scope);
  const reaction=view.actions.find(a=>a.type==='reaction'&&a.payload?.take===true);if(reaction)return {action:reaction.id,actorId:npcId};
  const privateView=await host.engine.project({ownerId:gmUserId,actorId:npcId,audience:'private'});
  if(privateView.campaignId!==campaignId||privateView.audience!=='private'||privateView.characterId!==npcId)throw error('npc-scope-failure');
  const own=privateView.characters.find(c=>c.characterId===npcId),enemies=privateView.characters.filter(c=>c.characterId!==npcId&&c.factionId!==own.factionId&&c.factionId!=='neutral'&&!c.defeated&&c.position);
  const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  if(own.resources?.action){const attack=view.actions.find(a=>a.type==='attack'&&enemies.some(e=>e.characterId===a.payload.targetId&&distance(own.position,e.position)<=1));if(attack)return {action:attack.id,actorId:npcId};
   if(enemies.length&&!own.conditions?.some(c=>['grappled','restrained'].includes(c))){const moves=view.actions.filter(a=>a.type==='move'&&(privateView.availableMovement??[]).some(m=>m.x===a.payload.x&&m.y===a.payload.y&&m.costFeet*(own.conditions?.includes('prone')?2:1)<=own.resources.movementFeet)).map(a=>({a,d:Math.min(...enemies.map(e=>distance(a.payload,e.position)))})).sort((a,b)=>a.d-b.d);if(moves[0]&&moves[0].d<Math.min(...enemies.map(e=>distance(own.position,e.position))))return {action:moves[0].a.id,actorId:npcId};}
  }
  return view.actions.some(a=>a.id==='end_turn')?{action:'end_turn',actorId:npcId}:null;
 }
 async function run(){
  started=now();report('starting');let outcome='stopped',reason;
  try{
   const initial=await snapshot();initialRevision=initial.revision;
   if(initial.decisionOpen||!['ready','complete','paused'].includes(ai.status().state))throw error('start-requires-idle-paused-rehearsal');
   await record({kind:'autoplay-start',campaignId,revision:initialRevision,maxCommands,maxOpportunities,maxDurationMs,at:new Date(now()).toISOString()});
   let repeatedRulings=0;
   while(true){
    bounded();const p=await snapshot();state.lastRevision=p.revision;
    // Every committed die choice also consumes a revision. Never reinterpret a
    // waiting die as an ordinary discretionary ruling or open a new AI window.
    if(p.revision-initialRevision>=maxCommands)throw error('revision-budget');
    if(p.rollPending||(p.pendingActions??[]).some(r=>r.kind==='inspiration')){
     const current=ai.status();
     if(current.state==='awaiting-human')throw error('inspiration-human-required');
     if(!['thinking','awaiting-roll'].includes(current.state))throw error('inspiration-continuation-required');
     report('party-thinking');await sleep(250);continue;
    }
    if(p.mission?.complete){await command({action:'checkpoint'});outcome='complete';reason='mission-complete';break;}
    report('dm-review');
    let selection=null;
    if(chooseDM){let timer;const abort=new AbortController();try{selection=await Promise.race([chooseDM({projection:structuredClone(p),view:await host.service.project(gm),signal:abort.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(error('time-limit'));},Math.min(30000,Math.max(1,maxDurationMs-(now()-started))));})]);}finally{clearTimeout(timer);}}
    if(!selection){
     const pending=(p.pendingActions??[]).find(r=>r.kind!=='reaction');
     if(pending){const supported=/^(mission:|travel:)/.test(pending.kind);repeatedRulings=supported?0:repeatedRulings+1;if(repeatedRulings>=3)throw error('repeated-unstructured-rulings');selection={action:`ruling:${pending.id}:${supported}:note`,payload:{text:supported?'Delegated rehearsal DM approves this authored request. Unity revalidates every prerequisite and cost.':'Delegated rehearsal DM declines an unspecified mechanical outcome. Choose a concrete supported action; no success or resources are invented.'}};}
     else {selection=await npcChoice(p);}
    }
    if(selection){await command(selection);continue;}
    await openParty();
   }
  }catch(e){reason=['ai-budget-unavailable','inspiration-human-required','inspiration-continuation-required','requested-stop','time-limit','command-limit','opportunity-limit','revision-budget','dm-access-unavailable','projection-scope-failure','party-ownership-changed','dm-cannot-script-party','dm-action-outside-rehearsal-policy','dm-action-unavailable','receipt-scope-failure','ai-unavailable','party-provider-or-action-failure','party-provider-unavailable','three-opportunities-without-progress','npc-scope-failure','start-requires-idle-paused-rehearsal','repeated-unstructured-rulings'].includes(e?.code)?e.code:'unconfirmed-command-or-controller-failure';}
  await stopGate();report(outcome,reason);try{await record({kind:'autoplay-stop',campaignId,...state,at:new Date(now()).toISOString()});}catch{state.evidenceUnavailable=true;}return structuredClone(state);
 }
 return Object.freeze({start(){if(!flight)flight=run();return flight;},status:()=>structuredClone(state),async close(){stop=true;return flight?await flight:structuredClone(state);}});
}


