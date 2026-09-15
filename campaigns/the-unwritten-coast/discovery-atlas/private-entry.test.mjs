import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensurePrivateEntry,privateEntryCard} from './private-entry.mjs';
const binding={guildId:'1463393482306486387',parentChannelId:'1546676505780944979',channelId:'1548204446838689882',applicationId:'1540006061099188274',gmUserId:'1230264975533281312',dmThreadId:'333333333333333333',members:[{ownerId:'123456789012345678',actorId:'mara',threadId:'444444444444444444'}]};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'coast-entry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const manifestFile=join(dir,'entry.json'),messages=[],members=[binding.gmUserId,binding.applicationId],calls=[];
 let failAfterPost=false,failBeforePost=false;
 const thread={id:binding.dmThreadId,guild_id:binding.guildId,parent_id:binding.parentChannelId,type:12,owner_id:binding.applicationId,thread_metadata:{invitable:false,archived:false}};
 const request=async(method,path,body)=>{
  calls.push({method,path,body});
  if(path==='/users/@me')return{id:binding.applicationId};
  if(path.startsWith('/guilds/'))return{user:{id:binding.gmUserId,bot:false}};
  if(path===`/channels/${binding.dmThreadId}`)return thread;
  if(path.includes('/thread-members?'))return members.map(user_id=>({user_id}));
  if(method==='GET'&&path.includes('/messages?'))return messages;
  if(method==='GET'&&path.includes('/messages/'))return messages.find(m=>path.endsWith('/'+m.id));
  if(method==='POST'){
   if(failBeforePost)throw Error('Network lost');
   const message={...body,id:'555555555555555555',author:{id:binding.applicationId}};messages.push(message);
   if(failAfterPost)throw Error('Response lost');return message;
  }
  throw Error('Unexpected request '+method+' '+path);
 };
 const run=()=>ensurePrivateEntry({binding,threadId:binding.dmThreadId,ownerId:binding.gmUserId,request,manifestFile});
 return{run,messages,members,calls,thread,manifestFile,setFailure:mode=>{failAfterPost=mode==='after';failBeforePost=mode==='before';}};
}
test('welcome card contains stable controls and no private game data',()=>{
 for(const dm of[true,false]){
  const card=privateEntryCard({dm});assert.equal(card.flags,32768);assert.deepEqual(card.allowed_mentions,{parse:[]});
  const buttons=card.components[0].components.at(-1).components;
  assert.deepEqual(buttons.map(b=>b.custom_id),['coast:scene','coast:tactical','coast:atlas','coast:private','coast:recall']);
  assert.doesNotMatch(JSON.stringify(card),/R18|hp|maxHp|secret|sentinel/i);
 }
});
test('repeated delivery keeps exactly one persistent entry',async t=>{
 const f=await fixture(t),first=await f.run(),second=await f.run();assert.equal(first.messageId,second.messageId);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(first.phase,'verified');
});
test('uncertain POST that reached Discord is recovered from history without repost',async t=>{
 const f=await fixture(t);f.setFailure('after');await assert.rejects(f.run(),/Response lost/);
 assert.equal(JSON.parse(await readFile(f.manifestFile,'utf8')).phase,'posting');f.setFailure(null);
 const recovered=await f.run();assert.equal(recovered.phase,'verified');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('uncertain POST with no visible receipt remains reserved',async t=>{
 const f=await fixture(t);f.setFailure('before');await assert.rejects(f.run(),/Network lost/);f.setFailure(null);
 await assert.rejects(f.run(),/uncertain/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('unapproved member and changed destination stop delivery before POST',async t=>{
 const f=await fixture(t);f.members.push('666666666666666666');await assert.rejects(f.run(),/Unexpected/);f.members.pop();
 f.thread.type=11;await assert.rejects(f.run(),/destination/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('duplicate existing cards and foreign replacement are never overwritten',async t=>{
 const f=await fixture(t);await f.run();f.messages[0].author.id='666666666666666666';await assert.rejects(f.run(),/no longer matches/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const g=await fixture(t);g.messages.push(...['555555555555555555','666666666666666666'].map(id=>({...privateEntryCard({dm:true}),id,author:{id:binding.applicationId}})));
 await assert.rejects(g.run(),/Multiple/);assert.equal(g.calls.filter(c=>c.method==='POST').length,0);
});
