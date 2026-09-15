import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderArchitecture,projectMarker} from './projection.mjs';
const geometry=JSON.parse(await readFile(new URL('../art/architecture/r01-projection.json',import.meta.url),'utf8'));
const images={background:'/art/architecture/r01-cutaway.png',portraits:{mara:'/art/table/mara.png'}};
const makeView=()=>({catalog:{rooms:[{id:'R01',name:'Brass Vestibule',width:18,depth:12,height:10,pois:[{id:'R01-a',name:'Public service roster',description:'Recorded observation'},{id:'R01-b',name:'Speaking tube',description:'Recorded tube observation'}]}]},state:{poiIds:{}},party:[{id:'mara',name:'Mara Venn',roomId:'R01',x:.3,y:.4,hp:20,maxHp:28}]});

test('all three rendered images match the camera metadata and PNG dimensions',async()=>{
 assert.equal(Object.keys(geometry.views).length,3);
 for(const [layer,camera]of Object.entries(geometry.views)){
  const png=await readFile(new URL('../art/architecture/'+layer+'.png',import.meta.url));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),camera.width);assert.equal(png.readUInt32BE(20),camera.height);
  for(const x of[0,.25,.5,.75,1])for(const y of[0,.25,.5,.75,1]){const [px,py]=projectMarker(camera,{x,y});assert.ok(px>=0&&px<=camera.width);assert.ok(py>=0&&py<=camera.height);}
 }
});
test('top-down physical scale agrees with Blender orthographic camera, not an arbitrary image fit',()=>{
 const c=geometry.views['r01-floor-slice'];assert.ok(Math.abs(c.xAxis[0]-c.origin[0]-1600*18/27)<.001);assert.ok(Math.abs(c.yAxis[1]-c.origin[1]+1600*12/27)<.001);
 assert.ok(Math.abs(c.xAxis[1]-c.origin[1])<.001);assert.ok(Math.abs(c.yAxis[0]-c.origin[0])<.001);assert.deepEqual(c.zAxis,c.origin);
});
test('same normalized marker location projects consistently into every layer',()=>{
 const view=makeView();for(const layer of Object.keys(geometry.views)){
  const svg=renderArchitecture(view,{geometry,layer,images,grid:true}),[x,y]=projectMarker(geometry.views[layer],view.party[0]);
  assert.ok(svg.includes(`data-floor-x="${Number(x.toFixed(3))}"`));assert.ok(svg.includes(`data-floor-y="${Number(y.toFixed(3))}"`));assert.match(svg,/Mara Venn/);assert.match(svg,/5 ft grid/);
 }
});
test('undiscovered room, changed geometry, and off-map positions are rejected',()=>{
 const view=makeView();view.catalog.rooms=[];assert.throws(()=>renderArchitecture(view,{geometry,layer:'r01-cutaway',images}),/not discovered/);
 const changed=makeView();changed.catalog.rooms[0].width=19;assert.throws(()=>renderArchitecture(changed,{geometry,layer:'r01-cutaway',images}),/no longer matches/);
 for(const x of[-1,1.01,NaN,Infinity])assert.throws(()=>projectMarker(geometry.views['r01-cutaway'],{x,y:.5}),/outside/);
});
test('only discovered notes and players in this room appear',()=>{
 const view=makeView();view.party.push({id:'ivo',name:'Elsewhere',roomId:'R04',x:.2,y:.2});
 const hidden=renderArchitecture(view,{geometry,layer:'r01-cutaway',images});assert.doesNotMatch(hidden,/data-poi|Elsewhere|Recorded observation/);
 view.state.poiIds['R01-a']={};const known=renderArchitecture(view,{geometry,layer:'r01-cutaway',images});assert.match(known,/data-poi="R01-a"/);assert.doesNotMatch(known,/data-poi="R01-b"/);
});
test('player names cannot inject SVG and images cannot fetch arbitrary URLs',()=>{
 const view=makeView();view.party[0].name='<script>alert(1)</script>';const svg=renderArchitecture(view,{geometry,layer:'r01-cutaway',images});assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);
 assert.throws(()=>renderArchitecture(view,{geometry,layer:'r01-cutaway',images:{...images,background:'https://example.com/private'}}),/approved local PNG/);
});
test('both local SD material outputs match their recorded provenance',async()=>{
 for(const name of['harbor-limestone','tidal-brass']){
  const p=JSON.parse(await readFile(new URL('../art/architecture/'+name+'.provenance.json',import.meta.url),'utf8'));const bytes=await readFile(new URL('../art/architecture/'+name+'.png',import.meta.url));assert.equal(p.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(p.endpoint,'http://127.0.0.1:7860');assert.equal(p.request.steps,32);assert.ok(p.request.prompt.length>600);assert.ok(p.responseInfo.sd_model_hash);
 }
});
