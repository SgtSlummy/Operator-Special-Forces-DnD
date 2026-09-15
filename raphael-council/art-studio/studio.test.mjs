import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createStudio} from './server.mjs';
import {validateRequest,buildWorkflow,imageFromHistory,PRESETS} from './workflow.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),QA=join(HERE,'qa');
const spec=(extra={})=>({requestId:randomUUID(),kind:'location',title:'Test harbor',prompt:'A lamp beside the sea',checkpoint:'test.safetensors',seed:'42',steps:8,shape:'auto',contextId:'t-tavern',...extra});
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=','base64');
async function fixture(t,{ambiguous=false}={}){
 await mkdir(QA,{recursive:true});const dir=await mkdtemp(join(QA,'studio-test-'));let calls=0,history={},queued=[];
 const fake=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/system_stats')return response({devices:[{name:'Fixture GPU'}]});
  if(path.startsWith('/object_info'))return response({CheckpointLoaderSimple:{input:{required:{ckpt_name:[['test.safetensors']]}}}});
  if(path==='/queue')return response({queue_running:[],queue_pending:queued.map(id=>[0,id])});
  if(path==='/prompt'){calls++;const payload=JSON.parse(options.body);queued.push(payload.prompt_id);if(ambiguous)throw TypeError('Network disconnected after acceptance');return response({prompt_id:payload.prompt_id});}
  if(path.startsWith('/history/'))return response(history);
  if(path==='/view')return new Response(png,{headers:{'Content-Type':'image/png'}});
  throw Error('Unexpected path: '+path);
 };
 let studio=await createStudio({port:0,dataDir:dir,fetchImpl:fake});
 t.after(async()=>{await studio.close();assert(resolve(dir).startsWith(resolve(QA)+'/')||resolve(dir).startsWith(resolve(QA)+'\\'));await rm(dir,{recursive:true,force:true});});
 const state=await fetch(studio.origin+'/api/state').then(r=>r.json());
 return {get studio(){return studio;},get calls(){return calls;},setHistory(value){history=value;queued=[];},async post(value,headers={}){return fetch(studio.origin+'/api/jobs',{method:'POST',headers:{Origin:studio.origin,'Content-Type':'application/json','X-Studio-Capability':state.capability,...headers},body:JSON.stringify(value)});},async restart(){await studio.close();studio=await createStudio({port:0,dataDir:dir,fetchImpl:fake});}};
}
test('every art preset builds a linked API graph with numeric seed and output node',()=>{
 for(const kind of Object.keys(PRESETS)){const value=validateRequest(spec({kind})),graph=buildWorkflow(value);assert.equal(graph['5'].inputs.seed,42);assert.equal(graph['7'].class_type,'SaveImage');assert.equal(graph['4'].inputs.batch_size,1);assert.match(graph['2'].inputs.text,/lamp beside the sea/);for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value)){assert(graph[value[0]]);assert(Number.isInteger(value[1]));}}
});
test('settings reject unknown kinds, out-of-range workloads and unbounded text',()=>{
 for(const extra of [{kind:'video'},{steps:1000},{seed:-1},{shape:'huge'},{prompt:'x'.repeat(5001)},{contextId:'../../private'},{extra:true}])assert.throws(()=>validateRequest(spec(extra)));
});
test('history must match the exact job and report complete success with a saved output',()=>{
 const output={outputs:{'7':{images:[{filename:'a.png',subfolder:'',type:'output'}]}}};
 assert.equal(imageFromHistory({other:{...output,status:{completed:true,status_str:'success'}}},'ours').status,'running');
 assert.equal(imageFromHistory({ours:{...output,status:{completed:false,status_str:'success'}}},'ours').status,'running');
 assert.equal(imageFromHistory({ours:{...output,status:{completed:true,status_str:'error'}}},'ours').status,'failed');
 assert.equal(imageFromHistory({ours:{...output,status:{completed:true,status_str:'success'}}},'ours').status,'ready');
});
test('studio rejects foreign origins, missing capabilities and unknown model names',async t=>{
 const f=await fixture(t);assert.equal((await f.post(spec(),{Origin:'https://untrusted.example'})).status,403);assert.equal((await f.post(spec(),{'X-Studio-Capability':''})).status,403);assert.equal((await f.post(spec({checkpoint:'missing.safetensors'}))).status,400);assert.equal(f.calls,0);
 const foreign=await fetch(f.studio.origin+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(foreign.status,403);
});
test('concurrent duplicate requests enqueue only once and reject changed payloads',async t=>{
 const f=await fixture(t),request=spec();const results=await Promise.all([f.post(request),f.post(request)]);assert(results.every(r=>r.status===202));assert.equal(f.calls,1);assert.equal((await f.post({...request,prompt:'A different scene'})).status,400);assert.equal(f.calls,1);
});
test('simultaneous new jobs cannot exceed the eight-image queue limit',async t=>{
 const f=await fixture(t);const responses=await Promise.all(Array.from({length:10},()=>f.post(spec())));assert.equal(responses.filter(r=>r.status===202).length,8);assert.equal(responses.filter(r=>r.status===400).length,2);assert.equal(f.calls,8);
});

test('unknown submission outcomes retain their job ID and are not resubmitted',async t=>{
 const f=await fixture(t,{ambiguous:true}),request=spec();const result=await (await f.post(request)).json();assert.equal(result.job.status,'unknown');await f.post(request);assert.equal(f.calls,1);
 const recovered=await fetch(f.studio.origin+'/api/jobs/'+request.requestId).then(r=>r.json());assert.equal(recovered.job.status,'queued');
});
test('completed PNG and workflow survive a studio restart',async t=>{
 const f=await fixture(t),request=spec();await f.post(request);f.setHistory({[request.requestId]:{status:{completed:true,status_str:'success'},outputs:{'7':{images:[{filename:'coast.png',subfolder:'',type:'output'}]}}}});
 const ready=await fetch(f.studio.origin+'/api/jobs/'+request.requestId).then(r=>r.json());assert.equal(ready.job.status,'ready');await f.restart();
 const saved=await fetch(f.studio.origin+'/api/jobs/'+request.requestId+'/image');assert.equal(saved.status,200);assert.deepEqual(Buffer.from(await saved.arrayBuffer()),png);
 const workflow=await fetch(f.studio.origin+'/api/jobs/'+request.requestId+'/workflow').then(r=>r.json());assert.equal(workflow['5'].inputs.seed,42);assert.equal(workflow['7'].class_type,'SaveImage');
 assert.equal((await fetch(f.studio.origin+'/api/jobs/'+randomUUID()+'/image')).status,404);
});
