import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRulingCommit} from './exercise-ruling.mjs';
const fixture=()=>{
 const before={campaignId:'fixture',revision:7,pendingActions:[{id:'pending'}],actors:[{hp:10,gold:3}],worldMinutes:4,receipts:{},publicEvents:[]};
 const request={type:'gm_resolve',commandId:'command',payload:{pendingId:'pending',approved:false}};
 const receipt={success:true,campaignId:'fixture',commandId:'command',revision:8};
 return {before,after:{...structuredClone(before),revision:8,pendingActions:[],receipts:{command:{response:receipt}}},attempts:[request],receipts:[receipt]};
};
test('ruling acceptance requires matching persisted receipt and unchanged mechanics',()=>{assert.equal(evaluateRulingCommit(fixture()).passed,true);for(const change of [v=>v.after.actors[0].gold++,v=>v.after.worldMinutes++,v=>v.after.pendingActions.push({id:'new'}),v=>delete v.after.receipts.command,v=>v.receipts[0].campaignId='another']){const v=fixture();change(v);assert.equal(evaluateRulingCommit(v).passed,false);}});
test('wrong decision, repeated submit and unmatched command cannot pass',()=>{for(const change of [v=>v.attempts[0].payload.approved=true,v=>v.attempts.push(v.attempts[0]),v=>v.attempts[0].commandId='other',v=>v.attempts[0].payload.pendingId='other']){const v=fixture();change(v);assert.equal(evaluateRulingCommit(v).passed,false);}});

const approval=()=>{const v=fixture();v.approved=true;v.requireExplanation=true;v.attempts[0].payload.approved=true;v.attempts[0].payload.text='Narrative action allowed; this does not grant a discovery.';v.receipts[0].result={message:'DM approved: '+v.attempts[0].payload.text};return v;};
test('approval with explanation requires the actual note in the matching persisted receipt',()=>{
 const v=approval(),result=evaluateRulingCommit(v);assert.equal(result.passed,true);assert.equal(result.singleRequestedRuling,true);assert.equal(result.singleDecline,false);assert.equal(result.explanationRecorded,true);
 for(const change of [v=>delete v.attempts[0].payload.text,v=>v.attempts[0].payload.text='   ',v=>delete v.receipts[0].result,v=>v.receipts[0].result.message='DM approved: different note',v=>v.attempts[0].payload.approved=false,v=>v.after.receipts.command={response:{...v.receipts[0],result:{message:'different persisted note'}}}]){
  const changed=approval();change(changed);assert.equal(evaluateRulingCommit(changed).passed,false);
 }
});
