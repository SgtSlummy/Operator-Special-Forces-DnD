const $=id=>document.getElementById(id);let view,selected,pending,busy=false,pendingInvalid=false,signInQueued=false,fieldInputs=[];
let draftRecord=null,draftBuffer=null,draftScope=null,draftConflict=false;
const writtenAction=action=>['interact','talk','describe'].includes(action?.type)&&action.fields?.length===1&&action.fields.every(field=>(field.type===undefined||field.type==='text')&&(field.kind===undefined||field.kind==='text')&&(field.maxLength??1500)<=1500);
const draftsAvailable=()=>view?.draftEnabled===true&&view.viewer==='player'&&!view.dmController;
function draftScopeKey(){return JSON.stringify([view?.campaignId,view?.actor?.id,view?.viewer]);}
function adoptDraft(record){
 draftRecord=record;draftConflict=false;
 if(record)draftBuffer={actionId:record.actionId,input:structuredClone(record.input),revision:record.expectedRevision,viewToken:null,baseVersion:record.version,dirty:false};
 else draftBuffer=null;
}
function startDraft(action){if(!draftsAvailable()||!writtenAction(action)||draftBuffer)return;draftBuffer={actionId:action.id,input:Object.fromEntries(action.fields.map(f=>[f.id,''])),revision:view.revision,viewToken:view.viewToken,baseVersion:draftRecord?.version??null,dirty:true};}
function draftControls(){
 const enabled=draftsAvailable()&&Boolean(draftBuffer);$('draft-panel').hidden=!enabled;if(!enabled)return;
 const prepared=draftRecord?.status==='prepared',completed=draftRecord?.status==='completed'&&!draftBuffer.dirty,stale=draftBuffer.revision!==view.revision;
 $('draft-status').textContent=prepared?'An attempt is unresolved. Recover its original result before editing.':completed?(draftRecord.receipt?.result||'Result recorded.'):(draftBuffer.dirty?'Unsaved changes. ':'Saved privately. ')+(draftConflict?'A newer saved draft exists. Your local text is preserved. Use saved draft instead, or review the current scene to replace it explicitly. ':stale?'The scene changed. Review the current scene before trying this intention. ':'')+(!draftBuffer.viewToken&&draftBuffer.dirty?'Review the current scene before saving edits.':'');
 $('draft-save').disabled=busy||Boolean(pending)||pendingInvalid||prepared||!draftBuffer.viewToken||draftConflict;
 $('draft-try').textContent=prepared?'Recover original action':'Try action';$('draft-try').disabled=busy||Boolean(pending)||pendingInvalid||!draftRecord||completed||(!prepared&&(draftBuffer.dirty||stale||draftConflict));
 $('draft-rebase').disabled=busy||prepared; $('draft-rebase').textContent=draftConflict?'Review scene and replace newer draft':'Review current scene';
 $('draft-use-saved').hidden=!draftConflict;$('draft-use-saved').disabled=busy;
 $('draft-new').hidden=prepared||!writtenAction(selected)||(!completed&&selected.id===draftBuffer.actionId);$('draft-new').disabled=busy;$('draft-new').textContent=completed?'Start new intention':'Replace current text with selected action';
 for(const input of $('draft-fields').querySelectorAll('input,textarea'))input.disabled=busy||prepared||completed;
}
function renderDraft(){
 draftControls();if(!draftsAvailable()||!draftBuffer)return;
 const active=document.activeElement;if(active&&$('draft-fields').contains(active))return;
 const action=view.actions?.find(a=>a.id===draftBuffer.actionId);$('draft-heading').textContent=`${action?.label??draftBuffer.actionId} — written intention`;$('draft-fields').replaceChildren();
 for(const [id,value]of Object.entries(draftBuffer.input)){const field=action?.fields?.find(f=>f.id===id);const label=document.createElement('label');label.textContent=field?.label??id;const input=document.createElement('textarea');input.name=id;input.value=value;input.rows=4;input.maxLength=field?.maxLength??4000;input.addEventListener('input',()=>{draftBuffer.input[id]=input.value;draftBuffer.dirty=true;draftControls();});label.append(input);$('draft-fields').append(label);}draftControls();
}
async function loadDraft(){
 if(!draftsAvailable()){draftRecord=null;draftBuffer=null;draftScope=null;draftConflict=false;renderDraft();return;}
 const key=draftScopeKey();if(draftScope!==key){draftScope=key;draftRecord=null;draftBuffer=null;draftConflict=false;}
 const {draft}=await api('/api/draft');
 if(draftBuffer?.dirty){draftConflict=(draft?.version??null)!==draftBuffer.baseVersion;draftRecord=draft;}
 else if(draft)adoptDraft(draft);
 else draftRecord=null;
 startDraft(selected);renderDraft();
}
const requiredFieldsReady=()=>fieldInputs.every(input=>!input.required||input.value.trim().length>0);
const explanationSelected=()=>selected?.group==='rulings'&&selected.id.endsWith(':note')&&selected.fields?.some(f=>f.id==='text');
const pendingKey='hollow-lantern.pending.v1';
try{const saved=sessionStorage.getItem(pendingKey);if(saved){const value=JSON.parse(saved);if(value.version!==1||typeof value.campaignId!=='string'||typeof value.actorId!=='string'||typeof value.audience!=='string'||!/^[-a-f0-9]{36}$/.test(value.request?.commandId)||typeof value.request.action!=='string')throw new Error('Invalid pending record');pending=value;}}catch{pendingInvalid=true;}
const notice=text=>$('notice').textContent=text;
const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;};
const readable=value=>/^[+-]?\d+(?:\.\d+)?$/.test(String(value??'').trim())?String(value).trim():String(value??'').replaceAll('-',' ').replace(/([a-z])([A-Z])/g,'$1 $2');
function detailSection(title,entries){const section=document.createElement('section');section.className='item';const heading=document.createElement('h3');heading.textContent=title;section.append(heading);for(const [name,value]of entries){const row=document.createElement('p');row.textContent=`${readable(name)}: ${Array.isArray(value)?value.map(readable).join(' · '):readable(value)}`;section.append(row);}$('details').append(section);}
const shownActions=()=> (view.actions??[]).filter(a=>$('tab').value==='rulings'?a.group==='rulings'&&a.id.startsWith('ruling:'):$('tab').value!=='inventory'||['use','equip','drop','transfer','buy','sell'].includes(a.group));
async function api(path,input){const response=await fetch(path,{method:input?'POST':'GET',headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error??'The game is unavailable.'),{status:response.status});return data;}
function renderActions(){const actions=shownActions().filter(a=>a.group===$('group').value);$('action').replaceChildren(...($('tab').value==='rulings'||$('group').value==='rulings'?[option('','Choose a ruling response…')]:[]),...actions.map(a=>option(a.id,a.label)));chooseAction();}
function renderRulingChoices(){
 let guide=$('ruling-response-guide');if(!guide){guide=document.createElement('section');guide.id='ruling-response-guide';guide.setAttribute('aria-label','Available ruling responses');$('action').parentElement.before(guide);}
 if($('tab').value==='rulings')$('details').after(guide);else $('action').parentElement.before(guide);
 guide.replaceChildren();const actions=shownActions().filter(a=>a.group==='rulings'&&a.id.startsWith('ruling:'));
 guide.hidden=!view.dmStatus||$('group').value!=='rulings'||actions.length===0;if(guide.hidden)return;
 const title=document.createElement('h3');title.textContent='Available responses';const help=document.createElement('p');help.textContent='Choose in the response dropdown, then confirm. Nothing changes before confirmation.';const list=document.createElement('ul');
 const notes=actions.filter(a=>a.id.endsWith(':note')&&actions.some(base=>base.id===a.id.slice(0,-5)));
 for(const action of actions.filter(a=>!notes.includes(a))){const row=document.createElement('li'),name=document.createElement('strong'),description=document.createElement('p');name.textContent=action.label;description.textContent=action.description??'';row.append(name,description);list.append(row);}guide.append(title,help,list);
 if(notes.length){const alternatives=document.createElement('p');alternatives.className='ruling-explanation-options';const heading=document.createElement('strong');heading.textContent='With explanation';const detail=document.createElement('span');detail.textContent=`${notes.map(a=>a.label).join(' / ')}. These make the same decision and also require your written ruling before confirmation.`;alternatives.append(heading,detail);guide.append(alternatives);}
}
function chooseAction(){
 renderRulingChoices();selected=view.actions?.find(a=>a.id===$('action').value);
 startDraft(selected);renderDraft();$('submit').hidden=draftsAvailable()&&writtenAction(selected);$('fields').hidden=$('submit').hidden;
 const ruling=$('tab').value==='rulings'||$('group').value==='rulings';
 const withExplanation=ruling&&selected?view.actions?.find(a=>a.group==='rulings'&&a.id===selected.id+':note'):undefined;
 $('action').parentElement.firstChild.textContent=ruling?(explanationSelected()?'Response selected ':'1. Choose a response '):'Action ';
 $('submit').textContent=ruling?(selected?`Confirm: ${selected.label}${withExplanation?' (no explanation)':''}`:'Choose a response above'):'Confirm action';
 $('cost').textContent=draftsAvailable()&&writtenAction(selected)?'Write and review this intention above. Saving does not attempt an action.':selected?.description??(ruling?'Select a response in the dropdown above to enable confirmation.':'No action is available. The DM may need to open decisions.');
 if(withExplanation)$('cost').textContent+=' No explanation will be recorded unless you add one below.';
 let addExplanation=$('add-ruling-explanation');
 if(!addExplanation){addExplanation=document.createElement('button');addExplanation.id='add-ruling-explanation';addExplanation.type='button';addExplanation.textContent='Add explanation';$('fields').before(addExplanation);addExplanation.addEventListener('click',()=>{
  if(busy||pending||pendingInvalid)return;
  const action=view.actions?.find(a=>a.group==='rulings'&&a.id===selected?.id+':note');if(!action)return;
  $('action').value=action.id;chooseAction();$('fields').querySelector('textarea, input')?.focus();
 });}
 addExplanation.hidden=!withExplanation;addExplanation.disabled=busy||Boolean(pending)||pendingInvalid;
 $('submit').disabled=busy||!selected||Boolean(pending)||pendingInvalid;$('fields').replaceChildren();
 fieldInputs=[];
 for(const field of selected?.fields??[]){const label=document.createElement('label');label.textContent=explanationSelected()&&field.id==='text'?'2. Write your explanation (required)':field.label;const input=document.createElement(field.multiline?'textarea':'input');input.name=field.id;input.required=field.required!==false;input.maxLength=field.maxLength??1500;input.addEventListener('input',updateControls);fieldInputs.push(input);label.append(input);$('fields').append(label);}
 updateControls();
}
function render(){
 const tabLabel=$('tab').parentElement;tabLabel.firstChild.textContent='Open Map, Character, Inventory… ';
 let review=$('review-rulings');if(!review){review=document.createElement('button');review.id='review-rulings';review.type='button';review.textContent='Review pending rulings';review.addEventListener('click',()=>{if(busy)return;$('tab').value='rulings';$('group').value='rulings';render();updateControls();});$('summary').after(review);}
 review.hidden=!view.dmStatus||$('tab').value==='rulings';review.disabled=busy;
 let back=$('rulings-back');if(!back){back=document.createElement('button');back.id='rulings-back';back.type='button';back.textContent='Back to map';back.addEventListener('click',()=>{if(busy)return;$('tab').value='map';render();updateControls();});review.after(back);}back.hidden=$('tab').value!=='rulings';back.disabled=busy;
 if(view.dmStatus&&!$('tab').querySelector('option[value="rulings"]'))$('tab').append(option('rulings','Pending rulings'));
 if(!view.dmStatus){$('tab').querySelector('option[value="rulings"]')?.remove();if(!$('tab').value)$('tab').value='map';}
 document.querySelector('.game').hidden=false;$('scene').textContent=view.title;$('summary').textContent=view.summary;$('revision').textContent=`${view.viewer==='gm'?'DM view':'Private character view'} · Revision ${view.revision}`;
 $('dm-actor-label').hidden=!view.dmController;$('dm-actor').replaceChildren(option('','DM overview'),...(view.controllableActors??[]).map(a=>option(a.id,`${a.name}${a.active?' · Active turn':''}`)));$('dm-actor').value=view.selectedActor??'';$('dm-actor').disabled=busy;
 const tab=$('tab').value;document.querySelector('.game').setAttribute('data-view',tab);if(tab==='rulings')tabLabel.firstChild.textContent='View ';$('map').hidden=tab!=='map';$('map-link').hidden=tab!=='map';$('portrait').hidden=tab!=='character'||!view.actor;document.querySelector('aside').hidden=['journal','help'].includes(tab);$('details').replaceChildren();
 $('level').parentElement.hidden=tab!=='map';$('dm-actor-label').hidden=!view.dmController||tab==='rulings';
 if(tab==='map'){$('map').src=`/api/map?level=${encodeURIComponent($('level').value)}&viewToken=${encodeURIComponent(view.viewToken)}&revision=${view.revision}`;$('map-link').href=$('map').src;}
 if(tab==='character'){
  const actor=view.actor;
  if(actor)$('portrait').src=`/api/portrait?viewToken=${encodeURIComponent(view.viewToken)}`;
  $('details').textContent=actor?`${actor.name}\n${actor.hp} / ${actor.maxHp} HP\n${actor.details}\n${actor.conditions.join(', ')}`:'Use the DM actor controls to inspect or direct a character.';
  if(actor?.sheet){
   const section=document.createElement('section');section.className='item';const heading=document.createElement('h3');heading.textContent='Features and rules';section.append(heading);
   for(const feature of actor.sheet.features??[]){const p=document.createElement('p');p.textContent=`${readable(feature.name??feature.id)} — ${feature.description??'Review this feature with the DM.'}`;section.append(p);}$('details').append(section);
   detailSection('Skills',Object.entries(actor.skills??{}).map(([key,value])=>[key,value>=0?`+${value}`:value]));
   detailSection('Training',[['saving throws',actor.saves],['weapons',actor.sheet.weaponProficiencies],['armor',actor.sheet.armorTraining],['tools',actor.sheet.tools],['languages',actor.sheet.languages]]);
   if(actor.sheet.spellcasting)detailSection('Spells',Object.entries(actor.sheet.spellcasting));
   if(actor.deathSaves)detailSection('Death saves',Object.entries(actor.deathSaves));
  }
 }
 if(tab==='journal')$('details').textContent=(view.journal??[]).join('\n\n');
 if(tab==='rulings'){$('scene').textContent='Pending rulings';$('details').textContent=view.dmStatus?.pendingRulings.length?view.dmStatus.pendingRulings.map(r=>r.text).join('\n\n'):'No pending rulings. New requests will appear here for your review.';document.querySelector('aside').hidden=!shownActions().length;}
 if(tab==='help')$('details').textContent='The map uses numbered columns and rows, each square five feet. Use Open map at full size to inspect coordinates on a small screen. Gold portrait tokens are companions; red tokens are visible opponents. Dark areas are unexplored; muted ground is remembered. Actions use the information your character has. Describe Action requests a DM ruling. Your private items and discoveries remain in your character view.';
 if(tab==='inventory')for(const item of view.actor?.inventory??[]){const section=document.createElement('section');section.className='item';const title=document.createElement('h3');title.textContent=`${item.name} × ${item.quantity}${item.equipped?' · Equipped':''}`;const p=document.createElement('p');p.textContent=item.description;const value=document.createElement('small');value.textContent=`Value: ${item.value}`;section.append(title,p,value);$('details').append(section);}
 const current=$('group').value,groups=[...new Set(shownActions().map(a=>a.group))];if(view.dmStatus){const first=view.dmStatus.pendingRulings.length?'rulings':'pause';groups.sort((a,b)=>(a===first?-1:b===first?1:0));}$('group').replaceChildren(...groups.map(g=>option(g,g.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase()))));if(groups.includes(current))$('group').value=current;renderActions();
}
function samePendingScope(){return Boolean(pending&&view&&view.campaignId===pending.campaignId&&(view.selectedActor??view.actor?.id??'')===pending.actorId&&view.viewer===pending.audience);}
function updateControls(){if(document.getElementById("rulings-back"))document.getElementById("rulings-back").disabled=busy;if(document.getElementById("review-rulings"))document.getElementById("review-rulings").disabled=busy;const unresolved=Boolean(pending)||pendingInvalid;$('pending-panel').hidden=!unresolved;$('pending-description').textContent=pendingInvalid?'A saved action record could not be read. No new mechanics can be submitted until you inspect or dismiss this record.':pending?`Unconfirmed action: ${pending.actionLabel}. Character: ${pending.actorName||pending.actorId||'DM overview'}. Campaign: ${pending.campaignId}. Command ${pending.request.commandId}. This record stays in this browser tab after reload.`:'';
 $('recover').disabled=busy||!samePendingScope();$('recover-context').textContent=pending&&!samePendingScope()?'Sign in to the original campaign and character. The DM can select the saved character below to recover its result.':'';
 $('submit').disabled=busy||unresolved||!selected||!requiredFieldsReady();if(explanationSelected())$('submit').textContent=requiredFieldsReady()?`Confirm: ${selected.label}`:'Write an explanation above';for(const id of ['group','action'])$(id).disabled=busy||unresolved;if($('add-ruling-explanation'))$('add-ruling-explanation').disabled=busy||unresolved;for(const id of ['refresh','level','tab','dm-actor','dismiss-pending','confirm-dismiss','cancel-dismiss'])$(id).disabled=busy;document.querySelector('.game').setAttribute('aria-busy',String(busy));draftControls();}
async function exclusive(work){if(busy)return;busy=true;updateControls();try{await work();}catch(error){notice(error.message);}finally{busy=false;updateControls();if(signInQueued){signInQueued=false;void signIn();}}}
async function loadView(){const next=await api(`/api/view?level=${encodeURIComponent($('level').value)}`);view=next;if(draftScope&&draftScope!==draftScopeKey()){draftBuffer=null;draftRecord=null;draftConflict=false;}render();await loadDraft();updateControls();}
async function refresh(){return exclusive(async()=>{await loadView();notice(pending?'Your original action is still unconfirmed. Use Recover original action; refreshing does not resubmit it.':'');});}
function savePending(value){sessionStorage.setItem(pendingKey,JSON.stringify(value));pending=value;updateControls();}
function clearPending(){sessionStorage.removeItem(pendingKey);pending=null;pendingInvalid=false;$('dismiss-confirm').hidden=true;updateControls();}
function showReceipt(receipt){if(!pending||receipt?.success!==true||receipt.commandId!==pending.request.commandId||receipt.campaignId!==pending.campaignId||!Number.isSafeInteger(receipt.revision))throw new Error('The returned receipt does not match your saved action. Keep the record and ask the DM to inspect it.');$('receipt').textContent=Object.entries(receipt.result??{}).map(([key,value])=>`${key==='message'?'':`${readable(key)}: `}${typeof value==='object'?JSON.stringify(value):value}`).join('\n')+`\nRevision ${receipt.revision}${receipt.replayed?' · Original result recovered':''}`;clearPending();}
function uncertainty(error){if(!pending){notice(`The receipt was confirmed, but the refreshed view is unavailable: ${error.message}`);return;}notice(error.status===404?'No receipt is available yet. The original request may still be in flight. Keep this record and check again; this does not prove that nothing happened.':`${error.message} Your original action remains saved. Restore access if needed, then use Recover original action. No new action was sent.`);}
$('group').addEventListener('change',()=>{if(!busy)renderActions();});$('action').addEventListener('change',()=>{if(!busy)chooseAction();});$('tab').addEventListener('change',()=>{if(!busy&&view){render();updateControls();}});$('level').addEventListener('change',refresh);$('refresh').addEventListener('click',refresh);
$('intent').addEventListener('submit',async event=>{event.preventDefault();if(draftsAvailable()&&writtenAction(selected))return;if(busy||!selected||pending||pendingInvalid||!requiredFieldsReady())return;const request={action:selected.id,payload:Object.fromEntries(new FormData(event.target)),revision:view.revision,commandId:crypto.randomUUID(),viewToken:view.viewToken},saved={version:1,campaignId:view.campaignId,actorId:view.selectedActor??view.actor?.id??'',audience:view.viewer,actorName:view.actor?.name??'',actionLabel:selected.label,level:$('level').value,request};
 await exclusive(async()=>{try{savePending(saved);}catch{notice('This browser could not save the pending action. Nothing was sent. Enable tab storage before acting.');return;}try{const result=await api(`/api/action?level=${encodeURIComponent(saved.level)}`,saved.request);showReceipt(result.receipt);await loadView();notice('Action confirmed.');}catch(error){uncertainty(error);}});
});
$('recover').addEventListener('click',()=>exclusive(async()=>{if(!samePendingScope()){notice('Select the original character before recovering.');return;}try{const result=await api('/api/receipt',{commandId:pending.request.commandId});showReceipt(result.receipt);await loadView();notice('The original receipt was recovered. No action was resubmitted.');}catch(error){uncertainty(error);}}));
$('dm-actor').addEventListener('change',()=>{const actorId=$('dm-actor').value;return exclusive(async()=>{await api('/api/actor',{actorId});await loadView();notice(pending?'Character selected. Recover the saved action before submitting new mechanics.':'');});});
$('dismiss-pending').addEventListener('click',()=>{$('dismiss-confirm').hidden=false;$('confirm-dismiss').focus();});$('cancel-dismiss').addEventListener('click',()=>{$('dismiss-confirm').hidden=true;$('dismiss-pending').focus();});$('confirm-dismiss').addEventListener('click',()=>{if(busy)return;try{clearPending();notice('Local recovery record dismissed. This did not cancel or undo the original action. Check the Journal or ask the DM before repeating it.');}catch{notice('The local recovery record could not be removed.');}});
async function signIn(){if(busy){signInQueued=true;return;}const code=new URLSearchParams(location.hash.slice(1)).get('code');history.replaceState(null,'',location.pathname);return exclusive(async()=>{if(code)await api('/api/session',{code});await loadView();notice(pending?'A saved action needs your attention. Recovery is read-only and starts only when you press Recover original action.':'');});}
$('draft-save').addEventListener('click',()=>exclusive(async()=>{
 if(!draftsAvailable()||!draftBuffer||draftRecord?.status==='prepared'||!draftBuffer.viewToken||draftConflict)return;
 try{const result=await api('/api/draft/save',{viewToken:draftBuffer.viewToken,actionId:draftBuffer.actionId,input:structuredClone(draftBuffer.input),expectedDraftVersion:draftBuffer.baseVersion});draftRecord=result.draft;draftBuffer.baseVersion=draftRecord.version;draftBuffer.dirty=false;draftConflict=false;notice('Draft saved. No action was attempted.');renderDraft();}
 catch(error){if(error.status===409)draftConflict=true;throw error;}
}));
$('draft-try').addEventListener('click',()=>exclusive(async()=>{
 if(!draftsAvailable()||!draftRecord||draftRecord.status==='completed'||(draftRecord.status!=='prepared'&&(draftBuffer.dirty||draftConflict||draftBuffer.revision!==view.revision)))return;
 try{const result=await api('/api/draft/try',{draftId:draftRecord.draftId,version:draftRecord.version});adoptDraft(result.draft);await loadView();renderDraft();}
 catch(error){try{await loadDraft();}catch{}notice(`${error.message} Reopen the saved intention to recover its original result.`);}
}));
$('draft-rebase').addEventListener('click',()=>exclusive(async()=>{
 if(!draftBuffer||draftRecord?.status==='prepared')return;
 const local=structuredClone(draftBuffer);await loadView();
 const action=view.actions?.find(a=>a.id===local.actionId);if(!writtenAction(action)){notice('That action is unavailable. Your local text is preserved.');return;}
 draftBuffer={...local,viewToken:view.viewToken,revision:view.revision,baseVersion:draftRecord?.version??null,dirty:true};draftConflict=false;renderDraft();notice('Current scene reviewed. Save this intention before trying it; saving replaces the prior saved version.');
}));
$('draft-use-saved').addEventListener('click',()=>{if(busy)return;adoptDraft(draftRecord);renderDraft();});
$('draft-new').addEventListener('click',()=>{if(busy||!writtenAction(selected))return;draftBuffer=null;startDraft(selected);renderDraft();});
window.addEventListener('hashchange',()=>{draftBuffer=null;draftRecord=null;draftScope=null;draftConflict=false;void signIn();});updateControls();await signIn();
