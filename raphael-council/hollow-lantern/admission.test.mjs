import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAdmissionService} from './admission.mjs';
import {EngineError} from './engine-client.mjs';

const gm='100000000000000001',owner='200000000000000001',scope={campaignId:'production-fixture',userId:owner};
const input={presetId:'fighter',name:'Ada',edition:'2024'};
function fixture(){
 const state={revision:1,decisionOpen:false,phase:'briefing',rollPending:false,pendingActions:[],characters:[]};
 const receipts=new Map(),calls=[];let lose=false;
 const engine={campaignId:scope.campaignId,project:async()=>structuredClone(state),async command(intent){calls.push(structuredClone(intent));if(receipts.has(intent.commandId))return {...receipts.get(intent.commandId),replayed:true};if(intent.expectedRevision!==state.revision)throw new EngineError('STALE_REVISION','Stale');if(state.decisionOpen||state.phase==='combat'||state.rollPending||state.pendingActions.length)throw new EngineError('ENROLLMENT_CLOSED','Closed');state.characters.push({characterType:'player',characterId:intent.payload.characterId,ownerId:intent.payload.ownerId});state.revision++;const receipt={commandId:intent.commandId,revision:state.revision,success:true};receipts.set(intent.commandId,receipt);if(lose){lose=false;throw new EngineError('ENGINE_UNAVAILABLE','Lost');}return receipt;}};
 return {engine,state,calls,lose(){lose=true;}};
}
test('browser and Discord retries reserve one seat and ignore changed retry choices',async()=>{
 const f=fixture(),service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true});
 try{await Promise.all([service.join(scope,input),service.join(scope,{...input,name:'Changed'})]);assert.equal(f.state.characters.length,1);assert.equal(f.calls.length,1);assert.equal((await service.status(scope)).name,'Ada');}finally{await service.close();}
});
test('reservations wait through active play, combat, pending actions and rolls',async()=>{
 const f=fixture();f.state.decisionOpen=true;const service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true});
 try{assert.equal((await service.join(scope,input)).status,'waiting');f.state.decisionOpen=false;f.state.phase='combat';await service.drain();f.state.phase='briefing';f.state.rollPending=true;await service.drain();f.state.rollPending=false;f.state.pendingActions.push({id:'ruling'});await service.drain();assert.equal(f.calls.length,0);f.state.pendingActions=[];await service.drain();assert.equal((await service.status(scope)).status,'enrolled');}finally{await service.close();}
});
test('all 100 reservations count while play is active; a 101st cannot enter',async()=>{
 const f=fixture();f.state.decisionOpen=true;const service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true});
 try{for(let n=0;n<100;n++)await service.join({...scope,userId:String(200000000000000000n+BigInt(n))},input);await assert.rejects(service.join({...scope,userId:'300000000000000001'},input),{code:'PLAYER_CAPACITY'});assert.equal(f.calls.length,0);}finally{await service.close();}
});
test('lost committed response survives native restart with the identical command',async()=>{
 const root=mkdtempSync(join(tmpdir(),'admission-')),dbPath=join(root,'admission.sqlite'),f=fixture();f.lose();let service=createAdmissionService({engine:f.engine,dbPath,gmUserId:gm,authorize:async()=>true});
 try{assert.equal((await service.join(scope,input)).status,'recovering');await service.close();service=createAdmissionService({engine:f.engine,dbPath,gmUserId:gm,authorize:async()=>true});await service.drain();assert.equal((await service.status(scope)).status,'enrolled');assert.equal(f.state.characters.length,1);assert.deepEqual(f.calls[0],f.calls[1]);}finally{await service.close();rmSync(root,{recursive:true,force:true});}
});
test('revocation blocks admission and suppresses status; client ownership fields rejected',async()=>{
 const f=fixture();f.state.decisionOpen=true;let eligible=true;const service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>eligible});
 try{await assert.rejects(service.join(scope,{...input,ownerId:gm}),{code:'INVALID_INPUT'});await service.join(scope,input);eligible=false;f.state.decisionOpen=false;await service.drain();assert.equal(f.calls.length,0);await assert.rejects(service.status(scope),{code:'ACCESS_DENIED'});await assert.rejects(service.join({...scope,campaignId:'other'},input),{code:'ACCESS_DENIED'});}finally{await service.close();}
});
test('publication failures do not turn a committed seat into an uncertain command',async()=>{
 const f=fixture(),service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true,onCommitted:async()=>{throw Error('publication');}});
 try{assert.equal((await service.join(scope,input)).status,'enrolled');await service.drain();assert.equal(f.calls.length,1);}finally{await service.close();}
});


test('production recovery hold prevents command preparation and exposes only counts',async()=>{
 const f=fixture();let held=true;f.engine.recovery=async()=>({held});
 const service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true});
 try{assert.equal((await service.join(scope,input)).status,'waiting');assert.equal(f.calls.length,0);assert.deepEqual(service.health(),{state:'recovery_held',reserved:1,waiting:1,uncertain:0,enrolled:0,needsGm:0});held=false;await service.drain();assert.equal((await service.status(scope)).status,'enrolled');}finally{await service.close();}
});


test('staged admission limits new reservations without lowering campaign capacity',async()=>{
 const f=fixture();f.state.decisionOpen=true;const service=createAdmissionService({engine:f.engine,dbPath:':memory:',gmUserId:gm,authorize:async()=>true,seatLimit:2});
 try{await service.join(scope,input);await service.join({...scope,userId:'200000000000000002'},input);const newcomer={...scope,userId:'200000000000000003'};assert.equal((await service.status(newcomer)).status,'full');assert.equal((await service.status(scope)).capacity,100);await assert.rejects(service.join(newcomer,input),{code:'PLAYER_CAPACITY'});assert.equal((await service.join(scope,input)).status,'waiting');}finally{await service.close();}
});
