const $=id=>document.getElementById(id);
let state=null,kind='location',selected=null,pending=null,submitting=false,pollTimer,pollDeadline=0;
const allowedTables=new Set(['http://127.0.0.1:51950','http://127.0.0.1:51951']);
const context=new URLSearchParams(location.hash.slice(1));
const tableOrigin=allowedTables.has(context.get('tableOrigin'))?context.get('tableOrigin'):null;
const contextId=/^[\w-]{1,100}$/.test(context.get('contextId')??'')?context.get('contextId'):null;
const tableWindow=window.parent!==window?window.parent:window.opener;
if(context.get('prompt'))$('prompt').value=context.get('prompt').slice(0,5000);
if(context.get('title'))$('artTitle').value=context.get('title').slice(0,100);
if(tableOrigin)$('tableLink').href=tableOrigin+'/';
try{pending=JSON.parse(sessionStorage.getItem('coast-studio-pending')||'null');}catch{pending=null;}
function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
async function api(path,options={}){
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{...(options.body?{'Content-Type':'application/json','X-Studio-Capability':state?.capability??''}:{}),...options.headers}});
  const result=await response.json();if(!response.ok)throw Error(result.error||'The studio could not complete that request.');return result;
}
function workspace(name){
  for(const id of ['studio','library','nodes'])$(id+'Workspace').hidden=id!==name;
  document.querySelectorAll('.workspace-nav [data-workspace]').forEach(button=>{if(button.dataset.workspace===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(name==='nodes'){
    const online=state?.engine.online;$('editorOffline').hidden=!!online;$('nodeEditor').hidden=!online;
    if(online&&!$('nodeEditor').getAttribute('src'))$('nodeEditor').src=state.engine.editorUrl+'/';
  }
  if(name==='library')renderGallery();
}
function chooseKind(value,example=false){kind=value;$('mapNote').hidden=kind!=='map';document.querySelectorAll('[data-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===kind)));if(example)applyExample();}
function applyExample(){const preset=state?.presets[kind];if(!preset)return;$('prompt').value=preset.example;$('artTitle').value=({character:'A keeper of the coast',location:'An evening at the Salt Lantern',item:'The mariner’s compass',map:'A harbor inn from above'})[kind];$('shape').value='auto';}
function updateControls(){
  const engine=state?.engine;$('engineLabel').textContent=engine?.online?'ComfyUI connected':engine?.starting?'Starting ComfyUI…':'ComfyUI is offline';$('engineDot').classList.toggle('online',!!engine?.online);
  $('startEngine').hidden=!!engine?.online;$('startEngine').disabled=!!engine?.starting;
  $('generate').disabled=submitting||!engine?.online||!$('checkpoint').value;
  $('generate').querySelector('span').textContent=submitting?'Sending artwork…':'Create artwork';
  $('modelHint').textContent=engine?.online?(engine.checkpoints.length?'Local generation · saved to your collection':'No checkpoint found. Add a compatible model, then refresh.'):'Start the renderer to create artwork. Your collection remains available.';
  $('recoverSubmit').hidden=!pending;
  $('libraryCount').textContent=String(state?.jobs?.length??0);
}
async function loadState(){
  try{
    const next=await api('/api/state'),chosen=$('checkpoint').value;state=next;
    $('checkpoint').replaceChildren();for(const model of next.engine.checkpoints){const option=document.createElement('option');option.value=model;option.textContent=model.replace(/\.safetensors$/,'');$('checkpoint').append(option);}
    if(next.engine.checkpoints.includes(chosen))$('checkpoint').value=chosen;
    if(!next.engine.checkpoints.length){const option=document.createElement('option');option.value='';option.textContent=next.engine.online?'No model installed':'Waiting for ComfyUI';$('checkpoint').append(option);}
    if(selected){const fresh=state.jobs.find(job=>job.id===selected.id);if(fresh)selected=fresh;}
    updateControls();renderGallery();
  }catch(error){notice(error.message||'The studio connection was interrupted. Refresh to reconnect.',true);}
}
function tile(job){
  const button=document.createElement('button');button.type='button';button.className='art-tile';button.classList.toggle('selected',job.id===selected?.id);button.setAttribute('aria-label',`View ${job.title}, ${job.status}`);
  if(job.imageUrl){const image=document.createElement('img');image.src=job.imageUrl;image.alt=job.title;image.loading='lazy';button.append(image);}else{const placeholder=document.createElement('span');placeholder.className='tile-pending';placeholder.textContent=({queued:'In the queue',running:'Rendering',unknown:'Check status',submitted:'Submitting',failed:'Needs attention'})[job.status]??job.status;button.append(placeholder);}
  const name=document.createElement('span');name.className='tile-name';name.textContent=job.title;
  const caption=document.createElement('span');caption.className='tile-caption';caption.textContent=`${state.presets[job.kind]?.label??job.kind} · ${new Date(job.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
  button.append(name,caption);button.addEventListener('click',()=>{selectJob(job,true);workspace('studio');if(matchMedia('(max-width:760px)').matches)$('artStage').scrollIntoView({block:'center',behavior:'auto'});});return button;
}
function renderGallery(){
  if(!state)return;
  for(const [id,jobs] of [['recentGrid',state.jobs.slice(0,4)],['libraryGrid',state.jobs.filter(job=>$('filter').value==='all'||job.kind===$('filter').value)]]){
    const grid=$(id);grid.replaceChildren();if(!jobs.length){const empty=document.createElement('p');empty.className='empty-note';empty.textContent=id==='recentGrid'?'Your finished images will gather here. Create the first one from your brief.':'No artwork in this view yet. Create an image or choose another artwork type.';grid.append(empty);}else jobs.forEach(job=>grid.append(tile(job)));
  }
}
function selectJob(job,fill=false){
  selected=job;try{sessionStorage.setItem('coast-studio-selected',job.id);}catch{}
  if(fill){chooseKind(job.kind);$('artTitle').value=job.title;$('prompt').value=job.prompt;$('negative').value=job.negative;$('seed').value=job.seed;$('steps').value=job.steps;$('shape').value=job.shape;if(state.engine.checkpoints.includes(job.checkpoint))$('checkpoint').value=job.checkpoint;}
  renderSelected();renderGallery();
  clearTimeout(pollTimer);pollDeadline=Date.now()+240000;if(['queued','running','submitted'].includes(job.status))pollTimer=setTimeout(poll,1500);
}
function renderSelected(){
  if(!selected)return;const job=selected,ready=job.status==='ready',failed=job.status==='failed',unknown=job.status==='unknown';
  $('artStage').classList.remove('reference');$('previewTitle').textContent=job.title;$('previewKind').textContent=state.presets[job.kind]?.label??job.kind;
  $('previewSubtitle').textContent=ready?'Created in your local studio':failed?'This version needs attention':unknown?'Checking an uncertain submission':'Your brief is becoming an image';
  $('renderState').hidden=ready;$('renderState').classList.toggle('failed',failed||unknown);
  $('renderTitle').textContent=failed?'This image could not finish':unknown?'Let’s recover this image':job.status==='queued'?'Waiting for its turn':'Bringing the scene to life';
  $('renderMessage').textContent=job.message||(job.status==='queued'?'ComfyUI will start when the renderer is free.':'You can keep playing. This image stays linked to its original brief.');
  $('resultActions').hidden=!ready;
  if(ready){$('previewImage').src=job.imageUrl;$('previewImage').alt=job.title;$('downloadImage').href=job.imageUrl;$('downloadImage').download=`${job.kind}-${job.id}.png`;}
  $('imageMeta').textContent=`${job.seed} seed · ${job.steps} steps · ${job.checkpoint.replace(/\.safetensors$/,'')}`;
  $('downloadWorkflow').hidden=false;$('downloadWorkflow').href=`/api/jobs/${job.id}/workflow`;
  $('useAtTable').hidden=!(ready&&tableOrigin&&contextId&&tableWindow&&job.contextId===contextId);
}
async function poll(){
  if(!selected)return;const id=selected.id;
  try{const {job}=await api(`/api/jobs/${id}`);if(selected?.id!==id)return;selected=job;const i=state.jobs.findIndex(item=>item.id===id);if(i>=0)state.jobs[i]=job;renderSelected();renderGallery();
    if(['queued','running','submitted'].includes(job.status)){if(Date.now()<pollDeadline)pollTimer=setTimeout(poll,2200);else{$('renderMessage').textContent='Automatic checks have paused. Use Check status to recover this job.';}}
  }catch(error){notice('The renderer connection was interrupted. Check status to recover this same image.',true);}
}
async function generate(recover=false){
  if(submitting)return;submitting=true;notice('');
  const request=recover&&pending?pending:{requestId:crypto.randomUUID(),kind,title:$('artTitle').value,prompt:$('prompt').value,negative:$('negative').value,checkpoint:$('checkpoint').value,seed:$('seed').value,steps:Number($('steps').value),shape:$('shape').value,contextId};
  pending=request;try{sessionStorage.setItem('coast-studio-pending',JSON.stringify(request));}catch{}updateControls();
  try{
    const {job}=await api('/api/jobs',{method:'POST',body:JSON.stringify(request)});pending=null;sessionStorage.removeItem('coast-studio-pending');state.jobs=[job,...state.jobs.filter(item=>item.id!==job.id)];selectJob(job);if(matchMedia('(max-width:760px)').matches)$('artStage').scrollIntoView({block:'center',behavior:'auto'});
  }catch(error){notice(error.message||'The connection was interrupted. Recover the same request before creating another version.',true);}
  finally{submitting=false;updateControls();}
}
document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>workspace(button.dataset.workspace)));
document.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>chooseKind(button.dataset.kind)));
$('brief').addEventListener('submit',event=>{event.preventDefault();void generate();});$('recoverSubmit').addEventListener('click',()=>void generate(true));
$('example').addEventListener('click',applyExample);$('filter').addEventListener('change',renderGallery);$('checkpoint').addEventListener('change',updateControls);
$('refreshEngine').addEventListener('click',()=>void loadState());$('checkJob').addEventListener('click',()=>{clearTimeout(pollTimer);pollDeadline=Date.now()+240000;void poll();});
$('variation').addEventListener('click',()=>{selectJob(selected,true);$('seed').value='';workspace('studio');$('prompt').focus();notice('The original brief is loaded. Adjust it or create another composition with a new seed.');});
$('startEngine').addEventListener('click',async()=>{if(!state)return;$('startEngine').disabled=true;notice('Starting the local renderer. This can take a moment.');try{await api('/api/engine/start',{method:'POST',body:'{}'});await loadState();}catch(error){notice(error.message,true);$('startEngine').disabled=false;}});
$('useAtTable').addEventListener('click',async()=>{
  if(!selected?.imageUrl||!tableOrigin||!tableWindow)return;
  try{const response=await fetch(selected.imageUrl);if(!response.ok)throw Error();const blob=await response.blob();if(blob.size>28*1024*1024)throw Error();const imageData=await new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=no;reader.readAsDataURL(blob);});tableWindow.postMessage({type:'coast-studio-art',contextId,jobId:selected.id,title:selected.title,imageData},tableOrigin);notice('Sent to the table as a local preview. Campaign state and player views are unchanged.');}catch{notice('The image could not be sent. Save the PNG and reopen the studio from your table.',true);}
});
$('previewImage').addEventListener('error',()=>notice('This preview could not load. Refresh the collection and try again.',true));
$('artStage').classList.add('reference');await loadState();
const restored=state?.jobs.find(job=>job.id===sessionStorage.getItem('coast-studio-selected'));if(restored)selectJob(restored);
setInterval(()=>{if(!document.hidden&&!submitting)void loadState();},15000);
