import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from './catalog.mjs';
import { createTable, tableProject, discordScene } from './table-model.mjs';

function opening(){
 const state=createTable(CATALOG);
 state.party=[];
 state.table.opening={description:'Eleven passengers wait aboard.\n\nThe harbor clerk waits beneath the awning.',privatePreparation:'NEVER SHARE',messageIds:['private-metadata']};
 return state;
}
test('verified opening reaches public scene card without preparation or mutation',()=>{
 const state=opening(),before=structuredClone(state),catalogBefore=structuredClone(CATALOG);
 const view=tableProject(CATALOG,state);
 assert.deepEqual(view.catalog.rooms.find(r=>r.id==='f-deck').narration,['Eleven passengers wait aboard.','The harbor clerk waits beneath the awning.']);
 const card=discordScene(view,'f-deck');
 assert.match(card.components[0].components[0].content,/Eleven passengers wait aboard\.\n\nThe harbor clerk/);
 assert.doesNotMatch(JSON.stringify(view),/NEVER SHARE|private-metadata|messageIds/);
 assert.deepEqual(state,before);assert.deepEqual(CATALOG,catalogBefore);
});
test('opening does not replace a progressed scene or replay on returning',()=>{
 for(const currentRoomId of ['f-deck','t-tavern']){
  const state=opening();state.currentRoomId=currentRoomId;state.history=[{text:'The company moved ashore.'}];
  const view=tableProject(CATALOG,state);
  assert.equal(view.catalog.rooms.find(r=>r.id==='f-deck').narration,undefined);
 }
});
test('rehearsal and malformed opening retain authored scene description',()=>{
 for(const value of [undefined,null,{}, {description:''},{description:['not text']}]){
  const state=createTable(CATALOG);state.table.opening=value;
  const view=tableProject(CATALOG,state),room=view.catalog.rooms.find(r=>r.id==='f-deck');
  assert.equal(room.narration,undefined);
  assert.ok(discordScene(view,'f-deck').components[0].components[0].content.includes(room.description));
 }
});
