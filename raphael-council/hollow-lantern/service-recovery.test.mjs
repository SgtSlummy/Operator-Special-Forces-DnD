import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameService} from './service.mjs';
const scope={campaignId:'campaign',userId:'player',actorId:'hero',commandId:'11111111-1111-4111-8111-111111111111',expectedRevision:4,audience:'private'};
function fixture(authorize=async()=>true,resolve=async()=>({resolution:'cancelled'})){
 const calls=[];const client={campaignId:'campaign',project:async()=>{throw Error('unexpected projection');},command:async()=>{throw Error('unexpected command');},resolveUncertain:async value=>{calls.push(value);return resolve(value);}};
 return {calls,service:createGameService({client,authorize})};
}
test('service resolves only the authenticated original identity and returns the validated proof',async()=>{
 for(const result of [{resolution:'cancelled'},{resolution:'committed',receipt:{commandId:scope.commandId}}]){
  const {service,calls}=fixture(async()=>true,async()=>result);
  assert.equal(await service.resolve({...scope,ownerId:'forged'}),result);
  assert.deepEqual(calls,[{ownerId:'player',actorId:'hero',commandId:scope.commandId,expectedRevision:4}]);
 }
});
test('recovery rechecks current access before dispatch and before disclosing the result',async()=>{
 const denied=fixture(async()=>false);await assert.rejects(denied.service.resolve(scope),e=>e.code==='ACCESS_DENIED');assert.equal(denied.calls.length,0);
 let checks=0;const revoked=fixture(async()=>++checks===1);await assert.rejects(revoked.service.resolve(scope),e=>e.code==='ACCESS_DENIED');assert.equal(revoked.calls.length,1);
 const foreign=fixture();await assert.rejects(foreign.service.resolve({...scope,campaignId:'other'}),e=>e.code==='ACCESS_DENIED');assert.equal(foreign.calls.length,0);
});
test('recovery rejects malformed identity and browser attempts to target another owner',async()=>{
 for(const patch of [{commandId:'bad'},{expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:Number.MAX_SAFE_INTEGER},{expectedRevision:undefined},{targetOwnerId:'other'}]){
  const {service,calls}=fixture();await assert.rejects(service.resolve({...scope,...patch}),e=>e.code==='INVALID_INPUT');assert.equal(calls.length,0);
 }
});
test('unknown recovery outcome propagates without retry or gameplay dispatch',async()=>{
 const failure=Object.assign(new Error('unavailable'),{code:'ENGINE_UNAVAILABLE'});const {service,calls}=fixture(async()=>true,async()=>{throw failure;});
 await assert.rejects(service.resolve(scope),e=>e===failure);assert.equal(calls.length,1);
});
