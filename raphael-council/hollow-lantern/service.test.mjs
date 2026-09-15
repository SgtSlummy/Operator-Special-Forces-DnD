import test from 'node:test';
import {buildPanel} from '../discord/hollow-lantern/components.mjs';

test('Discord Pause menu exposes DM mode handoff with plain labels',()=>{
 const p=fixture();Object.assign(p,{audience:'gm',decisionOpen:false,directorMode:'human_gm',aiDirectorId:'ai-director:secret',authorityEpoch:9001});
 const issued=[];const issue=data=>{issued.push(data);return `control-${issued.length}`;};
 const panel=buildPanel(presentProjection(p),issue,{group:'pause'});
 const serialized=JSON.stringify(panel);
 assert.ok(issued.some(data=>data.actionId==='director:ai'));
 assert.match(serialized,/AI DM/);assert.match(serialized,/Mode: Human DM/);
 assert.doesNotMatch(serialized,/ai-director:secret|authorityEpoch|9001/);
 assert.doesNotMatch(serialized,/Only you approve rulings/);
 Object.assign(p,{directorMode:'ai_dm',rollPending:true});issued.length=0;
 const takeover=buildPanel(presentProjection(p),issue,{group:'pause'});
 assert.ok(issued.some(data=>data.actionId==='director:human'));
 assert.match(JSON.stringify(takeover),/Human DM/);
});
import assert from 'node:assert/strict';
import {presentProjection,createGameService,presentReceipt} from './service.mjs';

test('paused GM switches DM mode without entering internal identifiers',async()=>{
 const p={...fixture(),audience:'gm',characterId:undefined,decisionOpen:false,directorMode:'human_gm'};const sent=[];
 const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async request=>{sent.push(request);return{success:true,revision:5};}}});
 const offered=presentProjection(p),action=offered.actions.find(a=>a.id==='director:ai');assert.equal(action.label,'AI DM');assert.equal(action.group,'pause');assert.deepEqual(action.fields,[]);assert.deepEqual(action.payload,{mode:'ai_dm'});assert.match(offered.summary,/Human DM/);
 const gm={...scope,actorId:'',audience:'gm',action:'director:ai',payload:{}};
 await game.command(gm);assert.equal(sent[0].type,'gm_director_mode');assert.match(sent[0].payload.aiDirectorId,/^ai-director:[a-f0-9]{64}$/);
 for(const payload of [{aiDirectorId:sent[0].payload.aiDirectorId},{aiDirectorId:'ai-director:attacker'},{mode:'human_gm'}])await assert.rejects(game.command({...gm,commandId:'forged-'+JSON.stringify(payload),payload}),{code:'INVALID_INPUT'});
 assert.equal(sent.length,1);await assert.rejects(game.command({...gm,commandId:'stale',expectedRevision:3}),{code:'STALE_REVISION'});
 p.aiDirectorId='ai-director:existing';await game.command({...gm,commandId:'retain'});assert.equal(sent[1].payload.aiDirectorId,p.aiDirectorId);
 p.directorMode='ai_dm';p.authorityEpoch=9001;p.rollPending=true;const takeover=presentProjection(p);assert.equal(takeover.actions.find(a=>a.id==='director:human').label,'Human DM');assert.match(takeover.summary,/AI DM/);assert.doesNotMatch(takeover.summary,/9001|ai-director:/);
 await game.command({...gm,commandId:'takeover',action:'director:human'});assert.deepEqual(sent[2].payload,{mode:'human_gm'});
 for(const audience of ['public','private'])assert.equal(presentProjection({...p,audience}).actions.some(a=>a.type==='gm_director_mode'),false);
 p.audience='private';await assert.rejects(game.command({...gm,commandId:'player'}),{code:'UNAVAILABLE_ACTION'});assert.equal(sent.length,3);
 p.audience='gm';p.decisionOpen=true;assert.equal(presentProjection(p).actions.some(a=>a.type==='gm_director_mode'),false);
});

function fixture(){return {projectionVersion:2,campaignId:'fixture-lantern',revision:4,audience:'private',characterId:'mara',currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[{characterId:'mara',displayName:'Mara',classId:'fighter',level:3,position:{x:3,y:3},factionId:'party',primaryHealth:31,primaryHealthMaximum:31,armorClass:18,resources:{movementFeet:30},abilities:[]}],map:{width:25,height:25,level:'tactical',cells:[{x:3,y:3,visibility:'visible',terrain:'floor'}],tokens:[]},inventory:{currency:25,items:[{itemId:'potion',displayName:'potion',quantity:1,value:50,usable:true,description:'Restore health.'}]},availableMovement:[{x:3,y:4,costFeet:5}],discoveries:[],pendingActions:[],publicEvents:[]};}
test('narrative ruling choices explain their limits instead of repeating the request',()=>{
 const p={...fixture(),audience:'gm',pendingActions:[{id:'r1',kind:'ruling',text:'Examine the convoy ledger.'}]};
 const view=presentProjection(p),approve=view.actions.find(a=>a.id==='ruling:r1:true'),decline=view.actions.find(a=>a.id==='ruling:r1:false');
 assert.equal(approve.label,'Approve request');assert.match(approve.description,/Rolls, discoveries, and resource changes still need/);assert.doesNotMatch(approve.description,/Examine the convoy/);
 assert.match(decline.description,/will not be applied/);assert.equal(view.dmStatus.pendingRulings[0].text,'Examine the convoy ledger.');
 assert.equal(view.actions.find(a=>a.id==='ruling:r1:true:note').fields[0].id,'text');
});
test('automated ruling effects and multiple requests remain distinguishable and GM-scoped',()=>{
 const p={...fixture(),pendingActions:[{id:'travel',kind:'travel:coastal-road',text:'Travel along the coast.'},{id:'rest',kind:'rest:short',text:'Take a short rest.'}]};
 const gm=presentProjection({...p,audience:'gm'});assert.equal(gm.actions.find(a=>a.id==='ruling:travel:true').label,'Approve request 1');assert.match(gm.actions.find(a=>a.id==='ruling:rest:true').description,/requested rest.*effects and costs/);assert.match(gm.dmStatus.pendingRulings[1].text,/^Request 2:/);
 for(const audience of ['private','public']){const view=presentProjection({...p,audience});assert.equal(view.dmStatus,undefined);assert.equal(view.actions.some(a=>a.id.startsWith('ruling:')),false);}
});
const scope={campaignId:'fixture-lantern',userId:'user',actorId:'mara',audience:'player',commandId:'intent-1',expectedRevision:4};

test('Inspiration choices remain available to the roller while paused and incapacitated, suppressing ordinary actions',()=>{
 const p=fixture();p.rollPending=true;p.decisionOpen=false;p.characters[0].primaryHealth=0;p.characters[0].conditions=['incapacitated'];
 p.pendingActions=[{kind:'inspiration',id:'roll-1',actorId:'mara',dieId:0,sides:20,value:3}];
 const view=presentProjection(p);assert.equal(view.actions.length,2);assert.ok(view.actions.every(a=>a.type==='inspiration_choice'));assert.match(view.actions[1].description,/must use the replacement/);assert.match(view.summary,/die choice is waiting/);
 assert.deepEqual(view.actions[1].payload,{pendingId:'roll-1',dieId:0,choice:'reroll'});
 for(const audience of ['public','gm']){const hidden=presentProjection({...p,audience,characterId:undefined});assert.equal(hidden.actions.filter(a=>a.type!=='gm_director_mode').length,0);assert.ok(!JSON.stringify(hidden.actions).includes('roll-1'));if(audience==='gm')assert.equal(hidden.dmStatus.pendingRulings.length,0);}
 assert.equal(presentProjection({...p,pendingActions:[{...p.pendingActions[0],actorId:'other'}]}).actions.length,0);
 assert.equal(presentProjection({...p,pendingActions:[{...p.pendingActions[0],value:21}]}).actions.length,0);
});

test('Inspiration action submits only the offered die choice and rejects forged result fields',async()=>{
 const p=fixture();p.rollPending=true;p.pendingActions=[{kind:'inspiration',id:'roll-1',actorId:'mara',dieId:0,sides:8,value:1}];let sent;
 const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async c=>(sent=c,{revision:5,result:{status:'pending-roll'}})}});
 await game.command({...scope,action:'inspiration:roll-1:0:reroll',payload:{}});assert.equal(sent.type,'inspiration_choice');assert.deepEqual(sent.payload,{pendingId:'roll-1',dieId:0,choice:'reroll'});
 for(const payload of [{value:8},{dieId:1},{choice:'keep'},{damage:99}])await assert.rejects(game.command({...scope,commandId:'forged',action:'inspiration:roll-1:0:reroll',payload}),{code:'INVALID_INPUT'});
});

test('pending roll receipts do not announce unapplied outcomes; resolved choices display the original outcome',()=>{
 const pending=presentReceipt({revision:5,replayed:true,result:{status:'pending-roll',damage:99,hit:true,message:'hidden target'}});
 assert.match(pending,/outcome has not been applied/);assert.match(pending,/Original pending receipt recovered/);assert.doesNotMatch(pending,/99|hidden target|Hit:/);
 const resolved=presentReceipt({revision:6,result:{status:'resolved',originalCommandId:'original',outcome:{damage:4,hit:true,message:'Attack resolved.'}}});assert.match(resolved,/Damage: 4/);assert.match(resolved,/Hit: yes/);assert.match(resolved,/Revision 6/);
});

test('Inspiration migration requires explicit GM grant and no pending roll',()=>{
 const p={...fixture(),canPrepareInspiration:true};assert.equal(presentProjection(p).actions.some(a=>a.type==='gm_prepare_inspiration'),false);
 assert.deepEqual(presentProjection({...p,audience:'gm'}).actions.find(a=>a.type==='gm_prepare_inspiration').payload,{version:1});
 assert.equal(presentProjection({...p,audience:'gm',rollPending:true}).actions.some(a=>a.type==='gm_prepare_inspiration'),false);
});

test('DM retains Pause during a waiting die, but cannot open decisions or change the scene',()=>{
 const p={...fixture(),audience:'gm',characterId:undefined,rollPending:true};
 assert.deepEqual(presentProjection(p).actions.map(a=>[a.type,a.payload]),[['gm_decision',{open:false}]]);
 assert.ok(presentProjection({...p,decisionOpen:false}).actions.every(a=>a.type==='gm_director_mode'));
 assert.equal(presentProjection({...p,audience:'private'}).actions.length,0);
});

test('Inspiration sheet guidance follows the explicit supported engine version',()=>{
 const p=fixture();p.characters[0].sheet={features:[{id:'human-resourceful'}]};p.characters[0].resources.heroicInspiration=true;
 const text=version=>presentProjection({...p,inspirationRulesVersion:version}).actor.sheet.features[0].description;
 assert.match(text(1),/private Keep or Reroll/);assert.match(text(1),/must use the replacement/);
 for(const version of [undefined,0,2,'1'])assert.match(text(version),/require DM review/);
});

test('Preserve Life distributes only among granted recipients and sends validated intentions',async()=>{
 const p=fixture();p.characters[0].abilities=['preserve-life'];p.characters[0].resources.channelDivinity=2;
 p.preserveLife={pool:15,targets:[{characterId:'mara',displayName:'Mara'},{characterId:'guard',displayName:'Guard'}]};
 const offered=presentProjection(p).actions.find(a=>a.id==='preserve-life:divide');assert.equal(offered.fields.length,1);assert.equal(offered.fields[0].kind,'healing-allocation');
 let sent;const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async c=>(sent=c,{revision:5})}});
 const allocations=[{targetId:'mara',amount:10},{targetId:'guard',amount:5}];await game.command({...scope,action:offered.id,payload:{allocations:JSON.stringify(allocations)}});assert.deepEqual(sent.payload,{abilityId:'preserve-life',allocations});
 await assert.rejects(game.command({...scope,commandId:'bad',action:offered.id,payload:{allocations:JSON.stringify([{targetId:'hidden',amount:1}])}}),{code:'INVALID_INPUT'});
 for(const overrides of [{audience:'public'},{preserveLife:undefined},{decisionOpen:false},{rollPending:true}])assert.equal(presentProjection({...p,...overrides}).actions.some(a=>a.id==='preserve-life:divide'),false);
 p.characters[0].resources.channelDivinity=0;assert.equal(presentProjection(p).actions.some(a=>a.id==='preserve-life:divide'),false);
});

test('location attack offers only authorized guesses and converts visible one-based coordinates',async()=>{
 const p=fixture();p.phase='combat';p.activeActorId='mara';p.inventory.items=[{itemId:'longbow',displayName:'Longbow',quantity:1,equipped:true}];
 assert.equal(presentProjection(p).actions.some(a=>a.type==='attack_location'),false);
 p.targeting={availableLocationAttack:true,coordinateBase:0};let sent;
 const service=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async c=>(sent=c,{revision:5})}});
 await service.command({...scope,action:'attack-location:longbow',payload:{column:'25',row:'1'}});
 assert.deepEqual(sent.payload,{weaponId:'longbow',x:24,y:0});assert.equal(sent.type,'attack_location');
 for(const payload of [{column:'0',row:'1'},{column:'1',row:'26'},{column:'1.5',row:'2'},{column:'1',row:'2',targetId:'SECRET'}])await assert.rejects(service.command({...scope,commandId:'different',action:'attack-location:longbow',payload}),{code:'INVALID_INPUT'});
});
test('preparing terrain is offered only by an explicit GM engine grant',()=>{
 const p=fixture();p.canPrepareTerrain=true;
 assert.equal(presentProjection(p).actions.some(a=>a.type==='gm_prepare_terrain'),false);
 assert.equal(presentProjection({...p,audience:'gm'}).actions.find(a=>a.type==='gm_prepare_terrain').payload.version,1);
 assert.equal(presentProjection({...p,audience:'gm',canPrepareTerrain:false}).actions.some(a=>a.type==='gm_prepare_terrain'),false);
});

test('combat movement offers use projected costs, prone multiplier and remaining movement',()=>{
 const p=fixture();p.phase='combat';p.activeActorId='mara';p.availableMovement.push({x:4,y:3,costFeet:10});
 const moves=()=>presentProjection(p).actions.filter(a=>a.type==='move');
 p.characters[0].resources.movementFeet=5;assert.deepEqual(moves().map(a=>a.id),['move:3:4']);
 p.characters[0].conditions=['prone'];assert.equal(moves().length,0);
 p.characters[0].resources.movementFeet=10;assert.equal(moves().length,1);assert.match(moves()[0].description,/^10 feet/);
 p.characters[0].resources.movementFeet=0;assert.equal(moves().length,0);
 p.characters[0].resources.criticalMoveFeet=10;assert.equal(moves().length,1);
 p.activeActorId='other';assert.equal(moves().length,0);
});
test('exploration ignores turn budget but disables immobile conditions and unknown costs',()=>{
 const p=fixture();p.characters[0].resources.movementFeet=0;const moves=()=>presentProjection(p).actions.filter(a=>a.type==='move');assert.equal(moves().length,1);
 for(const condition of ['grappled','restrained','incapacitated','stunned','paralyzed','unconscious']){p.characters[0].conditions=[condition];assert.equal(moves().length,0);}
 p.characters[0].conditions=[];p.availableMovement=[{x:4,y:3},{x:3,y:4,costFeet:0}];assert.equal(moves().length,0);
});
test('unaffordable movement cannot become an engine command through current service controls',async()=>{
 const p=fixture();p.phase='combat';p.activeActorId='mara';p.characters[0].resources.movementFeet=0;let calls=0;
 const game=createGameService({authorize:async()=>true,client:{campaignId:scope.campaignId,project:async()=>p,command:async()=>calls++}});
 await assert.rejects(game.command({...scope,action:'move:3:4',payload:{}}),{code:'UNAVAILABLE_ACTION'});assert.equal(calls,0);
});
test('DM status is explicit and pending ruling details never enter private or public status',()=>{
 const p=fixture();p.pendingActions=[{id:'private-ruling',kind:'ruling',text:'GM-only review'},{id:'reaction',kind:'reaction',text:'not a discretionary ruling'}];
 const gm=presentProjection({...p,audience:'gm',characterId:undefined,decisionOpen:false});assert.match(gm.summary,/Player decisions: PAUSED\nPending rulings: 1/);assert.equal(gm.dmStatus.pendingRulings.length,1);
 assert.match(presentProjection({...p,audience:'gm',characterId:undefined}).summary,/Player decisions: OPEN/);
 assert.equal(presentProjection(p).dmStatus,undefined);assert.equal(presentProjection({...p,audience:'public'}).dmStatus,undefined);
});
test('movement labels match one-based map while intention stays exact engine coordinates',()=>{const view=presentProjection(fixture());assert.deepEqual(view.actions.find(a=>a.id==='move:3:4').payload,{x:3,y:4});assert.match(view.actions.find(a=>a.id==='move:3:4').label,/4, 5/);});
test('public presentation excludes malformed extra private fields and map even if upstream carries them',()=>{const p={...fixture(),audience:'public',characterId:''};const view=presentProjection(p);assert.equal(view.actor,undefined);assert.equal(view.map,undefined);assert.equal(view.actions.length,0);assert.equal(view.stock.length,0);assert.ok(!JSON.stringify(view).includes('Restore health'));});
test('paused decisions offer no mutating character actions',()=>{const p=fixture();p.decisionOpen=false;assert.equal(presentProjection(p).actions.length,0);});
test('scoped action validates exact fixed identifiers and rejects injected damage',async()=>{let commands=0;const game=createGameService({client:{campaignId:'fixture-lantern',project:async()=>fixture(),command:async()=>commands++},authorize:async()=>true});await assert.rejects(game.command({...scope,action:'move:3:4',payload:{x:6,y:4}}),{code:'INVALID_INPUT'});await assert.rejects(game.command({...scope,action:'move:3:4',payload:{damage:900}}),{code:'INVALID_INPUT'});assert.equal(commands,0);});
test('current membership and revision are rechecked before dispatch',async()=>{let allowed=false,commands=0;const game=createGameService({client:{campaignId:'fixture-lantern',project:async()=>fixture(),command:async()=>commands++},authorize:async()=>allowed});await assert.rejects(game.command({...scope,action:'move:3:4'}),{code:'ACCESS_DENIED'});allowed=true;await assert.rejects(game.command({...scope,expectedRevision:3,action:'move:3:4'}),{code:'STALE_REVISION'});assert.equal(commands,0);});
test('modal quantity converts only whole numeric input; the engine receives identifiers not derived results',async()=>{let sent;const game=createGameService({client:{campaignId:'fixture-lantern',project:async()=>fixture(),command:async request=>sent=request},authorize:async()=>true});await assert.rejects(game.command({...scope,action:'drop:potion',payload:{quantity:'1.2'}}),{code:'INVALID_INPUT'});await game.command({...scope,action:'drop:potion',payload:{quantity:'1'}});assert.deepEqual(sent,{ownerId:'user',actorId:'mara',commandId:'intent-1',expectedRevision:4,type:'drop',payload:{itemId:'potion',quantity:1}});});
test('each view requests its explicit engine audience, character and map level',async()=>{let sent;const game=createGameService({client:{campaignId:'fixture-lantern',project:async request=>{sent=request;return fixture();},command:async()=>{}},authorize:async()=>true});await game.project({...scope,mapLevel:'regional'});assert.deepEqual(sent,{ownerId:'user',actorId:'mara',audience:'private',mapLevel:'regional'});});

test('downed active character retains death-save/end-turn control',()=>{const p=fixture();p.phase='combat';p.activeActorId='mara';p.characters[0].primaryHealth=0;const actions=presentProjection(p).actions;assert.deepEqual(actions.map(a=>a.type),['end_turn']);});
test('standard actions, transfers, upcast and multi-target bless are reachable',()=>{const p=fixture();p.phase='combat';p.activeActorId='mara';p.characters[0].conditions=['prone'];p.characters[0].abilities=['bless','cure-wounds'];p.characters[0].resources.spellSlots2=2;p.characters.push({...p.characters[0],characterId:'friend',displayName:'Friend',position:{x:4,y:3}});const actions=presentProjection(p).actions;for(const id of ['dash','disengage','dodge','stand'])assert.ok(actions.some(a=>a.payload.abilityId===id));assert.ok(actions.some(a=>a.type==='transfer'&&a.payload.targetId==='friend'));assert.ok(actions.some(a=>a.payload.slotLevel===2));assert.ok(actions.some(a=>a.payload.targetIds?.length===2));});
test('ambiguous transport retry forwards original validated intent despite newer revision and rechecks access',async()=>{let revision=4,allowed=true;const sent=[];const game=createGameService({authorize:async()=>allowed,client:{campaignId:scope.campaignId,project:async()=>({...fixture(),revision}),command:async request=>{sent.push(structuredClone(request));if(sent.length===1){revision=5;throw new Error('connection lost after commit');}return {revision:5,replayed:true,result:{message:'Moved'}};}}});const intent={...scope,action:'move:3:4',payload:{x:3,y:4}};await assert.rejects(game.command(intent),/connection lost/);assert.equal((await game.command(intent)).replayed,true);assert.deepEqual(sent[0],sent[1]);await assert.rejects(game.command({...intent,payload:{x:3,y:5}}),{code:'COMMAND_COLLISION'});allowed=false;await assert.rejects(game.command(intent),{code:'ACCESS_DENIED'});assert.equal(sent.length,2);});
test('receipt display is a bounded allowlist and neutralizes mentions',()=>{const text=presentReceipt({revision:7,replayed:true,result:{message:'@everyone check',total:19,passed:true,secret:'SECRET',inventory:{item:'HIDDEN'}}});assert.match(text,/Total: 19/);assert.match(text,/Revision 7/);assert.doesNotMatch(text,/SECRET|HIDDEN|@everyone/);});

test('healing receipts show authorized requested and actual amounts without raw IDs or extra state',()=>{
 const result={message:'Healing complete',healing:5,allocations:[{targetId:'PRIVATE-ID',displayName:'@Mara',amount:8,healing:5,primaryHealth:99,secret:'SECRET'},{targetId:'NO-NAME',amount:2,healing:2},{displayName:'INVALID',amount:1,healing:3}]};
 const text=presentReceipt({revision:8,result});assert.match(text,/5 HP restored \(8 allocated\)/);assert.doesNotMatch(text,/PRIVATE-ID|NO-NAME|SECRET|99|INVALID|@Mara/);
 const recipient=presentReceipt({result:{message:'Healing restored your health.',healing:5}});assert.match(recipient,/Healing: 5/);assert.doesNotMatch(recipient,/allocated|Mara/);
});
test('fresh service recovers original receipt by scoped read, never sends a stale mutation',async()=>{
 let commands=0,lookups=0,allowed=true;
 const game=createGameService({authorize:async()=>allowed,client:{campaignId:scope.campaignId,project:async()=>({...fixture(),revision:9}),command:async()=>commands++,receipt:async request=>{lookups++;assert.deepEqual(request,{ownerId:'user',actorId:'mara',commandId:'intent-1'});return {revision:5,replayed:true,originalType:'move',result:{message:'Moved'}};}}});
 assert.equal((await game.command({...scope,action:'invented-invalid-action',payload:{damage:999}})).originalType,'move');assert.equal(commands,0);
 allowed=false;await assert.rejects(game.command({...scope,action:'move:3:4'}),{code:'ACCESS_DENIED'});assert.equal(lookups,1);
});

test('persistent mission and discovered travel are offered; only a GM scope offers subgroup selection',()=>{
 const p=fixture();p.mission={availableActions:['rescue-technician'],canScout:true};p.travelOptions=[{destinationId:'rescue',minutes:10}];
 let view=presentProjection(p);assert.ok(view.actions.some(a=>a.type==='mission_action'));assert.ok(view.actions.some(a=>a.type==='scout_route'));assert.ok(view.actions.some(a=>a.type==='travel'));assert.ok(!view.actions.some(a=>a.payload.actorIds));
 p.canChooseTravelGroup=true;view=presentProjection(p);assert.ok(view.actions.some(a=>a.payload.actorIds?.[0]==='mara'));
});

test('private action timeline filters a second owned character and strips hidden result fields',()=>{const p=fixture();p.privateHistory=[{sequence:1,revision:3,characterId:'mara',kind:'death-save',result:{message:'Your save',roll:9,deathFailures:1,secret:'SECRET'}},{sequence:2,revision:4,characterId:'rogue',kind:'check',result:{message:'HIDDEN ROGUE'}}];const view=presentProjection(p);assert.equal(view.history.length,1);assert.match(view.journal.join(' '),/Death save failures: 1/);assert.doesNotMatch(JSON.stringify(view),/SECRET|HIDDEN ROGUE/);p.audience='public';assert.equal(presentProjection(p).history.length,0);assert.doesNotMatch(JSON.stringify(presentProjection(p)),/Your save/);});
test('downed End Turn explicitly explains entry save already resolved',()=>{const p=fixture();p.phase='combat';p.activeActorId='mara';p.characters[0].primaryHealth=0;const action=presentProjection(p).actions[0];assert.equal(action.label,'End Turn');assert.match(action.description,/already resolved/);});


test('combat-only cleric spells are not offered or dispatched during exploration; Divine Spark remains',async()=>{
 const p=fixture();p.characters[0].abilities=['sacred-flame','guiding-bolt','divine-spark-radiant'];p.characters[0].resources.spellSlots1=2;p.characters.push({characterId:'sentinel',displayName:'Sentinel',factionId:'hostile',position:{x:4,y:3},primaryHealth:20});
 const offered=()=>presentProjection(p).actions.filter(a=>a.type==='ability'&&p.characters[0].abilities.includes(a.payload.abilityId)).map(a=>a.payload.abilityId);
 assert.deepEqual(offered(),['divine-spark-radiant']);let commands=0;
 const service=createGameService({client:{campaignId:p.campaignId,project:async()=>p,command:async()=>commands++},authorize:async()=>true});
 for(const spell of ['sacred-flame','guiding-bolt'])await assert.rejects(service.command({...scope,action:'ability:'+spell+':sentinel',payload:{}}),{code:'UNAVAILABLE_ACTION'});assert.equal(commands,0);
 p.phase='combat';p.activeActorId='mara';assert.deepEqual(offered(),['sacred-flame','guiding-bolt','divine-spark-radiant']);
});


test('after an attack receipt refreshed offers remove spent main actions but retain movement and bonus abilities',async()=>{
 const p=fixture();p.phase='combat';p.activeActorId='mara';p.characters[0].resources.action=true;p.characters[0].resources.bonusAction=true;p.characters[0].abilities=['cunning-dash','cunning-disengage'];p.characters[0].conditions=['prone'];p.inventory.items.push({itemId:'shortbow',displayName:'Shortbow',quantity:1,equipped:true});p.characters.push({characterId:'sentinel',displayName:'Sentinel',factionId:'hostile',position:{x:4,y:3},primaryHealth:20});let commands=0;
 const game=createGameService({client:{campaignId:p.campaignId,project:async()=>p,command:async()=>{commands++;p.revision++;p.characters[0].resources.action=false;return {success:true,revision:p.revision};}},authorize:async()=>true});
 assert.ok(presentProjection(p).actions.some(a=>a.id==='attack:sentinel:shortbow'));await game.command({...scope,action:'attack:sentinel:shortbow',payload:{}});
 const ids=presentProjection(p).actions.map(a=>a.id);assert.ok(!ids.some(id=>id.startsWith('attack:')));for(const id of ['standard:dash','standard:disengage','standard:dodge'])assert.ok(!ids.includes(id));
 for(const id of ['move:3:4','standard:stand','end_turn','ability:cunning-dash:mara','ability:cunning-disengage:mara'])assert.ok(ids.includes(id),id);
 await assert.rejects(game.command({...scope,commandId:'second-attack',expectedRevision:5,action:'attack:sentinel:shortbow',payload:{}}),{code:'UNAVAILABLE_ACTION'});assert.equal(commands,1);
 p.pendingActions=[{id:'reaction',kind:'reaction',reactors:['mara']}];assert.ok(presentProjection(p).actions.some(a=>a.group==='reaction'));
 p.pendingActions=[];p.phase='exploration';assert.ok(presentProjection(p).actions.some(a=>a.id==='standard:dash'));
});


test('spent combat action suppresses main-cost spells including group variants while preserving bonus and surge',()=>{
 const p=fixture(),main=['sacred-flame','cure-wounds','bless','guiding-bolt','aid','spare-the-dying','divine-spark-heal','divine-spark-radiant','preserve-life'],bonus=['healing-word','lesser-restoration','cunning-dash','cunning-disengage','action-surge'];p.phase='combat';p.activeActorId='mara';p.characters[0].abilities=[...main,...bonus];Object.assign(p.characters[0].resources,{action:true,bonusAction:true,spellSlots2:2});p.characters.push({characterId:'ally',displayName:'Ally',factionId:'party',position:{x:4,y:3},primaryHealth:10},{characterId:'foe',displayName:'Foe',factionId:'hostile',position:{x:5,y:3},primaryHealth:10});
 const actions=()=>presentProjection(p).actions;assert.ok(actions().some(a=>a.payload.abilityId==='bless'&&a.payload.targetIds?.length===2));assert.ok(actions().some(a=>a.payload.abilityId==='aid'&&a.payload.targetIds?.length===2));
 p.characters[0].resources.action=false;const spent=actions();assert.ok(!spent.some(a=>main.includes(a.payload.abilityId)));for(const ability of bonus)assert.ok(spent.some(a=>a.payload.abilityId===ability),ability);
 p.phase='exploration';for(const ability of main.filter(a=>!['sacred-flame','guiding-bolt'].includes(a)))assert.ok(actions().some(a=>a.payload.abilityId===ability),ability);assert.ok(actions().some(a=>a.payload.targetIds?.length===2));
});

test('owned armor is never offered as a weapon and removal precedes transfer',()=>{
 const p=fixture();p.phase='combat';p.activeActorId='mara';p.targeting={availableLocationAttack:true,coordinateBase:0};p.shop=[];
 p.characters.push({...p.characters[0],characterId:'enemy',displayName:'Enemy',factionId:'hostile'});
 p.inventory.items=[{itemId:'chain-mail',slot:'body',displayName:'Chain mail',quantity:1,equipped:true,canEquip:false,canUnequip:false,canTransfer:false},{itemId:'shield',slot:'shield',displayName:'Shield',quantity:1,equipped:true,canUnequip:true,unequipMinutes:0,canTransfer:false},{itemId:'sword',slot:'weapon',displayName:'Sword',quantity:1,equipped:true}];
 const v=presentProjection(p);assert.deepEqual(v.actions.filter(a=>a.type==='attack').map(a=>a.payload.weaponId),['sword']);assert.deepEqual(v.actions.filter(a=>a.type==='attack_location').map(a=>a.payload.weaponId),['sword']);
 assert.equal(v.actions.some(a=>['drop','transfer','sell'].includes(a.type)&&['shield','chain-mail'].includes(a.payload.itemId)),false);
 assert.match(v.actions.find(a=>a.type==='unequip').description,/Costs your action/);
 assert.equal(v.actions.some(a=>a.type==='unequip'&&a.payload.itemId==='chain-mail'),false);
});
test('armor offers use engine permissions and duration, and migration is explicitly GM granted',()=>{
 const p=fixture();p.inventory.items=[{itemId:'chain-mail',slot:'body',displayName:'Chain mail',quantity:1,canEquip:true,equipMinutes:10}];
 assert.match(presentProjection(p).actions.find(a=>a.type==='equip').description,/10 world minutes after DM approval/);
 p.inventory.items[0].canEquip=false;assert.equal(presentProjection(p).actions.some(a=>a.type==='equip'),false);
 p.canPrepareEquipment=true;assert.equal(presentProjection(p).actions.some(a=>a.type==='gm_prepare_equipment'),false);
 assert.deepEqual(presentProjection({...p,audience:'gm'}).actions.find(a=>a.type==='gm_prepare_equipment').payload,{version:1});
 assert.equal(presentProjection({...p,audience:'gm',canPrepareEquipment:false}).actions.some(a=>a.type==='gm_prepare_equipment'),false);
});

test('equipment intentions cannot supply another item or calculated armor class',async()=>{
 const p=fixture();p.inventory.items=[{itemId:'shield',displayName:'Shield',slot:'shield',quantity:1,equipped:true,canUnequip:true,unequipMinutes:0}];let sent=[];
 const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async c=>{sent.push(c);return{revision:5};}}});
 for(const payload of [{itemId:'secret-shield'},{armorClass:99}])await assert.rejects(game.command({...scope,action:'unequip:shield',payload}),{code:'INVALID_INPUT'});
 assert.equal(sent.length,0);await game.command({...scope,action:'unequip:shield',payload:{}});assert.equal(sent.length,1);assert.equal(sent[0].type,'unequip');assert.deepEqual(sent[0].payload,{itemId:'shield'});
});

test('interrupted armor time is offered only to GM with engine duration and never as approval override',()=>{
 const p={...fixture(),audience:'gm',pendingActions:[{id:'armor',kind:'equipment:unequip',durationMinutes:5,text:'Remove armor'}]};
 const actions=presentProjection(p).actions;assert.equal(actions.filter(a=>a.fields.some(f=>f.id==='elapsedMinutes')).length,2);
 assert.equal(actions.filter(a=>a.fields.some(f=>f.id==='elapsedMinutes')).every(a=>a.payload.approved===false),true);
 for(const change of [{audience:'private'},{audience:'public'},{pendingActions:[{id:'armor',kind:'rest:short',durationMinutes:5}]},{pendingActions:[{id:'armor',kind:'equipment:unequip',durationMinutes:'5'}]}])assert.equal(presentProjection({...p,...change}).actions.some(a=>a.fields.some(f=>f.id==='elapsedMinutes')),false);
});
test('interruption submits bounded intended minutes and preserves an optional explanation variant',async()=>{
 const p={...fixture(),audience:'gm',pendingActions:[{id:'armor',kind:'equipment:unequip',durationMinutes:5}]};let sent=[];
 const game=createGameService({authorize:async()=>true,client:{campaignId:p.campaignId,project:async()=>p,command:async c=>{sent.push(c);return{revision:5};}}});
 for(const elapsedMinutes of ['6','-1','1.5','NaN','9007199254740993'])await assert.rejects(game.command({...scope,action:'ruling:armor:false:elapsed',payload:{elapsedMinutes}}),{code:'INVALID_INPUT'});
 assert.equal(sent.length,0);
 await game.command({...scope,action:'ruling:armor:false:elapsed:note',payload:{elapsedMinutes:'2',text:'Interrupted by a patrol.'}});
 assert.deepEqual(sent[0].payload,{pendingId:'armor',approved:false,elapsedMinutes:2,text:'Interrupted by a patrol.'});
 await assert.rejects(game.command({...scope,commandId:'other',action:'ruling:armor:true',payload:{elapsedMinutes:'2'}}),{code:'INVALID_INPUT'});
});
