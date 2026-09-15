import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {roomMap,roomScene,atlasMap,roomIndex,worldMap,sceneOverlay} from './render.mjs';
import {CATALOG} from './catalog.mjs';
const room={id:'KNOWN',name:'Visible room',areaId:'town',floor:'Ground',width:40,depth:20,height:10,x:0,y:0,z:0,kind:'home',visibleFeatures:['Timber floor'],pois:[{id:'VISIBLE',name:'Writing desk',x:.3,y:.4}]};
const catalog={rooms:[room],links:[{from:'KNOWN',to:'UNAUTHORIZED_ROOM',description:'UNAUTHORIZED_PASSAGE'}],places:[],roads:[]};
test('standalone exports are well-formed XML for every room and combined atlas',()=>{
 const documents=CATALOG.rooms.flatMap(r=>[['plan '+r.id,roomMap(r)],['cutaway '+r.id,roomScene(r)],['index '+r.id,roomIndex({rooms:[r],links:[]})],['overlay '+r.id,sceneOverlay(r)]]);
 documents.push(['full index',roomIndex(CATALOG)],['full town',atlasMap(CATALOG,[],{iso:false,grid:true})],['full cutaway',atlasMap(CATALOG)],['world',worldMap(CATALOG,{})]);
 const script='import json,sys,xml.etree.ElementTree as E\nfor name,svg in json.load(sys.stdin):\n try: E.fromstring(svg)\n except Exception as error: raise AssertionError(name+": "+str(error))\n';
 const result=spawnSync('python',['-c',script],{input:JSON.stringify(documents),encoding:'utf8',maxBuffer:1024*1024});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
});
test('every authored room renders finite measured plans and rotated cutaways',()=>{
 assert.equal(CATALOG.rooms.length,35);
 for(const r of CATALOG.rooms)for(const svg of [roomMap(r),roomScene(r),atlasMap({rooms:[r],links:[]},[],{angle:137}),roomIndex({rooms:[r],links:[]})]){
  assert.match(svg,/<svg/);assert.doesNotMatch(svg,/NaN|Infinity|undefined/);assert.match(svg,/viewBox=/);
 }
});
test('rendering consumes only projected rooms, links and points of interest',()=>{
 for(const svg of [roomMap(room),roomScene(room),sceneOverlay(room),atlasMap(catalog),atlasMap(catalog,[],{iso:false,grid:true}),roomIndex(catalog),worldMap(catalog,{})])assert.doesNotMatch(svg,/UNAUTHORIZED_ROOM|UNAUTHORIZED_PASSAGE|UNAUTHORIZED_POI/);
 assert.equal((roomIndex(catalog).match(/data-room=/g)||[]).length,1);
 assert.equal((roomMap(room).match(/data-poi=/g)||[]).length,1);
 assert.doesNotMatch(roomMap({...room,pois:[]}),/Writing desk|data-poi=/);
});
test('titles, attributes and image sources cannot inject markup',()=>{
 const evil='<script>alert(1)</script>" onload="evil';
 const r={...room,id:evil,name:evil,floor:evil,width:evil,pois:[{id:evil,name:evil,x:0,y:1}]};
 for(const svg of [roomMap(r),roomScene(r),sceneOverlay(r),roomIndex({rooms:[r]},[],{artData:{[evil]:'javascript:alert(1)'}})]){
  assert.doesNotMatch(svg,/<script| onload="|javascript:/);assert.match(svg,/&lt;script&gt;/);
 }
});
test('schematic filters do not retain excluded rooms or edges',()=>{
 const other={...room,id:'UPPER_ONLY',areaId:'dungeon',floor:'Upper'};
 const c={rooms:[room,other],links:[{from:room.id,to:other.id,description:'SECRET_ROUTE'}]};
 const svg=roomIndex(c,[],{areaId:'town',floor:'Ground'});
 assert.match(svg,/not a measured floor plan/);assert.doesNotMatch(svg,/UPPER_ONLY|SECRET_ROUTE/);
 assert.match(roomIndex(c,[],{floor:'Upper'}),/UPPER_ONLY/);
 assert.doesNotMatch(roomIndex(c,[],{floor:'Missing'}),/data-room=/);
});
test('room pin coordinates coincide with measured grid and party coordinates',()=>{
 const svg=roomMap(room,[{name:'Hero',roomId:room.id,x:.3,y:.4}]);
 // 40×20 feet at 20.5 px/foot: origin 90,120; point .3,.4 = 336,284.
 assert.equal((svg.match(/cx="336" cy="284"/g)||[]).length,3);
 assert.match(svg,/x1="192.5" y1="120" x2="192.5" y2="530"/);
 assert.match(svg,/5-foot squares/);
 assert.doesNotMatch(roomMap(room,[],{grid:false}),/x1="192.5" y1="120" x2="192.5" y2="530"/);
 assert.match(sceneOverlay(room),/cx="300" cy="260"/);
});
test('town grid is measured and uses only known geometry',()=>{
 const svg=atlasMap(catalog,[],{iso:false,grid:true});
 assert.match(svg,/id="town-five-foot-grid"/);assert.match(svg,/20 ft · 5-foot squares/);
 assert.doesNotMatch(atlasMap(catalog,[],{iso:false,grid:false}),/town-five-foot-grid/);
});
test('photo index supports same-origin images and safe self-contained PNGs',()=>{
 assert.match(roomIndex(catalog),/href="\/art\/room\/KNOWN.png"/);
 assert.match(roomIndex(catalog,[],{artData:{KNOWN:'data:image/png;base64,YQ=='}}),/href="data:image\/png;base64,YQ=="/);
 const svg=roomIndex({rooms:CATALOG.rooms,links:CATALOG.links});assert.equal((svg.match(/data-room=/g)||[]).length,35);
});
