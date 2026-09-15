import {roomMap,roomIndex,atlasMap,worldMap,esc} from './render.mjs';
const $=id=>document.getElementById(id),e=esc;
let key=sessionStorage.getItem('coast-table-key')||'',data,roomId,areaId,view='scene',floor='all',busy=false,drawer=null;
if(location.hash.length>1){key=location.hash.slice(1);sessionStorage.setItem('coast-table-key',key);history.replaceState(null,'',location.pathname);}
const icons={scene:'M3 5h18v14H3z M3 15l5-5 5 5 3-3 5 5 M16 8h.01',atlas:'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',character:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',inventory:'M5 8h14v13H5z M9 8V4h6v4 M5 12h14 M10 12v3h4v-3',shop:'M3 9l3-6h12l3 6 M3 9v3h18V9 M5 12v9h14v-9 M10 21v-6h4v6',journal:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',raphael:'M12 20V8 M12 13C2 14 2 4 3 3c3 5 8 2 9 10 M12 13c10 1 10-9 9-10-3 5-8 2-9 10 M9 3h6',dm:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 11h8 M12 7v8'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]}"/></svg>`;
const art=id=>`${data?.preview===false?'/api':''}/art/room/${encodeURIComponent(id)}.png`;
const portrait=id=>`${data?.preview===false?'/api':''}/art/table/${encodeURIComponent(id)}.png`;
const current=()=>data?.catalog.rooms.find(r=>r.id===roomId);
function mapArt(svg,preparation=false){
 if(data?.preview!==false)return svg;
 return svg.replace(/href="\/art\/(room|table)\/([A-Za-z0-9_%.-]+)\.png"/g,(_,kind,id)=>`href="/api/art/${kind==='room'&&preparation&&data.identity.role==='gm'?'preparation':kind}/${id}.png"`);
}
const notify=(text,error=false)=>{$('notice').textContent=text;$('notice').style.color=error?'#f2b3a4':'';};
async function api(url,options={}){
 const live=data?.preview===false,target=new URL(url,location.origin);let body=options.body;
 if(live){
  if(target.pathname==='/api/action'&&options.method==='POST')body=JSON.stringify({viewToken:data.viewToken,commandId:crypto.randomUUID(),action:JSON.parse(body)});
  else if(target.pathname!=='/api/view')target.searchParams.set('viewToken',data.viewToken);
 }
 const r=await fetch(target,{...options,body,credentials:'same-origin',headers:{...(!live?{'X-Table-Key':key}:{}),...options.headers}});
 const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'The table could not respond.'),{status:r.status});return v;
}
let accessLocked=false;
function lockAccess(status){
 if(accessLocked)return;accessLocked=true;data=null;drawer=null;key='';sessionStorage.removeItem('coast-table-key');
 artStudioWindow=null;artPreviewRoom=null;$('artStudioDialog')?.close();$('artStudioFrame')?.removeAttribute('src');
 $('drawer').hidden=true;$('drawerBody').replaceChildren();$('drawerTitle').textContent='';$('dock').replaceChildren();
 $('identity').textContent='Access paused';$('campaignStatus').textContent='Your table is hidden until access is restored.';
 const panel=document.createElement('section');panel.style.padding='2rem';panel.setAttribute('role','alert');
 const title=document.createElement('h1');title.textContent=status===401?'Your session has ended':'Campaign access is unavailable';
 const message=document.createElement('p');message.textContent='Private notes, maps and controls have been cleared from this page. Reopen the table after signing in or restoring access.';
 const reopen=document.createElement('a');reopen.href=status===401?'/api/auth/discord/start':location.pathname+location.search;reopen.textContent=status===401?'Sign in with Discord':'Reopen the table';
 panel.append(title,message,reopen);$('table').replaceChildren(panel);$('refresh').textContent='Reopen';$('refresh').onclick=()=>location.reload();
}
async function refresh(silent=false){if(accessLocked)return;try{const next=await api('/api/view');if(accessLocked)return;const sameViewer=data&&JSON.stringify(data.identity)===JSON.stringify(next.identity)&&data.preview===next.preview;
 if(silent&&sameViewer&&data.state.revision===next.state.revision){data.viewToken=next.viewToken;syncCardLinks();return;}
 if(silent&&sameViewer&&document.activeElement?.matches('input,textarea,select'))return;
 if(data&&!sameViewer){drawer=null;$('drawer').hidden=true;$('drawerBody').replaceChildren();$('intent').value='';roomId=null;floor='all';view='scene';$('artStudioDialog')?.close();$('artStudioFrame')?.removeAttribute('src');artStudioWindow=null;artPreviewRoom=null;}
 const following=!roomId||roomId===data?.state.currentRoomId;data=next;if(data.key)key=data.key;roomId=!following&&data.catalog.rooms.some(r=>r.id===roomId)?roomId:data.state.currentRoomId;areaId=current()?.areaId;render();if(!silent)notify('Your table is up to date.');}catch(err){if(err.status===401||err.status===403)lockAccess(err.status);notify(err.message,true);}}
async function act(action){if(busy||accessLocked)return false;busy=true;try{await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...action,revision:data.state.revision})});if(accessLocked)return false;await refresh();if(accessLocked)return false;notify(data.preview===false?'Recorded in your campaign.':'Recorded in this rehearsal.');return true;}catch(err){if(err.status===401||err.status===403)lockAccess(err.status);else await refresh(true);notify(err.message,true);return false;}finally{busy=false;}}
const narration={
 't-tavern':['The Salt Lantern gives the harbor somewhere to put down its burdens. Rain taps the amber windows; inside, the little sounds of supper gather beneath the larger hush of the sea. Spoons touch thick bowls of chowder. Damp hems darken the floor beside the long tables.','The hearth throws a low, steady warmth across the public dining room. From here you can watch the quay through the windows, settle near the fire, or find a place among the diners. The chalk menu is close enough to read without interrupting anyone. Nothing requires you to hurry. Decide where your attention falls.'],
 'f-deck':['Brinewatch arrives a little at a time: first the dark line of the quay, then the windows, then the smell of rain on worked timber. Salt has collected in the joints of the rail. Beneath your boots, the ferry gives one last slow roll.','The gangplank settles against the waiting quay. A mooring line lies in a loose coil nearby, and the rope around the rail has gone dark with spray. The ordinary business of arrival continues around you. The shore is within walking distance now.'],
 'R01':['The door has been made to outlast weather, visitors, and perhaps the sea itself. Brass holds the lantern light in dull gold patches; at shoulder height, a dent interrupts its otherwise patient surface. Rain whispers against the outer windows.','Inside this public maintenance lobby, the equipment has the worn order of things used every day. An umbrella stand waits by the entrance. A service roster and speaking tube offer more practical company than the heavy door. Somewhere beyond, machinery continues its work.'],
 'R04':['The first footstep does not return alone. It comes back as a chord, stretched through a nave of pipes larger than cottages. Between the columns, the distance becomes difficult to judge; each small sound seems to find another surface on which to linger.','There are human accommodations within the enormous machinery: labels at reading height, controls within reach, routes kept broad enough for the people who maintain them. A low whistle briefly separates itself from the steady industrial breath. The printed control diagram is available to examine.'],
 'R05':['The room makes a quiet argument for ordinary life. A mended rug sits between a bunk and the small comforts arranged around it. Two mugs wait beside the kettle. After the machinery outside, even the space between the furniture feels companionably close.','The back window looks onto an indoor harbor. Within the flat, the visitor directions note is available to read. You can pause on the threshold, call out, or look more closely at what has been left in plain sight.']};
function paragraphs(r){return r.narration??narration[r.id]??[r.flavor,r.description];}
function markers(svg){for(const p of data.party){const safe=e(p.name);svg=svg.replace(new RegExp(`<g aria-label="${safe.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}">([\\s\\S]*?)<\\/g>`),(_,body)=>{const xy=body.match(/cx="([\d.-]+)" cy="([\d.-]+)"/);if(!xy)return _;const x=Number(xy[1]),y=Number(xy[2]);return `<g aria-label="${safe}"><rect x="${x-15}" y="${y-20}" width="30" height="40" rx="4" fill="#edd4a6"/><image href="${portrait(p.id)}" x="${x-13}" y="${y-18}" width="26" height="36" preserveAspectRatio="xMidYMid slice"/><title>${safe}</title></g>`;});}return svg;}
let mapZoom=1,mapContext='',mapScroll={left:0,top:0};
function mountMapZoom(drawing){
 if(!drawing||view==='scene')return;
 const viewport=document.createElement('div');viewport.dataset.mapViewport='';viewport.tabIndex=0;viewport.setAttribute('aria-label','Map viewport. Use arrow keys or scroll to explore the enlarged map.');
 viewport.style.cssText='overflow:auto;max-height:70vh;width:100%;overscroll-behavior:contain;';
 drawing.before(viewport);viewport.append(drawing);
 const paint=()=>{drawing.style.cssText=`width:${mapZoom*100}%;max-width:none;height:auto;max-height:none;display:block;`;};
 paint();viewport.scrollLeft=mapScroll.left;viewport.scrollTop=mapScroll.top;
 viewport.addEventListener('scroll',()=>{mapScroll={left:viewport.scrollLeft,top:viewport.scrollTop};});
 let controls=$('mapZoomControls');if(!controls){controls=document.createElement('div');controls.id='mapZoomControls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Map magnification');$('mapTools').append(controls);}
 controls.replaceChildren();
 const status=document.createElement('output');status.setAttribute('aria-live','polite');status.style.padding='0 .6rem';
 const minus=document.createElement('button'),plus=document.createElement('button'),reset=document.createElement('button');
 minus.type=plus.type=reset.type='button';minus.textContent='−';plus.textContent='+';reset.textContent='Reset view';minus.setAttribute('aria-label','Zoom out');plus.setAttribute('aria-label','Zoom in');
 const sync=()=>{status.textContent=Math.round(mapZoom*100)+'%';minus.disabled=mapZoom<=1;plus.disabled=mapZoom>=4;};
 const zoom=next=>{const before=mapZoom,cx=(viewport.scrollLeft+viewport.clientWidth/2)/before,cy=(viewport.scrollTop+viewport.clientHeight/2)/before;mapZoom=Math.max(1,Math.min(4,next));paint();viewport.scrollLeft=cx*mapZoom-viewport.clientWidth/2;viewport.scrollTop=cy*mapZoom-viewport.clientHeight/2;mapScroll={left:viewport.scrollLeft,top:viewport.scrollTop};sync();};
 minus.onclick=()=>zoom(mapZoom-.5);plus.onclick=()=>zoom(mapZoom+.5);reset.onclick=()=>{mapZoom=1;mapScroll={left:0,top:0};paint();viewport.scrollTo(0,0);sync();};
 controls.append(minus,status,plus,reset);sync();
}
function stage(){const context=JSON.stringify([data.identity,roomId,areaId,view,floor]);if(context!==mapContext){mapZoom=1;mapScroll={left:0,top:0};mapContext=context;}$('mapZoomControls')?.replaceChildren();const mapCatalog={...data.catalog,rooms:data.catalog.rooms.map(r=>({...r,pois:r.pois.filter(p=>data.state.poiIds[p.id])}))};const r=mapCatalog.rooms.find(r=>r.id===roomId);$('mapTools').hidden=view==='scene';$('angleLabel').hidden=view!=='dungeon';$('scale').textContent=view==='tactical'?`${r.width} × ${r.depth} feet · 5 ft grid`:'Schematic routes · choose a room to inspect';
 let map;
 if(view==='scene'){
  map=`<img src="${art(r.id)}" alt="${e(r.name)} — ${e(r.description)}">${r.pois.filter(p=>data.state.poiIds[p.id]).map((p,i)=>`<button class="note-pin" data-note="${e(p.id)}" style="left:${p.x*100}%;top:${p.y*100}%" aria-label="${e(p.name)}">${i+1}</button>`).join('')}<div class="art-caption">${e(r.name)} · ${data.state.roomIds[r.id]?.visited?'Visited':'Learned location'} · discoveries appear as you make them</div>`;
 }else if(view==='tactical'&&['R01','R02','R05','R07'].includes(r.id)&&data.encounter?.roomId===r.id&&data.encounter.terrain!=='hallway'){
  const url=new URL('/api/card',location.origin);url.searchParams.set('kind','tactical');url.searchParams.set('room',r.id);if(data.preview===false)url.searchParams.set('viewToken',data.viewToken);
  map=`<img data-combat-map src="${e(url.pathname+url.search)}" alt="${e(r.name)} — illustrated tactical map with visible combatants">`;
 }else if(['R01','R02','R05','R07'].includes(r.id)&&(view==='dungeon'||view==='tactical')&&(view==='tactical'||areaId===r.areaId&&Number(floor)===r.floor)&&data.encounter?.roomId!==r.id){
  const prefix=r.id.toLowerCase(),cut=r.id==='R02'?2.5:4;
  const choices=[['cutaway','Full room'],['floor-slice','Floor slice'],['low-cutaway','Low cutaway']].map(([suffix,label])=>[`${prefix}-${suffix}`,label]);
  const remembered=$('stage').dataset.architectureLayer;
  const layer=view==='tactical'?`${prefix}-floor-slice`:choices.some(([id])=>id===remembered)?remembered:`${prefix}-cutaway`;
  $('angleLabel').hidden=true;$('scale').textContent=`${r.width} × ${r.depth} feet · 5 ft grid · architectural cut at ${cut} ft`;
  map=`<div class="architecture-controls" role="group" aria-label="Architectural view">${view==='dungeon'?choices.map(([id,label])=>`<button type="button" data-architecture-layer="${id}" aria-pressed="${id===layer}">${label}</button>`).join(''):''}</div><div data-architecture-map="${layer}" aria-live="polite"><p>Preparing the illustrated map…</p></div><p class="art-caption">Markers show current positions. The ${cut} ft cut reveals the lower part of this room; it is not another floor.</p>`;
 }else{
  const parties=data.party;
  if(view==='tactical'){
   const hallway=data.encounter?.roomId===r.id&&data.encounter.terrain==='hallway';
   const room=hallway?{...r,name:'Straight connecting hallway',width:60,depth:10,pois:[],kind:'workshop'}:r;
   map=roomMap(room,parties,{grid:true});
   if(data.encounter?.roomId===r.id){const w=Math.min(820/room.width,450/room.depth)*room.width,h=Math.min(820/room.width,450/room.depth)*room.depth;
    map=map.replace('</svg>',data.encounter.enemies.map(enemy=>`<g><image href="${portrait(enemy.art??'sentinel')}" x="${(1000-w)/2+enemy.x*w-14}" y="${(650-h)/2+enemy.y*h-18}" width="28" height="36"/><title>${e(enemy.name)}</title></g>`).join('')+'</svg>');}
  }else if(view==='world')map=worldMap(data.catalog,data.state);
  else if(view==='diagram')map=roomIndex(mapCatalog,parties,{areaId,floor});
  else map=atlasMap(mapCatalog,parties,{areaId,floor,iso:view==='dungeon',grid:view==='town',angle:Number($('angle').value)});
  map=markers(map);
 }
 $('stage').innerHTML=mapArt(map);mountMapZoom($('stage').querySelector(':scope > svg, :scope > img[data-combat-map]'));
 for(const button of $('stage').querySelectorAll('[data-architecture-layer]'))button.addEventListener('click',()=>{$('stage').dataset.architectureLayer=button.dataset.architectureLayer;stage();});
 const slot=$('stage').querySelector('[data-architecture-map]');
 if(slot){const url=`/api/architecture?room=${encodeURIComponent(r.id)}&layer=${encodeURIComponent(slot.dataset.architectureMap)}${data.preview===false?'&viewToken='+encodeURIComponent(data.viewToken):''}`;
  fetch(url).then(async response=>{if(!response.ok)throw Error(response.status===409?'The map changed. Choose the view again to refresh.':'This illustration is temporarily unavailable.');return response.text();}).then(svg=>{if(slot.isConnected){slot.innerHTML=svg;const drawing=slot.querySelector('svg');mountMapZoom(drawing);}}).catch(error=>{if(slot.isConnected)slot.textContent=error.message;});
 }
}
function health(c){return Number.isFinite(c.hp)&&Number.isFinite(c.maxHp)?`<div class="health"><span style="width:${100*c.hp/c.maxHp}%"></span></div><small>${c.hp} / ${c.maxHp} HP</small>`:'<div class="health unknown"></div><small>HP ?</small>';}
function combat(){const en=data.encounter;$('combat').hidden=!en||en.roomId!==roomId;if($('combat').hidden)return;
 const fighter=(c,enemy=false)=>`<div class="combatant"><img src="${portrait(enemy?(c.art??'sentinel'):c.id)}" alt="${e(c.name)}"><strong>${e(c.name)}</strong>${health(c)}</div>`;
 $('combat').innerHTML=`<div class="combat-title"><strong>Round ${en.round}</strong><span>${e(en.surprise)}</span></div><div class="combat-strip" style="--room-art:url('${art(roomId)}')"><div class="combat-side">${data.party.filter(p=>p.roomId===roomId).map(c=>fighter(c)).join('')}</div><b class="versus">VS</b><div class="combat-side">${en.enemies.map(c=>fighter(c,true)).join('')||'<p>No opponent is visible.</p>'}</div></div>`;
}
function syncCardLinks(){
 for(const [id,kind]of [['saveScene','scene'],['saveTactical','tactical'],['saveCombat','combat']]){
  const url=new URL('/api/card',location.origin);url.searchParams.set('kind',kind);url.searchParams.set('room',roomId);
  if(data.preview===false)url.searchParams.set('viewToken',data.viewToken);
  $(id).href=url.pathname+url.search;
 }
}
function render(){
  document.getElementById('campaignStatus').textContent=data.preview===false?'Campaign table · actions are recorded in this campaign':data.preview===true?'Presentation rehearsal · separate save · actions here do not change the live campaign':'Campaign table · checking session mode';const r=current();if(!r)return;const gm=data.identity.role==='gm';$('identity').textContent=gm?'DM preparation':data.personal?`${data.party.find(p=>p.id===data.identity.actorId)?.name} · private`:'Company view';
 $('area').innerHTML=data.catalog.areas.map(a=>`<option value="${e(a.id)}" ${areaId===a.id?'selected':''}>${e(a.name)}</option>`).join('');
 $('locations').innerHTML=data.catalog.rooms.filter(x=>x.areaId===areaId).map(x=>`<button class="location" data-room="${e(x.id)}" aria-pressed="${x.id===roomId}"><img src="${art(x.id)}" alt=""><span>${e(x.name)}<small>${data.state.roomIds[x.id]?.visited?'Visited':'Learned'} · level ${e(x.floor)}</small></span></button>`).join('');
 $('where').textContent=`${data.catalog.areas.find(a=>a.id===areaId)?.name} / ${r.kind} / ${r.width} × ${r.depth} feet`;$('title').textContent=r.name;
 $('travel').disabled=roomId===data.state.currentRoomId||data.identity.role==='shared';$('travel').textContent=roomId===data.state.currentRoomId?'Company is here':gm?'Move company here':data.identity.role==='player'?'Request journey here':'Sign in to request travel';
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(view===b.dataset.view)));
 const floors=[...new Set(data.catalog.rooms.filter(x=>x.areaId===areaId).map(x=>String(x.floor)))];if(floor!=='all'&&!floors.includes(floor))floor='all';$('floor').innerHTML=`<option value="all">All discovered layers</option>${floors.map(f=>`<option ${f===floor?'selected':''}>${f}</option>`).join('')}`;
 $('sceneLead').textContent=r.flavor;syncCardLinks();$('saveCombat').hidden=data.encounter?.roomId!==roomId;
 stage();combat();$('narration').innerHTML=paragraphs(r).map(t=>`<p>${e(t)}</p>`).join('');$('features').innerHTML=r.visibleFeatures.map(f=>`<li>${e(f)}</li>`).join('');
 const notes=r.pois.filter(p=>data.state.poiIds[p.id]);$('notes').innerHTML=notes.length?notes.map((p,i)=>`<div class="note"><button data-note="${e(p.id)}">${i+1}. ${e(p.name)}</button><p>${e(p.description)}</p></div>`).join(''):'<p class="empty-note">No annotations yet.<br>The room has not told you everything.</p><p class="muted">Look, listen, ask, or describe an interaction. Your DM will call for a check when the outcome is uncertain.</p>';
 $('exits').innerHTML=data.catalog.links.filter(l=>l.from===r.id||l.to===r.id).map(l=>{const dest=data.catalog.rooms.find(x=>x.id===(l.from===r.id?l.to:l.from));return dest?`<button data-room="${e(dest.id)}">${e(dest.name)} →</button>`:'';}).join('');
 const companyRoom=data.catalog.rooms.find(x=>x.id===data.state.currentRoomId);
 $('partyLocation').textContent=`Company location: ${companyRoom?.name??'Not available'}. Browsing your atlas does not move the party.`;
 if(companyRoom&&roomId!==companyRoom.id){const back=document.createElement('button');back.type='button';back.dataset.room=companyRoom.id;back.textContent='Return to company scene';$('partyLocation').append(' ',back);}
 $('intent').disabled=data.identity.role!=='player';$('intentForm').querySelector('button').disabled=data.identity.role!=='player';$('intent').placeholder=data.identity.role==='player'?'Describe what you do; the DM resolves the result…':'Open a private player link to submit an action.';
 $('dock').innerHTML=[['scene','Scene'],['atlas','Atlas'],['character','Character'],['inventory','Inventory'],['shop','Shop'],['journal','Journal'],['raphael','Raphael'],...(gm?[['dm','DM desk']]:[])].map(([id,label])=>`<button data-panel="${id}">${icon(id)}${label}</button>`).join('');
 if(drawer){const draft=[...$('drawerBody').querySelectorAll('form')].map(f=>({action:f.dataset.action,formId:f.id,id:f.querySelector('[name=requestId],[name=enemyId]')?.value,opponents:f.querySelectorAll('[data-opponent]').length,values:[...f.querySelectorAll('input,select')].map((x,index)=>({index,name:x.name,id:x.id,value:x.value,checked:x.checked}))}));const recall=$('recallAnswer')?.innerHTML;openPanel(drawer);for(const saved of draft){const f=[...$('drawerBody').querySelectorAll('form')].find(f=>f.dataset.action===saved.action&&f.id===saved.formId&&f.querySelector('[name=requestId],[name=enemyId]')?.value===saved.id);if(f){if(f.id==='encounterForm')f.querySelector('#opponentRows').innerHTML=Array.from({length:saved.opponents},opponentRow).join('');for(const v of saved.values){const input=f.querySelectorAll('input,select')[v.index];if(input&&input.name===v.name&&input.id===v.id){input.value=v.value;if(input.type==='checkbox')input.checked=v.checked;}}}}if(recall&&$('recallAnswer'))$('recallAnswer').innerHTML=recall;}
}
function privateMessage(){return '<p>This information belongs in your own character thread.</p><p class="muted">Open the personal link supplied by your DM. The shared company view cannot read private inventories, purchases or rewards.</p>';}
function openPanel(name){drawer=name;$('drawer').hidden=false;$('drawerTitle').textContent={character:'Your character',inventory:'Your belongings',shop:'Trade & provisions',journal:'The company’s record',raphael:'Raphael',dm:'DM desk'}[name]||name;let html='';
 if(name==='character')html=data.personal?`<img class="portrait" src="${portrait(data.identity.actorId)}" alt="Your character"><h3>${e(data.party.find(p=>p.id===data.identity.actorId)?.name)}</h3>${health(data.personal)}<p>${data.personal.coins} gp carried</p><p class="muted">Personal equipment and rewards stay in this private view.</p>`:privateMessage();
 if(name==='inventory')html=data.personal?`<p>${data.personal.coins} gp · visible only to you and your DM</p><table><thead><tr><th>Item</th><th>Acquired from</th><th>Share</th></tr></thead><tbody>${data.personal.items.map(i=>`<tr><td>${e(i.name)}</td><td>${e(i.source)}</td><td><button data-share="${e(i.id)}">Show party</button></td></tr>`).join('')}</tbody></table>`:privateMessage();
 if(name==='shop')html=!data.personal?privateMessage():!data.shop?'<p>No shop is available at the company’s current location.</p><p>Return to an open merchant to browse their stock.</p>':`<h3>${e(data.shop.name)}</h3><p>You carry ${data.personal.coins} gp. Purchases go directly to your private inventory.</p><table><thead><tr><th>Goods</th><th>Price</th><th></th></tr></thead><tbody>${data.shop.stock.map(i=>`<tr><td>${e(i.name)}<br><small>${i.quantity} available</small></td><td>${i.price} gp</td><td><button data-buy="${e(i.id)}" ${i.quantity===0||i.price>data.personal.coins?'disabled':''}>Buy</button></td></tr>`).join('')}</tbody></table>`;
 if(name==='journal')html=[...data.state.history.map(x=>({text:x.summary,at:x.at})),...data.journal].sort((a,b)=>String(b.at).localeCompare(String(a.at))).map(x=>`<div class="journal-entry"><time>${e(new Date(x.at).toLocaleString())}</time><p>${e(x.text)}</p></div>`).join('')||'<p>The record is waiting for your first discovery.</p>';
 if(name==='raphael')html=`<img class="portrait" src="${portrait('raphael')}" alt="Raphael, your angelic traveling companion"><p>“Tell me what you wish to remember. I will look through the accounts available to you.”</p><form id="recallForm"><label for="recallQuery">A person, place, or recent event</label><input id="recallQuery" value="recent" maxlength="200"><button class="primary">Ask Raphael</button></form><div id="recallAnswer"></div>`;
 if(name==='dm')html=dmDesk();
 $('drawerBody').innerHTML=html;
 $('addOpponent')?.addEventListener('click',()=>{if($('opponentRows').childElementCount>=12)return notify('An encounter supports up to twelve opponents.',true);$('opponentRows').insertAdjacentHTML('beforeend',opponentRow());});
 $('opponentRows')?.addEventListener('click',event=>{if(event.target.closest('[data-remove-opponent]'))event.target.closest('[data-opponent]').remove();});
 $('encounterForm')?.addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form);const enemies=[...form.querySelectorAll('[data-opponent]')].map(row=>({name:row.querySelector('[name=enemyName]').value.trim(),art:row.querySelector('[name=enemyArt]').value,hp:Number(row.querySelector('[name=enemyHp]').value),maxHp:Number(row.querySelector('[name=enemyHp]').value),visible:row.querySelector('[name=enemyVisible]').checked,healthKnown:row.querySelector('[name=enemyHealth]').checked}));if(!enemies.length)return notify('Add at least one opponent before starting.',true);act({type:'encounter',roomId,terrain:fields.get('terrain'),surprise:fields.get('surprise'),enemies});});
 $('recallForm')?.addEventListener('submit',async event=>{event.preventDefault();try{const answer=await api('/api/recall?q='+encodeURIComponent($('recallQuery').value));$('recallAnswer').innerHTML=`<p>${e(answer.answer).replace(/\n/g,'<br>')}</p><details><summary>${answer.sources.length} recorded sources</summary>${answer.sources.map(s=>`<p>${e(s.text)}<br><small>${e(s.at)}</small></p>`).join('')}</details>`;}catch(err){notify(err.message,true);}});
 document.querySelectorAll('#drawerBody form[data-action]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const f=Object.fromEntries(new FormData(form));if(f.checkTotal!==undefined)f.checkTotal=Number(f.checkTotal);if(f.hp!==undefined)f.hp=Number(f.hp);if(f.maxHp!==undefined)f.maxHp=Number(f.maxHp);if(form.dataset.action==='setVitals'&&f.hp>f.maxHp)return notify('Current HP cannot exceed maximum HP.',true);act({type:form.dataset.action,...f});}));
}
function opponentRow(){return '<fieldset data-opponent><legend>Opponent</legend><label>Name<input name="enemyName" required maxlength="60"></label><label>Illustration<select name="enemyArt"><option value="sentinel">Bronze sentinel</option><option value="harbor-lookout">Harbor lookout</option></select></label><label>Starting HP<input name="enemyHp" type="number" min="1" max="10000" required></label><label><input name="enemyVisible" type="checkbox" checked> Visible to players</label><label><input name="enemyHealth" type="checkbox"> Reveal health to players</label><button type="button" data-remove-opponent>Remove opponent</button></fieldset>';}
function dmDesk(){if(data.identity.role!=='gm')return '';const prepared=data.preparation.catalog.rooms.find(r=>r.id===roomId);
 return `<p class="muted">${data.preview===false?'Your private preparation space. Changes here are recorded in this campaign.':'One preparation space. These controls affect only the isolated rehearsal.'}</p><h3>Private player entrances</h3>${data.preview===false?'<p>Players sign in with their own Discord accounts and use their assigned private threads.</p>':''}${(data.playerLinks??[]).map(p=>`<p><a href="${e(p.url)}" target="_blank" rel="noopener">Open ${e(data.party.find(x=>x.id===p.actorId)?.name)}’s private table</a></p>`).join('')}<hr><details><summary>Complete DM dungeon atlas</summary>${mapArt(atlasMap(data.preparation.catalog,data.preparation.state.party,{areaId:'undertow',iso:true,angle:30}),true)}${data.preparation.catalog.rooms.filter(r=>r.areaId==='undertow').map(r=>`<details><summary>${e(r.name)}</summary><img src="${data.preview===false?'/api/art/preparation/'+encodeURIComponent(r.id)+'.png':art(r.id)}" alt="${e(r.name)}" width="100%"><p>${e(r.gmNotes)}</p></details>`).join('')}</details><hr><h3>Resolve an investigation</h3><p>${e(prepared?.gmNotes||'')}</p><form data-action="discoverPoi"><input type="hidden" name="roomId" value="${e(roomId)}"><label>Point of interest<select name="poiId">${prepared.pois.map(p=>`<option value="${e(p.id)}">${e(p.name)} · ${e(p.skill)} DC ${p.dc}</option>`).join('')}</select></label><label>Player’s interaction<input name="interaction" required></label><label>Resolved total<input type="number" name="checkTotal" min="0" max="100" required></label><button>Record check result</button></form><h3>Reveal a learned location</h3><form data-action="revealRoom"><select name="roomId">${data.preparation.catalog.rooms.filter(r=>!data.state.roomIds[r.id]).map(r=>`<option value="${e(r.id)}">${e(r.name)}</option>`).join('')}</select><label>How it was learned<input name="reason" required></label><button>Reveal location</button></form><h3>Private reward</h3><form data-action="award"><select name="actorId">${data.party.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select><label>Item<input name="name" required maxlength="100"></label><label>Source<input name="source" required maxlength="100"></label><button>Award privately</button></form><h3>Encounter</h3><p class="muted">Set the opponents and resolve rolls as DM. Players see only opponents and health information you reveal.</p>${!data.encounter?`<form id="encounterForm"><label>Battlefield<select name="terrain"><option value="room">This room</option><option value="hallway">Straight connecting hallway</option></select></label><label>Opening situation<input name="surprise" maxlength="120" value="No surprise" required></label><div id="opponentRows">${opponentRow()}</div><button type="button" id="addOpponent">Add opponent</button><button type="submit">Begin encounter here</button></form>`:''}${data.preview===true?'<details><summary>Rehearsal fixture</summary><button id="beginCombat">Stage guardian encounter here</button> <button id="beginHallway">Stage straight hallway encounter</button></details>':''}${data.encounter?`<p>Round ${data.encounter.round}</p><button id="nextRound">Next round</button> <button id="endCombat">End encounter</button>${data.encounter.enemies.map(en=>`<p>${e(en.name)} · ${en.hp}/${en.maxHp} HP <span>${data.table.encounter.enemies.find(x=>x.id===en.id)?.visible?'Visible to players':'Hidden from players'}</span> <button data-visibility="${e(en.id)}">${data.table.encounter.enemies.find(x=>x.id===en.id)?.visible?'Hide opponent':'Reveal opponent'}</button> <button data-health="${e(en.id)}">${data.table.encounter.enemies.find(x=>x.id===en.id)?.healthKnown?'Conceal health':'Reveal health'}</button> <form data-action="enemy"><input type="hidden" name="enemyId" value="${e(en.id)}"><label>Current HP<input name="hp" type="number" min="0" max="${en.maxHp}" value="${en.hp}" required></label><button>Record HP</button></form></p>`).join('')}`:''}<h3>Company health</h3><p class="muted">Record the result of damage or healing. Current health is shown to the company; private belongings stay private.</p>${data.party.map(p=>`<details><summary>${e(p.name)} · ${Number.isFinite(p.hp)?p.hp:'?'} / ${Number.isFinite(p.maxHp)?p.maxHp:'?'} HP</summary><form id="vitals-${e(p.id)}" data-action="setVitals"><input type="hidden" name="actorId" value="${e(p.id)}"><label>Current HP<input type="number" name="hp" min="0" value="${Number.isFinite(p.hp)?p.hp:''}" required></label><label>Maximum HP<input type="number" name="maxHp" min="1" value="${Number.isFinite(p.maxHp)?p.maxHp:''}" required></label><button>Record health</button></form></details>`).join('')||'<p>No party members are enrolled yet.</p>'}<h3>Player requests</h3>${data.requests.map(r=>`<div class="request"><strong>${e(data.party.find(p=>p.id===r.actorId)?.name)}</strong><p>${e(r.text)}</p>${r.status==='pending'?`<form data-action="answer"><input type="hidden" name="requestId" value="${e(r.id)}"><label>Your ruling<input name="answer" required></label><button>Reply privately</button></form>`:`<p>${e(r.answer)}</p>`}</div>`).join('')||'<p>No pending requests.</p>'}<hr><button id="discordExport">Download player-safe Discord message</button><p class="muted">Components V2 message adapter. This download does not post to Discord or register a bot interaction handler.</p>`;
}
function selectRoom(id){if(!data.catalog.rooms.some(r=>r.id===id))return;roomId=id;areaId=current().areaId;view='scene';floor='all';render();}
$('area').addEventListener('change',()=>selectRoom(data.catalog.rooms.find(r=>r.areaId===$('area').value)?.id));$('floor').addEventListener('change',()=>{floor=$('floor').value;stage();});$('angle').addEventListener('input',stage);$('refresh').addEventListener('click',()=>refresh());$('closeDrawer').addEventListener('click',()=>{document.querySelector(`[data-panel="${drawer}"]`)?.focus();drawer=null;$('drawer').hidden=true;});
$('intentForm').addEventListener('submit',async event=>{event.preventDefault();const input=$('intent'),text=input.value;const recorded=await act({type:'request',text});if(recorded&&input.isConnected&&input.value===text)input.value='';});
$('travel').addEventListener('click',()=>data.identity.role==='gm'?act({type:'visitRoom',roomId}):act({type:'request',text:`I would like to travel to ${current().name}.`}));
function showNote(id,anchor){const p=current().pois.find(p=>p.id===id);if(!p||!data.state.poiIds[p.id])return;document.querySelector('.pin-note')?.remove();const n=document.createElement('div');n.className='pin-note';n.innerHTML=`<strong>${e(p.name)}</strong>${e(p.description)}`;n.style.left=Math.min(p.x*100,65)+'%';n.style.top=Math.min(p.y*100+5,65)+'%';$('stage').append(n);if(anchor?.classList.contains('note-pin'))anchor.setAttribute('aria-description',p.description);}
document.addEventListener('mouseover',ev=>{const b=ev.target.closest('.note-pin');if(b)showNote(b.dataset.note,b);});document.addEventListener('focusin',ev=>{const b=ev.target.closest('.note-pin');if(b)showNote(b.dataset.note,b);});$('stage').addEventListener('mouseleave',()=>document.querySelector('.pin-note')?.remove());
document.addEventListener('click',async ev=>{if(accessLocked)return;const b=ev.target.closest('button,[data-room],[data-place],[data-poi]');if(!b)return;
 if(b.dataset.room)return selectRoom(b.dataset.room);
 if(b.dataset.view){view=b.dataset.view;stage();document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(view===x.dataset.view)));return;}
 if(b.dataset.panel){if(['scene','atlas'].includes(b.dataset.panel)){drawer=null;$('drawer').hidden=true;view=b.dataset.panel==='scene'?'scene':'diagram';render();$('scene').scrollIntoView();}else{openPanel(b.dataset.panel);$('closeDrawer').focus();}return;}
 if(b.dataset.note)return showNote(b.dataset.note,b);
 if(b.dataset.poi){const p=current().pois.find(x=>x.id===b.dataset.poi);notify(p?.description||'Describe what you examine to your DM.');return;}
 if(b.dataset.place){const place=data.catalog.places.find(p=>p.id===b.dataset.place);if(place?.roomId)selectRoom(place.roomId);return;}
 if(b.dataset.buy)return act({type:'buy',itemId:b.dataset.buy});if(b.dataset.share)return act({type:'shareItem',itemId:b.dataset.share});
 if(b.id==='beginCombat'||b.id==='beginHallway')return act({type:'encounter',roomId,terrain:b.id==='beginHallway'?'hallway':'room',surprise:'Ambush rehearsal · surprise adjudicated by the DM',enemies:[{name:'Bronze sentinel',hp:32,maxHp:40,visible:true,healthKnown:false}]});
 if(b.id==='nextRound')return act({type:'round'});if(b.id==='endCombat')return act({type:'endEncounter'});if(b.dataset.health){const enemy=data.table?.encounter?.enemies.find(x=>x.id===b.dataset.health);if(enemy)return act({type:'enemy',enemyId:enemy.id,healthKnown:!enemy.healthKnown});}
 if(b.dataset.visibility){const enemy=data.table?.encounter?.enemies.find(x=>x.id===b.dataset.visibility);if(enemy)return act({type:'enemy',enemyId:enemy.id,visible:!enemy.visible});}
 
 if(b.id==='discordExport'){const payload=await api('/api/discord?room='+encodeURIComponent(roomId)),url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=roomId+'-discord.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('Discord message downloaded. Attach the scene image as scene.png when sending.');}
});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){$('drawer').hidden=true;drawer=null;document.querySelector('.pin-note')?.remove();}if(['Enter',' '].includes(ev.key)&&ev.target.matches('svg [tabindex]')){ev.preventDefault();ev.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
// The local DM studio receives only this projected scene brief. It never receives a player key.
let artStudioWindow=null,artPreviewRoom=null;
function syncArtTools(){
 const localGM=location.hostname==='127.0.0.1'&&data?.identity.role==='gm';
 if($('illustrateScene'))$('illustrateScene').hidden=!localGM;
 if($('artStudioLink'))$('artStudioLink').hidden=!localGM;
 if(artPreviewRoom&&(artPreviewRoom!==roomId||!$('stage').querySelector('img')?.getAttribute('src')?.startsWith('data:image/png;base64,'))){artPreviewRoom=null;$('restoreArt').hidden=true;$('artPreviewStatus').textContent='';}
}
$('illustrateScene')?.addEventListener('click',()=>{
 const room=current();if(!room||data?.identity.role!=='gm')return;
 const fragment=new URLSearchParams({tableOrigin:location.origin,contextId:room.id,title:room.name,prompt:[room.name,room.description,$('sceneLead').textContent].filter(Boolean).join('. ').slice(0,5000)});
 const frame=$('artStudioFrame');frame.src='http://127.0.0.1:51960/#'+fragment;artStudioWindow=frame.contentWindow;
 $('artStudioDialog').showModal();
});
$('closeArtStudio')?.addEventListener('click',()=>$('artStudioDialog').close());
$('artStudioDialog')?.addEventListener('close',()=>$('illustrateScene')?.focus());
window.addEventListener('message',event=>{
 if(event.origin!=='http://127.0.0.1:51960'||event.source!==artStudioWindow||data?.identity.role!=='gm')return;
 const result=event.data;
 if(result?.type!=='coast-studio-art'||result.contextId!==roomId||typeof result.imageData!=='string'||result.imageData.length>40*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.imageData))return;
 view='scene';render();const image=$('stage').querySelector('img');if(!image)return;
 image.src=result.imageData;image.alt=String(result.title||current().name).slice(0,100)+' — local artwork preview';
 $('artStudioDialog').close();artPreviewRoom=roomId;$('restoreArt').hidden=false;$('artPreviewStatus').textContent='Local artwork preview · not shared with players';
 notify('Your artwork is previewed here. Discoveries, geometry, and other viewers are unchanged.');
});
$('restoreArt')?.addEventListener('click',()=>{artPreviewRoom=null;stage();$('restoreArt').hidden=true;$('artPreviewStatus').textContent='';notify('Campaign artwork restored. Your generated image remains in the studio.');});
new MutationObserver(syncArtTools).observe($('title'),{childList:true});
await refresh();syncArtTools();setInterval(()=>{if(!document.hidden&&!busy)refresh(true);},3000);
