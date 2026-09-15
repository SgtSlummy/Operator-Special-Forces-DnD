import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderTacticalMap} from './renderers.mjs';
function texture(color){const c=createCanvas(64,64),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,64,64);return c.toBuffer('image/png');}
const map={id:'coastal-road',width:2,height:2,cells:[{x:0,y:0,terrain:'floor',visibility:'visible'},{x:1,y:0,terrain:'floor',visibility:'remembered'}]};
async function pixel(buffer,x,y){const i=await loadImage(buffer),c=createCanvas(i.width,i.height),ctx=c.getContext('2d');ctx.drawImage(i,0,0);return [...ctx.getImageData(x,y,1,1).data];}
test('matching scene floor overrides global stone suppression while unrelated scenes do not',async()=>{
 const baseline=await renderTacticalMap(map);
 const assets={terrainTextures:{floor:'https://must-not-load.invalid'},terrainTexturesByScene:{'coastal-road':{floor:texture('#ff0000')}}};
 const scene=await renderTacticalMap(map,assets);assert.notDeepEqual(scene,baseline);
 assert.deepEqual(await renderTacticalMap(map,{terrainTextures:assets.terrainTextures,terrainTexturesByScene:{'signal-dungeon':{floor:'https://must-not-load.invalid'}}}),baseline);
 assert.notDeepEqual(await pixel(scene,55,85),await pixel(baseline,55,85));
 assert.notDeepEqual(await pixel(scene,85,85),await pixel(baseline,85,85));
 assert.deepEqual(await pixel(scene,55,117),await pixel(baseline,55,117));
});
test('scene texture merge preserves global materials not overridden',async()=>{
 const stone={...map,id:'signal-dungeon'};const global={floor:texture('#0088aa')};
 assert.deepEqual(await renderTacticalMap(stone,{terrainTextures:global,terrainTexturesByScene:{'signal-dungeon':{wall:'https://unused.invalid'}}}),await renderTacticalMap(stone,{terrainTextures:global}));
});
test('unknown scene materials never load or change pixels even in nearby mode',async()=>{
 const scoped={...map,viewerCharacterId:'hero',tokens:[{characterId:'hero',x:0,y:0,displayName:'Hero'}]};
 for(const detail of [false,true]){
  const baseline=await renderTacticalMap(scoped,{detail});
  assert.deepEqual(await renderTacticalMap({...scoped,cells:[...scoped.cells,{x:0,y:1,terrain:'secret',visibility:'unknown'}]},{detail,terrainTexturesByScene:{'coastal-road':{secret:'https://must-not-load.invalid'}}}),baseline);
 }
});
