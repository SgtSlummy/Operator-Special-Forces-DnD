import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInvestigationDraftStore } from '../../hollow-lantern/investigation-drafts.mjs';
import { createHollowLanternAdapter, ControlStore } from './adapter.mjs';
const baseScope={campaignId:'camp',userId:'owner',actorId:'hero',audience:'player',mapLevel:'tactical'};
const action={id:'describe',type:'describe',group:'describe',label:'Describe action',payload:{target:'door'},fields:[{id:'text',label:'Your intention',maxLength:1500,multiline:true}]};
function all(value){return value&&typeof value==='object'?[value,...Object.values(value).flatMap(all)]:[];}
const button=(payload,label)=>all(payload).find(x=>x.label===label&&x.custom_id)?.custom_id;
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'native-draft-')); let store=await createInvestigationDraftStore({file:join(dir,'draft.json')});
 t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
 let revision=4, actions=[structuredClone(action)], allowed=true, failNext=false, revokeAfter=0; const commands=[]; const receipts=new Map();
 const engine={project:async()=>{await Promise.resolve();if(revokeAfter>0&&--revokeAfter===0)allowed=false;return {revision,audience:'player',title:'Room',actions:actions,journal:['Known carving'],actor:{name:'Hero'}};},command:async request=>{commands.push(structuredClone(request));if(receipts.has(request.commandId))return receipts.get(request.commandId);const receipt={ok:true,message:'Recorded'};receipts.set(request.commandId,receipt);revision++;if(failNext){failNext=false;throw new Error('response lost');}return receipt;}};
 let tokens, adapter;
 function build(){tokens=new ControlStore();adapter=createHollowLanternAdapter({engine,draftStore:store,tokenStore:tokens,campaignId:'camp',authorize:async s=>allowed&&s.userId==='owner'&&s.actorId==='hero',resolveActor:async()=> 'hero'});}
 build();
 async function click(id,{text='Examine @everyone **hinges**',modal=false,user='owner',values}={}){const interaction={customId:id,values,user:{id:user},id:'interaction',isModalSubmit:()=>modal,fields:{getTextInputValue:()=>text},deferReply:async()=>{interaction.deferred=true;},reply:async p=>{interaction.output=p;interaction.replied=true;},editReply:async p=>{interaction.output=p;},showModal:async p=>{interaction.modal=p;}};await adapter.handleInteraction(interaction);return interaction;}
 async function save(){const panel=await adapter.panel(baseScope);const menu=all(panel).find(x=>x.placeholder==='Choose your next action');const grouped=await click(menu.custom_id,{values:[menu.options.find(x=>x.label==='Describe Action').value]});const targets=all(grouped.output).find(x=>x.placeholder==='Choose a target or action');const opened=await click(targets.custom_id,{values:[targets.options[0].value]});assert.match(opened.modal.title,/Save/);return click(opened.modal.custom_id,{modal:true});}
 return {click,save,commands,get adapter(){return adapter;},get tokens(){return tokens;},get store(){return store;},setRevision:v=>{revision=v;},setActions:v=>{actions=v;},deny:()=>{allowed=false;},revokeDuringFresh:()=>{revokeAfter=2;},loseResponse:()=>{failNext=true;},restart:async()=>{await store.close();store=await createInvestigationDraftStore({file:join(dir,'draft.json')});build();}};
}
test('modal save and map/known details are read-only; restart offers durable resume; explicit Try runs once',async t=>{
 const f=await fixture(t), saved=await f.save();assert.equal(f.commands.length,0);assert.match(JSON.stringify(saved.output),/Saved intention/);assert.doesNotMatch(JSON.stringify(saved.output),/@everyone/);
 const map=await f.click(button(saved.output,'Map'));assert.ok(button(map.output,'Resume saved intention'));assert.equal(f.commands.length,0);
 const known=await f.click(button(saved.output,'Review known details'));assert.match(JSON.stringify(known.output),/Known carving/);assert.equal(f.commands.length,0);
 await f.restart();const panel=await f.adapter.panel(baseScope);const review=await f.click(button(panel,'Resume saved intention'));
 const tried=await f.click(button(review.output,'Try action'));assert.equal(f.commands.length,1);assert.equal(f.commands[0].payload.text,'Examine @everyone **hinges**');
 await f.click(button(review.output,'Try action'));assert.equal(f.commands.length,1);assert.match(JSON.stringify(tried.output),/completed/i);assert.ok(all(tried.output).filter(x=>x.type===10).every(x=>x.content.trim().length>0));
});
test('owner, stale revision, changed action and superseded controls cannot commit',async t=>{
 const f=await fixture(t), saved=await f.save(), commit=button(saved.output,'Try action');
 await f.click(commit,{user:'other'});assert.equal(f.commands.length,0);
 f.setActions([{...action,payload:{target:'other-door'}}]);await f.click(commit);assert.equal(f.commands.length,0);
 f.setActions([action]);f.setRevision(5);await f.click(commit);assert.equal(f.commands.length,0);
 f.setRevision(4);const edit=await f.click(button(saved.output,'Edit intention'));await f.click(edit.modal.custom_id,{modal:true,text:'Different intent'});
 await f.click(commit);assert.equal(f.commands.length,0);
});
test('concurrent Try serializes and lost response reopens the original durable command',async t=>{
 const f=await fixture(t), saved=await f.save(), commit=button(saved.output,'Try action');
 await Promise.all([f.click(commit),f.click(commit)]);assert.equal(f.commands.length,1);
 const g=await fixture(t), other=await g.save();g.loseResponse();await g.click(button(other.output,'Try action'));assert.equal(g.commands.length,1);
 await g.restart();const panel=await g.adapter.panel(baseScope), review=await g.click(button(panel,'Resume saved intention'));
 await g.click(button(review.output,'Recover original action'));assert.equal(g.commands.length,2);assert.deepEqual(g.commands[1],g.commands[0]);
});
test('long escaped intention is fully paginated; revocation prevents Try',async t=>{
 const f=await fixture(t), opened=await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'describe',opensModal:true}));
 const saved=await f.click(opened.modal.custom_id,{modal:true,text:'*'.repeat(1500)});
 assert.ok(button(saved.output,'Next text'));
 for(const payload of [saved.output,(await f.click(button(saved.output,'Next text'))).output]){
  assert.ok(all(payload).filter(x=>x.type===10).reduce((sum,x)=>sum+x.content.length,0)<4000);
 }
 assert.equal(f.commands.length,0); f.deny(); await f.click(button(saved.output,'Try action')); assert.equal(f.commands.length,0);
});
test('talk and interact use untyped native text fields; group names cannot opt mechanics into drafts',async t=>{
 for(const type of ['talk','interact']){const f=await fixture(t);f.setActions([{...action,type}]);const saved=await f.save();assert.match(JSON.stringify(saved.output),/Saved intention/);assert.equal(f.commands.length,0);}
 const f=await fixture(t);f.setActions([{...action,type:'move'}]);const opened=await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'describe',opensModal:true}));assert.doesNotMatch(opened.modal.title,/Save/);
});
test('revocation while fresh projection is pending prevents save and prepare mutations',async t=>{
 const scope={campaignId:'camp',userId:'owner',actorId:'hero',role:'player',visibility:'private'};
 const f=await fixture(t), saved=await f.save(), before=await f.store.get(scope);
 f.revokeDuringFresh();await f.click(button(saved.output,'Try action'));assert.deepEqual(await f.store.get(scope),before);assert.equal(f.commands.length,0);
 const g=await fixture(t), original=await g.save(), existing=await g.store.get(scope), edit=await g.click(button(original.output,'Edit intention'));
 g.revokeDuringFresh();await g.click(edit.modal.custom_id,{modal:true,text:'Changed'});assert.deepEqual(await g.store.get(scope),existing);assert.equal(g.commands.length,0);
});
test('nontext field kind cannot enter written draft flow',async t=>{
 const f=await fixture(t);f.setActions([{...action,fields:[{...action.fields[0],kind:'number'}]}]);
 const opened=await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'describe',opensModal:true}));assert.doesNotMatch(opened.modal.title,/Save/);
});
test('mutating reused projected action after opening modal cannot change its saved contract',async t=>{
 const f=await fixture(t), mutable=structuredClone(action);f.setActions([mutable]);
 const opened=await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'describe',opensModal:true}));
 mutable.payload.target='secret-door';mutable.fields[0].maxLength=1600;
 await f.click(opened.modal.custom_id,{modal:true});
 assert.equal((await f.store.get({campaignId:'camp',userId:'owner',actorId:'hero',role:'player',visibility:'private'})).actionPayload.target,'door');assert.equal(f.commands.length,0);
});
test('scene changes during writing preserve submitted text; edit rebases before any attempt',async t=>{
 const f=await fixture(t), opened=await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'describe',opensModal:true}));
 f.setRevision(5);f.setActions([]);const saved=await f.click(opened.modal.custom_id,{modal:true,text:'Keep my idea'});
 assert.match(JSON.stringify(saved.output),/scene changed/);assert.match(JSON.stringify(saved.output),/Keep my idea/);
 await f.click(button(saved.output,'Try action'));assert.equal(f.commands.length,0);
 f.setActions([action]);const edit=await f.click(button(saved.output,'Edit intention'));assert.equal(edit.modal.components[0].component.value,'Keep my idea');
 const rebased=await f.click(edit.modal.custom_id,{modal:true,text:'Keep my idea'});await f.click(button(rebased.output,'Try action'));
 assert.equal(f.commands.length,1);assert.equal(f.commands[0].expectedRevision,5);assert.equal(f.commands[0].payload.text,'Keep my idea');
});
test('mechanical action stays immediate when draft store is configured',async t=>{
 const f=await fixture(t);f.setActions([{id:'move',type:'move',group:'move',payload:{x:1,y:2}}]);
 await f.click(f.tokens.issue({...baseScope,revision:4,actionId:'move'}));assert.equal(f.commands.length,1);
});
