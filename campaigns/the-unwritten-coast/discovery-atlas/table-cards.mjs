import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {roomMap} from './render.mjs';
import {renderArchitecturePng} from './architecture-art/png.mjs';
import {projectMarker} from './architecture-art/projection.mjs';
const require=createRequire(new URL('../../../raphael-council/package.json',import.meta.url));
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const root=new URL('./art/',import.meta.url);
GlobalFonts.registerFromPath(fileURLToPath(new URL('table/coast-serif.ttf',root)),'Coast');
const image=async key=>loadImage(await readFile(new URL(key,root)));
function cover(ctx,img,x,y,w,h){const scale=Math.max(w/img.width,h/img.height),sw=w/scale,sh=h/scale;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h);}
function wrap(ctx,text,x,y,width,lineHeight){let line='';for(const word of text.split(/\s+/)){const candidate=(line+' '+word).trim();if(ctx.measureText(candidate).width>width&&line){ctx.fillText(line,x,y);y+=lineHeight;line=word;}else line=candidate;}ctx.fillText(line,x,y);return y+lineHeight;}
export async function renderEncounter(view){
 const encounter=view.encounter;if(!encounter)throw Error('No visible encounter.');const c=createCanvas(1400,350),ctx=c.getContext('2d');
 cover(ctx,await image(encounter.roomId+'.png'),0,0,1400,350);ctx.fillStyle='#10262bea';ctx.fillRect(0,0,1400,350);ctx.fillStyle='#edd1a0';ctx.font='26px Coast';ctx.fillText(`Round ${encounter.round} · ${encounter.surprise}`,28,35);
 const allies=view.party.filter(p=>p.roomId===encounter.roomId),enemies=encounter.enemies;
 async function side(people,start,end,enemy){const slot=Math.min(130,(end-start)/Math.max(people.length,1)),offset=start+(end-start-slot*people.length)/2;for(let i=0;i<people.length;i++){const p=people[i],x=offset+i*slot,w=slot-12;cover(ctx,await image('table/'+(enemy?(p.art==='harbor-lookout'?'harbor-lookout':'sentinel'):p.id)+'.png'),x,62,w,192);ctx.fillStyle='#efe4cf';ctx.font='16px sans-serif';ctx.fillText(p.name,x,278,w);ctx.fillStyle='#586765';ctx.fillRect(x,292,w,7);if(Number.isFinite(p.hp)&&Number.isFinite(p.maxHp)){ctx.fillStyle='#a7cba5';ctx.fillRect(x,292,w*p.hp/p.maxHp,7);}ctx.fillStyle='#dedecf';ctx.font='14px sans-serif';ctx.fillText(p.healthUnknown||!Number.isFinite(p.hp)?'HP ?':`${p.hp} / ${p.maxHp} HP`,x,321);}}
 await side(allies,25,655,false);await side(enemies,755,1375,true);ctx.font='42px Coast';ctx.fillStyle='#e8c48a';ctx.fillText('VS',672,186);return c.toBuffer('image/png');
}
export async function renderTactical(view,roomId){const room=view.catalog.rooms.find(r=>r.id===roomId);if(!room)throw Error('Room is not discovered.');const hallway=view.encounter?.roomId===roomId&&view.encounter.terrain==='hallway',r=hallway?{...room,width:60,depth:10,name:'Connecting hallway',pois:[]}:room;
 if(!hallway&&view.encounter?.roomId===roomId&&['R01','R02','R05','R07'].includes(roomId)){
  const layer=roomId.toLowerCase()+'-floor-slice',geometry=JSON.parse(await readFile(new URL('architecture/'+roomId.toLowerCase()+'-projection.json',root),'utf8'));
  const background=await loadImage(await renderArchitecturePng(view,roomId,layer)),canvas=createCanvas(background.width,background.height),context=canvas.getContext('2d');context.drawImage(background,0,0);
  for(const enemy of view.encounter.enemies.filter(e=>e.visible!==false)){
   const [x,y]=projectMarker(geometry.views[layer],enemy),portrait=await image('table/'+(enemy.art==='harbor-lookout'?'harbor-lookout':'sentinel')+'.png');
   context.fillStyle='#b97561';context.fillRect(x-24,y-82,48,64);cover(context,portrait,x-21,y-79,42,58);
   context.fillStyle='#291c19';context.font='16px Coast';context.textAlign='center';const label=String(enemy.name).slice(0,60),labelWidth=Math.min(330,context.measureText(label).width+20);context.fillRect(x-labelWidth/2,y+8,labelWidth,27);context.fillStyle='#fff0d5';context.fillText(label,x,y+27,labelWidth-10);
   const known=enemy.healthKnown!==false&&Number.isFinite(enemy.hp)&&Number.isFinite(enemy.maxHp)&&enemy.maxHp>0;
   context.fillStyle='#291c19';context.fillRect(x-24,y-17,48,9);if(known){context.fillStyle='#d7a081';context.fillRect(x-23,y-16,46*Math.max(0,Math.min(1,enemy.hp/enemy.maxHp)),7);}else{context.fillStyle='#fff0d5';context.font='12px sans-serif';context.fillText('?',x,y-7);}
  }
  return canvas.toBuffer('image/png');
 }
 const c=createCanvas(1600,1040),ctx=c.getContext('2d'),svg=roomMap({...r,pois:r.pois.filter(p=>view.state.poiIds[p.id])},[],{grid:true});ctx.drawImage(await loadImage(Buffer.from(svg)),0,0,1600,1040);
 const scale=Math.min(820/r.width,450/r.depth),w=r.width*scale,h=r.depth*scale;
 for(const p of [...view.party.filter(p=>p.roomId===roomId),...(view.encounter?.roomId===roomId?view.encounter.enemies:[])]){const x=((1000-w)/2+p.x*w)*1.6,y=((650-h)/2+p.y*h)*1.6;ctx.fillStyle='#eed3a0';ctx.fillRect(x-22,y-29,44,58);cover(ctx,await image('table/'+(p.id.startsWith('enemy-')?(p.art==='harbor-lookout'?'harbor-lookout':'sentinel'):p.id)+'.png'),x-19,y-26,38,52);}
 return c.toBuffer('image/png');}
export async function renderSceneCard(view,roomId){const room=view.catalog.rooms.find(r=>r.id===roomId);if(!room)throw Error('Room is not discovered.');const c=createCanvas(1400,1120),ctx=c.getContext('2d');ctx.fillStyle='#142a30';ctx.fillRect(0,0,1400,1120);cover(ctx,await image(room.publicArtKey+'.png'),0,0,1400,720);ctx.fillStyle='#efd4a3';ctx.font='48px Coast';ctx.fillText(room.name,46,790);ctx.fillStyle='#e4e1d2';ctx.font='24px sans-serif';let y=wrap(ctx,room.flavor,46,842,1308,35);ctx.font='21px sans-serif';y=wrap(ctx,room.visibleFeatures.join(' · '),46,y+26,1308,32);ctx.fillStyle='#c7cfc2';ctx.font='17px sans-serif';ctx.fillText('The Unwritten Coast · Discovered surroundings · Scene / Tactical / Atlas / Character / Raphael',46,1080);return c.toBuffer('image/png');}
