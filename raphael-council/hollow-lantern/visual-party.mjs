import {randomUUID} from 'node:crypto';
import {createActivityPlayerBrowser} from './activity-player-browser.mjs';
import {validateVisionAction} from '../ai/obus-vision.mjs';

export const VISUAL_OPPORTUNITY_COMMAND_LIMIT=35;
const owners=['ai-fighter','ai-rogue','ai-cleric'];
const instructions='Play only the character shown in your private game screen. Use the visible buttons, dropdown labels and fields to choose one useful action. Read the situation, costs and map legend. Confirm only the action you intend. Communicate knowledge only through an offered in-game communication control. When the screen is loading or an outcome is uncertain, wait or use its recovery control. Do not assume what another character sees. Return one bounded pixel interaction.';
const code=error=>String(error?.code??error?.name??'VISUAL_PLAYER_UNAVAILABLE').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
const stopped=()=>Object.assign(Error('VISUAL_OPPORTUNITY_CLOSED'),{code:'VISUAL_OPPORTUNITY_CLOSED'});

/** Models receive only flattened screens and their own recent UI interactions.
 * The trusted controller keeps engine gates and receipts outside model memory. */
export function createVisualParty({client,campaignId,actors,gmUserId,authorizeAI,getGate,provisionSession,revokeSession=async()=>{},visionTransport,browserFactory=createActivityPlayerBrowser,webOrigin,renderAssets={},pendingStore,onCommit=async()=>{}}){
 if(client?.campaignId!==campaignId||!Array.isArray(actors)||actors.length!==3||new Set(actors.map(a=>a.actorId)).size!==3||new Set(actors.map(a=>a.ownerId)).size!==3||actors.some(a=>!owners.includes(a.ownerId))||![authorizeAI,getGate,provisionSession,visionTransport?.choose,visionTransport?.available,pendingStore?.get,pendingStore?.set,pendingStore?.reserveOpportunity].every(f=>typeof f==='function'))throw Error('VISUAL_PARTY_CONFIGURATION_REQUIRED');
 const seats=actors.map(a=>({...a,session:null,browser:null,opening:null,history:[],retiring:null,pending:pendingStore.get(a.actorId)}));
 let enabled=false,run=null,draining=false,closing=Promise.resolve(),actionTail=Promise.resolve();const intents=new Map();
 const scope=s=>({campaignId,userId:s.ownerId,actorId:s.actorId,audience:'player'});
 async function owned(s){
  if(!await authorizeAI(scope(s)))return false;
  const p=await client.project({ownerId:s.ownerId,actorId:s.actorId,audience:'private',mapLevel:'tactical'});
  return p.campaignId===campaignId&&p.audience==='private'&&p.characterId===s.actorId&&p.characters?.some(c=>c.characterId===s.actorId&&c.ownerId===s.ownerId)&&await authorizeAI(scope(s));
 }
 async function retire(s){
  if(s.retiring)return s.retiring;
  s.retiring=(async()=>{s.history=[];intents.delete(s.actorId);const browser=s.browser;s.browser=null;await browser?.close();if(s.opening)await s.opening.catch(()=>{});if(s.session){const session=s.session;s.session=null;await revokeSession({campaign:campaignId,owner:s.ownerId,actorId:s.actorId,session});}})();
  try{await s.retiring;}finally{s.retiring=null;}
 }
 async function gate(s,current,state=null){
  if(!enabled||run!==current||current.controller.signal.aborted||current.stopped||Date.now()>=current.deadline||current.completedRoll)return false;
  state??=await getGate();
  if(state.eligibleActorIds!==undefined&&(!Array.isArray(state.eligibleActorIds)||state.eligibleActorIds.some(id=>!seats.some(s=>s.actorId===id))))throw Error('VISUAL_ROSTER_INVALID');
  if(state.decisionOpen!==true||!state.rollPending&&state.hasPendingRulings===true||state.eligibleActorIds!==undefined&&!state.eligibleActorIds.includes(s.actorId)||!await owned(s))return false;
  if(state.rollPending){if(!pendingStore.reserveCommand||!pendingStore.getOpportunity)return false;const pending=state.inspirationPending;if(!pending||pending.actorId!==s.actorId||!current.originalIds.has(pending.originalCommandId)||current.choiceCount>=current.maxChoices)return false;return enabled&&run===current&&!current.controller.signal.aborted&&!current.stopped&&Date.now()<current.deadline&&!current.completedRoll;}
  return enabled&&run===current&&!current.controller.signal.aborted&&!current.stopped&&current.committedIntentCount<current.maxActions&&!current.done.has(s.actorId)&&!current.rollStarted;
 }
 const rememberPending=async(s,pending)=>{await pendingStore.set(s.actorId,pending);s.pending=structuredClone(pending);};
 async function recover(s){
  if(!s.pending)return true;if(!await owned(s))return false;
  let receipt;try{receipt=await client.receipt({ownerId:s.ownerId,actorId:s.actorId,commandId:s.pending.commandId});}catch{return false;}
  if(receipt?.contract!=='rpg-core-runtime-bridge-v1'||receipt.campaignId!==campaignId||receipt.commandId!==s.pending.commandId||receipt.success!==true||receipt.replayed!==true||receipt.revision!==s.pending.expectedRevision+1||!await owned(s))return false;
  // Recovery is presentation of an existing result, never a new gameplay command.
  await rememberPending(s,null);try{await onCommit({actorId:s.actorId,receipt,recovered:true});}catch{}return true;
 }
 function serialize(work){const next=actionTail.catch(()=>{}).then(work);actionTail=next.then(()=>{},()=>{});return next;}
 async function ensureBrowser(s,current){
  if(s.retiring)await s.retiring;if(!await gate(s,current))throw stopped();
  if(s.browser&&!s.browser.revoked())return s.browser;
  if(s.browser)await retire(s);
  if(!s.session){s.session='visual-'+s.actorId+'-'+randomUUID().slice(0,8);await provisionSession({campaign:campaignId,owner:s.ownerId,actorId:s.actorId,session:s.session});}
  if(!await gate(s,current))throw stopped();
  s.opening=browserFactory({client,ownerId:s.ownerId,actorId:s.actorId,gmUserId,authorizeAI,webOrigin,renderAssets,signal:current.controller.signal,
   getGate:async()=>{const state=await getGate(),pending=state.inspirationPending;return {decisionOpen:run?await gate(s,run,state):false,allowAction:!seats.some(other=>other.pending),...(state.rollPending?{allowedActionIds:pending?.actorId===s.actorId?[`inspiration:${pending.pendingId}:${pending.dieId}:keep`,`inspiration:${pending.pendingId}:${pending.dieId}:reroll`]:[]}: {})};},
   serializeAction:serialize,onPending:async pending=>{if(pending){const active=run;if(!active||active.controller.signal.aborted)throw stopped();const state=await getGate();await pendingStore.reserveCommand?.(active.id,s.actorId,pending.commandId,state.rollPending===true);}await rememberPending(s,pending);},
   onCommit:async({receipt})=>{const current=run;if(!current)return;if(!receipt?.commandId||!Number.isSafeInteger(receipt.revision)||typeof receipt.success!=='boolean')throw Error('VISUAL_RECEIPT_INVALID');if(current.receiptIds.has(receipt.commandId))return;current.receiptIds.add(receipt.commandId);const result=receipt.result;if(result?.status==='resolved'||result?.status==='pending-roll'&&current.originalIds.has(result.originalCommandId)){current.choiceCount++;if(result.status==='resolved')current.completedRoll=true;}else {current.done.add(s.actorId);current.committedIntentCount++;current.originalIds.add(receipt.commandId);}if(result?.status==='pending-roll')current.rollStarted=true;current.committed.push({actorId:s.actorId,receipt});intents.set(s.actorId,{actorId:s.actorId,status:'committed',opportunityId:current.id});try{await onCommit({actorId:s.actorId,receipt});}catch{}},
  });
  try{const browser=await s.opening;if(!enabled||run!==current||current.controller.signal.aborted){await browser.close();throw stopped();}s.browser=browser;return browser;}finally{s.opening=null;}
 }
 async function play(s,current,maxTokens,maxSteps){
  if(!await gate(s,current))return;
  const browser=await ensureBrowser(s,current);let repeated=0,last='',lastProgress=current.receiptIds.size;
  for(let step=0;step<maxSteps&&await gate(s,current);step++){
   const screenshot=await browser.screenshot();if(!await gate(s,current))return;
   const result=await visionTransport.choose({scope:{campaign:campaignId,owner:s.ownerId,role:'player'},session:s.session,screenshot,history:structuredClone(s.history.slice(-8)),instructions,maxTokens,signal:current.controller.signal});
   if(!await gate(s,current))return;
   const action=validateVisionAction(result.action,screenshot.width,screenshot.height),key=JSON.stringify(action);if(lastProgress!==current.receiptIds.size){repeated=0;last="";lastProgress=current.receiptIds.size;}repeated=key===last?repeated+1:0;last=key;
   if(repeated>=3)throw Object.assign(Error('REPEATED_VISUAL_ACTION'),{code:'REPEATED_VISUAL_ACTION'});
   intents.set(s.actorId,{actorId:s.actorId,status:'interacting',opportunityId:current.id,step:step+1});
   await browser.act(action);s.history.push({owner:s.ownerId,action,outcome:'Interaction sent to your screen; read the next screenshot for its result.'});if(s.history.length>8)s.history.shift();
  }
  if(await gate(s,current))throw Object.assign(Error('VISUAL_STEP_LIMIT'),{code:'VISUAL_STEP_LIMIT'});
 }
 return Object.freeze({
  async resumePendingOpportunity(){const saved=pendingStore.getOpportunity?.();return saved&&!saved.closed?this.onDecisionOpened({opportunityId:saved.id,resume:true,maxActions:saved.maxActions}):{status:"idle",committed:[]};},
  async ready(){return visionTransport.available();},
  start(){enabled=true;},
  close(){enabled=false;const cancelled=run?pendingStore.closeOpportunity?.(run.id):Promise.resolve();run?.controller.abort();intents.clear();closing=Promise.all([Promise.allSettled(seats.map(retire)),cancelled]).then(()=>{});return closing;},
  getPrivateIntents:()=>structuredClone([...intents.values()]),
  async syncOwnership(){for(const s of seats)if(!await owned(s))await retire(s);},
  async onDecisionOpened({opportunityId=randomUUID(),maxActions=3,timeoutMs=120000,maxTokens=256,maxSteps=12,resume=false}={}){
   if(!enabled||run||draining)return {status:run?'busy':draining?'draining':'closed',committed:[]};
   if(typeof opportunityId!=='string'||!opportunityId||opportunityId.length>100||!Number.isInteger(maxActions)||maxActions<1||maxActions>3||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000||!Number.isInteger(maxTokens)||maxTokens<64||maxTokens>1024||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>20)throw Error('VISUAL_OPPORTUNITY_BOUNDS');
   const saved=resume?pendingStore.getOpportunity?.():null;if(resume&&(!saved||saved.closed||saved.deadline<=Date.now()||saved.id!==opportunityId)){if(saved?.id===opportunityId)await pendingStore.closeOpportunity?.(opportunityId);return {status:"expired",committed:[]};}
   const current={deadline:saved?.deadline??Date.now()+timeoutMs,maxChoices:32,choiceCount:saved?.choices.length??0,committedIntentCount:saved?.actions.length??0,originalIds:new Set(saved?.actions.map(x=>x.commandId)??[]),rollStarted:resume,completedRoll:false,id:opportunityId,controller:new AbortController(),maxActions,done:new Set(saved?.actions.map(x=>x.actorId)??[]),receiptIds:new Set(),committed:[],failures:[],stopped:false,jobs:null};run=current;
   const timer=setTimeout(()=>current.controller.abort(),Math.max(1,current.deadline-Date.now()));
   const aborted=new Promise(resolve=>current.controller.signal.addEventListener('abort',resolve,{once:true}));
   try{
    await closing;await visionTransport.available();
    for(const s of seats)if(!await recover(s))return {status:'recovery-required',committed:[],failures:[{actorId:s.actorId,reason:'previous-action-unconfirmed'}]};
    if(!enabled||current.controller.signal.aborted)return {status:'paused',committed:[]};
    const state=await getGate();if(state.decisionOpen!==true||!state.rollPending&&state.hasPendingRulings===true)return {status:'paused',committed:[]};
    if(!resume&&!await pendingStore.reserveOpportunity(opportunityId))return {status:'already-handled',committed:[]};
    if(!resume)await pendingStore.beginOpportunity?.({id:opportunityId,deadline:current.deadline,maxActions,maxChoices:32,actions:[],choices:[],closed:false});
    const playRound=()=>seats.map(s=>play(s,current,maxTokens,maxSteps).catch(error=>{if(!current.controller.signal.aborted){current.failures.push({actorId:s.actorId,reason:'visual-interaction-stopped',code:code(error)});current.stopped=true;current.controller.abort();}}));
    do{current.jobs=Promise.allSettled(playRound());await Promise.race([current.jobs,aborted]);if(current.controller.signal.aborted||current.completedRoll)break;const next=await getGate();if(!next.rollPending)break;const pending=next.inspirationPending;if(!pendingStore.reserveCommand||!pendingStore.getOpportunity||!pending||!seats.some(s=>s.actorId===pending.actorId)||!current.originalIds.has(pending.originalCommandId)){current.failures.push({reason:'awaiting-human-roll'});break;}if(!next.decisionOpen||current.choiceCount>=current.maxChoices){current.stopReason=!next.decisionOpen?"paused":"choice-limit";break;}}while(current.rollStarted);
    // Abort late inference, close scoped containers, then wait for in-flight API
    // dispatches before allowing a new opportunity to consume another budget.
    if(current.controller.signal.aborted)await Promise.allSettled(seats.map(retire));
    await actionTail;
    const uncertain=seats.find(s=>s.pending);
    return {status:uncertain?'recovery-required':current.stopReason??(current.failures.length?'stopped':current.controller.signal.aborted?'timed-out':'complete'),committed:structuredClone(current.committed),committedIntentCount:current.committedIntentCount,choiceCount:current.choiceCount,failures:current.failures};
   }finally{await pendingStore.closeOpportunity?.(current.id);clearTimeout(timer);current.stopped=true;current.controller.abort();if(current.jobs){draining=true;void current.jobs.then(()=>{draining=false;});}run=null;}
  },
 });
}
