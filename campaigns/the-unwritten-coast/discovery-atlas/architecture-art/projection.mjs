const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const valid=n=>Number.isFinite(n)&&n>=0&&n<=1;
const imageSource=value=>{if(typeof value!=='string'||!(/^(?:data:image\/png;base64,[A-Za-z0-9+/=]+|\/art\/(?:architecture\/[a-z0-9-]+|table\/(?:mara|ivo|sable|tern))\.png)$/.test(value)))throw Error('Use an approved local PNG image.');return value;};
export function projectMarker(camera,{x,y,z=0}){
 if(![x,y,z].every(valid))throw Error('Marker is outside the room.');
 for(const key of ['origin','xAxis','yAxis','zAxis'])if(!Array.isArray(camera[key])||camera[key].length!==2||!camera[key].every(Number.isFinite))throw Error('Invalid camera projection.');
 return camera.origin.map((v,i)=>v+x*(camera.xAxis[i]-v)+y*(camera.yAxis[i]-v)+z*(camera.zAxis[i]-v));
}
// Accept only the server's recipient projection and the geometry for a known room.
// This does not grant discovery or alter player positions.
export function renderArchitecture(view,{geometry,layer,images,grid=false}){
 const room=view.catalog.rooms.find(r=>r.id===geometry.roomId);if(!room)throw Error('Room is not discovered.');
 const dimensions=geometry.dimensionsFeet;
 if(room.width!==dimensions.width||room.depth!==dimensions.depth||room.height!==dimensions.height)throw Error('Artwork geometry no longer matches the room.');
 const camera=geometry.views[layer];if(!camera)throw Error('Unknown architectural view.');
 if(!Number.isInteger(camera.width)||!Number.isInteger(camera.height)||camera.width<1||camera.height<1)throw Error('Invalid image size.');
 const number=n=>Number(n.toFixed(3));
 const point=p=>projectMarker(camera,p).map(number);
 const line=(a,b)=>{const [x1,y1]=point(a),[x2,y2]=point(b);return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;};
 let markup=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${camera.width}" height="${camera.height}" viewBox="0 0 ${camera.width} ${camera.height}" role="img" aria-label="${escape(room.name)} architectural map"><title>${escape(room.name)} — ${escape(layer)}</title><image width="100%" height="100%" xlink:href="${imageSource(images.background)}"/>`;
 if(grid){
  const outline=geometry.floorPolygonFeet??[[0,0],[dimensions.width,0],[dimensions.width,dimensions.depth],[0,dimensions.depth]];
  if(!Array.isArray(outline)||outline.length<3||outline.length>64||outline.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[0]>dimensions.width||p[1]<0||p[1]>dimensions.depth))throw Error('Invalid architectural floor outline.');
  const clipId=('architecture-floor-'+room.id+'-'+layer).replace(/[^a-zA-Z0-9_-]/g,'');
  const points=outline.map(([x,y])=>point({x:x/dimensions.width,y:y/dimensions.depth}).join(',')).join(' ');
  let gridLines='';for(let x=0;x<=dimensions.width;x+=5)gridLines+=line({x:x/dimensions.width,y:0},{x:x/dimensions.width,y:1});for(let y=0;y<=dimensions.depth;y+=5)gridLines+=line({x:0,y:y/dimensions.depth},{x:1,y:y/dimensions.depth});
  markup+=`<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${points}"/></clipPath></defs><g data-grid-feet="5" clip-path="url(#${clipId})"><g stroke="#102d30" stroke-opacity=".8" stroke-width="5">${gridLines}</g><g stroke="#9cf3e7" stroke-opacity=".9" stroke-width="2">${gridLines}</g></g>`;}
 for(const feature of geometry.features){
  const record=room.pois.find(p=>p.id===feature.id);if(!record||!view.state.poiIds[feature.id])continue;
  // A horizontal cut removes features above its plane; keep their floor location discoverable.
  const coordinate={x:record.x??feature.x,y:record.y??feature.y,z:layer===room.id.toLowerCase()+'-cutaway'?feature.z:0};const [x,y]=point(coordinate);
  markup+=`<g data-poi="${escape(feature.id)}"><title>${escape(record.name)}: ${escape(record.description)}</title><path d="M ${x} ${y-8} l 8 8 -8 8 -8 -8 Z" fill="#e9d7a1" stroke="#17332f" stroke-width="2"/><path d="M${x} ${y-9}v-22" stroke="#e9d7a1" stroke-width="2"/><rect x="${x-95}" y="${y-56}" width="190" height="24" rx="4" fill="#16332f"/><text x="${x}" y="${y-39}" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#f6eccf">${escape(record.name)}</text></g>`;
 }
 for(const person of (view.party??view.state.party).filter(p=>p.roomId===room.id)){
  const [x,y]=point(person),portrait=imageSource(images.portraits[person.id]);
  markup+=`<g data-player="${escape(person.id)}" data-floor-x="${x}" data-floor-y="${y}"><title>${escape(person.name)} — ${number(person.x*dimensions.width)} ft east, ${number(person.y*dimensions.depth)} ft north</title><ellipse cx="${x}" cy="${y}" rx="17" ry="7" fill="#071918" opacity=".7"/><path d="M${x-23} ${y-82}h46v61l-23 20-23-20z" fill="#183b33" stroke="#e4c77d" stroke-width="2"/><image x="${x-21}" y="${y-80}" width="42" height="58" preserveAspectRatio="xMidYMid slice" xlink:href="${portrait}"/><rect x="${x-64}" y="${y+9}" width="128" height="24" rx="4" fill="#132b28"/><text x="${x}" y="${y+26}" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#f1e6c8">${escape(person.name)}</text>`;
  if(Number.isFinite(person.hp)&&Number.isFinite(person.maxHp)&&person.maxHp>0)markup+=`<rect x="${x-21}" y="${y-20}" width="42" height="4" fill="#102923"/><rect x="${x-21}" y="${y-20}" width="${number(42*Math.max(0,Math.min(1,person.hp/person.maxHp)))}" height="4" fill="#b9d9aa"/>`;
  markup+='</g>';
 }
 markup+=`<g><rect x="38" y="${camera.height-(grid?116:68)}" width="370" height="${grid?83:35}" rx="5" fill="#132b28"/><text x="54" y="${camera.height-(grid?91:45)}" font-family="Georgia,serif" font-size="18" fill="#f1e6c8">${dimensions.width} × ${dimensions.depth} ft</text>${grid?`<path d="M54 ${camera.height-70}h32" stroke="#9cf3e7" stroke-width="3"/><text x="96" y="${camera.height-64}" font-family="Georgia,serif" font-size="18" fill="#9cf3e7">5 ft grid · solid aqua lines</text><text x="54" y="${camera.height-43}" font-family="Georgia,serif" font-size="16" fill="#f1e6c8">Floor seams are not grid lines</text>`:''}</g></svg>`;
 return markup;
}
