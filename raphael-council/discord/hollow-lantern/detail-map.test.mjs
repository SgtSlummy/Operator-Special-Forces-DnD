import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderTacticalMap} from './renderers.mjs';
const own={characterId:'hero',displayName:'Mara',x:12,y:12};
const map={width:25,height:25,scaleFeet:5,viewerCharacterId:'hero',tokens:[own],cells:[{x:12,y:12,terrain:'floor',visibility:'visible'},{x:11,y:12,terrain:'floor',visibility:'remembered'}]};
async function pixels(buffer){const i=await loadImage(buffer),c=createCanvas(i.width,i.height),ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {width:i.width,height:i.height,data:ctx.getImageData(0,0,i.width,i.height).data};}
function art(hidden){const c=createCanvas(250,250),ctx=c.getContext('2d');ctx.fillStyle='#234567';ctx.fillRect(0,0,250,250);if(hidden){ctx.fillStyle='#ff0022';ctx.fillRect(130,120,10,10);}return c.toBuffer('image/png');}
test('nearby uses 9 by 9 at 64 pixels while overview remains 25 by 25',async()=>{
 const overview=await pixels(await renderTacticalMap(map));const nearby=await pixels(await renderTacticalMap(map,{detail:true}));
 assert.equal(overview.width,880);assert.equal(nearby.width,656);assert.equal(nearby.height,828);
 // Controlled marker remains in the central global cell (13,13), local (5,5).
 const offset=((110+4*64+2)*nearby.width+40+4*64+3)*4;
 assert.deepEqual([...nearby.data.slice(offset,offset+3)],[130,238,227]);
});
test('detail falls back to unchanged overview without authorized visible own token',async()=>{
 for(const m of [{...map,viewerCharacterId:undefined},{...map,cells:[]},{...map,tokens:[]}]) assert.deepEqual(await renderTacticalMap(m,{detail:true}),await renderTacticalMap(m));
});
test('detail clips hidden art and off-frame or concealed entities before rendering',async()=>{
 const expected=await renderTacticalMap(map,{detail:true,background:art(false)});
 assert.deepEqual(await renderTacticalMap({...map,cells:[...map.cells,{x:13,y:12,terrain:'wall',visibility:'unknown',cover:'total'}],tokens:[own,{characterId:'hidden',displayName:'SECRET',x:13,y:12},{characterId:'far',displayName:'FAR',x:0,y:0}],objects:[{x:13,y:12,kind:'door'},{x:0,y:0,kind:'stairs'}]},{detail:true,background:art(true),portraits:{hidden:'https://invalid.example',far:'https://invalid.example'}}),expected);
});
test('detail background sampling retains global coordinates and edge viewport stays within map',async()=>{
 const c=createCanvas(250,250),ctx=c.getContext('2d');ctx.fillStyle='#aa1122';ctx.fillRect(0,0,250,250);ctx.fillStyle='#123456';ctx.fillRect(110,120,10,10);
 const p=await pixels(await renderTacticalMap({...map,cells:[...map.cells,{x:11,y:12,terrain:'floor',visibility:'visible'}]},{detail:true,background:c.toBuffer('image/png')}));
 const offset=((110+4*64+30)*p.width+40+3*64+30)*4;assert.deepEqual([...p.data.slice(offset,offset+3)],[18,52,86]);
 const corner={...own,x:24,y:24};assert.equal((await pixels(await renderTacticalMap({...map,tokens:[corner],cells:[{x:24,y:24,terrain:'floor',visibility:'visible'}]},{detail:true}))).width,656);
});
