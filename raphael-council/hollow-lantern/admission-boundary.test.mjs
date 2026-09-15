import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {createAdmissionMembership} from './admission-membership.mjs';
import {createAdmissionService} from './admission.mjs';
import {createDraftStoreRpcHandler,createRemoteAdmission} from './draft-store-rpc.mjs';
import {createActivityRuntime} from './activity-runtime.mjs';
import {DiscordAuth} from '../auth/discord.mjs';
const owner='200000000000000001',gm='100000000000000001',guild='300000000000000001',campaignId='production',scope={campaignId,userId:owner};

test('gateway cache is shared, event-invalidated, bounded by TTL and unavailable during reconnect',async()=>{
 const client=new EventEmitter();let calls=0,allowed=true,clock=0;
 Object.assign(client,{options:{intents:{has:()=>true}},isReady:()=>true,guilds:{fetch:async()=>({members:{fetch:async()=>{calls++;return {id:owner,user:{bot:false},pending:false};}},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>allowed})})}})}});
 const verifier=createAdmissionMembership({client,guildId:guild,channelId:'400000000000000001',now:()=>clock,ttlMs:100});
 try{assert.deepEqual(await Promise.all([verifier.member(owner),verifier.member(owner)]),[true,true]);assert.equal(calls,1);await verifier.member(owner);assert.equal(calls,1);clock=101;await verifier.member(owner);assert.equal(calls,2);allowed=false;client.emit('guildMemberUpdate');assert.equal(await verifier.member(owner),false);assert.equal(calls,3);allowed=true;client.emit('shardDisconnect');assert.equal(await verifier.member(owner),false);assert.equal(calls,3);client.emit('shardResume');assert.equal(await verifier.member(owner),true);assert.equal(calls,4);await verifier.member(owner,{fresh:true});assert.equal(calls,5);}finally{verifier.close();assert.equal(client.listenerCount('guildMemberUpdate'),0);}
});
test('membership without intent never retains successful authorization',async()=>{
 const client=new EventEmitter();let calls=0;Object.assign(client,{guilds:{fetch:async()=>({members:{fetch:async()=>{calls++;return{id:owner,user:{bot:false}};}},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}})}});
 const verifier=createAdmissionMembership({client,guildId:guild,channelId:'400000000000000001'});try{await verifier.member(owner);await verifier.member(owner);assert.equal(calls,2);}finally{verifier.close();}
});

test('raw uncached-member revocations and guild loss immediately discard cached grants',async()=>{
 const client=new EventEmitter();let calls=0,allowed=true,present=true;
 Object.assign(client,{options:{intents:{has:()=>true}},isReady:()=>true,guilds:{fetch:async()=>({members:{fetch:async options=>{assert.equal(options.cache,false);calls++;if(!present)throw new Error('Unknown member');return{id:owner,user:{bot:false}};}},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>allowed})})}})}});
 const verifier=createAdmissionMembership({client,guildId:guild,channelId:'400000000000000001'});
 try{
  assert.equal(await verifier.member(owner),true);
  allowed=false;client.emit('raw',{t:'GUILD_MEMBER_UPDATE',d:{guild_id:guild,user:{id:owner},roles:[]}});
  assert.equal(await verifier.member(owner),false);assert.equal(calls,2);
  allowed=true;client.emit('guildMemberAvailable');assert.equal(await verifier.member(owner),true);
  present=false;client.emit('raw',{t:'GUILD_MEMBER_REMOVE',d:{guild_id:guild,user:{id:owner}}});
  assert.equal(await verifier.member(owner),false);assert.equal(calls,4);
  present=true;client.emit('raw',{t:'GUILD_MEMBER_ADD',d:{guild_id:guild,user:{id:owner}}});assert.equal(await verifier.member(owner),true);
  for(const event of ['guildUnavailable','guildDelete']){
   client.emit(event,{id:guild});const before=calls;assert.equal(await verifier.member(owner),false);assert.equal(calls,before);
   client.emit('shardResume');assert.equal(await verifier.member(owner),false);
   client.emit('raw',{t:'GUILD_CREATE',d:{id:guild,unavailable:false}});assert.equal(await verifier.member(owner),true);assert.equal(calls,before+1);
  }
  client.emit('raw',{t:'GUILD_DELETE',d:{id:guild}});assert.equal(await verifier.member(owner),false);
 }finally{verifier.close();assert.equal(client.listenerCount('raw'),0);}
});

test('revocation while membership verification is in flight cannot install a new cached grant',async()=>{
 const client=new EventEmitter();let release;const barrier=new Promise(resolve=>{release=resolve;});
 Object.assign(client,{options:{intents:{has:()=>true}},isReady:()=>true,guilds:{fetch:async()=>({members:{fetch:async()=>{await barrier;return{id:owner,user:{bot:false}};}},channels:{fetch:async()=>({permissionsFor:()=>({has:()=>true})})}})}});
 const verifier=createAdmissionMembership({client,guildId:guild,channelId:'400000000000000001'});
 try{const pending=verifier.member(owner);client.emit('raw',{t:'GUILD_MEMBER_REMOVE',d:{guild_id:guild,user:{id:owner}}});release();assert.equal(await pending,false);}finally{verifier.close();}
});
test('production auth gives verified unseated identity prospective scope and never host',async()=>{
 const db=new DatabaseSync(':memory:');let allowed=true;
 const config={campaign:campaignId,guild,token:'test',admissionEnabled:true,dmIds:[gm]};
 const auth=new DiscordAuth({db,game:{readMember:()=>null},config,verifyMember:async s=>{assert.deepEqual(s,scope);return allowed;},fetchImpl:()=>assert.fail('Native verification must own membership')});
 try{assert.deepEqual(await auth.member(owner),{campaign:campaignId,owner,role:'prospective'});allowed=false;await assert.rejects(auth.member(owner),{code:'discord_membership_unverified'});}finally{db.close();}
});
test('prospective browser identity reaches only admission and cannot obtain a game view',async()=>{
 const session={campaign:campaignId,owner,role:'prospective'};
 const auth={config:{publicOrigin:'https://game.example'},authenticate:async()=>session,member:async()=>session};
 const client={campaignId,project:()=>assert.fail('No private projection'),command:()=>assert.fail('No command')};
 const admission={status:async s=>{assert.deepEqual(s,scope);return {status:'available'};},join:async s=>{assert.deepEqual(s,scope);return{status:'waiting'};}};
 const runtime=createActivityRuntime({auth,client,gmUserId:gm,admission});
 assert.equal((await runtime.handle('view',new Request('https://game.example/api/hollow-lantern/view'))).status,403);
 assert.equal((await runtime.handle('admission',new Request('https://game.example/api/hollow-lantern/admission'))).status,200);
 assert.equal((await runtime.handle('admission',new Request('https://game.example/api/hollow-lantern/admission',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}))).status,403);
});
test('real private RPC joins the native reservation once and rejects identity injection/revocation',async t=>{
 let allowed=true;
 const engine={campaignId,project:async()=>({decisionOpen:true,phase:'briefing',revision:1,characters:[]}),command:()=>assert.fail('Active play cannot enroll')};
 const service=createAdmissionService({engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>allowed});
 const draftStore=Object.fromEntries(['get','save','prepare','complete'].map(k=>[k,()=>assert.fail('No draft access')]));
 const secret='dedicated-private-admission-test-1234567890';
 const handler=createDraftStoreRpcHandler({draftStore,getAdmission:()=>service,secret,campaignId,gmUserId:gm,authorize:()=>assert.fail('Admission uses current native membership')});
 const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await service.close();});
 const remote=createRemoteAdmission({baseUrl:`http://127.0.0.1:${server.address().port}`,secret,campaignId});
 const first=await remote.join(scope,{presetId:'rogue',name:'Kestrel',edition:'2024'});assert.equal(first.status,'waiting');assert.equal((await remote.join(scope,{presetId:'fighter',name:'Retry',edition:'2024'})).characterId,first.characterId);
 await assert.rejects(remote.join(scope,{presetId:'rogue',name:'Kestrel',edition:'2024',ownerId:gm}));allowed=false;await assert.rejects(remote.status(scope),{status:403});
});
