import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderTacticalMap} from './renderers.mjs';
const own={characterId:'hero',displayName:'Hero',x:12,y:12};
const base={width:25,height:25,terrainRulesVersion:1,viewerCharacterId:'hero',tokens:[own],cells:[{x:12,y:12,terrain:'floor',visibility:'visible'}]};
const features=[{cover:'half'},{cover:'three-quarters'},{cover:'total'},{obscurement:'light'},{obscurement:'heavy'},{terrain:'difficult'}];
const cell=(extra={})=>({x:13,y:12,terrain:'floor',visibility:'visible',...extra});
async function pixels(map,detail){const image=await loadImage(await renderTacticalMap(map,{detail}));const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.width,data:ctx.getImageData(0,0,image.width,image.height).data};}
test('authored terrain art cannot alter pixels outside its exact square at either scale',async()=>{
 for(const detail of [false,true]){
  const before=await pixels({...base,cells:[...base.cells,cell()]},detail),size=detail?64:32,left=40+(detail?5:13)*size,top=110+(detail?4:12)*size;
  for(const feature of features){const after=await pixels({...base,cells:[...base.cells,cell(feature)]},detail);let changed=0;
   for(let i=0;i<before.data.length;i+=4){if(before.data.slice(i,i+4).every((v,n)=>v===after.data[i+n]))continue;changed++;const x=i/4%before.width,y=Math.floor(i/4/before.width);assert(x>=left&&x<left+size&&y>=top&&y<top+size,'mark escaped authoritative square');}assert(changed>0);
  }
 }
});
test('unknown terrain and concealed props never affect the rendered map',async()=>{
 for(const detail of [false,true]){const expected=await renderTacticalMap(base,{detail});for(const feature of features)assert.deepEqual(await renderTacticalMap({...base,cells:[...base.cells,cell({...feature,visibility:'unknown'})],objects:[{x:13,y:12,kind:'door'}],tokens:[own,{characterId:'secret',displayName:'SECRET',x:13,y:12}]},{detail,portraits:{secret:'https://must-not-load.invalid'}}),expected);}
});
test('remembered features are dimmed and cannot reveal present creatures or objects',async()=>{
 for(const feature of features){const known={...base,cells:[...base.cells,cell(feature)]},remembered={...base,cells:[...base.cells,cell({...feature,visibility:'remembered'})]};
  const current=await pixels(known,true),past=await pixels(remembered,true);let bright=0,dim=0;for(let y=112+4*64;y<110+5*64-2;y++)for(let x=42+5*64;x<40+6*64-2;x++){const i=(y*current.width+x)*4;bright+=current.data[i]+current.data[i+1]+current.data[i+2];dim+=past.data[i]+past.data[i+1]+past.data[i+2];}assert(dim<bright);
  assert.deepEqual(await renderTacticalMap(remembered,{detail:true}),await renderTacticalMap({...remembered,objects:[{x:13,y:12,kind:'stairs'}],tokens:[own,{characterId:'secret',x:13,y:12}]},{detail:true,portraits:{secret:'https://must-not-load.invalid'}}));
 }
});
test('legacy rules do not acquire authored cover or concealment from visual fields',async()=>{
 const legacy={...base,terrainRulesVersion:0,cells:[...base.cells,cell()]};const expected=await renderTacticalMap(legacy);
 for(const feature of features.slice(0,5))assert.deepEqual(await renderTacticalMap({...legacy,cells:[...base.cells,cell(feature)]}),expected);
});
