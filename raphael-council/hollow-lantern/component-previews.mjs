import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { presentProjection } from './service.mjs';
import { buildPanel } from '../discord/hollow-lantern/components.mjs';
import { renderTacticalMap, renderPublicCombatCard } from '../discord/hollow-lantern/renderers.mjs';

// Offline developer preview of the REAL serialized component tree. No Discord
// client, engine commands, credentials or blind-participant context is involved.
const source = resolve(process.env.HOLLOW_PREVIEW_SOURCE ?? 'C:/Users/Hermes/LocalFiles/HollowLanternMission-20260909/evidence');
const output = resolve(process.env.HOLLOW_PREVIEW_OUTPUT ?? `C:/Users/Hermes/LocalFiles/hollow-lantern/component-previews-${Date.now()}`);
const art = fileURLToPath(new URL('../../campaign-art/hollow-lantern/', import.meta.url));
const portraits = Object.fromEntries(['fighter','rogue','cleric','sentinel'].map((id,i) => [`lantern-${id}`, join(art,['mara.png','kestrel.png','ash.png','sentinel-sd.png'][i])]));
await mkdir(output, {recursive:true});
function inspect(payload) {
 let count=0,characters=0; const failures=[];
 function walk(c) {
  count++;
  if(c.type===10) characters+=c.content.length;
  if(c.type===1 && (c.components.length>5 || c.components.some(x=>x.type===3)&&c.components.length!==1))failures.push('action-row');
  if(c.type===3 && (!c.options?.length||c.options.length>25))failures.push('select-options');
  if(c.type===9 && (c.components.length<1||c.components.length>3||!c.accessory))failures.push('section');
  for(const child of c.components??[])walk(child);
  if(c.accessory)walk(c.accessory);
 }
 for(const c of payload.components)walk(c);
 if(count>40)failures.push('component-count');if(characters>4000)failures.push('text-budget');
 if(payload.content||payload.embeds||!(payload.flags&32768))failures.push('v2-envelope');
 return {count,characters,failures};
}
function lines(ctx,text,width) {
 const result=[];
 for(const paragraph of String(text).replace(/\*\*/g,'').split('\n')) {
  let line='';for(const word of paragraph.split(' ')){const candidate=line?`${line} ${word}`:word;if(ctx.measureText(candidate).width>width&&line){result.push(line);line=word;}else line=candidate;}result.push(line);
 }return result;
}
async function draw(payload, image, width) {
 const canvas=createCanvas(width,16000),ctx=canvas.getContext('2d');
 ctx.fillStyle='#1e1f22';ctx.fillRect(0,0,width,16000);
 const x=16,w=width-32;let y=24;
 ctx.font='12px sans-serif';ctx.fillStyle='#b6b8bf';ctx.fillText('LOCAL COMPONENT PREVIEW · NOT DISCORD',x,y);y+=28;
 const text=(content,tx,tw)=>{
  for(const paragraph of content.split('\n')){const heading=paragraph.startsWith('#');ctx.font=heading?'bold 19px sans-serif':'15px sans-serif';ctx.fillStyle=heading?'#f2f3f5':'#d5d6da';for(const line of lines(ctx,paragraph.replace(/^#+\s*/,''),tw)){ctx.fillText(line,tx,y+17);y+=22;}}y+=8;
 };
 const box=(label,bx,by,bw,bh,primary=false,disabled=false)=>{ctx.fillStyle=primary?'#5865f2':'#303136';ctx.fillRect(bx,by,bw,bh);ctx.strokeStyle='#424349';ctx.strokeRect(bx,by,bw,bh);ctx.fillStyle=disabled?'#878990':'#f2f3f5';ctx.font='bold 13px sans-serif';const chunks=lines(ctx,label,bw-16);chunks.slice(0,2).forEach((line,i)=>ctx.fillText(line,bx+8,by+18+i*16));};
 function component(c,tx,tw) {
  if(c.type===17){const start=y;ctx.fillStyle='#111214';ctx.fillRect(tx,y,tw,15000-y);y+=18;for(const child of c.components)component(child,tx+16,tw-32);y+=12;ctx.fillStyle='#d7b54a';ctx.fillRect(tx,start,4,y-start);}
  else if(c.type===10)text(c.content,tx,tw);
  else if(c.type===14){ctx.strokeStyle='#34353a';ctx.beginPath();ctx.moveTo(tx,y+8);ctx.lineTo(tx+tw,y+8);ctx.stroke();y+=24;}
  else if(c.type===12){if(image){const h=tw*image.height/image.width;ctx.drawImage(image,tx,y,tw,h);y+=h+14;}}
  else if(c.type===9){const start=y;for(const child of c.components)component(child,tx,tw-100);box(c.accessory.label,tx+tw-92,start,92,38);y=Math.max(y,start+48);}
  else if(c.type===1){if(c.components[0]?.type===3){const select=c.components[0];box(`${select.placeholder}  ▾`,tx,y,tw,38);y+=48;}else{const bw=(tw-8*(c.components.length-1))/c.components.length;const bh=Math.max(...c.components.map(b=>{ctx.font='bold 13px sans-serif';return lines(ctx,b.label,bw-16).length>1?52:38;}));c.components.forEach((b,i)=>box(b.label,tx+i*(bw+8),y,bw,bh,b.style===1,b.disabled));y+=bh+10;}}
 }
 for(const c of payload.components)component(c,x,w);
 if(y>15900)throw new Error('Preview overflow');
 const result=createCanvas(width,Math.ceil(y+20));result.getContext('2d').drawImage(canvas,0,0);return result.toBuffer('image/png');
}
const checked=[],chosen=new Map();let maximum={count:0};
for(const name of (await readdir(source)).filter(n=>n.endsWith('.json')).sort()){
 const record=JSON.parse(await readFile(join(source,name),'utf8'));if(!record.projection)continue;
 const view=presentProjection(record.projection),settings=[{tab:'map'},...(['public','gm'].includes(view.audience)?[]:['character','inventory','journal','help','skills','features','spells','training'].map(tab=>({tab}))),...[...new Set((view.actions??[]).map(a=>a.group))].map(group=>({tab:'map',group}))];
 for(const setting of settings){let counter=0;const panel=buildPanel(view,()=>`fixture-${++counter}`,setting),result=inspect(panel);
  // Reserve the actual host's Open Table row/button and an art-review row/button.
  const countWithHostExtras=result.count+(view.audience==='public'?0:view.audience==='gm'?4:2);
  if(countWithHostExtras>40)result.failures.push('host-component-count');
  const check={source:name,setting,...result,countWithHostExtras};checked.push(check);if(countWithHostExtras>maximum.count)maximum={count:countWithHostExtras,source:name,setting};
  const key=`${record.projection.currentSceneId}-${view.mode}-${view.audience}-${setting.tab}${setting.group?`-${setting.group}`:''}`;
  // Capture phase maps and one example of every player/DM action group or tab.
  if(setting.tab==='map'&&!setting.group||!chosen.has(`${view.audience}-${setting.tab}-${setting.group??''}`)){
   const pick=setting.tab==='map'&&!setting.group?key:`${view.audience}-${setting.tab}-${setting.group??''}`;
   if(!chosen.has(pick))chosen.set(pick,{view,panel,check});
  }
 }
}
const previews=[];
for(const [key,{view,panel,check}]of chosen){
 const stem=key.replace(/[^a-zA-Z0-9_-]/g,'-');
 const bytes=view.audience==='public'?await renderPublicCombatCard({title:view.publicTitle,summary:view.publicSummary,participants:view.publicParticipants},{portraits,sceneArt:join(art,'cover.png')}):view.map?await renderTacticalMap(view.map,{title:view.title,portraits,terrainTextures:{floor:join(art,'stone-floor-sd.png')}}):null;
 // Illustration URL is local attachment metadata, no external asset upload.
 if(bytes&&!panel.components[0].components.some(c=>c.type===12))panel.components[0].components.splice(2,0,{type:12,items:[{media:{url:'attachment://view.png'},description:view.audience==='public'?'Public scene':'Scoped visible map'}]});
 const image=bytes?await loadImage(bytes):null;
 await writeFile(join(output,`${stem}.json`),JSON.stringify({kind:'local-preview',discord:false,source:check.source,payload:panel},null,2));
 for(const [size,width]of [['desktop',680],['mobile',390]])await writeFile(join(output,`${stem}-${size}.png`),await draw(panel,image,width));
 previews.push({key,desktop:`${stem}-desktop.png`,mobile:`${stem}-mobile.png`,payload:`${stem}.json`,check:inspect(panel)});
}
const failures=checked.filter(x=>x.failures.length);
const report={kind:'offline-component-schema-and-layout-review',discord:false,blindTest:false,source,checked:checked.length,maximum,failures,previews};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
await writeFile(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Hollow Lantern component previews</title><style>body{background:#1e1f22;color:#f2f3f5;font:16px system-ui;margin:24px}a{color:#a7c8ff}.pair{display:flex;align-items:flex-start;gap:20px}.pair img{max-width:48%;height:auto}section{padding:20px 0;border-top:1px solid #555}</style><h1>Hollow Lantern · actual component payload previews</h1><p>Local developer rendering from scoped Unity rehearsal records. Not Discord screenshots, mobile client acceptance, or blind testing. ${checked.length} payloads checked; ${failures.length} schema failures. Artwork: approved portraits and sentinel-sd.png; hidden terrain filtered by renderer.</p>${previews.map(p=>`<section><h2>${p.key}</h2><a href="${p.payload}">Native V2 payload</a><div class="pair"><img loading="lazy" src="${p.desktop}"><img loading="lazy" src="${p.mobile}"></div></section>`).join('')}`);
console.log(JSON.stringify({output,checked:checked.length,maximum,failures:failures.length,previews:previews.length}));
if(failures.length)process.exitCode=1;
