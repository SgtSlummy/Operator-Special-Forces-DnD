import test from 'node:test';
import assert from 'node:assert/strict';
import {presentProjection,createGameService} from './service.mjs';
const base=()=>({projectionVersion:2,campaignId:'population',revision:4,audience:'gm',currentSceneId:'briefing',phase:'exploration',decisionOpen:false,characters:[],map:{width:25,height:25,level:'tactical',cells:[],tokens:[]},pendingActions:[],publicEvents:[],canAddPopulation:true,canAddPlayers:true,playerCount:3,playerLimit:100});
test('population actions are gated by authoritative capability, pause and capacity',()=>{
  const p=base();let actions=presentProjection(p).actions;assert.equal(actions.filter(a=>a.type==='gm_add_player').length,3);assert.equal(actions.filter(a=>a.type==='gm_add_npc').length,4);assert.ok(actions.every(a=>a.fields.length<=5));
  p.playerCount=100;assert.ok(!presentProjection(p).actions.some(a=>a.type==='gm_add_player'));
  delete p.canAddPopulation;assert.ok(!presentProjection(p).actions.some(a=>a.type==='gm_add_npc'));
  p.audience='public';p.canAddPopulation=true;assert.ok(!presentProjection(p).actions.some(a=>a.type.startsWith('gm_')));
});
test('NPC approval requires a bounded reply and legacy player enrollment offers migration first',async()=>{
  const p=base();p.pendingActions=[{id:'conversation-1',kind:'npc-conversation',text:'Do you remember me?'}];
  const actions=presentProjection(p).actions,approval=actions.filter(a=>a.type==='gm_resolve'&&a.payload.approved);
  assert.equal(approval.length,1);assert.equal(approval[0].fields[0].id,'text');assert.equal(approval[0].fields[0].maxLength,700);
  const sent=[],game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async r=>{sent.push(r);return {success:true};}}});
  const request={campaignId:p.campaignId,userId:'dm',audience:'gm',actorId:'',expectedRevision:4,commandId:'reply-1',action:approval[0].id};
  await assert.rejects(game.command({...request,payload:{}}),{code:'INVALID_INPUT'});
  await assert.rejects(game.command({...request,payload:{text:'x'.repeat(701)}}),{code:'INVALID_INPUT'});
  await game.command({...request,payload:{text:'Welcome back, traveler.'}});assert.equal(sent.length,1);
  p.canAddPlayers=false;p.canPrepareEquipment=true;assert.ok(!presentProjection(p).actions.some(a=>a.type==='gm_add_player'));assert.ok(presentProjection(p).actions.some(a=>a.type==='gm_prepare_equipment'));
});
test('the shared browser/Discord service translates NPC coordinates and forbids injected stats',async()=>{
  const p=base(),sent=[];const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async r=>{sent.push(r);return {success:true};}}});
  const scope={campaignId:p.campaignId,userId:'dm',audience:'gm',actorId:'',expectedRevision:4,commandId:'npc-1',action:'npc:add:boss',payload:{characterId:'brass-warden',name:'The Brass Warden',sceneId:'signal-dungeon',column:'19',row:'19'}};
  await game.command(scope);assert.deepEqual(sent[0].payload,{role:'boss',characterId:'brass-warden',name:'The Brass Warden',sceneId:'signal-dungeon',x:18,y:18});
  await assert.rejects(game.command({...scope,commandId:'npc-2',payload:{...scope.payload,hp:100000}}),{code:'INVALID_INPUT'});assert.equal(sent.length,1);
});
test('nearby living merchants expose stock-backed controls and authorized memories in the journal',()=>{
  const p={...base(),audience:'private',characterId:'mara',decisionOpen:true,characters:[{characterId:'mara',displayName:'Mara',factionId:'party',position:{x:3,y:3},resources:{},abilities:[]},{characterId:'mira',displayName:'Mira',factionId:'neutral',position:{x:3,y:4}}],inventory:{currency:10,items:[]},npcs:[{characterId:'mira',name:'Mira',role:'shopkeeper',defeated:false,stock:[{itemId:'rations',quantity:2,price:1}],memories:[{text:'You returned my ledger.'}]}]};
  const result=presentProjection(p);assert.ok(result.actions.some(a=>a.id==='merchant:buy:mira:rations'));assert.ok(result.actions.some(a=>a.id==='npc:talk:mira'));assert.ok(result.journal.includes('Mira: You returned my ledger.'));
  p.npcs[0].defeated=true;assert.ok(!presentProjection(p).actions.some(a=>a.id.startsWith('merchant:')||a.id.startsWith('npc:talk:')));
});
