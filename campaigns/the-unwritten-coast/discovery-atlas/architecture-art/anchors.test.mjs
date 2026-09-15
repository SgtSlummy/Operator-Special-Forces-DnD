import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {CATALOG} from '../catalog.mjs';
import {renderArchitecture,projectMarker} from './projection.mjs';
const geometry=JSON.parse(await readFile(new URL('../art/architecture/r01-projection.json',import.meta.url),'utf8'));
const room=CATALOG.rooms.find(r=>r.id==='R01');
const images={background:'/art/architecture/r01-cutaway.png',portraits:{}};
test('aligned discovery notes render on the actual room art in every slice',async()=>{
 const {chromium}=createRequire(import.meta.url)('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1200}});
  const directory='C:/Users/Hermes/LocalFiles/UnwrittenCoast/architecture-alignment';await mkdir(directory,{recursive:true});
  for(const layer of Object.keys(geometry.views)){
   const png=await readFile(new URL('../art/architecture/'+layer+'.png',import.meta.url));
   const svg=renderArchitecture({catalog:{rooms:[room]},state:{poiIds:{'R01-a':true,'R01-b':true}},party:[]},{geometry,layer,images:{background:'data:image/png;base64,'+png.toString('base64'),portraits:{}},grid:true});
   await page.setContent('<style>body{margin:0}</style>'+svg);
   await page.evaluate(async()=>{for(const element of document.querySelectorAll('svg image')){const image=new Image();image.src=element.getAttribute('href')||element.getAttribute('xlink:href');await image.decode();}});
   assert.equal(await page.locator('[data-poi]').count(),2);await page.screenshot({path:directory+'/'+layer+'.png'});
  }
 }finally{await browser.close();}
});
test('tactical anchors match physical roster and speaking tube positions measured in Blender',()=>{
 const metres={'R01-a':[2.5603199005,3.5783519745],'R01-b':[.9143999815,3.483864069]};
 for(const poi of room.pois){const expected=metres[poi.id];assert.ok(Math.abs(poi.x*18*.3048-expected[0])<.00001);assert.ok(Math.abs(poi.y*12*.3048-expected[1])<.00001);}
});
test('every architectural layer shares catalog floor anchors and reveals notes only after discovery',()=>{
 const view={catalog:{rooms:[room]},state:{poiIds:{},party:[]},party:[]};
 const before=JSON.stringify(view.state);
 for(const layer of Object.keys(geometry.views)){
  const hidden=renderArchitecture(view,{geometry,layer,images});assert.doesNotMatch(hidden,/data-poi=/);
 }
 assert.equal(JSON.stringify(view.state),before);
 for(const layer of Object.keys(geometry.views)){
  const discovered={...view,state:{...view.state,poiIds:{'R01-a':true}}};
  const rendered=renderArchitecture(discovered,{geometry,layer,images});
  const feature=geometry.features.find(f=>f.id==='R01-a'),poi=room.pois[0];
  const [x,y]=projectMarker(geometry.views[layer],{x:poi.x,y:poi.y,z:layer==='r01-cutaway'?feature.z:0}).map(v=>Number(v.toFixed(3)));
  assert.ok(rendered.includes(`M ${x} ${y-8} l 8 8`),layer);assert.match(rendered,/data-poi="R01-a"/);assert.doesNotMatch(rendered,/data-poi="R01-b"/);
 }
});
