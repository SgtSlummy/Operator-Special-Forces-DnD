import {readFile,open,mkdir,rename} from 'node:fs/promises';
import {acquireCommitFollowerLock} from './commit-follower-lock.mjs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
/** Trusted observer ONLY: entries contain GM metadata and must never be passed
 * wholesale to gameplay agents. Use publicProjection for public presentation.
 * A crash during delivery leaves a durable uncertain marker, not a blind retry.
 */
export async function createCommitFollower({client,gmUserId,cursorFile,onEvent,authorize=async()=>false,onGap=()=>{},initialRevision=0,pollMs=2000}){
 if(!client?.project||!client.campaignId||!gmUserId||!cursorFile||typeof onEvent!=='function'||!Number.isSafeInteger(initialRevision)||initialRevision<0||pollMs<500)fail('COMMIT_FOLLOWER_CONFIGURATION');
 const lock=await acquireCommitFollowerLock(cursorFile);cursorFile=lock.cursorPath;
 let state;
 try{
  try{state=JSON.parse(await readFile(cursorFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(state&&(state.campaignId!==client.campaignId||state.gmUserId!==gmUserId||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0))fail('COMMIT_CURSOR_SCOPE');
 }catch(error){await lock.close();throw error;}
 state??={version:1,campaignId:client.campaignId,gmUserId,revision:initialRevision,pending:null};let timer,closed=false,closePromise,queue=Promise.resolve(),lastError=null;
 async function save(next){lock.assertHeld();await mkdir(dirname(cursorFile),{recursive:true});const temp=`${cursorFile}.${randomUUID()}.tmp`,handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(next,null,2));await handle.sync();}finally{await handle.close();}await rename(temp,cursorFile);state=next;}
 async function drain(){
  if(closed)return {status:'closed'};lock.assertHeld();if(state.pending)fail('COMMIT_DELIVERY_UNCERTAIN');if(!await authorize())fail('COMMIT_OBSERVER_REVOKED');
  const p=await client.project({ownerId:gmUserId,audience:'gm',mapLevel:'regional'}),j=p.committedEvents;
  if(p.audience!=='gm'||p.campaignId!==client.campaignId||j?.version!==1||!Array.isArray(j.entries)||j.latestRevision!==p.revision||!Number.isSafeInteger(j.retainedFromRevision))fail('COMMIT_JOURNAL_UNAVAILABLE');
  if(j.entries.length&&(j.entries[0].revision!==j.retainedFromRevision||j.entries.at(-1).revision!==j.latestRevision))fail('COMMIT_JOURNAL_INCOMPLETE');
  if(state.revision>p.revision)fail('COMMIT_CURSOR_AHEAD');
  if(state.revision<j.retainedFromRevision-1){const gap={from:state.revision+1,to:j.retainedFromRevision-1};await onGap(gap);return {status:'history-gap',...gap};}
  let count=0;
  for(const entry of j.entries.filter(e=>e.revision>state.revision)){
   if(closed)break;
   if(entry.revision!==state.revision+1||entry.publicProjection?.revision!==entry.revision||entry.publicProjection.audience!=='public'||entry.publicProjection.campaignId!==client.campaignId||entry.publicProjection.committedEvents)fail('COMMIT_ENTRY_INVALID');
   if(['inventory','inventoryByCharacter','privateHistory','gmNotes'].some(key=>entry.publicProjection[key]!=null)||(entry.publicProjection.pendingActions?.length??0)>0)fail('COMMIT_PUBLIC_PRIVACY');
   if(entry.type==='command_cancelled'||Object.hasOwn(entry,'control')){
    const c=entry.control,keys=['contract','terminal','code','campaignId','commandId','actorId','ownerId','originalExpectedRevision','revision'];
    if(entry.type!=='command_cancelled'||entry.receipt!==null||!c||Array.isArray(c)||Object.keys(c).length!==keys.length||keys.some(key=>!Object.hasOwn(c,key))||c.contract!=='rpg-core-runtime-bridge-v1'||c.terminal!==true||c.code!=='COMMAND_CANCELLED'||c.campaignId!==client.campaignId||c.commandId!==entry.commandId||c.ownerId!==entry.ownerId||c.actorId!==entry.actorId||c.revision!==entry.revision||typeof c.commandId!=='string'||!c.commandId||c.commandId.length>128||typeof c.ownerId!=='string'||!c.ownerId||c.ownerId.length>128||typeof c.actorId!=='string'||c.actorId.length>128||!Number.isSafeInteger(c.originalExpectedRevision)||c.originalExpectedRevision<0||c.originalExpectedRevision>=entry.revision)fail('COMMIT_ENTRY_INVALID');
    if(!await authorize())fail('COMMIT_OBSERVER_REVOKED');
    await save({...state,revision:entry.revision,pending:null});continue;
   }
   if(entry.receipt?.revision!==entry.revision||entry.receipt.commandId!==entry.commandId||entry.receipt.replayed!==false)fail('COMMIT_ENTRY_INVALID');
   if(!await authorize())fail('COMMIT_OBSERVER_REVOKED');
   await save({...state,pending:{revision:entry.revision,commandId:entry.commandId}});
   await onEvent(structuredClone(entry));
   await save({...state,revision:entry.revision,pending:null});count++;
  }return {status:'caught-up',count,revision:state.revision};
 }
 function poll(){const result=queue.then(drain).then(value=>{lastError=value.status==='history-gap'?'COMMIT_HISTORY_GAP':null;return value;},error=>{lastError=error.code??'COMMIT_OBSERVER_FAILED';throw error;});queue=result.catch(()=>{});return result;}
 return Object.freeze({poll,status:()=>structuredClone({...state,lastError}),start(){if(!timer&&!closed)timer=setInterval(()=>{void poll().catch(()=>{clearInterval(timer);timer=null;});},pollMs);timer?.unref?.();},acknowledgeDelivered({revision,commandId}){if(closed)return Promise.reject(Object.assign(new Error('COMMIT_FOLLOWER_CLOSED'),{code:'COMMIT_FOLLOWER_CLOSED'}));const result=queue.then(async()=>{if(closed)fail('COMMIT_FOLLOWER_CLOSED');if(!state.pending||state.pending.revision!==revision||state.pending.commandId!==commandId)fail('COMMIT_ACK_MISMATCH');await save({...state,revision,pending:null});lastError=null;});queue=result.catch(()=>{});return result;},close(){if(closePromise)return closePromise;closed=true;clearInterval(timer);closePromise=(async()=>{await queue;await lock.close();})();return closePromise;}});
}
