import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';

const browserWorker=String.raw`
const {chromium}=require('/opt/browser/node_modules/playwright-core');
const readline=require('node:readline');let page,browser,context,n=0;const pending=new Map();
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const ask=request=>new Promise(resolve=>{const id=++n;pending.set(id,resolve);send({requestId:id,...request})});
readline.createInterface({input:process.stdin}).on('line',async line=>{const m=JSON.parse(line);if(m.responseId){pending.get(m.responseId)?.(m);pending.delete(m.responseId);return;}
try{let result;if(m.op==='open'){
browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});context=await browser.newContext({viewport:m.viewport,serviceWorkers:'block'});
await context.route('**/*',async route=>{const req=route.request();const r=await ask({url:req.url(),method:req.method(),headers:req.headers(),body:req.postData()});if(r.blocked)return route.abort();await route.fulfill({status:r.status,headers:r.headers,body:Buffer.from(r.body,'base64')});});
page=await context.newPage();await page.goto(m.url);await page.waitForLoadState('networkidle',{timeout:10000});result=true;
}else if(m.op==='screen'){
// Capture the current viewport pixels without evaluating document.fonts.ready.
// Native select popups can suspend that page evaluation and stall capture.
const session=await context.newCDPSession(page);try{const shot=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});result={png:shot.data,...page.viewportSize()};}finally{await session.detach();}
}
else if(m.op==='act'){const a=m.action;if(a.kind==='click')await page.mouse.click(a.x,a.y);if(a.kind==='select'){await page.mouse.click(a.x,a.y);await page.keyboard.type(a.text);await page.keyboard.press('Enter');}if(a.kind==='type')await page.keyboard.type(a.text);if(a.kind==='scroll')await page.mouse.wheel(0,a.deltaY);await page.waitForTimeout(500);result=true;}
else if(m.op==='close'){await browser?.close();process.exit(0);}
send({id:m.id,result});}catch(error){const type=['Error','TypeError','TimeoutError'].includes(error.name)?error.name:'Error';const detail=/fonts?\.ready|fonts? to load/i.test(error.message)?'font-wait':/Target.*closed|browser has been closed/i.test(error.message)?'target-closed':/crash/i.test(error.message)?'browser-crashed':error.name==='TimeoutError'?'operation-timeout':'unclassified';send({id:m.id,error:'browser-operation-failed',type,detail})}});
`;
const actionSchema={oneOf:[{type:'object',properties:{kind:{const:'click'},x:{type:'integer',minimum:0,maximum:1000},y:{type:'integer',minimum:0,maximum:1000}},required:['kind','x','y'],additionalProperties:false},{type:'object',properties:{kind:{enum:['done','uncertain']},observation:{type:'string'}},required:['kind','observation'],additionalProperties:false},{type:'object',properties:{kind:{const:'scroll'},deltaY:{type:'integer'}},required:['kind','deltaY'],additionalProperties:false},{type:'object',properties:{kind:{const:'type'},text:{type:'string'}},required:['kind','text'],additionalProperties:false}]};
actionSchema.oneOf.push({type:'object',properties:{kind:{const:'select'},x:{type:'integer',minimum:0,maximum:1000},y:{type:'integer',minimum:0,maximum:1000},text:{type:'string'}},required:['kind','x','y','text'],additionalProperties:false});

/** Network-none Chromium routes requests through a controller allowlist. The
 * browser has no filesystem mounts; its profile/cookies live only in tmpfs. */
export async function createIsolatedBrowser({loginUrl,image='localhost/hollow-browser:isolated',readOnly=false,viewport='desktop'}){
 const target=new URL(loginUrl);if(target.hostname!=='127.0.0.1'||target.port!=='18795'||target.protocol!=='http:')throw Error('DISPOSABLE_FIXTURE_REQUIRED');
 if(!['desktop','phone'].includes(viewport))throw Error('UNSUPPORTED_REHEARSAL_VIEWPORT');
 const viewportSize=viewport==='phone'?{width:390,height:844}:{width:1280,height:1000};
 const id='hl-interactive-'+randomUUID(),profileId=randomUUID();
 const child=spawn('podman',['run','--rm','--name',id,'--network','none','--http-proxy=false','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--env','HOME=/tmp','--env','XDG_CONFIG_HOME=/tmp/config','--tmpfs','/tmp:rw,size=256m','--interactive','--entrypoint','node',image,'-e',browserWorker],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const waiting=new Map();let sequence=0;const lines=createInterface({input:child.stdout});
 child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
 const call=(op,extra={})=>new Promise((resolve,reject)=>{const key=++sequence;waiting.set(key,{resolve,reject});child.stdin.write(JSON.stringify({id:key,op,...extra})+'\n');});
 lines.on('line',async line=>{try{const m=JSON.parse(line);if(m.requestId){const u=new URL(m.url);let result={blocked:true};
 if(u.origin===target.origin&&(!readOnly||['GET','HEAD'].includes(m.method)||u.pathname==='/api/session')){const headers={...m.headers};delete headers.host;delete headers['content-length'];const response=await fetch(u,{method:m.method,headers,body:['GET','HEAD'].includes(m.method)?undefined:m.body,redirect:'manual',signal:AbortSignal.timeout(10000)});const h=Object.fromEntries(response.headers);delete h['content-encoding'];delete h['content-length'];result={status:response.status,headers:h,body:Buffer.from(await response.arrayBuffer()).toString('base64')};}
 child.stdin.write(JSON.stringify({responseId:m.requestId,...result})+'\n');
 }else{const p=waiting.get(m.id);waiting.delete(m.id);if(m.error)p?.reject(Object.assign(Error('browser-operation-failed'),{name:['Error','TypeError','TimeoutError'].includes(m.type)?m.type:'Error',code:['font-wait','target-closed','browser-crashed','operation-timeout'].includes(m.detail)?m.detail:undefined}));else p?.resolve(m.result);}}catch{child.stdin.write(JSON.stringify({responseId:0,blocked:true})+'\n');}});
 child.on('close',()=>{for(const p of waiting.values())p.reject(Error('browser-closed'));waiting.clear();});
 await call('open',{url:loginUrl,viewport:viewportSize});
 return {proof:async()=>{const data=JSON.parse(execFileSync('podman',['inspect',id],{encoding:'utf8',windowsHide:true}))[0];if(data.HostConfig.NetworkMode!=='none'||!data.HostConfig.ReadonlyRootfs||(data.HostConfig.Binds??[]).length)throw Error('INTERACTIVE_ISOLATION_UNPROVEN');return {production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:data.HostConfig.NetworkMode,hostMounts:(data.HostConfig.Binds??[]).length,browserAccess:'fixture-only',containerId:id,profileId,container:{image:data.Image,readOnly:data.HostConfig.ReadonlyRootfs,network:data.HostConfig.NetworkMode,capDrop:data.HostConfig.CapDrop,securityOpt:data.HostConfig.SecurityOpt,mounts:data.Mounts}};},screenshot:async()=>{const s=await call('screen');return {...s,png:Buffer.from(s.png,'base64')};},act:action=>call('act',{action}),close:async()=>{child.stdin.write(JSON.stringify({op:'close'})+'\n');lines.close();await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},3000);child.once('close',()=>{clearTimeout(timer);resolve();});});}};
}

export function createVisualParticipant({spawnImpl=spawn,execImpl=execFileSync,fetchImpl=fetch}={}){
 const name='hl-visual-player-'+randomUUID(),history=[],inference=new AbortController();
 const child=spawnImpl('podman',['run','--rm','--name',name,'--network','none','--http-proxy=false','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--interactive','docker.io/library/node:24.17.0-bookworm-slim','node','-e',"require('node:readline').createInterface({input:process.stdin}).on('line',line=>process.stdout.write(line+'\\n'))"],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout});let pending;lines.on('line',line=>{pending?.(JSON.parse(line));pending=undefined;});child.stderr.on('data',()=>{});
 return {proof:async()=>{const p=JSON.parse(execImpl('podman',['inspect',name],{encoding:'utf8',windowsHide:true}))[0];if(p.HostConfig.NetworkMode!=='none'||!p.HostConfig.ReadonlyRootfs||(p.HostConfig.Binds??[]).length)throw Error('INTERACTIVE_ISOLATION_UNPROVEN');return {containerId:name,image:p.Image,network:p.HostConfig.NetworkMode,readOnly:p.HostConfig.ReadonlyRootfs,binds:p.HostConfig.Binds,capDrop:p.HostConfig.CapDrop,securityOpt:p.HostConfig.SecurityOpt,model:'obus-qwen3.8-27b:65k',tools:false,retrieval:false,sharedHistory:false};},async decide({task,screenshot,width,height}){
  inference.signal.throwIfAborted();
  // This participant's isolated relay receives only ordinary task, pixels, and
  // its own previous actions. Controller audit state never enters this channel.
  const input={task:task+' For clicks use NORMALIZED coordinates from 0 to 1000 across the whole screenshot: {"kind":"click","x":number,"y":number}. To choose a dropdown option use {"kind":"select","x":number,"y":number,"text":"visible option label"}. Click a text field to focus it, then enter your own text with {"kind":"type","text":"your text"}. Clicking alone does not enter text. To scroll use {"kind":"scroll","deltaY":500}, with a negative value to scroll up. Finish with {"kind":"done","observation":"Describe what you see in your own words"}. If unclear use {"kind":"uncertain","observation":"Explain what is unclear"}. Return JSON only.',image:screenshot.toString('base64'),width,height,ownActions:history};
  const relayed=new Promise(resolve=>{pending=resolve;});child.stdin.write(JSON.stringify(input)+'\n');const message=await relayed;
  inference.signal.throwIfAborted();
  const response=await fetchImpl('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([inference.signal,AbortSignal.timeout(80000)]),body:JSON.stringify({model:'obus-qwen3.8-27b:65k',stream:false,think:false,format:actionSchema,messages:[{role:'user',content:'Your prior actions and observations (history only): '+JSON.stringify(message.ownActions)+'\nCURRENT TASK: '+message.task+'\nComplete the current task; a previous completed observation does not complete a new task.',images:[message.image]}],options:{temperature:0,num_predict:180,num_ctx:4096}})});
  if(!response.ok)throw Error('vision-unavailable');const result=await response.json();if(result.message?.tool_calls?.length)throw Error('unexpected-tools');const action=JSON.parse(result.message.content.replace(/^```(?:json)?\s*|\s*```$/g,'').trim());history.push(action);if(['click','select'].includes(action.kind)){ordinaryAction(action,1001,1001);return {...action,x:Math.min(width-1,Math.round(action.x*width/1000)),y:Math.min(height-1,Math.round(action.y*height/1000))};}return action;
 },async close(){inference.abort();if(pending){pending({ownActions:[],task:'',image:''});pending=undefined;}child.stdin.end();lines.close();child.kill();execImpl('podman',['rm','--force',name],{stdio:'ignore',windowsHide:true});}};
}

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// A blinking caret can alternate two screenshots while the same click repeats.
// This is a conservative stop, never evidence that a task succeeded.
function repeatedVisualAction(steps){
 const recent=steps.slice(-3);
 return recent.length===3&&new Set(recent.map(s=>s.sha256)).size<=2&&recent.every(s=>JSON.stringify(s.action)===JSON.stringify(recent[0].action));
}

/** Conservative controller-only check. Reading a receipt is not proof that the
 * participant recognized its own token; ambiguous coordinate prose fails. */
export function evaluateTokenObservation({before,after,observation}){
 const match=/column\s+(\d+)\s*[,;]?\s*row\s+(\d+)/i.exec(observation??'');
 const moved=after.revision>before.revision&&(after.x!==before.x||after.y!==before.y);
 const ownToken=Boolean(match&&Number(match[1])===after.x+1&&Number(match[2])===after.y+1);
 return {passed:moved&&ownToken,moved,ownToken,before,after,observation,reason:ownToken?undefined:'Own-token coordinates were incorrect or not clearly described.'};
}
export function validateIsolation(proof){
 if(!proof||proof.production!==false||proof.disposable!==true||proof.freshProfile!==true||proof.sharedCookies!==false||proof.sharedMemory!==false||proof.participantNetwork!=='none'||proof.hostMounts!==0||proof.browserAccess!=='fixture-only'||!proof.containerId||!proof.profileId)throw Error('INTERACTIVE_ISOLATION_UNPROVEN');
}
export function ordinaryAction(value,width,height){
 if(!value||!['click','select','type','scroll','done','uncertain'].includes(value.kind))throw Error('UNSUPPORTED_PARTICIPANT_ACTION');
 const allowed={click:['kind','x','y'],select:['kind','x','y','text'],type:['kind','text'],scroll:['kind','deltaY'],done:['kind','observation'],uncertain:['kind','observation']}[value.kind];
 if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('UNSUPPORTED_PARTICIPANT_ACTION');
 if(['click','select'].includes(value.kind)&&(!Number.isInteger(value.x)||!Number.isInteger(value.y)||value.x<0||value.y<0||value.x>=width||value.y>=height))throw Error('INVALID_CLICK');
 if(['type','select'].includes(value.kind)&&(typeof value.text!=='string'||value.text.length>300))throw Error('INVALID_TEXT');
 if(value.kind==='scroll'&&(!Number.isInteger(value.deltaY)||Math.abs(value.deltaY)>900))throw Error('INVALID_SCROLL');
 if(['done','uncertain'].includes(value.kind)&&(typeof value.observation!=='string'||value.observation.length>1000))throw Error('INVALID_OBSERVATION');
 return value;
}

/** Controller only. Inject an attested disposable browser transport and a fresh
 * isolated visual participant, never a development agent. Participant receives
 * screenshots and ordinary user instructions, not audit state or expected moves. */
export async function runInteractiveRehearsal({browser,participant,audit,outputRoot,now=Date.now}){
 const directory=join(outputRoot,`interactive-${randomUUID()}`);await mkdir(directory,{recursive:true});
 const started=now(),deadline=started+90000,steps=[];let outcome='incomplete',failureType;
 const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TRIAL_TIME_LIMIT')),Math.max(1,deadline-now()));})]);}finally{clearTimeout(timer);}};
 try{
  const proof=await bounded(browser.proof());validateIsolation(proof);
  await writeFile(join(directory,'isolation.json'),JSON.stringify(proof,null,2));
  if(participant.proof)await writeFile(join(directory,'participant-isolation.json'),JSON.stringify(await bounded(participant.proof()),null,2));
  const before=await bounded(audit.snapshot());
  // Audit information is deliberately excluded from participant messages.
  for(let index=0;index<10;index++){
   if(now()>=deadline)throw Error('TRIAL_TIME_LIMIT');
   const screen=await bounded(browser.screenshot());
   if(!Buffer.isBuffer(screen.png)||screen.png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('SCREENSHOT_REQUIRED');
   const file=`${String(index+1).padStart(2,'0')}.png`;await writeFile(join(directory,file),screen.png);
   const raw=await bounded(participant.decide({task:'Use the visible ordinary controls to move your character to a nearby reachable square. Then inspect the updated map and describe whether your token moved. If anything is unclear, stop. Return one click, type, scroll, done, or uncertain action.',screenshot:screen.png,width:screen.width,height:screen.height}));
   await writeFile(join(directory,`${String(index+1).padStart(2,'0')}-participant.json`),JSON.stringify(raw,null,2));
   const action=ordinaryAction(raw,screen.width,screen.height);steps.push({file,sha256:digest(screen.png),action});
   if(repeatedVisualAction(steps)){outcome='stopped-repeated-no-change';break;}
   if(action.kind==='uncertain'){outcome='participant-uncertain';break;}
   if(action.kind==='done'){
    const after=await bounded(audit.snapshot());
    const verdict=await bounded(audit.evaluate({before,after,observation:action.observation}));
    await writeFile(join(directory,'controller-verdict.json'),JSON.stringify(verdict,null,2));
    outcome=verdict.passed?'passed-small-slice':'failed-controller-check';break;
   }
   await bounded(browser.act(action));
   const guard=await bounded(audit.guard());
   if(guard.disclosure||guard.pendingRuling||guard.uncertainCommit){outcome='stopped-guard';break;}
  }
 }catch(error){failureType=error.name;outcome=['INTERACTIVE_ISOLATION_UNPROVEN','TRIAL_TIME_LIMIT','SCREENSHOT_REQUIRED','UNSUPPORTED_PARTICIPANT_ACTION','INVALID_CLICK','INVALID_TEXT','INVALID_SCROLL','INVALID_OBSERVATION'].includes(error.message)?error.message:'transport-failed';}
 finally{await Promise.allSettled([browser.close(),participant.close()]);await writeFile(join(directory,'report.json'),JSON.stringify({outcome,failureType,steps,elapsedMs:now()-started,evidenceKind:'disposable-interactive-rehearsal',fullMission:false,realDiscord:false},null,2));}
 return {directory,outcome};
}

/** Read-only panel inspection; controller supplies ordinary tasks, while its
 * scoring callback and expected records stay out of the participant transport.
 * Failure stages/codes are controller-only; raw errors can contain private URLs. */
export async function runPanelInspection({browser,participant,tasks,audit,outputRoot,identity}){
 const directory=join(outputRoot,`panels-${randomUUID()}`);await mkdir(directory,{recursive:true});
 const started=Date.now(),steps=[],verdicts=[];let outcome='incomplete',index=0,stage='browser-proof',failure;
 const bound=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIME_LIMIT')),Math.max(1,90000-(Date.now()-started)));})]);}finally{clearTimeout(timer);}};
 try{
  const proof=await bound(browser.proof());validateIsolation(proof);stage='participant-proof';const participantProof=await bound(participant.proof());stage='evidence-write';await writeFile(join(directory,'isolation.json'),JSON.stringify({identity,browser:proof,participant:participantProof},null,2));
  for(const [phase,task]of tasks.entries()){
   let completed=false;
   while(index<10&&Date.now()-started<90000){
    stage='browser-screenshot';const screen=await bound(browser.screenshot()),file=`${String(++index).padStart(2,'0')}.png`;stage='evidence-write';await writeFile(join(directory,file),screen.png);
    stage='participant-decision';const raw=await bound(participant.decide({task,screenshot:screen.png,width:screen.width,height:screen.height}));stage='evidence-write';await writeFile(join(directory,file+'.action.json'),JSON.stringify(raw,null,2));
    stage='action-validation';const action=ordinaryAction(raw,screen.width,screen.height);steps.push({phase,file,sha256:digest(screen.png),action});
    if(action.kind==='uncertain')throw Error('PARTICIPANT_UNCERTAIN');
    if(action.kind==='done'){stage='controller-audit';const verdict=await bound(audit({phase,observation:action.observation}));verdicts.push(verdict);completed=true;break;}
    if(repeatedVisualAction(steps))throw Error('REPEATED_NO_CHANGE');
    stage='browser-action';await bound(browser.act(action));
   }
   if(!completed)throw Error('ACTION_OR_TIME_LIMIT');
  }
  outcome=verdicts.every(v=>v.passed)?'passed-panels':'failed-panel-understanding';
 }catch(error){
  const stops=['PARTICIPANT_UNCERTAIN','REPEATED_NO_CHANGE','TIME_LIMIT','ACTION_OR_TIME_LIMIT'];
  const known=[...stops,'INTERACTIVE_ISOLATION_UNPROVEN','UNSUPPORTED_PARTICIPANT_ACTION','INVALID_CLICK','INVALID_TEXT','INVALID_SCROLL','INVALID_OBSERVATION','REHEARSAL_GUARD_STOP','browser-operation-failed','browser-closed','vision-unavailable','unexpected-tools'];
  outcome=stops.includes(error?.message)?error.message:'transport-failed';
  failure={stage,type:['Error','TypeError','SyntaxError','TimeoutError','AbortError'].includes(error?.name)?error.name:'UnknownError',code:known.includes(error?.message)?error.message:'unclassified',detail:['font-wait','target-closed','browser-crashed','operation-timeout'].includes(error?.code)?error.code:undefined,step:index};
 }
 finally{await Promise.allSettled([browser.close(),participant.close()]);await writeFile(join(directory,'report.json'),JSON.stringify({identity,outcome,failure,steps,verdicts,elapsedMs:Date.now()-started,realDiscord:false,fullMission:false},null,2));}
 return {directory,outcome};
}
