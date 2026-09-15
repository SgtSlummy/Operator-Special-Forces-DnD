import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {createActivityRuntime} from './activity-runtime.mjs';
const run=promisify(execFile),owners=new Set(['ai-fighter','ai-rogue','ai-cleric']);
const fail=()=>{throw Error('PLAYER_BROWSER_ACCESS_DENIED');};
export function validatePlayerAction(a,width,height){
 const keys={click:['type','x','y'],select:['type','x','y','option'],type:['type','x','y','text'],scroll:['type','x','y','deltaY'],wait:['type','ms']};
 if(!a||!keys[a.type]||Object.keys(a).length!==keys[a.type].length||keys[a.type].some(k=>!Object.hasOwn(a,k)))throw Error('INVALID_BROWSER_ACTION');
 if(a.type!=='wait'&&(!Number.isInteger(a.x)||!Number.isInteger(a.y)||a.x<0||a.y<0||a.x>=width||a.y>=height))throw Error('INVALID_BROWSER_COORDINATES');
 if(a.type==='select'&&(typeof a.option!=='string'||!a.option.length||a.option.length>200)||a.type==='type'&&(typeof a.text!=='string'||a.text.length>500)||a.type==='scroll'&&(!Number.isInteger(a.deltaY)||a.deltaY===0||Math.abs(a.deltaY)>1600)||a.type==='wait'&&(!Number.isInteger(a.ms)||a.ms<0||a.ms>2000))throw Error('INVALID_BROWSER_ACTION');return a;
}
/** Trusted controller boundary. No human cookies or GM scope are accepted. */
export function createPlayerRequestBoundary({client,ownerId,actorId,gmUserId,authorizeAI,getGate,webOrigin,renderAssets={},onCommit=async()=>{},onPending=async()=>{},serializeAction=work=>work(),fetchImpl=fetch,now=Date.now,ttlMs=600000}){
 const origin=new URL(webOrigin);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||!owners.has(ownerId)||typeof actorId!=='string'||!actorId||typeof authorizeAI!=='function'||typeof getGate!=='function'||typeof serializeAction!=='function'||typeof onPending!=='function'||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)throw Error('INVALID_PLAYER_BROWSER_CONFIGURATION');
 const scope={campaignId:client.campaignId,userId:ownerId,actorId,audience:'player'},token=randomBytes(32).toString('hex'),cookie=`hollow_ai=${token}`,expires=now()+ttlMs;let revoked=false,actionTail=Promise.resolve(),pendingAction=null;
 async function allowed(){return !revoked&&now()<expires&&await authorizeAI(scope)===true;}
 async function currentActor(){
  if(!await allowed())return false;
  const p=await client.project({ownerId,actorId,audience:'private',mapLevel:'tactical'});
  return p.campaignId===client.campaignId&&p.audience==='private'&&p.characterId===actorId&&p.characters?.some(c=>c.characterId===actorId&&c.ownerId===ownerId)&&await allowed();
 }
 const auth={config:{activityOrigin:origin.origin},authenticate:async request=>request.headers.get('cookie')===cookie&&await allowed()?{campaign:client.campaignId,owner:ownerId,role:'player',actorId}:null,member:async user=>user===ownerId&&await allowed()?{campaign:client.campaignId,owner:ownerId,role:'player'}:null};
 const runtime=createActivityRuntime({auth,client,gmUserId,renderAssets,onCommit});
 async function settleResponse(response,expected,recovery=false){
  if(!expected)return response;
  try{const result=await response.clone().json(),r=result.receipt,j=result.rejection;
   const receipt=response.ok&&r?.contract==='rpg-core-runtime-bridge-v1'&&r.campaignId===expected.campaignId&&r.commandId===expected.commandId&&r.success===true&&r.revision===expected.expectedRevision+1&&(!recovery||r.replayed===true);
   const rejection=!recovery&&j?.contract==='hollow-action-rejection-v1'&&j.submitted===false&&j.campaignId===expected.campaignId&&j.commandId===expected.commandId&&j.actorId===expected.actorId&&j.expectedRevision===expected.expectedRevision;
   if(pendingAction===expected&&(receipt||rejection)){await onPending(null);pendingAction=null;}
  }catch{}return response;
 }

 async function settleResolution(response,expected){
  if(!response.ok)return response;
  try{
   const result=await response.clone().json(),r=result.resolution;
   const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
   const identity=value=>value?.contract==='rpg-core-runtime-bridge-v1'&&value.campaignId===expected.campaignId&&value.commandId===expected.commandId&&value.ownerId===ownerId&&value.actorId===expected.actorId&&value.originalExpectedRevision===expected.expectedRevision;
   const kind=r?.resolution,keys=['contract','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision','success','replayed','resolution',kind==='committed'?'receipt':'rejection'];
   let valid=exact(r,keys)&&identity(r)&&r.success===true&&typeof r.replayed==='boolean'&&Number.isSafeInteger(r.revision)&&r.revision>expected.expectedRevision;
   if(kind==='committed'){const receipt=r.receipt;valid=valid&&receipt?.contract===r.contract&&receipt.campaignId===r.campaignId&&receipt.commandId===r.commandId&&receipt.success===true&&receipt.replayed===true&&receipt.revision===expected.expectedRevision+1;}
   else if(kind==='cancelled'){const proof=r.rejection;valid=valid&&exact(proof,['contract','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision','code','terminal'])&&identity(proof)&&proof.revision===r.revision&&proof.code==='COMMAND_CANCELLED'&&proof.terminal===true;}
   else valid=false;
   if(!valid||pendingAction!==expected)return Response.json({error:'The recovery result could not be verified.'},{status:502});
   if(!await allowed())return new Response(null,{status:403});
   try{await onPending(null);}catch{return Response.json({error:'Recovery could not be saved. Check the original action again.'},{status:503});}
   pendingAction=null;return response;
  }catch{return Response.json({error:'The recovery result could not be verified.'},{status:502});}
 }
 return {cookie,origin:origin.origin,scope,revoked:()=>revoked,revoke(){revoked=true;},allowed,currentActor,pendingAction:()=>structuredClone(pendingAction),
 async request({url,method='GET',headers={},body}){
  const u=new URL(url);if(u.origin!==origin.origin||!await allowed())return new Response(null,{status:403});
  if(u.pathname.startsWith('/api/')){
   const match=/^\/api\/hollow-lantern\/(view|map|illustration|action|receipt|resolve)$/.exec(u.pathname);if(!match||headers.cookie!==cookie)return new Response(null,{status:403});
   const op=match[1];if(method!==(['action','receipt','resolve'].includes(op)?'POST':'GET')||typeof body==='string'&&Buffer.byteLength(body)>8192)return new Response(null,{status:400});
   const dispatch=()=>runtime.handle(op,new Request(url,{method,headers:{Cookie:cookie,Origin:origin.origin,'Content-Type':'application/json'},...(['POST'].includes(method)?{body}: {})}));
   if(op==='action'){const next=actionTail.catch(()=>{}).then(()=>serializeAction(async()=>{const gate=await getGate(scope);if(!await allowed()||gate?.decisionOpen!==true||gate?.allowAction===false)return Response.json({error:'Player decisions are paused.'},{status:409});let data;try{data=JSON.parse(body);}catch{return new Response(null,{status:400});}if(Array.isArray(gate.allowedActionIds)&&!gate.allowedActionIds.includes(data.action))return Response.json({error:'Only the current die choice is authorized.'},{status:409});if(pendingAction)return Response.json({error:'Recover the previous action first.'},{status:409});if(!/^[a-f0-9-]{36}$/.test(data?.commandId??'')||!Number.isSafeInteger(data.revision)||data.revision<0||u.searchParams.has('actorId')&&u.searchParams.get('actorId')!==actorId)return new Response(null,{status:400});pendingAction={commandId:data.commandId,expectedRevision:data.revision,campaignId:client.campaignId,actorId};await onPending(structuredClone(pendingAction));const finalGate=await getGate(scope);if(!await allowed()||finalGate?.decisionOpen!==true||Array.isArray(finalGate.allowedActionIds)&&!finalGate.allowedActionIds.includes(data.action)){await onPending(null);pendingAction=null;return Response.json({error:"Player authorization changed before dispatch."},{status:409});}return settleResponse(await dispatch(),pendingAction);}));actionTail=next.then(()=>{},()=>{});return next;}
   if(op==='resolve'){const next=actionTail.catch(()=>{}).then(()=>serializeAction(async()=>{
    let data;try{data=JSON.parse(body);}catch{return new Response(null,{status:400});}
    const expected=pendingAction;
    if(!expected||data?.commandId!==expected.commandId||data?.expectedRevision!==expected.expectedRevision)return Response.json({error:'Resolve only the saved pending action.'},{status:409});
    if(u.searchParams.has('campaignId')&&u.searchParams.get('campaignId')!==expected.campaignId||u.searchParams.has('actorId')&&u.searchParams.get('actorId')!==expected.actorId)return new Response(null,{status:403});
    return settleResolution(await dispatch(),expected);
   }));actionTail=next.then(()=>{},()=>{});return next;}
   if(op==='receipt'){const next=actionTail.catch(()=>{}).then(()=>serializeAction(async()=>{let data;try{data=JSON.parse(body);}catch{return new Response(null,{status:400});}const expected=pendingAction;if(expected&&data.commandId!==expected.commandId)return new Response(null,{status:409});return settleResponse(await dispatch(),expected,true);}));actionTail=next.then(()=>{},()=>{});return next;}
   return dispatch();
  }
  const shell=u.pathname==='/hollow-lantern'&&!u.search,asset=/^\/(?:assets|_next\/static)\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|png|svg|ico)$/.test(u.pathname)&&!u.pathname.includes('..');
  if(method!=='GET'||!shell&&!asset)return new Response(null,{status:403});
  // Never forward machine credentials or browser-provided headers to the shell host.
  const response=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!await allowed())return new Response(null,{status:403});return response;
 }};
}
const worker=String.raw`
const {chromium}=require('/opt/browser/node_modules/playwright-core'),readline=require('node:readline');let browser,page,n=0;const requests=new Map();const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{let m;try{m=JSON.parse(line);if(m.responseId){requests.get(m.responseId)?.(m);requests.delete(m.responseId);return;}let result;
if(m.op==='open'){browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:m.viewport,serviceWorkers:'block',acceptDownloads:false});await context.addCookies([{name:'hollow_ai',value:m.cookie.split('=')[1],url:m.origin,httpOnly:true,sameSite:'Strict'}]);await context.route('**/*',async route=>{const r=route.request(),requestId=++n;const response=await new Promise(resolve=>{requests.set(requestId,resolve);send({requestId,url:r.url(),method:r.method(),headers:r.headers(),body:r.postData()});});await route.fulfill({status:response.status,headers:response.headers,body:Buffer.from(response.body||'','base64')});});page=await context.newPage();await page.goto(m.origin+'/hollow-lantern');await page.waitForLoadState('networkidle',{timeout:10000});result=true;}
else if(m.op==='screen'){result={png:(await page.screenshot({timeout:10000})).toString('base64'),...page.viewportSize()};}
else if(m.op==='act'){const a=m.action;if(a.type==='click')await page.mouse.click(a.x,a.y);if(a.type==='type'){const editable=await page.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);return e instanceof HTMLTextAreaElement&&!e.disabled&&!e.readOnly||e instanceof HTMLInputElement&&['text','number','search','email','url','tel'].includes(e.type)&&!e.disabled&&!e.readOnly;},a);if(!editable)throw Error();await page.mouse.click(a.x,a.y);const focused=await page.evaluate(({x,y})=>document.activeElement===document.elementFromPoint(x,y),a);if(!focused)throw Error();await page.keyboard.press('Control+A');await page.keyboard.insertText(a.text);}if(a.type==='select'){const index=await page.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);return [...document.querySelectorAll('select')].indexOf(e);},a);if(index<0)throw Error();await page.locator('select').nth(index).selectOption({label:a.option});}if(a.type==='scroll'){await page.mouse.move(a.x,a.y);await page.mouse.wheel(0,a.deltaY);}await page.waitForTimeout(a.type==='wait'?a.ms:250);result=true;}
else if(m.op==='close'){await browser?.close();process.exit(0);}send({id:m.id,result});}catch{send({id:m?.id,error:true});}});
`;
export async function createActivityPlayerBrowser(options){
 const viewport=options.viewport??{width:1280,height:1000};if(!Number.isInteger(viewport.width)||!Number.isInteger(viewport.height)||viewport.width<320||viewport.height<320||viewport.width>2048||viewport.height>2048)throw Error('INVALID_VIEWPORT');
 const execute=options.runImpl??run,spawnChild=options.spawnImpl??spawn;
 const boundary=createPlayerRequestBoundary(options),name='hollow-player-'+randomUUID(),profileId=randomUUID(),pending=new Map();let sequence=0,closed=false,closing,child;const aborted=()=>options.signal?.aborted;
 if(aborted())throw Error('PLAYER_BROWSER_CANCELLED');
 try{await execute('podman',['create','--name',name,'--network','none','--http-proxy=false','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--env','HOME=/tmp','--env','XDG_CONFIG_HOME=/tmp/config','--tmpfs','/tmp:rw,size=256m','--interactive','--entrypoint','node',options.image??'localhost/hollow-browser:isolated','-e',worker],{windowsHide:true,timeout:30000});if(aborted())throw Error('PLAYER_BROWSER_CANCELLED');child=spawnChild('podman',['start','--attach','--interactive',name],{windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){boundary.revoke();await execute('podman',['rm','--force','--ignore',name],{windowsHide:true,timeout:10000}).catch(()=>{});throw error;}
 const lines=createInterface({input:child.stdout});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
 const stopPending=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('PLAYER_BROWSER_CLOSED'));}pending.clear();};child.on('error',()=>{boundary.revoke();stopPending();});child.once('exit',()=>{closed=true;boundary.revoke();stopPending();});
 const send=m=>{if(!closed)child.stdin.write(JSON.stringify(m)+'\n');};
 const call=(op,extra={})=>new Promise((resolve,reject)=>{if(closed)return reject(Error('PLAYER_BROWSER_CLOSED'));const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('PLAYER_BROWSER_TIMEOUT'));void close().catch(()=>{});},20000);pending.set(id,{resolve,reject,timer});send({id,op,...extra});});
 lines.on('line',async line=>{let m;try{if(line.length>24000000)throw Error();m=JSON.parse(line);if(m.requestId){let response=await boundary.request(m),reader=response.body?.getReader(),chunks=[],size=0;if(reader){try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>16*1024*1024)throw Error();chunks.push(Buffer.from(value));}}finally{await reader.cancel();}}const headers=Object.fromEntries(response.headers);for(const key of ['set-cookie','content-encoding','content-length'])delete headers[key];send({responseId:m.requestId,status:response.status,headers,body:Buffer.concat(chunks).toString('base64')});}else{const p=pending.get(m.id);pending.delete(m.id);if(p){clearTimeout(p.timer);if(m.error)p.reject(Error('PLAYER_BROWSER_OPERATION_FAILED'));else p.resolve(m.result);}}}catch{if(m?.requestId)send({responseId:m.requestId,status:403,headers:{},body:''});}});
 async function close(){if(closing)return closing;boundary.revoke();closing=(async()=>{send({op:'close'});try{await execute('podman',['rm','--force','--ignore',name],{windowsHide:true,timeout:10000});}finally{closed=true;options.signal?.removeEventListener('abort',cancel);lines.close();stopPending();child.kill();}})();return closing;}
 const cancel=()=>{void close().catch(()=>{});};options.signal?.addEventListener('abort',cancel,{once:true});if(aborted())cancel();
 async function proof(){const {stdout}=await execute('podman',['inspect',name],{windowsHide:true,timeout:5000});const p=JSON.parse(stdout)[0];if(p.HostConfig.NetworkMode!=='none'||!p.HostConfig.ReadonlyRootfs||(p.HostConfig.Binds??[]).length)throw Error('PLAYER_BROWSER_ISOLATION_FAILED');return {containerId:name,profileId,network:'none',readOnly:true,hostMounts:0,ownerId:options.ownerId,actorId:options.actorId,campaignId:options.client.campaignId,sharedCookies:false,image:p.Image};}
 try{await call('open',{origin:boundary.origin,cookie:boundary.cookie,viewport});await proof();if(aborted()||closed)throw Error('PLAYER_BROWSER_CANCELLED');}catch(error){await close().catch(()=>{});throw error;}
 return {proof,revoked:boundary.revoked,close,pendingAction:boundary.pendingAction,async screenshot(){if(!await boundary.currentActor())fail();const s=await call('screen'),png=Buffer.from(s.png,'base64');if(!await boundary.currentActor()||png.length<33||png.length>2*1024*1024||png.readUInt32BE(16)!==viewport.width||png.readUInt32BE(20)!==viewport.height)throw Error('PLAYER_SCREEN_UNAVAILABLE');return {png,width:viewport.width,height:viewport.height,timestamp:Date.now()};},async act(action){if(!await boundary.currentActor())fail();validatePlayerAction(action,viewport.width,viewport.height);return call('act',{action});}};
}
