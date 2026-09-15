import http from 'node:http';
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {createWriteStream,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PRESETS,validateRequest,buildWorkflow,imageFromHistory,requestFingerprint} from './workflow.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const ENGINE='http://127.0.0.1:8188';
const MAX_IMAGE=28*1024*1024;
const SAFE_ID=/^[0-9a-f-]{36}$/;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
export async function createStudio({port=51960,dataDir=join(HERE,'data'),engineUrl=ENGINE,fetchImpl=fetch,launchEngine,assetsRoot=resolve(HERE,'../../campaigns/the-unwritten-coast/discovery-atlas')}={}){
  if(/(^|[\\/])onedrive(?:[ -]|[\\/]|$)/i.test(resolve(dataDir)))throw Error('Studio data must remain outside OneDrive.');
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(engineUrl))throw Error('ComfyUI must use a local loopback address.');
  await mkdir(dataDir,{recursive:true});
  const jobs=new Map(),refreshing=new Map(),capability=randomBytes(32).toString('hex');
  let server,engineProcess,engineStarting=false;
  for(const name of await readdir(dataDir))if(/^[0-9a-f-]{36}\.json$/.test(name)){
    const job=JSON.parse(await readFile(join(dataDir,name),'utf8'));
    if(SAFE_ID.test(job.id)&&job.id+'.json'===name)jobs.set(job.id,job);
  }
  const save=async job=>{const temp=join(dataDir,job.id+'.'+randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(job,null,2));await rename(temp,join(dataDir,job.id+'.json'));};
  const publicJob=job=>({id:job.id,status:job.status,title:job.spec.title,kind:job.spec.kind,prompt:job.spec.prompt,negative:job.spec.negative,seed:job.spec.seed,steps:job.spec.steps,shape:job.spec.shape,checkpoint:job.spec.checkpoint,contextId:job.spec.contextId,createdAt:job.createdAt,message:job.message??'',imageUrl:job.status==='ready'?`/api/jobs/${job.id}/image`:null,promptId:job.promptId??null});
  async function engine(path,options={}){
    const response=await fetchImpl(engineUrl+path,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok){let message='ComfyUI could not complete this request.';try{const body=await response.json();message=body.error?.message||body.error||message;}catch{}throw Object.assign(Error(String(message).slice(0,300)),{rejected:response.status>=400&&response.status<500});}
    return response;
  }
  async function engineStatus(){
    try{
      const [stats,definitions,queue]=await Promise.all(['/system_stats','/object_info/CheckpointLoaderSimple','/queue'].map(path=>engine(path).then(r=>r.json())));
      return {online:true,starting:false,device:stats.devices?.[0]?.name??'Local renderer',checkpoints:definitions.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]??[],queue:(queue.queue_running?.length??0)+(queue.queue_pending?.length??0),editorUrl:engineUrl};
    }catch{return {online:false,starting:engineStarting,device:null,checkpoints:[],queue:0,editorUrl:engineUrl};}
  }
  async function collect(job){
    if(!['submitted','queued','running','unknown'].includes(job.status))return job;
    try{
      const history=await (await engine(`/history/${encodeURIComponent(job.promptId??job.id)}`)).json();
      const result=imageFromHistory(history,job.promptId??job.id);
      if(result.status==='ready'){
        const query=new URLSearchParams(result.image),response=await engine('/view?'+query);
        if(Number(response.headers.get('content-length'))>MAX_IMAGE)throw Error('Image exceeds the studio size limit.');
        const parts=[];let total=0;for await(const part of response.body){total+=part.length;if(total>MAX_IMAGE)throw Error('Image exceeds the studio size limit.');parts.push(Buffer.from(part));}
        const image=Buffer.concat(parts);if(!image.subarray(0,8).equals(PNG))throw Error('ComfyUI did not return a PNG image.');
        await writeFile(join(dataDir,job.id+'.png'),image,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        job.status='ready';job.message='Your artwork is ready.';job.sha256=createHash('sha256').update(image).digest('hex');
      }else if(result.status==='failed'){job.status='failed';job.message='The workflow failed. Open ComfyUI to inspect the error, then create a new version.';}
      else{
        const queue=await (await engine('/queue')).json();
        if(queue.queue_running?.some(entry=>entry[1]===(job.promptId??job.id)))job.status='running';
        else if(queue.queue_pending?.some(entry=>entry[1]===(job.promptId??job.id)))job.status='queued';
        else {job.status='unknown';job.message='This job is not in the current queue or history. Check ComfyUI before submitting it again.';}
      }
      await save(job);
    }catch{job.message='Connection to ComfyUI was interrupted. Check status to recover this same job.';}
    return job;
  }
  function refresh(job){if(!refreshing.has(job.id))refreshing.set(job.id,collect(job).finally(()=>refreshing.delete(job.id)));return refreshing.get(job.id);}
  async function submit(input){
    // Repeated browser requests return the same durable job, including unknown outcomes.
    const prior=jobs.get(input?.requestId);
    if(prior){if(prior.originalFingerprint!==requestFingerprint(input))throw Error('That request ID belongs to different artwork. Start a new version.');return prior;}
    const spec=validateRequest(input),fingerprint=requestFingerprint(input);
    if([...jobs.values()].filter(j=>['submitted','queued','running'].includes(j.status)).length>=8)throw Error('Eight images are already being prepared. Let one finish before adding another.');
    const status=await engineStatus();if(!status.online)throw Error('ComfyUI is offline. Start the renderer, then try again.');
    if(!status.checkpoints.includes(spec.checkpoint))throw Error('The selected model is no longer installed. Refresh the model list.');
    // Check again after async validation so simultaneous copies cannot enqueue twice.
    const repeated=jobs.get(spec.requestId);if(repeated){if(repeated.originalFingerprint!==fingerprint)throw Error('That request ID belongs to different artwork.');return repeated;}
    if([...jobs.values()].filter(j=>['submitted','queued','running','unknown'].includes(j.status)).length>=8)throw Error('Eight images are awaiting completion. Check their status before adding another.');
    const job={id:spec.requestId,spec,workflow:buildWorkflow(spec),originalFingerprint:fingerprint,status:'submitted',createdAt:new Date().toISOString(),promptId:spec.requestId};jobs.set(job.id,job);
    try{await save(job);}catch(error){jobs.delete(job.id);throw error;}
    try{
      const result=await (await engine('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:job.workflow,client_id:'unwritten-coast-studio',prompt_id:job.id})})).json();
      if(typeof result.prompt_id!=='string')throw Error('ComfyUI did not confirm the job.');
      job.promptId=result.prompt_id;job.status='queued';
    }catch(error){job.status=error.rejected?'failed':'unknown';job.message=error.rejected?'ComfyUI rejected this workflow. Refresh the model list and inspect the node editor.':'Submission outcome is uncertain. Check status before creating another version.';}
    await save(job);return job;
  }
  async function startEngine(){
    if((await engineStatus()).online)return {started:false,online:true};
    if(engineStarting||engineProcess)return {started:false,starting:true};
    engineStarting=true;
    try{
      if(launchEngine){await launchEngine();return {started:true};}
      const python=join(HERE,'.runtime','Scripts','python.exe'),checkout=resolve(HERE,'../../local/ComfyUI');
      if(!existsSync(python))throw Error('The local renderer environment is missing. Run the studio setup command in its README.');
      await Promise.all(['comfy-output','comfy-input','comfy-user'].map(name=>mkdir(join(dataDir,name),{recursive:true})));
      const log=createWriteStream(join(dataDir,'comfyui.log'),{flags:'a'});
      engineProcess=spawn(python,['-u',join(checkout,'main.py'),'--listen','127.0.0.1','--port','8188','--disable-api-nodes','--disable-all-custom-nodes','--extra-model-paths-config',join(HERE,'model-paths.yaml'),'--output-directory',join(dataDir,'comfy-output'),'--input-directory',join(dataDir,'comfy-input'),'--user-directory',join(dataDir,'comfy-user')],{cwd:checkout,windowsHide:true,stdio:['ignore','pipe','pipe']});
      engineProcess.stdout.pipe(log,{end:false});engineProcess.stderr.pipe(log,{end:false});
      engineProcess.once('exit',()=>{engineProcess=null;engineStarting=false;log.end();});
      engineProcess.once('error',()=>{engineProcess=null;engineStarting=false;log.end();});
      engineProcess.unref();return {started:true};
    }catch(error){engineStarting=false;throw error;}
  }
  const staticFiles=new Map([['/','index.html'],['/studio.css','studio.css'],['/studio.mjs','studio.mjs']]);
  const send=(res,status,value,type='application/json',extra={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src ${engineUrl}; frame-ancestors 'self' http://127.0.0.1:3000 http://127.0.0.1:3001 http://127.0.0.1:51950; base-uri 'none'; form-action 'self'`,...extra});res.end(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value));};
  async function handler(req,res){
    const origin=`http://127.0.0.1:${req.socket.localPort}`;
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Open the studio using its local address.'});
    try{
      const url=new URL(req.url,origin);if(url.origin!==origin)return send(res,403,{error:'Invalid address.'});
      if(req.method==='POST'){
        const token=req.headers['x-studio-capability'];
        if(req.headers.origin!==origin||typeof token!=='string'||token.length!==capability.length||!timingSafeEqual(Buffer.from(token),Buffer.from(capability)))return send(res,403,{error:'Reload the studio before making changes.'});
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(res,415,{error:'JSON required.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(res,413,{error:'Your description is too long.'});}const input=JSON.parse(raw||'{}');
        if(url.pathname==='/api/jobs')return send(res,202,{job:publicJob(await submit(input))});
        if(url.pathname==='/api/engine/start')return send(res,202,await startEngine());
      }
      if(req.method==='GET'&&url.pathname==='/api/state'){
        const status=await engineStatus();
        if(status.online)for(const job of [...jobs.values()].filter(j=>['submitted','queued','running','unknown'].includes(j.status)).slice(0,8))void refresh(job).catch(()=>{});
        return send(res,200,{capability,engine:status,presets:PRESETS,jobs:[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,150).map(publicJob)});
      }
      const match=/^\/api\/jobs\/([0-9a-f-]{36})(?:\/(image|workflow))?$/.exec(url.pathname);
      if(req.method==='GET'&&match){
        const job=jobs.get(match[1]);if(!job)return send(res,404,{error:'That artwork was not found.'});
        if(!match[2])return send(res,200,{job:publicJob(await refresh(job))});
        if(match[2]==='workflow')return send(res,200,JSON.stringify(job.workflow,null,2),'application/json',{'Content-Disposition':`attachment; filename="coast-${job.id}-workflow.json"`});
        if(job.status!=='ready')return send(res,409,{error:'The image is still being prepared.'});
        return send(res,200,await readFile(join(dataDir,job.id+'.png')),'image/png');
      }
      if(req.method==='GET'&&url.pathname==='/assets/coast-serif.ttf')return send(res,200,await readFile(join(assetsRoot,'art/table/coast-serif.ttf')),'font/ttf');
      if(req.method==='GET'&&url.pathname==='/assets/reference.png'){
        const {CATALOG}=await import('../../campaigns/the-unwritten-coast/discovery-atlas/catalog.mjs');
        const key=CATALOG.rooms.find(r=>r.id==='t-tavern').publicArtKey;
        return send(res,200,await readFile(join(assetsRoot,'art',key+'.png')),'image/png');
      }
      if(req.method==='GET'&&staticFiles.has(url.pathname)){const file=staticFiles.get(url.pathname);return send(res,200,await readFile(join(HERE,file)),file.endsWith('.css')?'text/css':file.endsWith('.mjs')?'text/javascript':'text/html');}
      return send(res,404,{error:'That studio page was not found.'});
    }catch(error){return send(res,400,{error:error.code==='ENOENT'?'That artwork is not available yet.':error.message});}
  }
  server=http.createServer((req,res)=>{void handler(req,res);});
  await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
  return {server,origin:`http://127.0.0.1:${server.address().port}`,startEngine,close:async()=>{await Promise.allSettled([...refreshing.values()]);await new Promise(ok=>{server.close(ok);server.closeAllConnections();});},jobs};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const studio=await createStudio({});console.log('Campaign art studio: '+studio.origin);
  if(process.argv.includes('--start-engine'))console.log(await studio.startEngine());
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void studio.close().then(()=>process.exit(0));});
}
