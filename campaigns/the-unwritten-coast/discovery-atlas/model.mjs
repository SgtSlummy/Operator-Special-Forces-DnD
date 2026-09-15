import { randomInt } from 'node:crypto';
import caretakerGeometry from './art/architecture/r05-projection.json' with { type: 'json' };
// Use the same measured footprint as the architectural map, without exposing its features.
function onRoomFloor(room,x,y) {
 const geometry=room.id===caretakerGeometry.roomId?caretakerGeometry:null;
 const polygon=room.floorPolygonFeet??geometry?.floorPolygonFeet;
 if(!polygon)return true;
 if(geometry)requireThat(room.width===geometry.dimensionsFeet.width&&room.depth===geometry.dimensionsFeet.depth,'Room floor geometry does not match its dimensions.');
 requireThat(Array.isArray(polygon)&&polygon.length>=3&&polygon.length<=64&&polygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=room.width&&p[1]>=0&&p[1]<=room.depth),'Invalid room floor geometry.');
 const px=x*room.width,py=y*room.depth;let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [ax,ay]=polygon[j],[bx,by]=polygon[i];
  const cross=(px-ax)*(by-ay)-(py-ay)*(bx-ax);
  if(Math.abs(cross)<1e-9&&px>=Math.min(ax,bx)&&px<=Math.max(ax,bx)&&py>=Math.min(ay,by)&&py<=Math.max(ay,by))return true;
  if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}
export function positionOnFloor(room,{x,y}) {
 requireThat(Number.isFinite(x)&&Number.isFinite(y),'Invalid arrival position.');
 x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
 if(onRoomFloor(room,x,y))return {x,y};
 const polygon=room.floorPolygonFeet??caretakerGeometry.floorPolygonFeet;
 const px=x*room.width,py=y*room.depth;let best=null,distance=Infinity;
 for(let i=0;i<polygon.length;i++){
  const [ax,ay]=polygon[i],[bx,by]=polygon[(i+1)%polygon.length],dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
  for(const [cx,cy] of [[ax+t*dx,ay+t*dy],[ax,ay]]){
   const candidate={x:cx/room.width,y:cy/room.depth},d=(cx-px)**2+(cy-py)**2;
   if(d<distance&&onRoomFloor(room,candidate.x,candidate.y)){best=candidate;distance=d;}
  }
 }
 requireThat(best,'No valid room arrival position.');return best;
}
const copy = value => structuredClone(value);
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const record = (source, visited=false) => ({ learned:true, visited, source, at:new Date().toISOString() });
const find = (items,id) => items.find(item=>item.id===id);
export function initialState(catalog) {
 const entry=catalog.rooms.find(r=>r.entry)||catalog.rooms[0];
 const start=catalog.places.find(p=>p.knownAtStart);
 return {version:1,revision:0,currentRoomId:entry?.id||null,currentPlaceId:start?.id||null,roomIds:entry?{[entry.id]:record('session start',true)}:{},poiIds:{},placeIds:start?{[start.id]:record('session start',true)}:{},roadIds:{},party:copy(catalog.party||[]).map(p=>({...p,roomId:entry?.id,x:Math.min(1,Math.max(0,p.x||0)),y:Math.min(1,Math.max(0,p.y||0))})),history:[]};
}
export function encounterChance(base,unknown) { requireThat(Number.isFinite(base)&&base>=0&&base<=100,'Base chance must be 0–100.');return Math.min(100,base*(unknown?2:1)); }
export function encounterCheck(base,unknown,roll) { requireThat(Number.isInteger(roll)&&roll>=1&&roll<=100,'Roll must be 1–100.');const chance=encounterChance(base,unknown);return {baseChance:base,unknown:Boolean(unknown),multiplier:unknown?2:1,chance,roll,encounter:roll<=chance}; }
export function applyAction(catalog,state,action) {
 requireThat(action&&typeof action==='object'&&!Array.isArray(action),'Action required.');
 const next=copy(state),at=new Date().toISOString();let summary='',privateDetails={};
 const room=id=>{const r=find(catalog.rooms,id);requireThat(r,'Unknown room.');return r;};
 const adjacent=(from,to)=>from===to||catalog.links.some(l=>(l.from===from&&l.to===to||l.to===from&&l.from===to)&&(!l.hidden||Boolean(next.roomIds[from]&&next.roomIds[to])));
 const reveal=(id,source,visited=false)=>{room(id);next.roomIds[id]={...record(source,visited),visited:visited||Boolean(next.roomIds[id]?.visited)};};
 switch(action.type) {
 case 'visitRoom': {const r=room(action.roomId);requireThat(adjacent(next.currentRoomId,r.id)||(action.override===true&&typeof action.reason==='string'&&action.reason.trim()),'Room must be reachable; GM override requires a reason.');reveal(r.id,action.override?'GM override':'entered from adjacent room',true);next.currentRoomId=r.id;summary=`Entered ${r.name}.`;break;}
 case 'revealRoom': {const r=room(action.roomId);requireThat(typeof action.reason==='string'&&action.reason.trim(),'GM revelation requires a reason.');reveal(r.id,'GM revelation');summary=`Discovered ${r.name}.`;privateDetails.reason=action.reason;break;}
 case 'learnPlace': {const p=find(catalog.places,action.placeId);requireThat(p,'Unknown place.');requireThat(typeof action.reason==='string'&&action.reason.trim(),'Learning a place requires a reason.');next.placeIds[p.id]=record('GM information',Boolean(next.placeIds[p.id]?.visited));summary=`Learned of ${p.name}.`;privateDetails.reason=action.reason;break;}
 case 'discoverPoi': {const r=room(action.roomId);requireThat(next.roomIds[r.id],'Room is unseen.');const p=find(r.pois||[],action.poiId);requireThat(p,'Unknown point of interest.');requireThat(typeof action.interaction==='string'&&action.interaction.trim(),'Describe the interaction.');requireThat(Number.isFinite(action.checkTotal),'Enter the resolved check total.');const success=action.checkTotal>=(p.dc??0);privateDetails={poiId:p.id,interaction:action.interaction,checkTotal:action.checkTotal,dc:p.dc,success};if(success){next.poiIds[p.id]=record('successful interaction');if(p.revealsRoomId)reveal(p.revealsRoomId,'successful discovery');summary=`Discovered ${p.name}. ${p.result||p.interaction||p.description||''}`;}else summary=`An investigation in ${r.name} found nothing new.`;break;}
 case 'moveMarker': {const p=find(next.party,action.markerId),r=room(action.roomId);requireThat(p,'Unknown party marker.');requireThat(next.roomIds[r.id]&&adjacent(p.roomId,r.id),'Marker destination must be exposed and adjacent.');requireThat(Number.isFinite(action.x)&&Number.isFinite(action.y)&&action.x>=0&&action.y>=0&&action.x<=1&&action.y<=1,'Marker is outside room bounds.');requireThat(onRoomFloor(r,action.x,action.y),'Marker is outside the room floor.');Object.assign(p,{roomId:r.id,x:action.x,y:action.y});summary=`${p.name} moved within ${r.name}.`;break;}
 case 'learnRoad': {const road=find(catalog.roads,action.roadId);requireThat(road,'Unknown road.');requireThat(typeof action.reason==='string'&&action.reason.trim(),'Learning a road requires a reason.');for(const id of [road.from,road.to]){const p=find(catalog.places,id);requireThat(p,'Road has no destination.');next.placeIds[id]=record('learned route',Boolean(next.placeIds[id]?.visited));}next.roadIds[road.id]=record('learned route',Boolean(next.roadIds[road.id]?.visited));summary='Learned a route between '+find(catalog.places,road.from).name+' and '+find(catalog.places,road.to).name+'.';privateDetails.reason=action.reason;break;}
 case 'travelRoad': {const road=find(catalog.roads,action.roadId);requireThat(road,'Unknown road.');requireThat(road.from===next.currentPlaceId||road.to===next.currentPlaceId,'Road must begin at the current place.');const dest=find(catalog.places,road.from===next.currentPlaceId?road.to:road.from);requireThat(dest,'Road has no destination.');const unknown=!next.roadIds[road.id];const result=encounterCheck(action.baseChance??15,unknown,randomInt(1,101));next.roadIds[road.id]=record('traveled',true);next.placeIds[dest.id]=record('visited',true);next.currentPlaceId=dest.id;if(dest.roomId){reveal(dest.roomId,'arrived by road',true);next.currentRoomId=dest.roomId;}summary=`Traveled to ${dest.name}. Encounter check: ${result.roll} against ${result.chance}% — ${result.encounter?'encounter':'clear'}.`;privateDetails=result;break;}
 default:throw new Error('Unknown action.');
 }
 next.revision++;next.history.push({id:next.revision,at,type:action.type,summary,gm:privateDetails});next.history=next.history.slice(-200);return next;
}
export function project(catalog,state,audience='player') {
 if(audience==='gm')return {audience:'gm',catalog:copy(catalog),state:copy(state)};
 const rooms=catalog.rooms.filter(r=>state.roomIds[r.id]).map(r=>({id:r.id,name:r.name,areaId:r.areaId,floor:r.floor,kind:r.kind,x:r.x,y:r.y,z:r.z,width:r.width,depth:r.depth,height:r.height,...(r.floorPlan?{floorPlan:{width:r.floorPlan.width,depth:r.floorPlan.depth,polygonFeet:r.floorPlan.polygonFeet.map(([x,y])=>[x,y])}}:{}),flavor:r.flavor,description:r.description,visibleFeatures:copy(r.visibleFeatures||[]),...(r.publicArtKey?{publicArtKey:r.publicArtKey}:{}),pois:(r.pois||[]).filter(p=>!p.hidden||state.poiIds[p.id]).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,description:state.poiIds[p.id]?(p.result||p.interaction||p.description||''):('You notice '+p.name+'.'),interaction:(state.poiIds[p.id]&&p.publicInteraction)||('Describe how you examine '+p.name+'.')}))}));
 const exposed=new Set(rooms.map(r=>r.id));const known=new Set(Object.keys(state.placeIds));
 const links=catalog.links.filter(l=>exposed.has(l.from)&&exposed.has(l.to)).map(l=>({id:l.id,from:l.from,to:l.to,kind:l.kind,description:l.description}));
 const places=catalog.places.filter(p=>known.has(p.id)).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,description:p.description,...(exposed.has(p.roomId)?{roomId:p.roomId}:{})}));
 const roads=catalog.roads.filter(r=>state.roadIds[r.id]&&known.has(r.from)&&known.has(r.to)).map(r=>({id:r.id,from:r.from,to:r.to,description:r.description}));
 const publicRecords=(ids,records)=>Object.fromEntries(ids.filter(id=>records[id]).map(id=>[id,{learned:Boolean(records[id].learned),visited:Boolean(records[id].visited),source:records[id].source,at:records[id].at}]));
 const safeState={version:state.version,revision:state.revision,currentRoomId:exposed.has(state.currentRoomId)?state.currentRoomId:null,currentPlaceId:known.has(state.currentPlaceId)?state.currentPlaceId:null,roomIds:publicRecords(rooms.map(r=>r.id),state.roomIds),poiIds:publicRecords(rooms.flatMap(r=>r.pois.map(p=>p.id)),state.poiIds),placeIds:publicRecords(places.map(p=>p.id),state.placeIds),roadIds:publicRecords(roads.map(r=>r.id),state.roadIds),party:state.party.filter(p=>exposed.has(p.roomId)).map(p=>({id:p.id,name:p.name,color:p.color,roomId:p.roomId,x:p.x,y:p.y})),history:state.history.map(e=>({id:e.id,at:e.at,type:e.type,summary:e.summary}))};
 return {audience:'player',catalog:{version:catalog.version,title:catalog.title,rooms,areas:catalog.areas.filter(a=>rooms.some(r=>r.areaId===a.id)).map(a=>({id:a.id,name:a.name,kind:a.kind,description:a.description})),links,places,roads,party:safeState.party},state:safeState};
}
export function discordPayload(catalog,state,roomId) {
 const snapshot=project(catalog,state),r=find(snapshot.catalog.rooms,roomId);requireThat(r,'Room is not publicly discovered.');
 return {allowed_mentions:{parse:[],users:[],roles:[],replied_user:false},attachments:[{id:0,filename:r.id+'-scene.png',description:'Discovered surroundings of '+r.name}],embeds:[{title:r.name,image:{url:'attachment://'+r.id+'-scene.png'},description:(r.flavor||r.description||'').slice(0,350),fields:[{name:'Visible surroundings',value:(r.visibleFeatures.join('\n')||r.description||'Nothing else is apparent.').slice(0,1024)},{name:'Points of interest',value:(r.pois.map(p=>`${p.name}: ${p.description}`).join('\n')||'No discoveries yet.').slice(0,1024)},{name:'Next decision',value:'Choose where to move, what to examine, or who to speak with.'}]}]};
}
