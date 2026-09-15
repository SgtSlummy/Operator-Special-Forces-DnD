import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG} from './catalog.mjs';
import {initialState,applyAction} from './model.mjs';
import geometry from './art/architecture/r05-projection.json' with {type:'json'};
const setup=(catalog=CATALOG,id='R05')=>{const state=initialState(catalog);state.roomIds[id]={learned:true,visited:true};state.party=[{id:'test-marker',name:'Test explorer',roomId:id,x:.5,y:.5}];return state;};
const move=(state,x,y,catalog=CATALOG,id='R05')=>applyAction(catalog,state,{type:'moveMarker',markerId:'test-marker',roomId:id,x,y});
test('R05 missing corner rejects movement without mutating state',()=>{
 const state=setup(),before=structuredClone(state);
 for(const [x,y] of [[10,2],[7.01,4.99],[11,0]])assert.throws(()=>move(state,x/11,y/17),/outside the room floor/);
 assert.deepEqual(state,before);
});
test('R05 accepts both arms and inner boundary of the measured L',()=>{
 const room=CATALOG.rooms.find(r=>r.id==='R05');
 assert.equal(room.width,geometry.dimensionsFeet.width);assert.equal(room.depth,geometry.dimensionsFeet.depth);
 for(const [x,y] of [[2,2],[10,10],[7,2],[10,5],[7,5],[0,0],[11,17]]){
  const state=setup(),next=move(state,x/11,y/17);
  assert.equal(next.revision,state.revision+1);assert.equal(next.party[0].x,x/11);assert.equal(next.party[0].y,y/17);
 }
});
test('rectangular rooms keep their bounds and unseen rooms stay inaccessible',()=>{
 const state=setup(CATALOG,'R01');
 assert.equal(move(state,.99,.01,CATALOG,'R01').party[0].x,.99);
 assert.throws(()=>move(state,1.01,.5,CATALOG,'R01'),/outside room bounds/);
 delete state.roomIds.R01;
 assert.throws(()=>move(state,.5,.5,CATALOG,'R01'),/exposed and adjacent/);
});
test('a changed measured room or malformed footprint fails closed',()=>{
 const catalog=structuredClone(CATALOG),r=catalog.rooms.find(r=>r.id==='R05');r.width=12;
 assert.throws(()=>move(setup(catalog),.5,.5,catalog),/geometry does not match/);
 const generic=structuredClone(CATALOG);generic.rooms.find(r=>r.id==='R01').floorPolygonFeet=[[0,0],[NaN,1],[1,1]];
 assert.throws(()=>move(setup(generic,'R01'),.5,.5,generic,'R01'),/Invalid room floor geometry/);
});
