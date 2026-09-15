import test from 'node:test';
import assert from 'node:assert/strict';
import {atlasMap} from './render.mjs';
const room=(id,floor=-1)=>({id,name:id,areaId:'undertow',floor,x:0,y:0,z:floor*20,width:80,depth:20,height:12,kind:'archive',pois:[]});
test('illustrated atlas only emits rooms and occupants in its supplied layer',()=>{
 const svg=atlasMap({rooms:[room('R07'),room('R05',-2)],links:[{from:'R07',to:'SECRET',description:'secret route'}]},[{id:'mara',name:'Mara',roomId:'R07',x:.3,y:.4},{id:'ivo',name:'Ivo',roomId:'SECRET',x:.5,y:.5}],{floor:-1});
 assert.match(svg,/data-room-art="R07"/);assert.match(svg,/data-party-marker="mara"/);
 assert.doesNotMatch(svg,/R05|SECRET|secret route|ivo/);
 assert.match(svg,/data-room="R07" tabindex="0" role="button"/);
 assert.match(svg,/artwork is not a furniture plan/);
});
test('illustrated floor projects a finite parallelogram through rotation',()=>{
 for(const angle of [0,45,90,180,270]){const svg=atlasMap({rooms:[room('R07')],links:[]},[],{angle});const matrix=svg.match(/transform="matrix\(([^)]+)\)"/)[1].split(' ').map(Number);assert.equal(matrix.length,6);assert.ok(matrix.every(Number.isFinite));assert.ok(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])>1);}
});
test('embedded export art is validated and tactical diagrams remain unillustrated',()=>{
 const catalog={rooms:[room('R07')],links:[]};
 assert.match(atlasMap(catalog,[],{artData:{R07:'data:image/png;base64,YQ=='}}),/href="data:image\/png;base64,YQ=="/);
 assert.doesNotMatch(atlasMap(catalog,[],{artData:{R07:'https://evil.invalid/secret'}}),/evil.invalid/);
 assert.doesNotMatch(atlasMap(catalog,[],{iso:false}),/data-room-art/);
 assert.doesNotMatch(atlasMap(catalog,[],{roomOnly:true}),/data-room-art/);
});
