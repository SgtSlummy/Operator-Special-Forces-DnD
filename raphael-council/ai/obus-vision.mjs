import {createHash,randomUUID} from 'node:crypto';
import {ObusTransport,AiError,boundedJson} from './obus.mjs';

export const VISION_CONTRACT='raph-obus-game-vision-v1';
export const VISION_MODEL='obus-qwen3.8-27b:65k';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])));
const same=(a,b)=>canonical(a)===canonical(b);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const fail=()=>{throw new AiError('The private game vision response could not be verified.');};
const fence=runtime=>Object.fromEntries(['contract','bootEpoch','generation','sessionPolicyRevision'].map(k=>[k,runtime[k]]));
const noMemory=['tools','retrieval','personal_memory','auto_memory'];

export function validateVisionAction(action,width,height){
 const keys={click:['type','x','y'],select:['type','x','y','option'],type:['type','x','y','text'],scroll:['type','x','y','deltaY'],wait:['type','ms']}[action?.type];
 if(!keys||!exact(action,keys))fail();
 if(action.type!=='wait'&&(!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.y<0||action.x>=width||action.y>=height))fail();
 if(action.type==='select'&&(typeof action.option!=='string'||!action.option.length||action.option.length>200))fail();
 if(action.type==='type'&&(typeof action.text!=='string'||action.text.length>500))fail();
 if(action.type==='scroll'&&(!Number.isInteger(action.deltaY)||action.deltaY===0||Math.abs(action.deltaY)>1600))fail();
 if(action.type==='wait'&&(!Number.isInteger(action.ms)||action.ms<0||action.ms>2000))fail();
 return structuredClone(action);
}

/** Only the private game route can see these pixels. No direct model fallback,
 * retrieval, filesystem references, shared history or tool execution. */
export class ObusVisionTransport{
 constructor({transport=new ObusTransport()}={}){this.transport=transport;}
 async available(){
  const c=(await this.transport.capabilities()).screenshot_vision;
  if(c?.contract!==VISION_CONTRACT||c.endpoint!=='/api/game/vision'||c.supported!==true||c.model!==VISION_MODEL||c.destination!=='local'||c.coordinateSpace!=='screenshot-pixels'||!noMemory.every(k=>c[k]===false)||!['click','select','type','scroll','wait'].every(a=>c.actions?.includes(a)))throw new AiError('The private game connection needs screenshot support.');
  return true;
 }
 async choose({scope,session,requestId=randomUUID(),screenshot,history=[],instructions,maxTokens=256,signal}){
  if(!exact(scope,['campaign','owner','role'])||scope.role!=='player'||!['ai-fighter','ai-rogue','ai-cleric'].includes(scope.owner)||typeof scope.campaign!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scope.campaign)||typeof session!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(session)||!/^[0-9a-f-]{36}$/.test(requestId)||typeof instructions!=='string'||instructions.length>2000||!Number.isInteger(maxTokens)||maxTokens<64||maxTokens>1024)throw new AiError('A scoped visual game request is required.');
  const {png,width,height}=screenshot??{};
  if(!Buffer.isBuffer(png)||png.length<33||png.length>2097152||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=2048)||width*height>4194304||png.readUInt32BE(16)!==width||png.readUInt32BE(20)!==height)throw new AiError('A bounded flattened game screenshot is required.');
  if(!Array.isArray(history)||history.length>8||history.some(h=>!exact(h,['owner','action','outcome'])||h.owner!==scope.owner||typeof h.outcome!=='string'||h.outcome.length>500))throw new AiError('Only this character’s recent interaction history is allowed.');
  for(const entry of history)validateVisionAction(entry.action,width,height);
  await this.available();
  const runtime=fence(await this.transport.runtime(scope,session));
  const request={contract:VISION_CONTRACT,scope,session,requestId,runtime,policy:{namespace:scope.campaign,mode:'local',tools:false,personal_memory:false,auto_memory:false,codex:false,exportable:false,escalationEligible:false},screenshot:{mime_type:'image/png',image_base64:png.toString('base64'),width,height},instructions,history,max_tokens:maxTokens};
  const result=await boundedJson(await this.transport.fetch(this.transport.url+'/api/game/vision',{method:'POST',redirect:'error',headers:this.transport.headers(),body:JSON.stringify(request),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)}),32768);
  if(!exact(result,['contract','status','replayed','requestId','scope','session','runtime','action','receipt'])||result.contract!==VISION_CONTRACT||result.status!=='completed'||typeof result.replayed!=='boolean'||result.requestId!==requestId||result.session!==session||!same(result.scope,scope)||!same(result.runtime,runtime))fail();
  const action=validateVisionAction(result.action,width,height),r=result.receipt;
  if(!r||r.provider!=='ollama'||r.model!==VISION_MODEL||r.endpoint!=='http://127.0.0.1:11434/api/chat'||r.destination!=='local'||r.finish_reason!=='stop'||!Number.isInteger(r.completion_tokens)||r.completion_tokens<1||r.completion_tokens>maxTokens||r.screenshotSha256!==sha(png)||!/^[a-f0-9]{64}$/.test(r.normalizedSha256??'')||r.width!==width||r.height!==height||r.coordinateSpace!=='screenshot-pixels'||r.actionValidated!==true||r.actionSha256!==sha(canonical(action))||!noMemory.every(k=>r[k]===false)||!['request_evidence_persisted','history_persisted','general_memory_writes','route_journal_writes'].every(k=>r[k]===false)||r.game_receipt_persisted!==true)fail();
  if(!same(runtime,fence(await this.transport.runtime(scope,session))))throw new AiError('The game-host authority changed. Capture new input after reconnecting.');
  signal?.throwIfAborted();
  return {action,receipt:structuredClone(r),requestId,replayed:result.replayed};
 }
}
