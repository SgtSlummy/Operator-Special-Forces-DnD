import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createEngineClient, CONTRACT } from './engine-client.mjs';

test('command and receipt responses cannot cross campaign or command identities', async () => {
  const input = {ownerId:'alice',actorId:'fighter',commandId:'original',expectedRevision:3,type:'buy',payload:{itemId:'potion',quantity:1}};
  for (const method of ['command','receipt']) {
    for (const change of [{campaignId:'other-table'},{commandId:'other-command'}]) {
      let calls=0;
      const client=createEngineClient({...base,fetchImpl:async(_url,request)=>{
        calls++;
        assert.equal(JSON.parse(request.body).campaignId,'test');
        return json({contract:CONTRACT,campaignId:'test',commandId:'original',revision:4,success:true,result:{},...change});
      }});
      await assert.rejects(client[method]({...input,campaignId:'untrusted-selector'}),{code:'WRONG_RESPONSE'});
      assert.equal(calls,1);
    }
  }
});

test('nested projection campaign must match its outer authenticated campaign', async () => {
  const client=createEngineClient({...base,fetchImpl:async()=>json({...projection,projection:{...projection.projection,campaignId:'other-table'}})});
  await assert.rejects(client.project({ownerId:'alice',actorId:'fighter'}),{code:'WRONG_VIEW'});
});

test('public projections reject GM director identity and private character scope', async () => {
  for (const fields of [{aiDirectorId:'private-director'},{characterId:'fighter'}]) {
    const client=createEngineClient({...base,fetchImpl:async()=>json({...projection,projection:{...projection.projection,audience:'public',characterId:'',...fields}})});
    await assert.rejects(client.project({ownerId:'alice',audience:'public'}),{code:'PRIVATE_PUBLIC_VIEW'});
  }
});

const recoveryInput={ownerId:'alice',actorId:'fighter',commandId:'recover-one',expectedRevision:3};
const recoveryResponse=(resolution='cancelled',ownerId='alice')=>({contract:CONTRACT,campaignId:'test',commandId:'recover-one',ownerId,actorId:'fighter',originalExpectedRevision:3,revision:4,success:true,replayed:false,resolution,...(resolution==='committed'?{replayed:true,receipt:{contract:CONTRACT,campaignId:'test',commandId:'recover-one',revision:4,success:true,replayed:true,result:{message:'Original result'}}}:{rejection:{contract:CONTRACT,code:'COMMAND_CANCELLED',terminal:true,campaignId:'test',commandId:'recover-one',ownerId,actorId:'fighter',originalExpectedRevision:3,revision:4}})});

test('uncertain recovery signs exact original identity and returns committed or cancelled proof',async()=>{
 for(const resolution of ['committed','cancelled']){
  let calls=0;const expected=recoveryResponse(resolution);
  const client=createEngineClient({...base,fetchImpl:async(url,request)=>{calls++;assert.match(url,/\/api\/rpg\/resolve$/);assert.deepEqual(JSON.parse(request.body),{contract:CONTRACT,campaignId:'test',channelId:'channel',...recoveryInput});assert.equal(request.headers['x-rpg-core-signature'],createHmac('sha256',secret).update(`12345.${request.body}`).digest('hex'));return json(expected);}});
  assert.deepEqual(await client.resolveUncertain({...recoveryInput,campaignId:'wrong',payload:{ignored:true}}),expected);assert.equal(calls,1);
 }
 const client=createEngineClient({...base,fetchImpl:async(_url,request)=>{assert.equal(JSON.parse(request.body).targetOwnerId,'alice');return json(recoveryResponse());}});
 assert.equal((await client.resolveUncertain({...recoveryInput,ownerId:'gm',targetOwnerId:'alice'})).ownerId,'alice');
});

test('uncertain recovery rejects cross-identity, mixed and incomplete terminal responses',async()=>{
 const mutations=[v=>v.campaignId='other',v=>v.commandId='other',v=>v.ownerId='other',v=>v.actorId='other',v=>v.originalExpectedRevision=2,v=>v.success=false,v=>delete v.replayed,v=>v.resolution='unknown',v=>v.extra=true];
 for(const resolution of ['committed','cancelled']) for(const mutate of mutations){const value=recoveryResponse(resolution);mutate(value);const client=createEngineClient({...base,fetchImpl:async()=>json(value)});await assert.rejects(client.resolveUncertain(recoveryInput));}
 for(const mutate of [v=>v.receipt.campaignId='other',v=>v.receipt.commandId='other',v=>v.receipt.revision=5,v=>v.receipt.success=false,v=>v.receipt.replayed=false,v=>v.receipt.result=null,v=>v.rejection={}]){const value=recoveryResponse('committed');mutate(value);const client=createEngineClient({...base,fetchImpl:async()=>json(value)});await assert.rejects(client.resolveUncertain(recoveryInput));}
 for(const mutate of [v=>v.rejection.contract='other',v=>v.rejection.campaignId='other',v=>v.rejection.commandId='other',v=>v.rejection.ownerId='other',v=>v.rejection.actorId='other',v=>v.rejection.originalExpectedRevision=2,v=>v.rejection.revision=5,v=>v.rejection.terminal=false,v=>v.rejection.code='RECEIPT_NOT_FOUND',v=>v.rejection.extra=true,v=>v.revision=3,v=>v.receipt={}]){const value=recoveryResponse();mutate(value);const client=createEngineClient({...base,fetchImpl:async()=>json(value)});await assert.rejects(client.resolveUncertain(recoveryInput));}
});

test('uncertain recovery validates input and never retries an ambiguous network outcome',async()=>{
 let calls=0;const client=createEngineClient({...base,fetchImpl:async()=>{calls++;throw new Error('lost');}});
 for(const change of [{expectedRevision:-1},{expectedRevision:Number.MAX_SAFE_INTEGER},{expectedRevision:1.5},{actorId:0},{ownerId:''},{targetOwnerId:''}])await assert.rejects(client.resolveUncertain({...recoveryInput,...change}));
 assert.equal(calls,0);await assert.rejects(client.resolveUncertain(recoveryInput),{code:'ENGINE_UNAVAILABLE'});assert.equal(calls,1);
});

const secret = 'test-engine-secret-'.repeat(4);
const base = { secret, channelId:'channel', campaignId:'test', now:()=>12345 };

test('recovery release signs the exact revision and authority epoch and never retries',async()=>{
 let calls=0;
 const client=createEngineClient({...base,fetchImpl:async(url,request)=>{calls++;assert.match(url,/\/api\/rpg\/recovery$/);assert.deepEqual(JSON.parse(request.body),{contract:CONTRACT,campaignId:'test',channelId:'channel',ownerId:'gm',operation:'release',expectedRevision:7,expectedAuthorityEpoch:3});return json({contract:CONTRACT,campaignId:'test',revision:7,authorityEpoch:3,held:false});}});
 assert.equal((await client.recovery({ownerId:'gm',operation:'release',expectedRevision:7,authorityEpoch:3})).held,false);assert.equal(calls,1);
 for(const mutation of [{revision:8},{authorityEpoch:4},{held:true},{campaignId:'other'}]){
  const invalid=createEngineClient({...base,fetchImpl:async()=>json({contract:CONTRACT,campaignId:'test',revision:7,authorityEpoch:3,held:false,...mutation})});
  await assert.rejects(invalid.recovery({ownerId:'gm',operation:'release',expectedRevision:7,authorityEpoch:3}));
 }
 calls=0;const lost=createEngineClient({...base,fetchImpl:async()=>{calls++;throw Error('lost');}});await assert.rejects(lost.recovery({ownerId:'gm',operation:'release',expectedRevision:7,authorityEpoch:3}));assert.equal(calls,1);
});
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const projection = {contract:CONTRACT,campaignId:'test',revision:3,projection:{projectionVersion:2,campaignId:'test',revision:3,audience:'private',characterId:'fighter'}};

test('signs exact bytes and scopes projection to one character',async()=>{
  const client=createEngineClient({...base,fetchImpl:async(url,request)=>{
    assert.equal(url,'http://127.0.0.1:18791/api/rpg/projection');
    assert.equal(request.headers['x-rpg-core-signature'],createHmac('sha256',secret).update(`12345.${request.body}`).digest('hex'));
    assert.deepEqual(JSON.parse(request.body),{contract:CONTRACT,campaignId:'test',channelId:'channel',ownerId:'alice',characterId:'fighter',audience:'private',mapLevel:'tactical'});
    assert.equal(request.redirect,'error'); return json(projection);
  }});
  assert.equal((await client.project({ownerId:'alice',actorId:'fighter'})).characterId,'fighter');
});
test('rejects a response belonging to another character or revision',async()=>{
  for(const change of [{characterId:'rogue'},{revision:4},{audience:'gm'}]){
    const client=createEngineClient({...base,fetchImpl:async()=>json({...projection,projection:{...projection.projection,...change}})});
    await assert.rejects(client.project({ownerId:'alice',actorId:'fighter'}),{code:'WRONG_VIEW'});
  }
});
test('unknown network result is never automatically retried',async()=>{
  let calls=0;
  const client=createEngineClient({...base,fetchImpl:async()=>{calls++;throw new Error('lost response');}});
  await assert.rejects(client.command({ownerId:'alice',actorId:'fighter',commandId:'once',expectedRevision:3,type:'buy',payload:{itemId:'potion',quantity:1}}),{code:'ENGINE_UNAVAILABLE'});
  assert.equal(calls,1);
});
test('rejects public private data and nonlocal endpoints',async()=>{
  for(const baseUrl of ['https://example.com','http://127.0.0.1.evil.test','http://user:password@127.0.0.1:18791','http://127.0.0.1:18791/other']) assert.throws(()=>createEngineClient({...base,baseUrl}),{code:'UNSAFE_ENDPOINT'});
  const client=createEngineClient({...base,fetchImpl:async()=>json({...projection,projection:{...projection.projection,audience:'public',inventory:{gold:30}}})});
  await assert.rejects(client.project({ownerId:'alice',audience:'public'}),{code:'PRIVATE_PUBLIC_VIEW'});
});
test('does not soften engine permission rejection',async()=>{
  const client=createEngineClient({...base,fetchImpl:async()=>json({code:'FORBIDDEN',message:'This character is not yours.'},403)});
  await assert.rejects(client.project({ownerId:'alice',actorId:'fighter'}),{code:'FORBIDDEN',status:403});
});

test('receipt recovery uses a signed read-only scoped endpoint',async()=>{
 const client=createEngineClient({...base,fetchImpl:async(url,request)=>{
  assert.match(url,/\/api\/rpg\/receipt$/);const body=JSON.parse(request.body);assert.equal(body.actorId,'fighter');assert.equal(body.commandId,'original');assert.equal(body.type,undefined);
  assert.equal(request.headers['x-rpg-core-signature'],createHmac('sha256',secret).update(`12345.${request.body}`).digest('hex'));
  return json({contract:CONTRACT,campaignId:'test',commandId:'original',revision:2,success:true,replayed:true,result:{message:'Moved'}});
 }});assert.equal((await client.receipt({ownerId:'alice',actorId:'fighter',commandId:'original'})).replayed,true);
});

test('public bridge response rejects a private action timeline',async()=>{const client=createEngineClient({...base,fetchImpl:async()=>json({...projection,projection:{...projection.projection,audience:'public',characterId:'',privateHistory:[{result:{message:'private death save'}}]}})});await assert.rejects(client.project({ownerId:'alice',audience:'public'}),{code:'PRIVATE_PUBLIC_VIEW'});});

function largeGmResponse(){
 const characters=Array.from({length:100},(_,i)=>({characterId:'player-'+i,displayName:'界'.repeat(80),characterType:'player',classId:'fighter',level:3,raceId:'human',factionId:'party',defeated:false}));
 const publicProjection={projectionVersion:2,campaignId:'test',revision:3,audience:'public',characterId:'',currentSceneId:'briefing',characters,map:{level:'regional',cells:[],tokens:[],nodes:[]}};
 const npcs=Array.from({length:4},(_,i)=>({characterId:'npc-'+i,name:'名'.repeat(80),role:['npc','boss','shopkeeper','enemy'][i],memories:Array.from({length:500},(_,j)=>({revision:j,text:'記'.repeat(1500),worldMinute:j}))}));
 return {...projection,projection:{...publicProjection,audience:'gm',npcs,committedEvents:{version:1,retainedFromRevision:1,latestRevision:64,entries:Array.from({length:64},(_,i)=>({revision:i+1,commandId:'event-'+i,publicProjection:{...publicProjection,revision:i+1},receipt:{success:true,result:{message:'Recorded.'}}}))}}};
}

test('GM projection receives a complete bounded 100-player retained journal and NPC memory record',async()=>{
 const response=largeGmResponse(),bytes=Buffer.byteLength(JSON.stringify(response));assert(bytes>2*1024*1024&&bytes<16*1024*1024);
 const client=createEngineClient({...base,fetchImpl:async()=>json(response)}),view=await client.project({ownerId:'dm',audience:'gm'});
 assert.deepEqual(view,response.projection);assert.equal(view.committedEvents.entries.length,64);assert.equal(view.npcs[3].memories[499].text.length,1500);
});

test('large-response allowance follows only the requested GM projection scope',async()=>{
 const response=largeGmResponse();
 for(const scope of [{ownerId:'alice',actorId:'fighter',audience:'private'},{ownerId:'alice',audience:'public'}]){
  const client=createEngineClient({...base,fetchImpl:async()=>json(response)});await assert.rejects(client.project(scope),{code:'RESPONSE_TOO_LARGE'});
 }
 for(const method of ['command','receipt','resolveUncertain']){
  const client=createEngineClient({...base,fetchImpl:async()=>json({...response,audience:'gm'})});await assert.rejects(client[method]({ownerId:'dm',actorId:'fighter',commandId:'large',expectedRevision:3,type:'checkpoint',payload:{},audience:'gm'}),{code:'RESPONSE_TOO_LARGE'});
 }
});

test('GM responses over 16 MiB are cancelled while invalid scopes never fetch',async()=>{
 let cancelled=false,calls=0;
 const client=createEngineClient({...base,fetchImpl:async()=>{calls++;let count=0;return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));if(++count===18)controller.close();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});}});
 for(const scope of [{ownerId:'dm',audience:'GM'},{ownerId:'dm',audience:'private'},{ownerId:'',audience:'gm'}])await assert.rejects(client.project(scope));assert.equal(calls,0);
 await assert.rejects(client.project({ownerId:'dm',audience:'gm'}),{code:'RESPONSE_TOO_LARGE'});assert.equal(calls,1);assert(cancelled);
});

test('non-GM projection streams still stop immediately above the original 2 MiB bound',async()=>{
 for(const audience of ['private','public']){
  let cancelled=false;const client=createEngineClient({...base,fetchImpl:async()=>{let sent=0;return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(sent++===0?2*1024*1024:1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});}});
  await assert.rejects(client.project({ownerId:'alice',actorId:audience==='private'?'fighter':'',audience}),{code:'RESPONSE_TOO_LARGE'});assert(cancelled);
 }
});
