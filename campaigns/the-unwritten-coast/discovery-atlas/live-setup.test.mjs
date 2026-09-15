import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openingState,initializeOpening,ensureDmThread} from './live-setup.mjs';
const binding={guildId:'111111111111111111',parentChannelId:'222222222222222222',applicationId:'333333333333333333',gmUserId:'444444444444444444'};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'coast-live-setup-'));const calls=[];let thread,uncertain=false,outsider=false;
 const request=async(method,path,body)=>{calls.push({method,path,body});
  if(path==='/users/@me')return{id:binding.applicationId};
  if(path===`/channels/${binding.parentChannelId}`)return{guild_id:binding.guildId,type:0};
  if(path.includes('/members/'))return{user:{id:binding.gmUserId,bot:false}};
  if(path.endsWith('/threads/active'))return{threads:thread&&!thread.thread_metadata.archived?[thread]:[]};
  if(path.includes('/threads/archived/private'))return{threads:thread?.thread_metadata.archived?[thread]:[],has_more:false};
  if(method==='POST'){if(uncertain)throw Error('Network outcome uncertain');thread={id:'555555555555555555',guild_id:binding.guildId,parent_id:binding.parentChannelId,owner_id:binding.applicationId,name:body.name,type:12,thread_metadata:{invitable:false,archived:false}};return thread;}
  if(method==='PATCH'){thread.thread_metadata.archived=false;return thread;}
  if(method==='PUT')return null;
  if(path.includes('/thread-members?'))return[{user_id:binding.applicationId},{user_id:binding.gmUserId},...(outsider?[{user_id:'666666666666666666'}]:[])];
  if(thread&&path===`/channels/${thread.id}`)return thread;
  throw Error('Unexpected request '+path);
 };
 return{root,calls,request,manifestFile:join(root,'dm.json'),get thread(){return thread;},set uncertain(value){uncertain=value;},set outsider(value){outsider=value;},close:()=>rm(root,{recursive:true,force:true})};}
test('opening has only the public start, no rehearsal characters, inventory or rolled outcomes',()=>{const s=openingState();assert.equal(s.currentRoomId,'f-deck');assert.deepEqual(Object.keys(s.roomIds),['f-deck']);assert.deepEqual(Object.keys(s.placeIds),['brinewatch']);assert.deepEqual(s.party,[]);assert.deepEqual(s.table.personal,{});assert.deepEqual(s.poiIds,{});assert.deepEqual(s.history,[]);});
test('initialization never overwrites an existing campaign',async()=>{const f=await fixture();try{const file=join(f.root,'state.json');await initializeOpening(file);const before=await readFile(file);await assert.rejects(initializeOpening(file),{code:'EEXIST'});assert.deepEqual(await readFile(file),before);}finally{await f.close();}});
test('DM setup reuses its one thread on repeated runs',async()=>{const f=await fixture();try{const first=await ensureDmThread({...f,binding}),second=await ensureDmThread({...f,binding});assert.equal(first.phase,'verified');assert.equal(second.threadId,first.threadId);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.ok(f.calls.some(c=>c.body?.invitable===false));}finally{await f.close();}});
test('uncertain create outcome is retained and never blindly retried',async()=>{const f=await fixture();try{f.uncertain=true;await assert.rejects(ensureDmThread({...f,binding}),/uncertain/);f.uncertain=false;await assert.rejects(ensureDmThread({...f,binding}),/uncertain/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);}finally{await f.close();}});
test('foreign members prevent private-thread verification',async()=>{const f=await fixture();try{f.outsider=true;await assert.rejects(ensureDmThread({...f,binding}),/membership/);assert.equal(JSON.parse(await readFile(f.manifestFile)).phase,'created');}finally{await f.close();}});
