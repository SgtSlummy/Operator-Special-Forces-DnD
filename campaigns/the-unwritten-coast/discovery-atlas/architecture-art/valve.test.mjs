import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CATALOG} from '../catalog.mjs';
import {architectureIllustration} from './delivery.mjs';
import {projectMarker} from './projection.mjs';
const room=CATALOG.rooms.find(r=>r.id==='R02');
const geometry=JSON.parse(await readFile(new URL('../art/architecture/r02-projection.json',import.meta.url),'utf8'));
const view={catalog:{rooms:[room]},state:{poiIds:{}},party:[{id:'mara',name:'Mara Venn',roomId:'R02',x:.55,y:.2,hp:20,maxHp:28}]};
test('Valve Throat dimensions, slices and POI anchors match its existing catalog',async()=>{
 assert.deepEqual(geometry.dimensionsFeet,{width:4,depth:6,height:5});assert.equal(geometry.horizontalSectionFeet,2.5);
 for(const feature of geometry.features){const poi=room.pois.find(p=>p.id===feature.id);assert.equal(feature.x,poi.x);assert.equal(feature.y,poi.y);}
 assert.equal(Object.keys(geometry.views).length,3);
 for(const [layer,camera]of Object.entries(geometry.views)){
  const png=await readFile(new URL('../art/architecture/'+layer+'.png',import.meta.url));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),camera.width);assert.equal(png.readUInt32BE(20),camera.height);
  const svg=await architectureIllustration(view,{roomId:'R02',layer});assert.match(svg,/Mara Venn/);assert.doesNotMatch(svg,/data-poi=/);
  const [x,y]=projectMarker(camera,view.party[0]).map(n=>Number(n.toFixed(3)));assert.ok(svg.includes(`data-floor-x="${x}" data-floor-y="${y}"`));
 }
});
test('second room preserves discovery and cannot substitute another room image',async()=>{
 await assert.rejects(architectureIllustration({...view,catalog:{rooms:[]}},{roomId:'R02'}),/Not discovered/);
 await assert.rejects(architectureIllustration(view,{roomId:'R02',layer:'r01-cutaway'}),/Unknown/);
 const known={...view,state:{poiIds:{'R02-b':true}}};
 for(const layer of Object.keys(geometry.views)){
  const svg=await architectureIllustration(known,{roomId:'R02',layer});assert.match(svg,/data-poi="R02-b"/);assert.doesNotMatch(svg,/data-poi="R02-a"/);
  const feature=geometry.features[1],[x,y]=projectMarker(geometry.views[layer],{...feature,z:layer==='r02-cutaway'?feature.z:0}).map(n=>Number(n.toFixed(3)));assert.ok(svg.includes(`M ${x} ${y-8} l 8 8`));
 }
});
