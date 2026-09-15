import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderTacticalMap} from './renderers.mjs';
const cells=[{x:0,y:0,visibility:'visible',terrain:'floor'},{x:1,y:0,visibility:'visible',terrain:'floor'}];
const tokens=[{characterId:'mara',displayName:'Mara',x:0,y:0},{characterId:'ash',displayName:'Ash',x:1,y:0}];
test('only scoped own token receives a cyan marker and private header',async()=>{
 const image=await loadImage(await renderTacticalMap({width:2,height:2,cells,tokens,viewerCharacterId:'mara'}));const c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);
 assert.deepEqual([...ctx.getImageData(42,126,1,1).data],[130,238,227,255]);
 assert.notDeepEqual([...ctx.getImageData(74,126,1,1).data],[130,238,227,255]);
 const gm=await loadImage(await renderTacticalMap({width:2,height:2,cells,tokens}));assert.equal(image.height-gm.height,40);
});
test('hidden own-token identity does not disclose presence or load portrait art',async()=>{
 const map={width:2,height:2,cells};const baseline=await renderTacticalMap(map);
 const hidden=await renderTacticalMap({...map,viewerCharacterId:'secret',tokens:[{characterId:'secret',displayName:'SECRET',x:1,y:1}]},{portraits:{secret:'https://not-allowed.invalid'}});
 assert.deepEqual(hidden,baseline);
});

test('a companion sharing a square cannot obscure the controlled portrait',async()=>{
 const portrait=color=>{const c=createCanvas(40,40),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,40,40);return c.toBuffer('image/png');};
 const map={width:2,height:2,cells,viewerCharacterId:'mara',tokens:[tokens[0],{...tokens[1],x:0}]};
 const image=await loadImage(await renderTacticalMap(map,{portraits:{mara:portrait('#123456'),ash:portrait('#dd2211')}}));
 const c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);
 assert.deepEqual([...ctx.getImageData(54,127,1,1).data],[18,52,86,255]);
});


test('coastal ground is distinct from stone and cannot load global stone texture',async()=>{
 const map={id:'coastal-road',width:2,height:2,cells:[{x:0,y:0,terrain:'floor',visibility:'visible'},{x:1,y:0,terrain:'floor',visibility:'remembered'}],tokens:[]};
 const coast=await loadImage(await renderTacticalMap(map,{terrainTextures:{floor:'https://must-not-load.invalid/stone.png'}}));
 const stone=await loadImage(await renderTacticalMap({...map,id:'signal-dungeon'}));
 const pixel=(image,x,y)=>{const c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(x,y,1,1).data];};
 assert.notDeepEqual(pixel(coast,52,82),pixel(stone,52,82));
 assert.deepEqual(pixel(coast,52,114),pixel(stone,52,114));
 assert.notDeepEqual(pixel(coast,52,82),pixel(coast,84,82));
});
test('terrain palettes and marks never disclose unknown grass sand or sea',async()=>{
 const base={id:'coastal-road',width:2,height:2,cells:[{x:0,y:0,terrain:'road',visibility:'visible'}]};
 const expected=await renderTacticalMap(base);
 for(const terrain of ['grass','sand','sea','water'])assert.deepEqual(await renderTacticalMap({...base,cells:[...base.cells,{x:1,y:1,terrain,visibility:'unknown'}]},{terrainTextures:{[terrain]:'https://must-not-load.invalid'}}),expected);
});

test('cover and fog are drawn only for known cells and cannot disclose obscured creatures',async()=>{
 const map={width:2,height:2,terrainRulesVersion:1,cells:[{x:0,y:0,terrain:'floor',visibility:'visible',obscurement:'heavy',creaturesVisible:false}]};
 const base=await renderTacticalMap(map);
 assert.deepEqual(await renderTacticalMap({...map,tokens:[{characterId:'hidden',displayName:'SECRET',x:0,y:0}]},{portraits:{hidden:'https://must-not-load.invalid'}}),base);
 for(const cover of ['half','three-quarters','total'])assert.deepEqual(await renderTacticalMap({...map,cells:[...map.cells,{x:1,y:1,visibility:'unknown',terrain:'floor',cover,obscurement:'heavy'}]}),base);
 assert.notDeepEqual(await renderTacticalMap({...map,cells:[{...map.cells[0],cover:'half'}]}),base);
});
