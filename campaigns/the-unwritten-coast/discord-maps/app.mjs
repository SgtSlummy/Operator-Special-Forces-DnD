import {AREAS,COLORS,initialState,layerFor,slicePosition,fromSlice,overviewPosition,movePlayer,changeView,transferPlayer,validateState} from './model.mjs';
const $=id=>document.getElementById(id);
const KEY='unwritten-coast-layered-atlas-v1';
let state=initialState();
let storageNotice='';
try {const saved=localStorage.getItem(KEY);if(saved) state=validateState(JSON.parse(saved));} catch {storageNotice='Saved positions could not be loaded. Preview markers are shown; load a positions file to recover.';}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{status('Browser storage is unavailable. Use Save positions file to keep these positions.',true);}}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function selected(){return state.players.find(p=>p.id===state.selected);}
function modeLabel(){return state.mode==='preview'?'PREVIEW POSITIONS':'MANUALLY ENTERED POSITIONS';}
function choose(player){state.selected=player.id;changeView(state,player.area,player.layer);$('placing').checked=false;render();persist();status(player.name+' · '+AREAS[player.area].name+' · '+layerFor(player.area,player.layer).name);}
function setImage(id,src,alt){const img=$(id);if(img.getAttribute('src')!==src){img.classList.add('loading');img.onload=()=>img.classList.remove('loading');img.onerror=()=>{img.classList.remove('loading');status('A map image could not load. Keep the artwork folder beside the campaign and reopen with Start-MapTable.ps1.',true);};img.src=src;}img.alt=alt;}
function renderMarkers(container,players,project,overview=false){
  container.replaceChildren();
  for(const player of players){
    const index=state.players.findIndex(p=>p.id===player.id)+1;
    const pos=project(player);
    const token=element('button',undefined,'token'+(state.selected===player.id?' selected':''));
    token.type='button';token.style.left=(pos.x*100)+'%';token.style.top=(pos.y*100)+'%';token.style.setProperty('--token',player.color);
    token.dataset.player=player.id;token.dataset.layer=player.layer;token.dataset.x=pos.x;token.dataset.y=pos.y;
    const floor=layerFor(player.area,player.layer);
    token.setAttribute('aria-label',player.name+' — '+floor.name+(overview?' — open this floor':''));
    token.title=player.name+' · '+floor.name+' · '+modeLabel();
    token.append(element('span',String(index),'coin'),element('span',player.name+(overview?' · '+floor.feet+' ft':''),'tag'));
    token.onclick=event=>{event.stopPropagation();choose(player);};container.append(token);
  }
}
function render(){
  const area=AREAS[state.area],layer=layerFor(state.area,state.layer),player=selected();
  $('areaSelect').value=state.area;$('areaTitle').textContent=area.name;$('areaEnvelope').textContent=area.envelope;
  $('modeBadge').textContent='GM table · '+(state.mode==='preview'?'Preview positions':'Manual positions');
  $('manual').checked=state.mode==='manual';$('grid').checked=state.grid;$('sliceGrid').classList.toggle('visible',state.grid);
  $('layers').replaceChildren();
  area.layers.forEach(floor=>{
    const count=state.players.filter(p=>p.area===state.area&&p.layer===floor.id).length;
    const btn=element('button',floor.name);btn.setAttribute('aria-pressed',String(floor.id===layer.id));
    btn.append(element('small',(floor.feet>0?'+':'')+floor.feet+' ft'+(count?' · '+count+' marker'+(count===1?'':'s'):'')));
    btn.onclick=()=>{changeView(state,state.area,floor.id);$('placing').checked=false;render();persist();status('Viewing '+floor.name+'. Party positions are unchanged.');};$('layers').append(btn);
  });
  $('floorNote').textContent=layer.note;$('sliceTitle').textContent=layer.name;$('elevation').textContent=(layer.feet>0?'+':'')+layer.feet+' ft · proposed level';
  setImage('overviewImage',area.overview,area.name+' 3D architectural cutaway with registered party markers');
  setImage('sliceImage',layer.image,area.name+' — '+layer.name+' architectural floor map');
  renderMarkers($('overviewMarkers'),state.players.filter(p=>p.area===state.area),overviewPosition,true);
  const onFloor=state.players.filter(p=>p.area===state.area&&p.layer===state.layer);
  renderMarkers($('sliceMarkers'),onFloor,slicePosition);
  $('sliceFoot').textContent=(onFloor.length?onFloor.length+' marker'+(onFloor.length===1?'':'s')+' on this floor.':'No party markers on this floor.')+' '+(state.grid?'Reference squares are image guides, not measured distances.':'Each number identifies the same person in both views.');
  $('sliceStage').classList.toggle('placing',$('placing').checked);
  const svg=$('overviewStage').querySelector('.registration');svg.replaceChildren();
  if(state.area==='beacon'){
    const y=(layer.overview[3]+layer.overview[2]/2)*1000;
    const ellipse=document.createElementNS('http://www.w3.org/2000/svg','ellipse');
    for(const [k,v] of Object.entries({cx:500,cy:y,rx:350,ry:layer.overview[2]*420,fill:'none',stroke:'#fff1b7','stroke-width':2,'stroke-dasharray':'7 5'}))ellipse.setAttribute(k,v);svg.append(ellipse);
  }
  $('roster').replaceChildren();
  state.players.forEach((p,index)=>{
    const btn=element('button');btn.setAttribute('aria-pressed',String(p.id===state.selected));btn.setAttribute('aria-label','Select '+p.name);
    const swatch=element('span',String(index+1),'swatch');swatch.style.background=p.color;
    const text=element('span',p.name);text.append(element('small',AREAS[p.area].name+' · '+layerFor(p.area,p.layer).name));btn.append(swatch,text);btn.onclick=()=>choose(p);$('roster').append(btn);
  });
  $('partySummary').textContent=state.players.length+' markers · '+(state.mode==='preview'?'illustrative starting positions':'entered by the table');
  $('playerName').value=player.name;$('playerColor').value=player.color;$('removePlayer').disabled=state.players.length<=1;$('addPlayer').disabled=state.players.length>=8;
  const elevations=AREAS[player.area].layers.map(l=>l.feet),height=layerFor(player.area,player.layer).feet;
  $('down').disabled=height===Math.min(...elevations);$('up').disabled=height===Math.max(...elevations);
  $('areaNote').textContent=area.note;
}
Object.values(AREAS).forEach(area=>{const opt=element('option',area.name);opt.value=area.id;$('areaSelect').append(opt);});
COLORS.forEach((color,i)=>{const opt=element('option',['Vermilion','Blue','Violet','Green','Ochre','Rose'][i]);opt.value=color;$('playerColor').append(opt);});
for(let n=50;n<1000;n+=50){for(const horizontal of [false,true]){const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',horizontal?0:n);line.setAttribute('x2',horizontal?1000:n);line.setAttribute('y1',horizontal?n:0);line.setAttribute('y2',horizontal?n:1000);$('sliceGrid').append(line);}}
$('areaSelect').onchange=()=>{changeView(state,$('areaSelect').value,AREAS[$('areaSelect').value].layers[0].id);$('placing').checked=false;render();persist();status('Area changed. Party markers retain their locations.');};
$('follow').onclick=()=>choose(selected());
$('grid').onchange=()=>{state.grid=$('grid').checked;render();persist();};
$('placing').onchange=()=>{render();status($('placing').checked?'Click the floor to place the selected marker. Use its landing button first if the marker is elsewhere.':'Marker placement is off.');};
function place(u,v){try{const p=selected();if(p.area!==state.area||p.layer!==state.layer)throw new Error('The selected marker is on another floor. Use Move to this floor’s landing first.');movePlayer(state,p.id,state.area,state.layer,u,v);render();persist();status(p.name+' moved. Both map views now show the same position.');}catch(e){status(e.message,true);}}
$('sliceStage').onclick=event=>{if(!$('placing').checked||event.target.closest('button'))return;const rect=$('sliceStage').getBoundingClientRect();const p=fromSlice(state.area,state.layer,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);place(p.u,p.v);};
$('sliceStage').onkeydown=event=>{if(!$('placing').checked||event.target!==$('sliceStage'))return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!moves[event.key])return;event.preventDefault();const p=selected(),step=event.shiftKey?.04:.01;place(p.u+moves[event.key][0]*step,p.v+moves[event.key][1]*step);};
$('moveHere').onclick=()=>{try{const p=selected(),layer=layerFor(state.area,state.layer);movePlayer(state,p.id,state.area,state.layer,...layer.entry);render();persist();status(p.name+' placed at the landing. Confirm movement with the table.');}catch(e){status(e.message,true);}};
for(const [id,direction]of[['down',-1],['up',1]])$(id).onclick=()=>{try{const p=transferPlayer(state,state.selected,direction);$('placing').checked=false;render();persist();status(p.name+' moved to '+layerFor(p.area,p.layer).name+' at the connecting landing.');}catch(e){status(e.message,true);}};
$('playerName').oninput=()=>{const value=$('playerName').value;if(!value.trim())return;selected().name=value;render();persist();};
$('playerName').onchange=()=>{const name=$('playerName').value.trim();if(!name){$('playerName').value=selected().name;status('Enter a marker name before saving it.',true);return;}selected().name=name;render();persist();status('Marker name updated in both views.');};
$('playerColor').onchange=()=>{selected().color=$('playerColor').value;render();persist();};
$('manual').onchange=()=>{state.mode=$('manual').checked?'manual':'preview';render();persist();status(state.mode==='manual'?'Manual positions are labeled. No automatic tracking is connected.':'Preview labels restored.');};
$('addPlayer').onclick=()=>{if(state.players.length>=8)return;const layer=layerFor(state.area,state.layer),p={id:'p'+Date.now().toString(36),name:'New marker',color:COLORS[state.players.length%COLORS.length],area:state.area,layer:state.layer,u:layer.entry[0],v:layer.entry[1]};state.players.push(p);state.selected=p.id;render();persist();$('playerName').focus();$('playerName').select();};
$('removePlayer').onclick=()=>{if(state.players.length<=1)return;const name=selected().name;state.players=state.players.filter(p=>p.id!==state.selected);state.selected=state.players[0].id;render();persist();status(name+' removed.');};
function download(blob,name){const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('saveState').onclick=()=>{download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'unwritten-coast-positions.json');status('Positions file downloaded.');};
$('loadState').onchange=async()=>{const input=$('loadState');try{const file=input.files[0];if(!file)return;if(file.size>64000)throw new Error('Positions files must be smaller than 64 KB.');const next=validateState(JSON.parse(await file.text()));state=next;$('placing').checked=false;render();persist();status('Saved positions loaded into both views.');}catch(e){status('Positions were not changed. '+e.message,true);}finally{input.value='';}};
$('reset').onclick=()=>{if(!confirm('Replace the current positions with the four preview markers? Save a positions file first if you want to keep them.'))return;state=initialState();$('placing').checked=false;render();persist();status('Preview markers restored.');};
async function imageReady(img){if(img.complete&&img.naturalWidth)return;await img.decode();if(!img.naturalWidth)throw new Error('The map image has not loaded.');}
function fitImage(ctx,img,box){const scale=Math.min(box.w/img.naturalWidth,box.h/img.naturalHeight);const w=img.naturalWidth*scale,h=img.naturalHeight*scale,x=box.x+(box.w-w)/2,y=box.y+(box.h-h)/2;ctx.drawImage(img,x,y,w,h);return{x,y,w,h};}
function drawTokens(ctx,players,project,box,overview){for(const p of players){const pos=project(p),x=box.x+pos.x*box.w,y=box.y+pos.y*box.h;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff8df';ctx.lineWidth=3;ctx.stroke();ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText(String(state.players.findIndex(v=>v.id===p.id)+1),x,y);if(p.id!==state.selected)continue;const name=p.name+(overview?' · '+layerFor(p.area,p.layer).feet+' ft':'');ctx.font='16px sans-serif';const labelWidth=ctx.measureText(name).width+14;const lx=Math.max(box.x,Math.min(x-labelWidth/2,box.x+box.w-labelWidth));const ly=Math.min(y+22,box.y+box.h-27);ctx.fillStyle='#183638';ctx.fillRect(lx,ly,labelWidth,26);ctx.fillStyle='white';ctx.textAlign='left';ctx.fillText(name,lx+7,ly+13);}}
async function exportMap(paired){
  const buttons=[$('exportSlice'),$('exportPair')];buttons.forEach(b=>b.disabled=true);
  try{
    const overview=$('overviewImage'),slice=$('sliceImage');await Promise.all([imageReady(slice),...(paired?[imageReady(overview)]:[])]);
    const canvas=document.createElement('canvas');canvas.width=paired?2200:1500;canvas.height=1450;const ctx=canvas.getContext('2d');ctx.fillStyle='#f4efe5';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#233c3d';ctx.font='40px Georgia';ctx.fillText(AREAS[state.area].name+' — '+layerFor(state.area,state.layer).name,40,62);
    ctx.font='20px sans-serif';ctx.fillText('THE UNWRITTEN COAST · '+modeLabel()+' · GM MAP',40,104);
    ctx.font='19px sans-serif';ctx.fillText(paired?'Overview includes other floors. Reveal only discovered areas.':'Current architectural slice · proposed layout',40,136);
    if(paired){const box=fitImage(ctx,overview,{x:35,y:180,w:690,h:1070});drawTokens(ctx,state.players.filter(p=>p.area===state.area),overviewPosition,box,true);}
    const box=fitImage(ctx,slice,{x:paired?760:35,y:180,w:paired?1400:1430,h:1070});drawTokens(ctx,state.players.filter(p=>p.area===state.area&&p.layer===state.layer),slicePosition,box,false);
    ctx.fillStyle='#233c3d';ctx.textAlign='left';ctx.font='20px sans-serif';ctx.fillText('Marker key',40,1300);
    state.players.filter(p=>p.area===state.area).forEach((p,i)=>{const column=i%2,row=Math.floor(i/2);ctx.fillText((state.players.findIndex(v=>v.id===p.id)+1)+'. '+p.name+' — '+layerFor(p.area,p.layer).name,40+column*(canvas.width/2),1333+row*27);});
    ctx.font='16px sans-serif';ctx.fillText('Manual map positions. Art registration is approximate. Reference grids and movement rules are not a surveyed scale.',40,1432);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Image export failed.');download(blob,state.area+'-'+state.layer+(paired?'-paired':'-slice')+'.png');status('Map PNG downloaded with '+modeLabel().toLowerCase()+'. Review discoveries before posting it.');
  }catch(e){status('Could not export this map. '+e.message,true);}finally{buttons.forEach(b=>b.disabled=false);}
}
$('exportSlice').onclick=()=>exportMap(false);$('exportPair').onclick=()=>exportMap(true);
render();status(storageNotice||'Choose a floor to explore. Preview markers are ready to rename and move.',Boolean(storageNotice));
