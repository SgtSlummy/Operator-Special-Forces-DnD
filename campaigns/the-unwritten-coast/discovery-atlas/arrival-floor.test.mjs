import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG} from './catalog.mjs';
import {createTable,tableAction,tableProject} from './table-model.mjs';
import {applyAction,positionOnFloor} from './model.mjs';
const gm={role:'gm'};
const fixture=()=>{const state=createTable(CATALOG);state.currentRoomId='R01';state.roomIds.R01={learned:true,visited:true};state.party[0]={...state.party[0],roomId:'R01',x:10/11,y:2/17};state.party[1]={...state.party[1],roomId:'R01',x:2/11,y:2/17};state.party[2]={...state.party[2],roomId:'R02',x:.3,y:.3};return state;};
const arrive=(catalog,state,action={type:'visitRoom',roomId:'R05',override:true,reason:'Isolated arrival test'})=>tableAction(catalog,state,gm,{...action,revision:state.revision});
test('party arrival adjusts invalid floor positions, preserves valid ones and split party',()=>{
 const state=fixture(),before=structuredClone(state),next=arrive(CATALOG,state);
 assert.deepEqual(state,before);assert.equal(next.revision,state.revision+1);
 assert.equal(next.party[0].roomId,'R05');assert.notDeepEqual(next.party[0],state.party[0]);
 assert.deepEqual({x:next.party[1].x,y:next.party[1].y},{x:state.party[1].x,y:state.party[1].y});
 assert.deepEqual(next.party[2],state.party[2]);
 for(const p of next.party.filter(p=>p.roomId==='R05'))assert.doesNotThrow(()=>applyAction(CATALOG,next,{type:'moveMarker',markerId:p.id,roomId:'R05',x:p.x,y:p.y}));
 const shared=tableProject(CATALOG,next);assert.ok(shared.catalog.rooms.some(r=>r.id==='R05'));assert.equal(shared.preparation,undefined);
 assert.deepEqual(shared.party.find(p=>p.id===next.party[0].id).x,next.party[0].x);
});
test('road arrival uses the same floor adjustment',()=>{
 const catalog=structuredClone(CATALOG),state=fixture();
 catalog.places=[{id:'start',name:'Start'},{id:'end',name:'Refuge',roomId:'R05'}];catalog.roads=[{id:'test-road',from:'start',to:'end'}];state.currentPlaceId='start';
 const next=arrive(catalog,state,{type:'travelRoad',roadId:'test-road',baseChance:0});
 assert.equal(next.currentRoomId,'R05');assert.equal(next.party[0].roomId,'R05');
 assert.doesNotThrow(()=>applyAction(catalog,next,{type:'moveMarker',markerId:next.party[0].id,roomId:'R05',x:next.party[0].x,y:next.party[0].y}));
});
test('arrival remains DM-only and rejects mismatched geometry atomically',()=>{
 const state=fixture(),before=structuredClone(state);
 assert.throws(()=>tableAction(CATALOG,state,{role:'player',actorId:CATALOG.party[0].id},{type:'visitRoom',roomId:'R05',revision:state.revision}),/Only the DM/);
 const catalog=structuredClone(CATALOG);catalog.rooms.find(r=>r.id==='R05').width=12;
 assert.throws(()=>arrive(catalog,state),/geometry does not match/);assert.deepEqual(state,before);
});
test('position adjustment supports other irregular rooms and leaves rectangular coordinates intact',()=>{
 assert.deepEqual(positionOnFloor({id:'rectangle',width:20,depth:20},{x:.8,y:.2}),{x:.8,y:.2});
 const triangle={id:'triangle',width:10,depth:10,floorPolygonFeet:[[0,0],[10,0],[0,10]]};
 const p=positionOnFloor(triangle,{x:.9,y:.9});assert.ok(Math.abs(p.x-.5)<1e-9&&Math.abs(p.y-.5)<1e-9);
 assert.throws(()=>positionOnFloor(triangle,{x:NaN,y:0}),/Invalid arrival/);
});
