import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startTable,previewState} from '../table-server.mjs';
import {CATALOG} from '../catalog.mjs';
import {tableProject} from '../table-model.mjs';
import {architectureIllustration} from './delivery.mjs';
import {projectMarker} from './projection.mjs';

const geometry=JSON.parse(await readFile(new URL('../art/architecture/r01-projection.json',import.meta.url)));
function seed(){const s=previewState();s.party[0]={...s.party[0],roomId:'R01',x:.37,y:.61};s.poiIds={};return s;}

test('delivery uses current room positions on all three architectural views',async()=>{
 const v=tableProject(CATALOG,seed(),{role:'shared'});
 for(const layer of Object.keys(geometry.views)){
  const svg=await architectureIllustration(v,{roomId:'R01',layer});
  const [x,y]=projectMarker(geometry.views[layer],v.party[0]).map(n=>Number(n.toFixed(3)));
  assert.ok(svg.includes(`data-floor-x="${x}" data-floor-y="${y}"`));
  assert.ok(svg.includes('data-player="mara"'));
  assert.ok(!svg.includes('data-player="ivo"'));
  assert.ok(!svg.includes('data-poi='));
  assert.equal((svg.match(/data:image\/png;base64,/g)||[]).length,2);
 }
});
test('delivery includes a discovered note only and refuses arbitrary asset selection',async()=>{
 const s=seed();s.poiIds['R01-a']={discovered:true};
 const v=tableProject(CATALOG,s,{role:'shared'});
 const svg=await architectureIllustration(v,{roomId:'R01'});
 assert.ok(svg.includes('data-poi="R01-a"'));assert.ok(!svg.includes('data-poi="R01-b"'));
 await assert.rejects(architectureIllustration(v,{roomId:'R01',layer:'../../table-server.mjs'}));
 delete s.roomIds.R01;
 await assert.rejects(architectureIllustration(tableProject(CATALOG,s,{role:'shared'}),{roomId:'R01'}),/Not discovered/);
});
test('HTTP illustration is discovery gated and raw geometry/art have no public route',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coast-architecture-'));let server;
 try{
  server=await startTable({gmPort:0,playerPort:0,stateFile:join(root,'state.json'),seed});
  const base=`http://127.0.0.1:${server.player.address().port}`;
  const response=await fetch(base+'/api/architecture?room=R01&layer=r01-floor-slice');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/svg\+xml/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.ok((await response.text()).includes('data-player="mara"'));
  for(const path of ['/api/architecture?room=R99','/art/architecture/r01-cutaway.png','/art/architecture/r01-projection.json'])assert.equal((await fetch(base+path)).status,404);
  await server.close();server=null;
  server=await startTable({gmPort:0,playerPort:0,stateFile:join(root,'hidden.json'),seed:()=>{const s=seed();delete s.roomIds.R01;return s;}});
  assert.equal((await fetch(`http://127.0.0.1:${server.player.address().port}/api/architecture?room=R01`)).status,404);
 }finally{if(server)await server.close();await rm(root,{recursive:true,force:true});}
});
