import test from 'node:test';
import assert from 'node:assert/strict';
import {presentProjection,createGameService} from './service.mjs';

const base=()=>({projectionVersion:2,campaignId:'continuity-fixture',revision:7,audience:'gm',currentSceneId:'briefing',phase:'exploration',decisionOpen:false,characters:[],map:{width:25,height:25,level:'tactical',cells:[],tokens:[]},pendingActions:[],publicEvents:[],continuity:{version:1,prepared:false}});
const preparation=p=>presentProjection(p).actions.filter(a=>a.type==='gm_prepare_world');

test('alternate-path preparation requires an explicitly unprepared paused GM view',()=>{
  assert.equal(preparation(base()).length,1);
  for(const patch of [{audience:'private'},{audience:'public'},{decisionOpen:true},{continuity:{version:1,prepared:true}},{continuity:{}},{continuity:undefined}])assert.equal(preparation({...base(),...patch}).length,0,JSON.stringify(patch));
});

test('prepare-world dispatch uses the existing authorized GM command envelope',async()=>{
  const p=base(),sent=[],reads=[],authorized=[];
  const game=createGameService({authorize:async scope=>{authorized.push(scope);return scope.userId==='dm'&&scope.audience==='gm';},client:{campaignId:p.campaignId,project:async scope=>{reads.push(scope);return p;},command:async request=>{sent.push(request);return {success:true,revision:8};}}});
  const action=preparation(p)[0],scope={campaignId:p.campaignId,userId:'dm',audience:'gm',actorId:'',expectedRevision:7,commandId:'prepare-fixture',action:action.id,payload:{}};
  assert.deepEqual(action.payload,{});assert.deepEqual(action.fields,[]);
  assert.equal((await game.command(scope)).success,true);
  assert.deepEqual(sent,[{ownerId:'dm',actorId:'',commandId:'prepare-fixture',expectedRevision:7,type:'gm_prepare_world',payload:{}}]);
  assert.deepEqual(reads,[{ownerId:'dm',actorId:'',audience:'gm',mapLevel:'tactical'}]);assert(authorized.length>=2);
  await assert.rejects(game.command({...scope,userId:'player',commandId:'forged-player'}),{code:'ACCESS_DENIED'});
  await assert.rejects(game.command({...scope,commandId:'payload-injection',payload:{prepared:true}}),{code:'INVALID_INPUT'});
  assert.equal(sent.length,1);
});

test('stale preparation controls cannot dispatch after a view change',async()=>{
  for(const patch of [{decisionOpen:true},{continuity:{prepared:true}},{revision:8}]){
    const p=base(),sent=[],action=preparation(p)[0];Object.assign(p,patch);
    const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async request=>sent.push(request)}});
    await assert.rejects(game.command({campaignId:p.campaignId,userId:'dm',audience:'gm',actorId:'',expectedRevision:7,commandId:'stale-preparation',action:action.id,payload:{}}));
    assert.equal(sent.length,0);
  }
});

test('describe-action help offers playable alternatives without promising mechanical effects',()=>{
  const p={...base(),audience:'private',characterId:'mara',decisionOpen:true,characters:[{characterId:'mara',displayName:'Mara',factionId:'party',position:{x:3,y:3},resources:{},abilities:[]}],inventory:{items:[]}};
  const action=presentProjection(p).actions.find(a=>a.type==='describe');
  assert(action);assert.equal(action.label,'Describe Action');assert.equal(action.fields[0].id,'text');
  assert.match(action.description,/another approach.*detour.*split/i);
  assert.match(action.description,/own location, knowledge and earlier rulings/i);
  assert.match(action.description,/movement and uncertain effects.*require.*actions/i);
  assert.doesNotMatch(action.description,/gm_prepare_world|continuity|projection|API|schema|authorityEpoch/);
});
