import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtReviewAdapter} from './art-review.mjs';

function fixture(){
 let member=true,current=true,time=0;const calls=[];
 const runtime={getArtReview:async()=>({status:'awaiting-review',candidateId:'candidate',sceneId:'briefing',revision:7,image:Buffer.from('private fixture image')}),approveArt:async input=>{if(!current)throw Object.assign(new Error('The scene changed.'),{name:'ArtReviewError'});calls.push(input);return {status:'approved',published:true};},declineArt:async input=>{calls.push(input);return {status:'retained'};}};
 const adapter=createArtReviewAdapter({getRuntime:()=>runtime,campaignId:'campaign',gmUserId:'dm',guildId:'guild',applicationId:'app',authorize:async()=>member,now:()=>time});
 const interaction=(customId,userId='dm')=>{const replies=[];return {customId,user:{id:userId},guildId:'guild',applicationId:'app',replies,reply:async p=>replies.push(p),deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p)};};
 return {adapter,calls,interaction,setMember:v=>member=v,setCurrent:v=>current=v,expire:()=>time=600001};
}
const buttons=panel=>panel.components[0].components.at(-1).components;

test('private native review has scoped controls and no public URL; copied control cannot approve',async()=>{
 const f=fixture();try{const panel=await f.adapter.panel({userId:'dm'});assert.equal(panel.flags,32768|64);assert.equal(panel.components[0].type,17);assert(Buffer.isBuffer(panel.files[0].attachment));assert.match(JSON.stringify(panel.components),/attachment:\/\/scene-candidate.png/);assert.doesNotMatch(JSON.stringify(panel.components),/http|private fixture image/);
  const id=buttons(panel)[0].custom_id;const copied=f.interaction(id,'player');await f.adapter.handleInteraction(copied);assert.equal(copied.replies[0].flags,64);assert.equal(f.calls.length,0);
  await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,1);await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,1);
 }finally{f.adapter.close();}
});

test('revoked, expired, wrong-guild and stale controls never approve a candidate',async()=>{
 for(const failure of ['revoked','expired','guild','stale']){const f=fixture();try{const panel=await f.adapter.panel({userId:'dm'}),i=f.interaction(buttons(panel)[0].custom_id);if(failure==='revoked')f.setMember(false);if(failure==='expired')f.expire();if(failure==='guild')i.guildId='other';if(failure==='stale')f.setCurrent(false);await f.adapter.handleInteraction(i);assert.equal(f.calls.length,0);assert(i.replies.length>0);}finally{f.adapter.close();}}
});

test('entry button opens a private review without approving and cannot be minted for a player',async()=>{
 const f=fixture();try{assert.equal(f.adapter.entryButton({userId:'player'}),null);const button=f.adapter.entryButton({userId:'dm'}),i=f.interaction(button.custom_id);await f.adapter.handleInteraction(i);assert.equal(i.replies[0].flags,64);assert.equal(i.replies[1].flags,32768|64);assert.equal(f.calls.length,0);assert.equal(f.adapter.matches({customId:'hl:other'}),false);}finally{f.adapter.close();}
});
test('revocation during art retrieval prevents the candidate attachment delivery',async()=>{
 let member=true;
 const adapter=createArtReviewAdapter({campaignId:'campaign',gmUserId:'dm',guildId:'guild',applicationId:'app',authorize:async()=>member,getRuntime:()=>({getArtReview:async()=>{member=false;return {status:'awaiting-review',candidateId:'c',sceneId:'s',revision:1,image:Buffer.from('private')};}})});
 await assert.rejects(adapter.panel({userId:'dm'}),/access changed/i);adapter.close();
});
