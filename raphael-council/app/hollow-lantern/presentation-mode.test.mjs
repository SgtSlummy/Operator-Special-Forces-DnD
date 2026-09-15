import test from 'node:test';
import assert from 'node:assert/strict';
import {choosePresentation,reconcilePresentation} from './presentation-mode.mjs';
const room={campaignId:'rehearsal',selectedActor:'scout',title:'Shore',mode:'exploration',revision:1,illustrations:{scene:true}};
test('arrival leads with available artwork and missing art falls back to tactical',()=>{
 assert.equal(reconcilePresentation(null,room).value,'scene');
 assert.equal(reconcilePresentation(null,{...room,illustrations:{scene:false}}).value,'tactical');
 assert.equal(reconcilePresentation(null,{...room,mode:'combat'}).value,'tactical');
});
test('manual investigation or map selection survives ordinary refreshes and loading',()=>{
 for(const value of ['scene','details','dungeon','tactical']){
  const selected=choosePresentation(room,value);
  assert.equal(reconcilePresentation(selected,{...room,revision:2}),selected);
  assert.equal(reconcilePresentation(selected,null),selected);
 }
});
test('combat starts with tactical but permits a subsequent manual view choice',()=>{
 const details=choosePresentation(room,'details'),combat={...room,mode:'combat'};
 assert.equal(reconcilePresentation(details,combat).value,'tactical');
 const selected=choosePresentation(combat,'details');assert.equal(reconcilePresentation(selected,{...combat,revision:3}),selected);
});
test('new room, actor, or campaign resets presentation without retaining another context',()=>{
 const selected=choosePresentation(room,'details');
 for(const next of [{...room,title:'Cistern'},{...room,selectedActor:'bard'},{...room,campaignId:'other'}])assert.equal(reconcilePresentation(selected,next).value,'scene');
 const identified={...room,sceneId:'shore'};
 assert.equal(reconcilePresentation(choosePresentation(identified,'details'),{...identified,title:'Shore at dusk'}).value,'details');
 assert.equal(reconcilePresentation(choosePresentation(identified,'details'),{...identified,sceneId:'cistern'}).value,'scene');
});
test('ending combat keeps the chosen details view and withdrawn art never leaves an empty Scene',()=>{
 assert.equal(reconcilePresentation(choosePresentation({...room,mode:'combat'},'details'),room).value,'details');
 const noArt={...room,illustrations:{scene:false}};
 assert.equal(reconcilePresentation(choosePresentation(room,'scene'),noArt).value,'tactical');
 assert.equal(choosePresentation(noArt,'scene').value,'tactical');
 assert.equal(choosePresentation(room,'unrecognized'),null);
});
