import test from 'node:test';
import assert from 'node:assert/strict';
import {createHollowLanternAdapter,ControlStore} from './adapter.mjs';

function fixture(renderAssets={}){
 let revision=4,allowed=true,now=1;
 const store=new ControlStore({now:()=>now}),commands=[],projections=[];
 const map={id:'signal-dungeon',level:'tactical',width:25,height:25,viewerCharacterId:'hero',cells:Array.from({length:625},(_,i)=>({x:i%25,y:Math.floor(i/25),terrain:'floor',visibility:'visible'})),tokens:[{characterId:'hero',displayName:'Hero',x:12,y:12}]};
 const engine={project:async scope=>{projections.push(scope);return {audience:scope.audience,revision,title:'Fixture',map:{...map,level:scope.mapLevel},actions:[]};},command:async input=>{commands.push(input);throw Error('Navigation must never command');}};
 const adapter=createHollowLanternAdapter({engine,tokenStore:store,campaignId:'fixture',renderAssets,authorize:async()=>allowed,resolveActor:async()=> 'hero'});
 const open=(extra={})=>adapter.panel({userId:'owner',actorId:'hero',...extra});
 async function press(id,user='owner') {let reply;await adapter.handleInteraction({customId:id,user:{id:user},deferReply:async()=>{},reply:async p=>reply=p,editReply:async p=>reply=p});return reply;}
 return {map,store,commands,projections,open,press,stale:()=>revision++,revoke:()=>allowed=false,expire:()=>now=9999999};
}
const controls=p=>p.components.flatMap(c=>c.components??[]).flatMap(c=>c.components??[c]);
const control=(p,label)=>controls(p).find(c=>c.label===label);
test('native renderer resolves only the current scene material binding in full and detail views',async()=>{
 let selected=0;
 const terrainTexturesByScene={get 'signal-dungeon'(){selected++;return {};},get 'unseen-scene'(){throw Error('Unrelated scene material must not load');}};
 const f=fixture({terrainTexturesByScene});const full=await f.open();assert.equal(selected,1);
 await f.press(control(full,'Nearby detail').custom_id);assert.equal(selected,2);assert.equal(f.commands.length,0);
});
test('private detail and full map preserve scope and revision without gameplay commands',async()=>{
 const f=fixture(),full=await f.open();assert.equal(control(full,'Full map').style,1);
 const id=control(full,'Nearby detail').custom_id;
 const t=f.store.get(id);assert.equal(t.actorId,'hero');assert.equal(t.userId,'owner');assert.equal(t.campaignId,'fixture');assert.equal(t.revision,4);assert.equal(t.actionId,undefined);
 const detail=await f.press(id);assert.equal(control(detail,'Nearby detail').style,1);assert.ok(detail.flags&64);
 assert.equal(full.files[0].attachment.readUInt32BE(16),880);
 assert.equal(detail.files[0].attachment.readUInt32BE(16),656);
 const restored=await f.press(control(detail,'Full map').custom_id);assert.equal(control(restored,'Full map').style,1);
 assert.deepEqual(restored.files[0].attachment,full.files[0].attachment);assert.equal(f.commands.length,0);
 assert.ok(f.projections.every(s=>s.actorId==='hero'&&s.userId==='owner'&&s.audience==='player'));
});
test('copied stale expired and revoked map controls never deliver an attachment',async()=>{
 for(const mode of ['copied','stale','expired','revoked']){const f=fixture(),p=await f.open(),id=control(p,'Nearby detail').custom_id;
 if(mode==='stale')f.stale();if(mode==='expired')f.expire();if(mode==='revoked')f.revoke();
 const result=await f.press(id,mode==='copied'?'intruder':'owner');assert.equal(result.files,undefined);assert.equal(f.commands.length,0);}
});
test('public GM overview regional and absent-visible-owner maps never offer invented detail',async()=>{
 for(const extra of [{audience:'public'},{audience:'gm',actorId:undefined},{mapLevel:'regional'},{mapLevel:'dungeon'}]){const f=fixture(),p=await f.open(extra);assert.equal(control(p,'Nearby detail'),undefined);}
 for(const mode of ['missing','hidden','mismatch']){const f=fixture();if(mode==='missing')f.map.tokens=[];if(mode==='hidden')f.map.cells.find(c=>c.x===12&&c.y===12).visibility='unknown';if(mode==='mismatch')f.map.viewerCharacterId='another';const p=await f.open({mapDetail:'nearby'});assert.equal(control(p,'Nearby detail'),undefined);}
});
test('detail preference is retained through ordinary navigation and rejects invalid values',async()=>{
 const f=fixture(),p=await f.open({mapDetail:'nearby'});const menu=controls(p).find(c=>c.placeholder==='Open your character menu');
 const mapChoice=menu.options.find(c=>c.label==='Map');assert.equal(f.store.get(mapChoice.value).mapDetail,'nearby');
 await assert.rejects(f.open({mapDetail:'arbitrary'}),/Invalid map detail/);
 const bad=f.store.issue({campaignId:'fixture',userId:'owner',actorId:'hero',audience:'player',revision:4,mapDetail:'arbitrary'});assert.match((await f.press(bad)).content,/not available/);assert.equal(f.commands.length,0);
});
