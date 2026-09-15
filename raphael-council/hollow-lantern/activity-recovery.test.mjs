import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityRuntime} from './activity-runtime.mjs';
const commandId='11111111-1111-4111-8111-111111111111';
function fixture({resolve,sessionCampaign='campaign'}={}){
 let active=true,commits=0;const calls=[];
 const auth={config:{activityOrigin:'https://table.example'},authenticate:async()=>({campaign:sessionCampaign,owner:'player',role:'player',actorId:'hero'}),member:async()=>active?{campaign:'campaign',owner:'player',role:'player'}:null};
 const client={campaignId:'campaign',project:async()=>({characterId:'hero',characters:[{characterId:'hero',ownerId:'player'}]}),command:async()=>{throw Error('unexpected gameplay dispatch');},receipt:async()=>{throw Error('unexpected receipt route');},resolveUncertain:async data=>{calls.push(data);return resolve?resolve(()=>{active=false;}):{resolution:'cancelled',commandId};}};
 const runtime=createActivityRuntime({auth,client,gmUserId:'dm',onCommit:async()=>{commits++;}});
 function request(body={commandId,expectedRevision:4},options={}){return new Request('https://table.example/api/hollow-lantern/resolve?actorId=hero',{method:options.method??'POST',headers:{Origin:options.origin??'https://table.example','Content-Type':'application/json'},...(options.method==='GET'?{}:{body:JSON.stringify(body)})});}
 return {runtime,request,calls,commits:()=>commits};
}
test('authenticated recovery forwards original identity without gameplay callbacks',async()=>{
 for(const resolution of ['cancelled','committed']){
  const f=fixture({resolve:async()=>({resolution,commandId})});const response=await f.runtime.handle('resolve',f.request());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{resolution:{resolution,commandId}});
  assert.deepEqual(f.calls,[{ownerId:'player',actorId:'hero',commandId,expectedRevision:4}]);assert.equal(f.commits(),0);
 }
});
test('recovery rejects forged body fields and malformed original revisions',async()=>{
 for(const body of [{commandId,expectedRevision:4,ownerId:'other'},{commandId,expectedRevision:4,targetOwnerId:'other'},{commandId},{commandId,expectedRevision:-1},{commandId,expectedRevision:1.5},{commandId,expectedRevision:Number.MAX_SAFE_INTEGER},{commandId:'bad',expectedRevision:4},[]]){
  const f=fixture();const response=await f.runtime.handle('resolve',f.request(body));assert.equal(response.status,400);assert.equal(f.calls.length,0);const error=await response.json();assert.equal(error.rejection,undefined);assert.equal(error.resolution,undefined);
 }
});
test('wrong origin and campaign cannot trigger resolution',async()=>{
 const origin=fixture();const denied=await origin.runtime.handle('resolve',origin.request(undefined,{origin:'https://other.example'}));assert.ok(denied.status>=400);assert.equal(origin.calls.length,0);
 const foreign=fixture({sessionCampaign:'other'});const result=await foreign.runtime.handle('resolve',foreign.request());assert.equal(result.status,401);assert.equal(foreign.calls.length,0);
 const get=fixture();const wrong=await get.runtime.handle('resolve',get.request(undefined,{method:'GET'}));assert.ok(wrong.status>=400);assert.equal(get.calls.length,0);
});
test('revocation or an unknown outcome returns no terminal proof and never retries',async()=>{
 for(const resolve of [async revoke=>{revoke();return {resolution:'cancelled'};},async()=>{throw Object.assign(new Error('unavailable'),{status:503});}]){
  const f=fixture({resolve});const response=await f.runtime.handle('resolve',f.request());assert.ok(response.status>=400);const body=await response.json();assert.equal(body.resolution,undefined);assert.equal(body.rejection,undefined);assert.equal(f.calls.length,1);assert.equal(f.commits(),0);
 }
});
