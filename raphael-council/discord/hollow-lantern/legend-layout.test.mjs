import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderTacticalMap} from './renderers.mjs';
function portrait(color){const c=createCanvas(64,64),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,64,64);return c.toBuffer('image/png');}
async function region(bytes,x,y,w,h){const image=await loadImage(bytes),c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(x,y,w,h).data;}
test('long controlled name stays within its legend slot in full and nearby maps',async()=>{
 const cells=[];for(let y=0;y<25;y++)for(let x=0;x<25;x++)cells.push({x,y,terrain:'floor',visibility:'visible'});
 const map={width:25,height:25,viewerCharacterId:'ash',cells,tokens:[{characterId:'ash',displayName:'Brother Ash',x:12,y:12},{characterId:'mara',displayName:'Mara Flint',x:13,y:12}]};
 const portraits={ash:portrait('#339966'),mara:portrait('#dd3355')};
 for(const detail of [false,true]){
  const short=await renderTacticalMap(map,{detail,portraits});
  const long=await renderTacticalMap({...map,tokens:[{...map.tokens[0],displayName:'Brother ExtremelyLongUnbrokenNameThatMustNotEscape Ash'},map.tokens[1]]},{detail,portraits});
  const footer=110+(detail?9*64:25*32)+23;
  assert.deepEqual(await region(short,190,footer+48,150,64),await region(long,190,footer+48,150,64));
 }
});


test('all visible tokens receive wrapped legend names and coordinates at both scales',async()=>{
 const cells=[];for(let y=0;y<25;y++)for(let x=0;x<25;x++)cells.push({x,y,terrain:'floor',visibility:'visible'});
 const tokens=Array.from({length:6},(_,i)=>({characterId:`actor${i}`,displayName:`Actor ${i}`,x:11+i%3,y:12+Math.floor(i/3)}));
 const map={width:25,height:25,cells,tokens,viewerCharacterId:'actor0'};
 for(const detail of [false,true]){
  const bytes=await renderTacticalMap(map,{detail}),image=await loadImage(bytes),slots=detail?3:5,footer=110+(detail?576:800)+23;
  assert.equal(image.height,110+(detail?576:800)+142+64);
  for(let i=0;i<tokens.length;i++){
   const x=40+(i%slots)*150,y=footer+52+Math.floor(i/slots)*64;
   const renamed=await renderTacticalMap({...map,tokens:tokens.map((t,n)=>n===i?{...t,displayName:'Renamed'}:t)},{detail});
   assert.notDeepEqual(await region(bytes,x,y,140,32),await region(renamed,x,y,140,32),`missing legend name ${i}`);
   const moved=await renderTacticalMap({...map,tokens:tokens.map((t,n)=>n===i?{...t,y:t.y+1}:t)},{detail});
   assert.notDeepEqual(await region(bytes,x,y+36,140,16),await region(moved,x,y+36,140,16),`missing coordinates ${i}`);
  }
 }
});

test('hidden, obscured and off-frame tokens cannot expand legend or image',async()=>{
 const cells=[];for(let y=0;y<25;y++)for(let x=0;x<25;x++)cells.push({x,y,terrain:'floor',visibility:x===0&&y===0?'unknown':'visible',creaturesVisible:!(x===14&&y===14)});
 const map={width:25,height:25,viewerCharacterId:'own',cells,tokens:[{characterId:'own',displayName:'Own',x:12,y:12}]};
 for(const detail of [false,true]){
  const expected=await renderTacticalMap(map,{detail});
  const hidden=[{characterId:'hidden',x:0,y:0},{characterId:'obscured',x:14,y:14},{characterId:'outside',x:26,y:26}];if(detail)hidden.push({characterId:'offframe',x:1,y:1});
  assert.deepEqual(await renderTacticalMap({...map,tokens:[...map.tokens,...hidden]},{detail,portraits:Object.fromEntries(hidden.map(t=>[t.characterId,'https://must-not-load.invalid']))}),expected);
 }
});
