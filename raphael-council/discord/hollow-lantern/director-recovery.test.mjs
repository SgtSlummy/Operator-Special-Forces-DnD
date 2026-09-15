import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectorRecoveryAdapter} from './director-recovery.mjs';
function fixture(){
 let member=true,time=0,current={status:'pending',ready:true,commandId:'director:original'},failure=false,reads=0;
 const calls=[],scopes=[];
 const runtime={getDirectorRecovery:async()=>{reads++;return {...current};},resolveDirectorRecovery:async input=>{calls.push(input);if(failure)throw new Error('private transport details');return {success:true,resolution:'cancelled'};}};
 let selected=runtime;
 const adapter=createDirectorRecoveryAdapter({getRuntime:()=>selected,campaignId:'campaign',gmUserId:'dm',guildId:'guild',applicationId:'app',authorize:async scope=>{scopes.push(scope);return member;},now:()=>time});
 const interaction=(customId,userId='dm')=>{const replies=[];return {customId,user:{id:userId},guildId:'guild',applicationId:'app',replies,reply:async p=>replies.push(p),deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p)};};
 return {adapter,runtime,calls,scopes,interaction,get reads(){return reads;},setMember:v=>member=v,setCurrent:v=>current=v,setRuntime:v=>selected=v,setFailure:v=>failure=v,expire:()=>time=600001};
}
const buttons=p=>p.components[0].components.flatMap(c=>c.type===1?c.components:[]);
test('private recovery reuses supplied runtime and resolves only its bound command once',async()=>{
 const f=fixture();try{const p=await f.adapter.panel({userId:'dm'});assert.equal(p.flags,32768|64);assert.deepEqual(p.allowedMentions,{parse:[]});assert.doesNotMatch(JSON.stringify(p),/director:original|authorityEpoch|aiDirectorId/);const id=buttons(p)[0].custom_id;await Promise.all([f.adapter.handleInteraction(f.interaction(id)),f.adapter.handleInteraction(f.interaction(id))]);assert.deepEqual(f.calls,[{userId:'dm',commandId:'director:original'}]);assert(f.scopes.every(s=>s.campaignId==='campaign'&&s.userId==='dm'&&s.audience==='gm'));assert.equal(f.reads,2);}finally{f.adapter.close();}
});
test('copied controls cannot consume the real GM token across user guild or application',async()=>{
 for(const kind of ['user','guild','application']){const f=fixture();try{const id=buttons(await f.adapter.panel({userId:'dm'}))[0].custom_id,i=f.interaction(id,kind==='user'?'player':'dm');if(kind==='guild')i.guildId='other';if(kind==='application')i.applicationId='other';await f.adapter.handleInteraction(i);assert.equal(f.calls.length,0);assert.equal(i.replies[0].flags,64);await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,1);}finally{f.adapter.close();}}
});
test('revoked expired stale unready and replaced-runtime controls never resolve',async()=>{
 for(const kind of ['revoked','expired','stale','unready','runtime']){const f=fixture();try{const id=buttons(await f.adapter.panel({userId:'dm'}))[0].custom_id;if(kind==='revoked')f.setMember(false);if(kind==='expired')f.expire();if(kind==='stale')f.setCurrent({status:'pending',ready:true,commandId:'new'});if(kind==='unready')f.setCurrent({status:'pending',ready:false,commandId:'director:original'});if(kind==='runtime')f.setRuntime({...f.runtime});await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,0,kind);}finally{f.adapter.close();}}
});
test('entry opens privately and guidance never offers resolution early',async()=>{
 const f=fixture();try{assert.equal(f.adapter.entryButton({userId:'player'}),null);assert.equal(f.adapter.matches({customId:'hl:other'}),false);f.setCurrent({status:'pending',ready:false,commandId:'director:original'});const i=f.interaction(f.adapter.entryButton({userId:'dm'}).custom_id);await f.adapter.handleInteraction(i);assert.equal(i.replies[0].flags,64);assert.match(JSON.stringify(i.replies[1]),/Pause decisions.*Human DM/);assert.equal(buttons(i.replies[1]).length,0);assert.equal(f.calls.length,0);}finally{f.adapter.close();}
});
test('uncertainty discloses no internals and allows fresh inspection',async()=>{
 const f=fixture();try{f.setFailure(true);const id=buttons(await f.adapter.panel({userId:'dm'}))[0].custom_id,i=f.interaction(id);await f.adapter.handleInteraction(i);assert.equal(f.calls.length,1);assert.match(JSON.stringify(i.replies),/Reopen/);assert.doesNotMatch(JSON.stringify(i.replies),/private transport details/);assert.equal(buttons(await f.adapter.panel({userId:'dm'})).length,1);await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,1);}finally{f.adapter.close();}
});
test('revocation during retrieval prevents private panel delivery',async()=>{
 const f=fixture();try{f.runtime.getDirectorRecovery=async()=>{f.setMember(false);return {status:'pending',ready:true,commandId:'private'};};await assert.rejects(f.adapter.panel({userId:'dm'}),/access changed/i);assert.equal(f.calls.length,0);}finally{f.adapter.close();}
});
test('empty unavailable and closed adapters cannot resolve anything',async()=>{
 const f=fixture();for(const state of [{status:'empty',ready:false},{status:'unavailable',ready:false}]){f.setCurrent(state);assert.equal(buttons(await f.adapter.panel({userId:'dm'})).length,0);}f.setRuntime(null);assert.equal(buttons(await f.adapter.panel({userId:'dm'})).length,0);const id=f.adapter.entryButton({userId:'dm'}).custom_id;f.adapter.close();assert.equal(f.adapter.entryButton({userId:'dm'}),null);await f.adapter.handleInteraction(f.interaction(id));assert.equal(f.calls.length,0);
});
