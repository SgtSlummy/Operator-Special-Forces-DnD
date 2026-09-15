import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseProductionPending,chooseProductionMechanical} from './production-director.mjs';
const running={productionVersion:1,runRequested:true,directorMode:'ai_dm',aiDirectorId:'ai-director:campaign',decisionOpen:true,pendingActions:[],characters:[]};
test('a busy player cannot starve another pending actor and each actor keeps FIFO order',()=>{
 const a={actorId:'a',id:'a1',kind:'describe'},b={actorId:'b',id:'b1',kind:'talk'},c={actorId:'c',id:'c1',kind:'mission:accept-briefing'};
 const queue=[a,{...a,id:'a2'},b,c];assert.equal(chooseProductionPending(queue).id,'a1');assert.equal(chooseProductionPending(queue,'a').id,'b1');assert.equal(chooseProductionPending(queue,'b').id,'c1');assert.equal(chooseProductionPending(queue,'c').id,'a1');
});
test('automated scene pause can continue while a human pause, takeover or unresolved reaction cannot',async()=>{
 assert.equal((await chooseProductionMechanical({...running,decisionOpen:false})).type,'gm_decision');
 for(const changed of [{runRequested:false},{directorMode:'human_gm'},{rollPending:true},{pendingActions:[{kind:'reaction'}]}])assert.equal(await chooseProductionMechanical({...running,decisionOpen:false,...changed}),null);
});
test('the production director never chooses combat actions for a human-controlled active player',async()=>{
 const state={...running,phase:'combat',activeActorId:'hero',characters:[{characterId:'hero',characterType:'player'}]};
 assert.equal(await chooseProductionMechanical(state,{privateView:()=>assert.fail('Do not plan a human turn')}),null);
});
test('unsupported mechanics wait for a human ruling instead of becoming automatic approvals',async()=>{
 const pending={id:'custom',actorId:'hero',kind:'invented-mechanic',text:'Alter reality'};
 assert.equal(chooseProductionPending([pending]),undefined);assert.equal(await chooseProductionMechanical({...running,pendingActions:[pending]}),null);
});
