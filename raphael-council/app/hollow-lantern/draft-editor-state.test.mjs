import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedDraftRead,emptyDraftEditor,selectDraftAction,receiveDraft,editDraftText,useSavedDraft,reviewDraft,acceptSavedDraft,draftDirty,draftRequestQuery} from './draft-editor-state.mjs';
test('obsolete failed read cannot replace a newer result; current failures remain visible',async()=>{
 let generation=1,rejectOld;const old=guardedDraftRead(()=>new Promise((resolve,reject)=>{rejectOld=reject;}),()=>generation===1);
 generation=2;assert.deepEqual(await guardedDraftRead(async()=>({draft:'new'}),()=>generation===2),{draft:'new'});
 rejectOld(new Error('obsolete network failure'));assert.equal(await old,null);
 await assert.rejects(()=>guardedDraftRead(async()=>{throw new Error('current failure');},()=>true),/current failure/);
 assert.equal(await guardedDraftRead(async()=>({draft:'obsolete'}),()=>false),null);
});
const action={id:'inspect',label:'Inspect door',type:'interact',fields:[{id:'text',multiline:true,maxLength:1500}]};
const view={campaignId:'camp',selectedActor:'hero',viewToken:'original',revision:3,actions:[action]};
const draft={draftId:'one',version:1,status:'editing',actionId:'inspect',input:{text:'Saved text'},expectedRevision:3};
test('typing survives same saved version refresh with original context',()=>{
 let s=receiveDraft(emptyDraftEditor(),draft,view);s=reviewDraft(s,view,'dungeon');s=editDraftText(s,'My unsaved question');
 s=receiveDraft(s,draft,{...view,viewToken:'new',revision:4});
 assert.equal(s.buffer.text,'My unsaved question');assert.equal(s.buffer.context.viewToken,'original');assert.equal(s.buffer.context.level,'dungeon');assert.equal(s.conflict,false);
 assert.match(draftRequestQuery(s.buffer.context),/level=dungeon/);
});
test('newer remote draft retains dirty text until explicit resolution',()=>{
 let s=receiveDraft(emptyDraftEditor(),draft,view);s=editDraftText(s,'Keep this');s=receiveDraft(s,{...draft,version:2,input:{text:'Other tab'}},view);
 assert.equal(s.conflict,true);assert.equal(s.buffer.text,'Keep this');
 const replaced=useSavedDraft(s,view);assert.equal(replaced.buffer.text,'Other tab');assert.equal(replaced.conflict,false);
 const reviewed=reviewDraft(s,{...view,viewToken:'fresh',revision:5},'tactical');assert.equal(reviewed.buffer.text,'Keep this');assert.equal(reviewed.saved.version,2);assert.equal(reviewed.buffer.context.revision,5);
});
test('different action selection never silently retargets written text',()=>{
 let s=selectDraftAction(emptyDraftEditor(),{action,view,level:'tactical',text:'Original thought'});
 s=selectDraftAction(s,{action:{...action,id:'talk',label:'Talk'},view,level:'dungeon'});
 assert.equal(s.buffer.actionId,'inspect');assert.equal(s.buffer.text,'Original thought');assert.equal(s.pending.action.id,'talk');
 s=selectDraftAction({...s,buffer:null},s.pending);assert.equal(s.buffer.actionId,'talk');
});
test('Save response enables Try only for saved text; prepared draft remains recoverable',()=>{
 let s=selectDraftAction(emptyDraftEditor(),{action,view,level:'tactical',text:'Saved text'});assert.equal(draftDirty(s),true);
 s=acceptSavedDraft(s,draft);assert.equal(draftDirty(s),false);
 s=receiveDraft(s,{...draft,version:2,status:'prepared'},view);assert.equal(s.saved.status,'prepared');assert.equal(draftDirty(s),false);
});
