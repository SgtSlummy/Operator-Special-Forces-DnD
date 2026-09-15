import {EngineError} from './engine-client.mjs';
import {presentReceipt} from './service.mjs';

const queues=new WeakMap();
const reject=(message,status=409)=>{throw new EngineError('DRAFT_UNAVAILABLE',message,status);};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const isActivityDraftAction=action=>['interact','talk','describe'].includes(action?.type)&&typeof action.id==='string'&&Array.isArray(action.fields)&&action.fields.length===1&&action.fields[0].id==='text'&&action.fields[0].kind===undefined&&action.fields[0].multiline===true&&Number.isSafeInteger(action.fields[0].maxLength)&&action.fields[0].maxLength>0&&action.fields[0].maxLength<=1500;
const validText=(action,input)=>isActivityDraftAction(action)&&input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===1&&typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=action.fields[0].maxLength;
const publicDraft=draft=>draft?Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='scope')):null;

/** Borrowed store: the runtime owner alone opens and closes it. Scope comes from authenticated server state. */
export function createActivityDraftBoundary({draftStore,service,authorize,gmUserId,onCommit}={}){
 if(typeof authorize!=='function'||!service||typeof service.project!=='function'||typeof service.command!=='function')throw new Error('Invalid Activity draft boundary.');
 if(draftStore&&!['get','save','prepare','complete'].every(key=>typeof draftStore[key]==='function'))throw new Error('Invalid draft storage.');
 const enabled=scope=>Boolean(draftStore&&scope?.audience==='player'&&scope.actorId&&scope.userId&&scope.campaignId&&scope.userId!==gmUserId&&!scope.gmController);
 const check=async scope=>{if(!enabled(scope)||!await authorize(scope))reject('Open your own private character view to use saved intentions.',403);};
 const storeScope=scope=>({campaignId:scope.campaignId,userId:scope.userId,actorId:scope.actorId,role:'player',visibility:'private'});
 const serial=(scope,work)=>{
  if(!draftStore)return Promise.reject(new EngineError('DRAFT_UNAVAILABLE','Saved intentions are unavailable.',403));
  let map=queues.get(draftStore);if(!map){map=new Map();queues.set(draftStore,map);}
  const key=JSON.stringify(storeScope(scope)),prior=map.get(key)??Promise.resolve();
  const flight=prior.catch(()=>{}).then(work);map.set(key,flight);
  void flight.finally(()=>{if(map.get(key)===flight)map.delete(key);}).catch(()=>{});return flight;
 };
 return Object.freeze({enabled,
  async get(scope){scope=structuredClone(scope);await check(scope);const draft=await draftStore.get(storeScope(scope));await check(scope);return publicDraft(draft);},
  async save(scope,{entry,actionId,input,expectedDraftVersion}={}){
   scope=structuredClone(scope);entry=structuredClone(entry);input=structuredClone(input);
   return serial(scope,async()=>{
    await check(scope);
    const action=entry?.actions?.find(a=>a.id===actionId);
    if(!Number.isSafeInteger(entry?.revision)||entry.revision<0||!validText(action,input)||!(expectedDraftVersion===null||Number.isSafeInteger(expectedDraftVersion)&&expectedDraftVersion>=0))reject('Enter a supported written intention from this view.',400);
    await check(scope);let draft;
    try{draft=await draftStore.save(storeScope(scope),{actionId:action.id,actionPayload:action.payload??{},input,expectedRevision:entry.revision},expectedDraftVersion);}catch{reject('The saved intention changed. Keep your text and reopen its saved version.');}
    await check(scope);return publicDraft(draft);
   });
  },
  async tryDraft(scope,{draftId,version}={}){
   scope=structuredClone(scope);
   return serial(scope,async()=>{
    await check(scope);
    if(typeof draftId!=='string'||!Number.isSafeInteger(version)||version<0)reject('Choose the saved intention to submit.',400);
    const privateScope=storeScope(scope);let draft=await draftStore.get(privateScope);await check(scope);
    if(!draft||draft.draftId!==draftId||draft.version!==version)reject('The saved intention changed. Reopen it before submitting.');
    if(draft.status==='completed')return {draft:publicDraft(draft)};
    if(draft.status==='editing'){
     const view=await service.project(scope);await check(scope);const action=view.actions?.find(a=>a.id===draft.actionId);
     if(view.revision!==draft.expectedRevision||!validText(action,draft.input)||JSON.stringify(stable(action.payload??{}))!==JSON.stringify(stable(draft.actionPayload)))reject('The scene or action changed. Review your text and explicitly save it against a fresh view before trying.');
     try{draft=await draftStore.prepare(privateScope,{draftId:draft.draftId,version:draft.version,currentRevision:view.revision,availableActionIds:[action.id]});}catch{reject('The saved intention changed. Reopen it before submitting.');}
     await check(scope);
    }
    if(draft.status==='completed')return {draft:publicDraft(draft)};
    if(draft.status!=='prepared'||!draft.intent)reject('Reopen the saved intention before submitting.');
    await check(scope);const intent=draft.intent;let receipt;
    try{receipt=await service.command({...scope,action:intent.actionId,payload:{...intent.actionPayload,...intent.input},expectedRevision:intent.expectedRevision,commandId:intent.commandId});}catch{await check(scope);reject('The action result is unconfirmed. Recover this same saved intention.');}
    await check(scope);
    if(!receipt||receipt.commandId!==intent.commandId||!Number.isSafeInteger(receipt.revision)||receipt.revision<0)reject('The action result is unconfirmed. Recover this same saved intention.');
    const result=String(presentReceipt(receipt)??'').trim()||'Result recorded.';
    draft=await draftStore.complete(privateScope,{draftId:draft.draftId,commandId:intent.commandId,receipt:{result}});await check(scope);
    if(onCommit&&!receipt.replayed){try{await onCommit({scope,receipt});}catch{/* Presentation notification cannot undo a confirmed action. */}await check(scope);}
    return {draft:publicDraft(draft),receipt};
   });
  }
 });
}
