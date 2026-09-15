import test from 'node:test';
import assert from 'node:assert/strict';
import {renderIllustratedOverview,renderOverview} from './renderers.mjs';
const base={level:'dungeon',title:'Known rooms',currentId:'hall',nodes:[{id:'hall',name:'Intake hall',discovered:true},{id:'gallery',name:'Turbine gallery',discovered:true}],edges:[{from:'hall',to:'gallery',discovered:true}]};
test('undiscovered rooms cannot change image layout, pixels, or cause artwork lookup',async()=>{
 const expected=await renderIllustratedOverview(base);let reads=0;
 const roomVignettes={};Object.defineProperty(roomVignettes,'secret',{get(){reads++;throw Error('Hidden asset accessed');}});
 const hidden={id:'secret',discovered:false,x:999,y:-999};Object.defineProperty(hidden,'name',{get(){throw Error('Hidden room name accessed');}});
 const actual=await renderIllustratedOverview({...base,nodes:[hidden,...base.nodes],edges:[...base.edges,{from:'hall',to:'secret',discovered:true},{from:'secret',to:'gallery',discovered:true}]},{roomVignettes});
 assert.deepEqual(actual,expected);assert.equal(reads,0);
});
test('undiscovered passage between known rooms is absent from image',async()=>{
 const map={...base,edges:[]};assert.deepEqual(await renderIllustratedOverview({...map,edges:[{from:'hall',to:'gallery',discovered:false,directed:true,minutes:99}]}),await renderIllustratedOverview(map));
});
test('known room without approved artwork retains the same usable fallback as unavailable art',async()=>{
 assert.deepEqual(await renderIllustratedOverview(base,{roomVignettes:{hall:'https://unapproved.example.test/private-map.png'}}),await renderIllustratedOverview(base));
});
test('regional overview keeps its existing route rendering',async()=>{
 const map={...base,level:'regional'};assert.deepEqual(await renderIllustratedOverview(map),renderOverview(map));
});
