import { panels, acts, entries, alternate } from './data.mjs';
import { esc, initialState, renderBoard, renderScreen, renderPanelNotes, renderRecap, renderEntry } from './views.mjs';
const app=document.querySelector('#app');
let s=initialState(), toastTimer;
const params=new URLSearchParams(location.search);
if (['board','walk','recap','chronicle'].includes(params.get('view'))) s.view=params.get('view');
if (Number(params.get('panel'))>=1&&Number(params.get('panel'))<=30) s.panel=Number(params.get('panel'));
function activePanel(){return panels.find(p=>p.id===s.panel)||panels[5];}
function visiblePanels(){return panels.filter(p=>s.role==='All'||p.role===s.role);}
function resetFrame(id){const keep={view:'walk',panel:id,role:s.role,minutes:s.minutes,mode:s.mode,autoImages:s.autoImages,discord:s.discord,voice:s.voice,mobile:s.mobile,extras:s.extras};s={...initialState(),...keep};}
function jump(id){resetFrame(Math.max(1,Math.min(30,Number(id))));render();window.scrollTo({top:0,behavior:'instant'});}
function step(delta){const list=visiblePanels(),at=list.findIndex(p=>p.id===s.panel);jump(list[Math.max(0,Math.min(list.length-1,at+delta))]?.id??s.panel);}
function toast(text){s.toast=text;clearTimeout(toastTimer);render();toastTimer=setTimeout(()=>{s.toast='';render();},5500);}
function modal(title,body){s.focus={title,body};render();document.querySelector('.modal button')?.focus();}
function source(id){const e=entries.find(e=>e.id===id);if(e) modal(`Source ${id}`,renderEntry(e,{corrected:s.panel>=21}));}
function setView(view){s.view=view;s.focus=null;if(view==='recap')s.panel=28;render();window.scrollTo({top:0,behavior:'instant'});}
function render(){
  const p=activePanel(), list=visiblePanels(), at=list.findIndex(f=>f.id===p.id);
  document.title=`Raphael · ${s.view==='board'?'30-frame storyboard':s.view==='recap'?'Illustrated episode recap':`Frame ${String(p.id).padStart(2,'0')} · ${p.title}`}`;
  history.replaceState(null,'',`?view=${s.view}&panel=${s.panel}`);
  app.innerHTML=`<header class="topbar"><div class="project-title">Raphael <span>BEHIND THE VEIL · STORYBOARD EDITION</span></div><nav class="topnav" aria-label="Mockup navigation"><button data-action="board" class="${s.view==='board'?'active':''}">Storyboard · 30</button><button data-action="walk" class="${s.view==='walk'?'active':''}">Walkthrough</button><button data-action="chronicle" class="${s.view==='chronicle'?'active':''}">Chronicle</button><button data-action="recap" class="${s.view==='recap'?'active':''}">Recap</button><label class="sr-only" for="perspective">Perspective</label><select id="perspective" data-field="role">${['All','Admin','DM','Player'].map(r=>`<option value="${r}" ${s.role===r?'selected':''}>${r==='All'?'All views':r+' view'}</option>`).join('')}</select><button data-action="mobile" aria-pressed="${s.mobile}">${s.mobile?'Desktop':'Mobile player'}</button><button data-action="reset">Reset</button></nav></header><div class="demo-ribbon">FICTIONAL DEMONSTRATION · No live game changes, microphone access, Discord messages or paid generation · Use the controls to rehearse the flow</div>${s.view==='board'?`<main class="board-container">${renderBoard(s)}</main>`:s.view==='recap'?`<main class="recap-container">${renderRecap()}</main>`:`<div class="walk-container"><header class="frame-heading"><div><div class="frame-label">ACT ${String(p.act).padStart(2,'0')} / ${acts[p.act-1].toUpperCase()} · ${p.role.toUpperCase()} VIEW</div><h1>${p.title}</h1></div><div class="frame-control"><button data-action="prev" aria-label="Previous panel" ${at<=0?'disabled':''}>←</button><label class="sr-only" for="frame">Storyboard frame</label><select id="frame" data-field="panel">${list.map(f=>`<option value="${f.id}" ${p.id===f.id?'selected':''}>${String(f.id).padStart(2,'0')} · ${f.title}</option>`).join('')}</select><button data-action="next" aria-label="Next panel" ${at===list.length-1?'disabled':''}>→</button><span class="frame-count">${String(p.id).padStart(2,'0')} / 30</span></div></header>${renderScreen(p,s)}${renderPanelNotes(p)}<nav class="frame-strip" aria-label="Storyboard frames">${list.map(f=>`<button data-jump="${f.id}" class="${f.id===p.id?'current':''}" aria-label="Frame ${f.id}: ${f.title}" ${f.id===p.id?'aria-current="step"':''}>${String(f.id).padStart(2,'0')}</button>`).join('')}</nav></div>`}${s.toast?`<div class="toast" role="status">${esc(s.toast)}</div>`:''}${s.focus?`<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${esc(s.focus.title)}</h2><button data-action="close-modal" aria-label="Close dialog">Close</button></header>${s.focus.body}</section></div>`:''}`;
}
function publicPreview(text,speaker='Maren'){s.extras??=[];s.extras.push({id:`R${s.extras.length+1}`,tag:'REHEARSAL',speaker,time:activePanel().time,text,at:s.panel});toast('Added to this local rehearsal feed. The authored episode recap is unchanged.');}
app.addEventListener('click',e=>{
  const sourceEl=e.target.closest('[data-source]');if(sourceEl){source(sourceEl.dataset.source);return;}
  const jumpEl=e.target.closest('[data-jump]');if(jumpEl){const p=panels.find(p=>p.id===Number(jumpEl.dataset.jump));s.role='All';jump(p.id);return;}
  const tile=e.target.closest('[data-tile]');if(tile){toast(`Map ${tile.dataset.tile} selected. The demonstrated route is B4 → C4 → D4 → E4, costing 15 feet.`);return;}
  const filter=e.target.closest('[data-tag]');if(filter){s.tag=filter.dataset.tag;render();return;}
  const feedTab=e.target.closest('[data-feed-tab]');if(feedTab){s.feedTab=feedTab.dataset.feedTab;render();return;}
  const target=e.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action.startsWith('source-')){source(action.slice(7));return;}
  switch(action){
    case 'prev':step(-1);break;case 'next':step(1);break;
    case 'board':case 'recap':case 'chronicle':case 'walk':setView(action);break;
    case 'start':s.role='All';jump(1);break;
    case 'opening':jump(6);break;case 'dm-view':s.role='DM';jump(6);break;case 'player-view':s.role='Player';jump(7);break;
    case 'proposal':jump(10);break;case 'image-view':jump(17);break;case 'counsel-view':jump(15);break;case 'abbey-view':jump(24);break;case 'correction-view':jump(20);break;
    case 'save-settings':jump(4);toast(`Settings saved for this rehearsal: ${s.minutes}-minute summaries, ${s.mode==='human'?'human DM':'arcade narrator'}.`);break;
    case 'ready':s.ready=true;toast('Ready status saved for this demonstration. Capture consent remains your separate choice.');break;
    case 'mic':toast('Simulated microphone check: ready. No microphone permission was requested.');break;
    case 'read':s.read=true;toast('Marked read in the private DM workspace. The draft was not copied into the shared transcript.');break;
    case 'font-up':s.font=Math.min(32,s.font+2);render();break;case 'font-down':s.font=Math.max(17,s.font-2);render();break;
    case 'edit':s.edit=!s.edit;render();break;
    case 'regenerate':s.narration=activePanel().type==='abbey'?'At the Abbey’s sheltered door, the courier finally catches his breath. A woman peers into the mist. “You brought him back,” she says. “I’m Mara. Come inside.”':activePanel().type==='cue'?'The courier is free. The crate is gone. On the causeway, the patrol lantern moves through the mist. The rocks offer shelter; beyond them stands the Abbey. What do you do next?':alternate;toast('A shorter authored variation is ready. No model request was made.');break;
    case 'submit-proposal':jump(11);toast('Maren’s example intention is ready for the DM’s ruling. No outcome has been decided.');break;
    case 'roll':s.rolled=true;render();break;
    case 'confirm':s.confirmed=true;toast('Sample outcome confirmed: courier freed; extra crate lost; personal equipment retained.');break;
    case 'move':s.moved=true;toast('Sample movement saved: 15 feet to shelter. The next press reuses this result.');break;
    case 'share-preview':s.sharePreview=true;render();break;case 'keep-private':s.sharePreview=false;render();break;
    case 'share':if(!s.shared){s.shared=true;publicPreview('You have already chosen a life over a crate. Find shelter for that life.','Maren · shared counsel');}break;
    case 'finish-image':s.imageReady=true;render();break;
    case 'request-image':s.imageRequested=true;render();break;
    case 'publish-summary':jump(19);toast('Sample summary published into the same shared chronicle.');break;
    case 'summaries':s.tag='SUMMARY';setView('chronicle');break;
    case 'correct':s.correction=true;jump(21);toast('E09 corrects the name to Mara. E10 supersedes E08, and the original E02 remains available.');break;
    case 'correction-feed':s.tag='ALL';setView('chronicle');break;
    case 'resume':s.resumed=true;toast('Both sample participants are ready. Capture resumes and the countdown continues at 08:47.');break;
    case 'reconnect':s.recovered=true;render();break;
    case 'save-note':s.note=true;toast('Rowan’s missing detail is saved as E15, labeled a written note. The 12-second gap is retained.');break;
    case 'end-session':s.ended=true;toast('Capture stopped. Complete source evidence, corrections and images are ready for the sample recap.');break;
    case 'complete-recap':if(s.complete)setView('recap');else{s.complete=true;render();}break;
    case 'mobile':s.mobile=!s.mobile;if(s.mobile&&activePanel().role!=='Player'){s.role='Player';jump(7);}else render();break;
    case 'reset':s=initialState();toast('Rehearsal reset. Back to the DM’s opening passage.');break;
    case 'print':window.print();break;
    case 'close-modal':s.focus=null;render();break;
    case 'speak':modal('Speak to the table','<label>Your words<textarea data-field="spoken" placeholder="What does your hero say?"></textarea></label><button data-action="send-spoken" class="primary">Add rehearsal transcript</button><p class="notice">Typed simulation only. This does not record speech or modify the authored episode.</p>');break;
    case 'send-spoken':if(s.spoken?.trim()){s.focus=null;publicPreview(s.spoken.trim());}break;
    case 'send-message':if(s.message?.trim())publicPreview(s.message.trim());else toast('Type a message first.');break;
  }
});
app.addEventListener('input',e=>{
  const field=e.target.dataset.field;if(!field||e.target.type==='checkbox'||e.target.tagName==='SELECT')return;
  if(field==='minutes'){s.minutes=Math.max(1,Math.min(180,Number(e.target.value)||10));return;}
  s[field]=e.target.value;
  if(field==='query'){const pos=e.target.selectionStart;render();const input=document.querySelector('[data-field="query"]');input.focus();input.setSelectionRange(pos,pos);}
});
app.addEventListener('change',e=>{
  const field=e.target.dataset.field;if(!field)return;
  if(field==='panel'){jump(Number(e.target.value));return;}
  if(field==='role'){
    s.role=e.target.value;
    if(s.view!=='board'&&s.role!=='All'){
      const candidates=panels.filter(p=>p.role===s.role);const chosen=candidates.sort((a,b)=>Math.abs(a.id-s.panel)-Math.abs(b.id-s.panel))[0];
      resetFrame(chosen.id);s.role=e.target.value;
    }
    render();return;
  }
  if(e.target.type==='checkbox')s[field]=e.target.checked;else if(field==='minutes')s[field]=Math.max(1,Math.min(180,Number(e.target.value)||10));else s[field]=e.target.value;
  if(['speaker','time','mode','minutes','autoImages','discord','voice','consent'].includes(field))render();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&s.focus){s.focus=null;render();return;}
  if(e.key==='Tab'&&s.focus){const controls=[...document.querySelectorAll('.modal button,.modal a,.modal input,.modal textarea')];const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  if(e.target.closest('input,textarea,select')||s.focus)return;
  if(e.key==='ArrowRight'&&s.view==='walk'){e.preventDefault();step(1);}if(e.key==='ArrowLeft'&&s.view==='walk'){e.preventDefault();step(-1);}
});
render();
