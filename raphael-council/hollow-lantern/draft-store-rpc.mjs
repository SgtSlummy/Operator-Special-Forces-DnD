import {validAdmissionInput} from './admission.mjs';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';

const CONTRACT='hollow-draft-store-v1',PATH='/_internal/draft-store',REQUEST_LIMIT=32768,RESPONSE_LIMIT=98304,SKEW=30000,CACHE_LIMIT=4096;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const scopeValid=(s,campaignId)=>exact(s,['campaignId','userId','actorId','role','visibility'])&&s.campaignId===campaignId&&['campaignId','userId','actorId'].every(k=>id(s[k]))&&s.role==='player'&&s.visibility==='private';
const admissionScope=(s,campaignId)=>exact(s,['campaignId','userId'])&&s.campaignId===campaignId&&/^\d{17,20}$/.test(s.userId);
const admissionArgs=(op,args)=>op==='admission-status'?exact(args,[]):op==='admission-join'&&validAdmissionInput(args);
const admissionResult=r=>object(r)&&['available','full','waiting','recovering','enrolled','needs_gm'].includes(r.status)&&r.capacity===100&&Array.isArray(r.presets);
const secretValid=s=>typeof s==='string'&&Buffer.byteLength(s)>=32&&Buffer.byteLength(s)<=1024;
function failure(status=503){const error=new Error(status===403?'Saved intention access is unavailable.':status===409?'The saved intention changed. Reload its saved state.':'The saved intention service is unavailable.');error.code='DRAFT_RPC_UNAVAILABLE';error.status=status;return error;}
function requireValue(ok,status=400){if(!ok)throw failure(status);}
function validateArgs(operation,args){
 if(operation==='get')return exact(args,[]);
 if(operation==='save')return exact(args,['value','expectedDraftVersion'])&&exact(args.value,['actionId','actionPayload','input','expectedRevision'])&&id(args.value.actionId)&&object(args.value.actionPayload)&&object(args.value.input)&&Object.keys(args.value.input).length<=10&&Object.entries(args.value.input).every(([key,value])=>id(key)&&typeof value==='string')&&integer(args.value.expectedRevision)&&(args.expectedDraftVersion===null||integer(args.expectedDraftVersion));
 if(operation==='prepare')return exact(args,['draftId','version','currentRevision','availableActionIds'])&&id(args.draftId)&&integer(args.version)&&integer(args.currentRevision)&&Array.isArray(args.availableActionIds)&&args.availableActionIds.length<=1024&&args.availableActionIds.every(id);
 if(operation==='complete')return exact(args,['draftId','commandId','receipt'])&&id(args.draftId)&&id(args.commandId)&&object(args.receipt);
 return false;
}
function validDraft(draft,scope){
 if(draft===null)return true;
 if(!exact(draft,['scope','draftId','version','status','actionId','actionPayload','input','expectedRevision','intent','receipt'])||!scopeValid(draft.scope,scope.campaignId)||!Object.keys(scope).every(k=>scope[k]===draft.scope[k])||!id(draft.draftId)||!integer(draft.version)||draft.version<1||!['editing','prepared','completed'].includes(draft.status)||!validateArgs('save',{value:{actionId:draft.actionId,actionPayload:draft.actionPayload,input:draft.input,expectedRevision:draft.expectedRevision},expectedDraftVersion:null}))return false;
 if(draft.status==='editing')return draft.intent===null&&draft.receipt===null;
 const intent=draft.intent;
 return exact(intent,['commandId','actionId','actionPayload','input','expectedRevision'])&&id(intent.commandId)&&intent.actionId===draft.actionId&&intent.expectedRevision===draft.expectedRevision&&JSON.stringify(intent.actionPayload)===JSON.stringify(draft.actionPayload)&&JSON.stringify(intent.input)===JSON.stringify(draft.input)&&(draft.status==='prepared'?draft.receipt===null:object(draft.receipt));
}
function requestBytes(request){
 return new Promise((resolve,reject)=>{
  let size=0,chunks=[];const timer=setTimeout(()=>finish(failure(408)),5000);
  const cleanup=()=>{clearTimeout(timer);request.off('data',data);request.off('end',end);request.off('error',error);request.off('aborted',aborted);};
  const finish=(problem,value)=>{cleanup();if(problem){request.pause();reject(problem);}else resolve(value);};
  const data=chunk=>{size+=chunk.length;if(size>REQUEST_LIMIT)finish(failure(413));else chunks.push(chunk);};
  const end=()=>finish(null,Buffer.concat(chunks));const error=()=>finish(failure(400)),aborted=()=>finish(failure(400));
  request.on('data',data);request.once('end',end);request.once('error',error);request.once('aborted',aborted);
 });
}
function send(response,status,value){
 let text=JSON.stringify(value);if(Buffer.byteLength(text)>RESPONSE_LIMIT){status=503;text=JSON.stringify({contract:CONTRACT,requestId:value.requestId,error:'The saved intention service is unavailable.'});}
 response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});response.end(text);
}

/** Host-bound RPC only. The supplied owner keeps exclusive ownership of the durable file. */
export function createDraftStoreRpcHandler({draftStore,getAdmission,secret,campaignId,gmUserId,authorize,now=Date.now}={}){
 if(!secretValid(secret)||!id(campaignId)||!id(gmUserId)||typeof authorize!=='function'||typeof now!=='function'||!draftStore||!['get','save','prepare','complete'].every(k=>typeof draftStore[k]==='function'))throw failure(503);
 const seen=new Map(),admissionSeen=new Map();
 return async function draftStoreRpc(request,response){
  let requestId=null;
  try{
   requireValue(request.url===PATH,404);requireValue(request.method==='POST',405);
   requireValue(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)&&!Object.hasOwn(request.headers,'origin')&&!Object.hasOwn(request.headers,'cookie'),403);
   requireValue(request.headers['content-type']==='application/json',400);
   const timestamp=request.headers['x-hollow-draft-timestamp'],signature=request.headers['x-hollow-draft-signature'];
   requireValue(typeof timestamp==='string'&&/^\d{1,16}$/.test(timestamp)&&Number.isSafeInteger(Number(timestamp))&&Math.abs(now()-Number(timestamp))<=SKEW&&typeof signature==='string'&&/^[0-9a-f]{64}$/.test(signature),403);
   if(request.headers['content-length']!==undefined)requireValue(/^\d+$/.test(request.headers['content-length'])&&Number(request.headers['content-length'])<=REQUEST_LIMIT,413);
   const bytes=await requestBytes(request);
   const expected=createHmac('sha256',secret).update(timestamp+'.').update(bytes).digest();requireValue(timingSafeEqual(expected,Buffer.from(signature,'hex')),403);
   let body;try{body=JSON.parse(bytes.toString('utf8'));}catch{throw failure(400);}
   requireValue(exact(body,['contract','requestId','operation','scope','args'])&&body.contract===CONTRACT&&uuid(body.requestId),400);requestId=body.requestId;
   const admissionOperation=body.operation.startsWith('admission-');
   requireValue(admissionOperation?admissionScope(body.scope,campaignId):scopeValid(body.scope,campaignId)&&body.scope.userId!==gmUserId,403);requireValue(admissionOperation?admissionArgs(body.operation,body.args):validateArgs(body.operation,body.args),400);
   const at=now();requireValue(Math.abs(at-Number(timestamp))<=SKEW,403);
   const replayCache=admissionOperation?admissionSeen:seen;
   for(const [key,expiry]of replayCache)if(expiry<at)replayCache.delete(key);
   const replayKey=requestId.toLowerCase();requireValue(!replayCache.has(replayKey),409);requireValue(replayCache.size<(admissionOperation?16384:CACHE_LIMIT),429);replayCache.set(replayKey,Number(timestamp)+SKEW);
   if(admissionOperation){const service=getAdmission?.();requireValue(service,503);const admission=body.operation==='admission-status'?await service.status(body.scope):await service.join(body.scope,body.args);requireValue(admissionResult(admission),503);send(response,200,{contract:CONTRACT,requestId,admission});return;}
   const scope=body.scope,authScope={campaignId,userId:scope.userId,actorId:scope.actorId,audience:'player',mapLevel:'tactical'};
   requireValue(await authorize({...authScope}),403);
   let draft;
   try{draft=body.operation==='get'?await draftStore.get(scope):body.operation==='save'?await draftStore.save(scope,body.args.value,body.args.expectedDraftVersion):await draftStore[body.operation](scope,body.args);}catch(error){
    if(['DRAFT_PREPARED','DRAFT_VERSION_MISMATCH','DRAFT_REVISION_MISMATCH','DRAFT_ACTION_UNAVAILABLE','DRAFT_COMMAND_MISMATCH','DRAFT_RECEIPT_MISMATCH'].includes(error?.code))throw failure(409);
    if(['DRAFT_INPUT_INVALID','DRAFT_SCOPE_INVALID'].includes(error?.code))throw failure(400);throw failure(503);
   }
   requireValue(await authorize({...authScope}),403);requireValue(validDraft(draft,scope),503);
   send(response,200,{contract:CONTRACT,requestId,draft});
  }catch(error){send(response,[400,403,404,405,408,409,413,429,503].includes(error?.status)?error.status:503,{contract:CONTRACT,requestId,error:failure(error?.status).message});}
 };
}

async function responseBytes(response){
 const length=response.headers.get('content-length');if(length!==null)requireValue(/^\d+$/.test(length)&&Number(length)<=RESPONSE_LIMIT,503);
 requireValue(response.body&&typeof response.body.getReader==='function',503);
 const reader=response.body.getReader();let count=0,chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;requireValue(count<=RESPONSE_LIMIT,503);chunks.push(Buffer.from(value));}return Buffer.concat(chunks);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** No retry: ambiguous writes must be reconciled through the original persisted draft. */
export function createRemoteDraftStore({baseUrl,secret,campaignId,fetchImpl=fetch,now=Date.now,timeoutMs=5000,admissionMode=false}={}){
 if(typeof baseUrl!=='string'||!/^http:\/\/127\.0\.0\.1(?::\d{1,5})?\/?$/.test(baseUrl)||!secretValid(secret)||!id(campaignId)||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw failure(503);
 let url;try{url=new URL(baseUrl);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();}catch{throw failure(503);}
 const endpoint=url.origin+PATH;
 async function call(operation,scope,args){
  requireValue(admissionMode?admissionScope(scope,campaignId)&&admissionArgs(operation,args):scopeValid(scope,campaignId)&&validateArgs(operation,args),400);
  const requestId=randomUUID(),timestamp=String(now()),raw=JSON.stringify({contract:CONTRACT,requestId,operation,scope,args});requireValue(Buffer.byteLength(raw)<=REQUEST_LIMIT,413);
  const controller=new AbortController();let timer;
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure(503));},timeoutMs);});
  const operationPromise=(async()=>{
   const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','x-hollow-draft-timestamp':timestamp,'x-hollow-draft-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')},body:raw});
   requireValue(!response.redirected,503);const bytes=await responseBytes(response);let result;try{result=JSON.parse(bytes.toString('utf8'));}catch{throw failure(503);}
   requireValue(result?.contract===CONTRACT&&result.requestId===requestId,503);
   if(!response.ok)throw failure([400,403,409,413,429].includes(response.status)?response.status:503);
   if(admissionMode){requireValue(exact(result,['contract','requestId','admission'])&&admissionResult(result.admission),503);return result.admission;}
   requireValue(exact(result,['contract','requestId','draft'])&&validDraft(result.draft,scope)&&(operation==='get'||result.draft!==null),503);return result.draft;
  })();
  try{return await Promise.race([operationPromise,timeout]);}catch(error){throw error?.code==='DRAFT_RPC_UNAVAILABLE'?error:failure(503);}finally{clearTimeout(timer);controller.abort();}
 }
 if(admissionMode)return Object.freeze({status:scope=>call('admission-status',scope,{}),join:(scope,input)=>call('admission-join',scope,input)});
 return Object.freeze({get:scope=>call('get',scope,{}),save:(scope,value,expectedDraftVersion=null)=>call('save',scope,{value,expectedDraftVersion}),prepare:(scope,args)=>call('prepare',scope,args),complete:(scope,args)=>call('complete',scope,args),close:async()=>{}});
}

export const createRemoteAdmission=options=>createRemoteDraftStore({...options,admissionMode:true,timeoutMs:30000});
