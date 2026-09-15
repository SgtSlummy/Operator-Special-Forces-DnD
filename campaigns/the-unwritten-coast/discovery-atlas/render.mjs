export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,n(v)));
const poly=(p,fill,stroke='#607773',extra='')=>`<polygon points="${p.map(a=>a.map(v=>n(v).toFixed(2)).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.3" ${extra}/>`;
const line=(a,b,color='#afc2b5',width=2,extra='')=>`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const text=(x,y,t,size=14,color='#e8e1cc',extra='')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Segoe UI, sans-serif" font-size="${size}" ${extra}>${esc(t)}</text>`;
const colors={dock:'#647c75',hold:'#8e7854',archive:'#6d7986',workshop:'#7c8771',chapel:'#9a9180',cavern:'#637a78',garden:'#719473',tavern:'#9a7652',home:'#8d9075',beacon:'#6d9192',market:'#a18a5c'};
const tint=r=>colors[r.kind]||'#7b8c82';
function frame(body,label,viewBox='0 0 1000 650'){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${esc(label)}"><rect x="-20000" y="-20000" width="40000" height="40000" fill="#182b30"/>${body}</svg>`;}
function token(p,x,y,i,size=14){if(p.atlasPortrait&&['mara','ivo','sable','tern'].includes(p.id)){const s=Math.max(15,size),top=y-s*2.7;return `<g aria-label="${esc(p.name)}" data-party-marker="${esc(p.id)}"><path d="M${x-s-2} ${top-2}H${x+s+2}V${y-9}L${x} ${y}L${x-s-2} ${y-9}Z" fill="#183335" stroke="#ead4a0" stroke-width="1.5"/><image href="/art/table/${p.id}.png" x="${x-s}" y="${top}" width="${s*2}" height="${s*2}" preserveAspectRatio="xMidYMid slice"/><title>${esc(p.name)} · party position</title></g>`;}return `<g aria-label="${esc(p.name)}"><circle cx="${x}" cy="${y}" r="${size+2}" fill="#fff5d9"/><circle cx="${x}" cy="${y}" r="${size}" fill="${esc(/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#255f63')}"/>${text(x,y+4,i+1,12,'white','text-anchor="middle" font-weight="700"')}<title>${esc(p.name)}</title></g>`;}
function poi(p,x,y,i){return `<g data-poi="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}"><circle cx="${x}" cy="${y}" r="11" fill="${p.hidden?'#574633':'#ebd9a7'}" stroke="#fff5d9" stroke-dasharray="${p.hidden?'3 2':'0'}"/>${text(x,y+4,i+1,11,p.hidden?'#fff5d9':'#182b30','text-anchor="middle" font-weight="700"')}<title>${esc(p.name)}</title></g>`;}
function symbol(kind,x,y,s=25,color='#eee2bc'){
 const common=`fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
 const shapes={archive:'<path d="M-18 14V-15H18V14M-18 0H18M-10-11V-3M-3-11V-3M5-11V-3M12-11V-3M-10 4V11M-3 4V11M5 4V11M12 4V11"/>',workshop:'<path d="M-20 7H20M-15 7V17M15 7V17M-12-10L6 8M-14-7L-9-12M4-13L14-3M12-12L-10 10"/>',chapel:'<path d="M-20 16L-14-10L0-20L14-10L20 16ZM0-12V10M-6-5H6"/>',beacon:'<path d="M-10 17L-7-12H7L10 17ZM-12-12H12V-18H-12ZM-21-15H-16M16-15H21M-4-23V-28M4-23V-28"/>',cavern:'<path d="M-22 15L-15-9L-5-18L7-12L19 0L24 15ZM-10 15Q-9-11 5-1L11 15"/>',garden:'<path d="M0 17V-10M0 0Q-22 0-17-15Q0-17 0 0M0 8Q22 5 17-9Q0-11 0 8M-10 19H10"/>',dock:'<path d="M-22 3H22L14 16H-14ZM0 3V-22L16-5H0M-20 22Q-12 17-4 22Q4 27 12 22Q17 19 23 22"/>',hold:'<path d="M-20-13H20V16H-20ZM-20-13L20 16M20-13L-20 16M-20 0H20"/>',tavern:'<path d="M-13-15H10V15H-13ZM10-10H18Q24 0 18 8H10M-9-9V10M-4-9V10M1-9V10"/>',home:'<path d="M-21-2L0-20L21-2M-16-5V18H16V-5M-4 18V3H5V18M-11 0H-7V5H-11"/>',market:'<path d="M-22-4L-16-17H16L22-4ZM-18-4V17H18V-4M-18 7H18M-8-17V-4M4-17V-4"/>'};
 return `<g transform="translate(${x} ${y}) scale(${s/25})" ${common}>${shapes[kind]||shapes.workshop}</g>`;
}
function objectGlyph(p,x,y,size=26){
 const name=String(p.name||'').toLowerCase();
 const shapes=[[/rope|mooring|coil/,'<ellipse rx="22" ry="14"/><ellipse rx="16" ry="10"/><ellipse rx="10" ry="6"/><path d="M22 0Q29 10 16 21L5 24"/>'],[/pump|gauge|valve|pipe/,'<path d="M-22 4H-7V-14H7V4H22V14H-22Z"/><circle cy="-10" r="9"/><path d="M0-10L5-15M-13-23H13M0-23V-18"/>'],[/piano|organ/,'<path d="M-22 17V-14Q-8-25 7-14L22 0V17Z"/><path d="M-22 5H22M-16 5V17M-10 5V17M-4 5V17M2 5V17M8 5V17M14 5V17"/>'],[/panel|inspection/,'<rect x="-20" y="-16" width="40" height="32" rx="2"/><circle cx="-14" cy="-10" r="1"/><circle cx="14" cy="-10" r="1"/><circle cx="-14" cy="10" r="1"/><circle cx="14" cy="10" r="1"/><path d="M-5 0H5"/>'],[/rail|gangplank/,'<path d="M-24-11H24V11H-24ZM-18-11V11M-10-11V11M-2-11V11M6-11V11M14-11V11M22-11V11"/>'],[/vane|counterweight/,'<path d="M0-24V23M-21-9H21L14-16M21-9L14-2M-11 23H11"/><rect x="-8" y="4" width="16" height="13"/>'],[/book|ledger|shelf|shelving|record|archive|journal/, '<rect x="-18" y="-13" width="36" height="26" rx="2"/><path d="M0-13V13M-13-7H-4M4-7H13M-13 0H-4M4 0H13M-13 7H-4M4 7H13"/>'],[/bed|cot|bunk/,'<rect x="-17" y="-21" width="34" height="42" rx="3"/><rect x="-12" y="-16" width="24" height="10" rx="2"/><path d="M-17-1H17"/>'],[/table|desk|bench|counter/,'<rect x="-23" y="-13" width="46" height="26" rx="2"/><path d="M-18-18V-13M18-18V-13M-18 13V18M18 13V18"/>'],[/barrel|cask|vat|well|basin/,'<circle r="18"/><ellipse rx="11" ry="18"/><path d="M-15-9H15M-15 9H15"/>'],[/chest|crate|box|trunk/,'<rect x="-19" y="-14" width="38" height="28"/><path d="M-19-6H19M-10-14V14M10-14V14"/><rect x="-3" y="-3" width="6" height="7"/>'],[/stair|ladder|steps/,'<path d="M-18-22V22H18V-22ZM-18-15H18M-18-8H18M-18-1H18M-18 6H18M-18 13H18"/>'],[/door|hatch|gate/,'<rect x="-20" y="-17" width="40" height="34"/><path d="M-20 17L8-11M8-11A40 40 0 0 1 20 17"/>'],[/fire|hearth|forge|stove/,'<rect x="-21" y="-19" width="42" height="38"/><path d="M-13 13Q-20 0-5-12Q-7 0 1-4Q0-15 10-16Q6-4 15 1Q20 13 9 14ZM-19 19H19"/>'],[/altar|shrine|statue|plinth/,'<rect x="-19" y="-16" width="38" height="32"/><rect x="-13" y="-10" width="26" height="20"/><circle r="5"/>'],[/pool|water|spring/,'<ellipse rx="23" ry="16"/><path d="M-14-5Q-7-10 0-5T14-5M-14 4Q-7-1 0 4T14 4"/>']];
 const shape=shapes.find(([re])=>re.test(name))?.[1]||'<path d="M0-18L18 0L0 18L-18 0Z"/><circle r="6"/>';
 return `<g transform="translate(${x} ${y}) scale(${size/25})" fill="#4a5146" stroke="#e1cea4" stroke-width="1.5" stroke-linejoin="round">${shape}</g>`;
}
export function roomMap(room,party=[],options={}){
 const width=Math.max(5,n(room.width)),depth=Math.max(5,n(room.depth)),scale=Math.min(820/width,450/depth),w=width*scale,h=depth*scale,ox=(1000-w)/2,oy=(650-h)/2;
 let body='';
 const plan=room.floorPlan,shaped=plan?.width===width&&plan?.depth===depth;
 if(shaped&&(!Array.isArray(plan.polygonFeet)||plan.polygonFeet.length<3||plan.polygonFeet.length>64||plan.polygonFeet.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[0]>width||p[1]<0||p[1]>depth)))throw Error('Invalid measured floor polygon.');
 const corners=shaped?plan.polygonFeet.map(([x,y])=>[ox+x*scale,oy+y*scale]):[[ox,oy],[ox+w,oy],[ox+w,oy+h],[ox,oy+h]];
 const floorPoints=corners.map(p=>p.join(',')).join(' ');
 if(shaped)body+=`<defs><clipPath id="tactical-floor"><polygon points="${floorPoints}"/></clipPath></defs><g clip-path="url(#tactical-floor)">`;
 const features=(room.visibleFeatures||[]).join(' ').toLowerCase();
 const wood=/plank|timber|wood|gangplank/.test(features)||['dock','tavern','home','hold'].includes(room.kind);
 const floorColor=wood?'#77644b':tint(room);
 body+=poly(corners,floorColor,'#d5cbaa');
 // Finish lines are schematic textures; the overlaid five-foot grid remains measured.
 const course=Math.max(8,Math.min(18,scale*1.5));
 for(let yy=0,row=0;yy<h;yy+=course,row++){
  body+=line([ox,oy+yy],[ox+w,oy+yy],wood?'#b09870':'#a9b5a0',.65,'opacity=".28"');
  const block=course*(wood?8:2),offset=(row%2)*block/2;
  for(let xx=offset;xx<w;xx+=block)body+=line([ox+xx,oy+yy],[ox+xx,oy+Math.min(h,yy+course)],wood?'#b09870':'#a9b5a0',.65,'opacity=".24"');
 }
 body+=`<rect x="${ox-8}" y="${oy-8}" width="${w+16}" height="${h+16}" fill="none" stroke="#7e897f" stroke-width="12"/><rect x="${ox-14}" y="${oy-14}" width="${w+28}" height="${h+28}" fill="none" stroke="#d2c8aa" stroke-width="1.5"/><rect x="${ox-2}" y="${oy-2}" width="${w+4}" height="${h+4}" fill="none" stroke="#e5d7b1" stroke-width="1.5"/>`;
 for(let xx=0;xx<=w;xx+=Math.max(12,scale*2)){body+=line([ox+xx,oy-13],[ox+xx,oy-3],'#293c3b',1);body+=line([ox+xx,oy+h+3],[ox+xx,oy+h+13],'#293c3b',1);}
 for(let yy=0;yy<=h;yy+=Math.max(12,scale*2)){body+=line([ox-13,oy+yy],[ox-3,oy+yy],'#293c3b',1);body+=line([ox+w+3,oy+yy],[ox+w+13,oy+yy],'#293c3b',1);}
 body+=text(970,60,wood?'TIMBER FLOOR':'STONE / EARTH FLOOR',10,'#aebfaf','text-anchor="end" letter-spacing="2"');
 if(options.grid!==false){const step=5*scale; if(w/step+h/step<1000){for(let x=step;x<w-.1;x+=step)body+=line([ox+x,oy],[ox+x,oy+h],'#172f35',.65,'opacity=".55"');for(let y=step;y<h-.1;y+=step)body+=line([ox,oy+y],[ox+w,oy+y],'#172f35',.65,'opacity=".55"');}}
 if(shaped)body+=`</g><polygon points="${floorPoints}" fill="none" stroke="#d2c8aa" stroke-width="8" stroke-linejoin="round"/>`;
 // Door position is only shown when a projected doorway supplies coordinates.
 for(const p of room.pois||[]){if(!/door|gate|hatch/i.test(p.name||''))continue;const dx=ox+clamp(p.x,0,1)*w,dy=oy+clamp(p.y,0,1)*h,ds=Math.min(5*scale,38);body+=`<path d="M${dx} ${dy}v-${ds}M${dx} ${dy-ds}A${ds} ${ds} 0 0 1 ${dx+ds} ${dy}" fill="none" stroke="#f2d7a0" stroke-width="1.6"/>`;}
 body+=text(30,35,`${room.name} · ${width} × ${depth} ft`,20,'#eee4cb');
 body+=text(30,60,options.grid===false?'Architectural plan · grid hidden':shaped?'5-foot squares · south at top':'5-foot squares · north at top',13,'#bfcec5');
 // Important objects are drawn exclusively from this already-authorized room projection.
 (room.pois||[]).forEach((p,i)=>{const x=ox+clamp(p.x,0,1)*w,y=oy+clamp(p.y,0,1)*h;body+=objectGlyph(p,x,y,Math.min(28,Math.max(16,scale*2.5)));body+=poi(p,x,y,i);body+=text(x,y+39,p.name,11,'#fff0ca','text-anchor="middle" paint-order="stroke" stroke="#263938" stroke-width="3"');});
 party.forEach((p,i)=>{if(p.roomId===room.id)body+=token(p,ox+clamp(p.x,0,1)*w,oy+clamp(p.y,0,1)*h,i);});
 const bar=Math.min(width,20)*scale;body+=line([ox,oy+h+32],[ox+bar,oy+h+32],'#f2e4bd',3);body+=text(ox+bar/2,oy+h+52,`${Math.min(width,20)} ft`,12,'#e7dbc0','text-anchor="middle"');
 body+=text(970,620,shaped?'N ↓':'N ↑',16,'#dfd8bf','text-anchor="end"');return frame(body,`${room.name}, measured tactical floor map`);
}
export function roomScene(room,party=[]){
 // A precise cutaway diagram is available alongside the separately authored scene artwork.
 return atlasMap({rooms:[{...room,x:0,y:0,z:0}],links:[]},party,{areaId:room.areaId,iso:true,angle:45,roomOnly:true});
}
export function atlasMap(catalog,party=[],options={}){
 let rooms=(catalog.rooms||[]).filter(r=>!options.areaId||r.areaId===options.areaId);
 if(options.floor!=null&&options.floor!=='all')rooms=rooms.filter(r=>String(r.floor)===String(options.floor));
 if(!rooms.length)return frame(text(500,325,'This part of the atlas is still unwritten.',23,'#e9dfc5','text-anchor="middle"'),'No discovered rooms');
 const iso=options.iso!==false,angle=n(options.angle??45)*Math.PI/180;
 const raw=(x,y,z=0)=>iso?[(x*Math.cos(angle)-y*Math.sin(angle)),(x*Math.sin(angle)+y*Math.cos(angle))*.5-z*.65]:[x,y];
 const points=rooms.flatMap(r=>[[r.x,r.y],[n(r.x)+n(r.width),r.y],[n(r.x)+n(r.width),n(r.y)+n(r.depth)],[r.x,n(r.y)+n(r.depth)]].map(p=>raw(n(p[0]),n(p[1]),n(r.z))));
 const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1]))-30,maxY=Math.max(...points.map(p=>p[1]))+30;
 const scale=Math.min(870/Math.max(20,maxX-minX),480/Math.max(20,maxY-minY));
 const P=(x,y,z=0)=>{const a=raw(n(x),n(y),n(z));return[500+(a[0]-(minX+maxX)/2)*scale,325+(a[1]-(minY+maxY)/2)*scale]};
 const R=new Map(rooms.map(r=>[r.id,r]));let body='';
 if(!iso&&options.grid===true){
  const left=Math.floor(Math.min(...rooms.map(r=>n(r.x)))/5)*5,right=Math.ceil(Math.max(...rooms.map(r=>n(r.x)+n(r.width)))/5)*5,up=Math.floor(Math.min(...rooms.map(r=>n(r.y)))/5)*5,down=Math.ceil(Math.max(...rooms.map(r=>n(r.y)+n(r.depth)))/5)*5;
  const origin=P(left,up),end=P(right,down),step=5*scale;
  body+=`<defs><pattern id="town-five-foot-grid" x="${origin[0]}" y="${origin[1]}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M${step} 0H0V${step}" fill="none" stroke="#88a394" stroke-width=".65" opacity=".3"/></pattern></defs><rect x="${origin[0]}" y="${origin[1]}" width="${end[0]-origin[0]}" height="${end[1]-origin[1]}" fill="url(#town-five-foot-grid)"/>`;
  const a=P(left,down);body+=line([a[0],a[1]+24],[a[0]+20*scale,a[1]+24],'#e5d3a8',2)+text(a[0]+10*scale,a[1]+43,'20 ft · 5-foot squares',11,'#c5d1bd','text-anchor="middle"');
 }
 for(const edge of catalog.links||[]){const a=R.get(edge.from),b=R.get(edge.to);if(!a||!b)continue;const p=P(n(a.x)+n(a.width)/2,n(a.y)+n(a.depth)/2,n(a.z)),q=P(n(b.x)+n(b.width)/2,n(b.y)+n(b.depth)/2,n(b.z));const mid=[q[0],p[1]];body+=`<path d="M${p}L${mid}L${q}" fill="none" stroke="#d0c098" stroke-width="${edge.kind==='stairs'?4:2}" stroke-dasharray="${edge.hidden?'4 5':edge.kind==='stairs'?'2 4':'0'}"><title>${esc(edge.description||edge.kind)}</title></path>`;}
 rooms.sort((a,b)=>(n(a.z)-n(b.z))||raw(n(a.x),n(a.y))[1]-raw(n(b.x),n(b.y))[1]);
 for(const r of rooms){const x=n(r.x),y=n(r.y),w=n(r.width),d=n(r.depth),z=n(r.z),h=iso?Math.min(12,Math.max(3,n(r.height))):0;
 const ps=[P(x,y,z),P(x+w,y,z),P(x+w,y+d,z),P(x,y+d,z)],top=[P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)];
 body+=`<g data-room="${esc(r.id)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">`;
 if(iso){body+=poly([ps[0],ps[1],top[1],top[0]],'#496564');body+=poly([ps[0],ps[3],top[3],top[0]],'#3c5259');}
 body+=poly(ps,tint(r),'#c1baa1',r.hidden?'stroke-dasharray="4 4"':'');
 // These illustrations are location previews, not measured furnishings or undiscovered POIs.
 if(iso&&!options.roomOnly){const supplied=options.artData?.[r.id],href=typeof supplied==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(supplied)?supplied:`/art/room/${encodeURIComponent(r.id)}.png`;const a=ps[0],b=ps[1],c=ps[3];body+=`<image data-room-art="${esc(r.id)}" href="${esc(href)}" width="1" height="1" preserveAspectRatio="none" opacity=".88" transform="matrix(${b[0]-a[0]} ${b[1]-a[1]} ${c[0]-a[0]} ${c[1]-a[1]} ${a[0]} ${a[1]})"/>`;body+=poly(ps,'none','#cfb985');}
 const tileStep=!iso&&options.grid===true?5:Math.max(5,Math.ceil(Math.max(w,d)/24/5)*5);for(let dx=tileStep;dx<w;dx+=tileStep)body+=line(P(x+dx,y,z),P(x+dx,y+d,z),'#243d3d',.6,'opacity=".3"');for(let dy=tileStep;dy<d;dy+=tileStep)body+=line(P(x,y+dy,z),P(x+w,y+dy,z),'#243d3d',.6,'opacity=".3"');
 const center=P(x+w/2,y+d/2,z);const sw=Math.min(w,d)*scale;
 if(sw>20)body+=symbol(r.kind,center[0],center[1],Math.min(24,sw*.2));
 (r.pois||[]).forEach((p,i)=>{if(options.roomOnly||sw>65){const c=P(x+clamp(p.x,0,1)*w,y+clamp(p.y,0,1)*d,z);body+=poi(p,c[0],c[1],i);}});
 const label=options.roomOnly?r.name:r.id;body+=text(center[0],center[1]+Math.min(35,sw*.35),label,options.roomOnly?19:12,'#fff4d3','text-anchor="middle" font-weight="600" paint-order="stroke" stroke="#182b30" stroke-width="3"');
 body+=`<title>${esc(r.name)} · ${esc(r.floor)} · ${n(r.width)} × ${n(r.depth)} ft</title></g>`;
 party.forEach((p,i)=>{if(p.roomId===r.id){const c=P(x+clamp(p.x,0,1)*w,y+clamp(p.y,0,1)*d,z);body+=token({...p,atlasPortrait:true},c[0],c[1],i,options.roomOnly?14:11);}});
 }
 body+=text(28,34,iso?'Architectural cutaway':'Rooms & connecting passages',20);body+=text(28,57,iso?(options.roomOnly?'Rotate to follow the room · low cutaway walls':'Illustrated locations · measured footprints · artwork is not a furniture plan'):'Room symbols identify spaces · linework traces known connections',12,'#b7c8bf');
 const floors=[...new Set(rooms.map(r=>r.floor))];body+=text(28,620,`${rooms.length} mapped spaces · ${floors.length} ${floors.length===1?'layer':'layers'}`,12,'#c9d2c1');return frame(body,iso?'Three-dimensional dungeon map':'Iconographic dungeon and hallways');
}
export function roomIndex(catalog,party=[],options={}){
 const rooms=(catalog.rooms||[]).filter(r=>(!options.areaId||r.areaId===options.areaId)&&(options.floor==null||options.floor==='all'||String(r.floor)===String(options.floor)));
 if(!rooms.length)return frame(text(500,325,'No discovered rooms on this layer.',23,'#e9dfc5','text-anchor="middle"'),'No discovered rooms');
 const columns=Math.min(4,rooms.length),cardW=236,cardH=238,gapX=62,gapY=78,margin=40,top=104,W=Math.max(650,margin*2+columns*cardW+(columns-1)*gapX),H=top+Math.ceil(rooms.length/columns)*(cardH+gapY)+20;
 const nodes=new Map(rooms.map((r,i)=>[r.id,{r,x:margin+(i%columns)*(cardW+gapX),y:top+Math.floor(i/columns)*(cardH+gapY),i}]));
 let body=text(40,38,'Rooms & passages',23,'#f3e6c6','letter-spacing="2"')+text(40,65,'Illustrated room index · schematic connections · not a measured floor plan',13,'#b4c6bc');
 for(const edge of catalog.links||[]){const a=nodes.get(edge.from),b=nodes.get(edge.to);if(!a||!b)continue;const ax=a.x+cardW/2,ay=a.y+cardH/2,bx=b.x+cardW/2,by=b.y+cardH/2;const lane=Math.min(a.y,b.y)-24-(a.i%3)*7;
  const path=a.y===b.y?`M${ax} ${ay}V${lane}H${bx}V${by}`:`M${ax} ${ay}H${a.x+cardW+gapX/2}V${b.y-32}H${bx}V${by}`;
  body+=`<path d="${path}" fill="none" stroke="#233c40" stroke-width="9"/><path d="${path}" fill="none" stroke="${edge.kind==='stairs'?'#dcbd7e':'#92ada5'}" stroke-width="2" stroke-dasharray="${edge.hidden?'4 5':edge.kind==='stairs'?'3 3':'0'}"><title>${esc(edge.description||edge.kind||'Known connection')}</title></path>`;
 }
 for(const {r,x,y,i} of nodes.values()){
  const supplied=options.artData?.[r.id],href=typeof supplied==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(supplied)?supplied:`/art/room/${encodeURIComponent(r.id)}.png`;
  const clip=`room-photo-${i}`;
  body+=`<g data-room="${esc(r.id)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}"><defs><clipPath id="${clip}"><rect x="${x+1}" y="${y+1}" width="${cardW-2}" height="149" rx="9"/></clipPath></defs><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="#233c40" stroke="${r.hidden?'#bd9461':'#708a7e'}" stroke-width="1.5" ${r.hidden?'stroke-dasharray="5 4"':''}/><image href="${esc(href)}" x="${x+1}" y="${y+1}" width="${cardW-2}" height="149" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/><rect x="${x+11}" y="${y+12}" width="66" height="23" rx="4" fill="#172b30" fill-opacity=".9"/>${text(x+44,y+28,r.id,11,'#fff0cc','text-anchor="middle" font-weight="700"')}`;
  const words=String(r.name||'').split(/\s+/);let labels=[''];for(const word of words){if((labels.at(-1)+' '+word).trim().length>26&&labels.at(-1))labels.push(word);else labels[labels.length-1]=(labels.at(-1)+' '+word).trim();}
  labels.slice(0,2).forEach((label,j)=>body+=text(x+13,y+174+j*18,label,15,'#f3e5c6','font-weight="600"'));
  body+=text(x+13,y+221,`${r.floor??'Unspecified layer'} · ${n(r.width)} × ${n(r.depth)} ft`,11,'#b9c9bd');
  const occupants=party.filter(p=>p.roomId===r.id);if(occupants.length)body+=text(x+cardW-12,y+133,`${occupants.length} party`,11,'#fff2cb','text-anchor="end" paint-order="stroke" stroke="#172b30" stroke-width="4"');
  body+=`<title>${esc(r.name)} · ${esc(r.floor)} · ${n(r.width)} × ${n(r.depth)} ft</title></g>`;
 }
 body+=text(40,H-22,`${rooms.length} mapped spaces · select an illustration to open the room`,12,'#b4c6bc');return frame(body,'Illustrated index of mapped rooms and hallways',`0 0 ${W} ${H}`);
}
export function worldMap(catalog,state){
 const places=catalog.places||[],roads=catalog.roads||[];let body='';
 // No full-world backdrop: even labels, coast detail and destinations are limited to the projection.
 body+=`<path d="M0 560Q180 440 270 535T580 520T1000 555V650H0Z" fill="#20464e"/><path d="M0 564Q180 444 270 539T580 524T1000 559" fill="none" stroke="#718f83"/>`;
 const maxX=Math.max(100,...places.map(p=>n(p.x))),maxY=Math.max(100,...places.map(p=>n(p.y)));
 const P=p=>[100+n(p.x)/maxX*800,105+n(p.y)/maxY*395];const byId=new Map(places.map(p=>[p.id,p]));
 roads.forEach(r=>{const a=byId.get(r.from),b=byId.get(r.to);if(a&&b){const p=P(a),q=P(b);body+=line(p,q,'#b8ae80',3,'stroke-dasharray="6 5"');}});
 places.forEach(p=>{const [x,y]=P(p),visited=Boolean(state.placeIds?.[p.id]?.visited);body+=`<g data-place="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(p.name)}"><circle cx="${x}" cy="${y}" r="30" fill="#2e514f" stroke="#d4c293" stroke-dasharray="${visited?'0':'4 3'}"/>${symbol('home',x,y,15)}${text(x,y+52,p.name,18,'#efe0b8','text-anchor="middle" paint-order="stroke" stroke="#182b30" stroke-width="4"')}${text(x,y+71,visited?'Visited':'Learned about',12,'#c1d1c6','text-anchor="middle"')}<title>${esc(p.description)}</title></g>`;});
 body+=text(30,35,'The coast you know',24);body+=text(30,59,'Only visited places and learned leads appear here.',13,'#c0cbbd');body+=text(30,620,'Unknown roads · twice the normal encounter chance per journey leg',13);return frame(body,'World map of discovered and learned places');
}
export function sceneOverlay(room){return `<svg class="artOverlay" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 650" role="img" aria-label="Discovered points of interest">${(room.pois||[]).map((p,i)=>poi(p,clamp(p.x,0,1)*1000,clamp(p.y,0,1)*650,i)).join('')}</svg>`;}
export function partyLegend(party){return party.map((p,i)=>`<span><b style="color:${esc(p.color)}">${i+1}</b> ${esc(p.name)}</span>`).join(' · ');}
