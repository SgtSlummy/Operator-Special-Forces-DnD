import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDiscordTable} from '../table-discord.mjs';
import {CATALOG} from '../catalog.mjs';
import {previewState} from '../table-server.mjs';
import {tableProject} from '../table-model.mjs';
import {renderArchitecturePng} from './png.mjs';
const ids={guildId:'111111111111111111',channelId:'222222222222222222',applicationId:'333333333333333333',gmUserId:'444444444444444444'},owner='555555555555555555';
function nodes(body){const out=[];function visit(value){if(!value||typeof value!=='object'||Buffer.isBuffer(value))return;if(value.type)out.push(value);for(const v of Object.values(value))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(body);return out;}
function fixture(renderer){
 const state=previewState();state.currentRoomId='R01';state.poiIds={};state.party[0]={...state.party[0],roomId:'R01',x:.42,y:.58};
 for(const room of CATALOG.rooms)state.roomIds[room.id]={learned:true};
 let view=tableProject(CATALOG,state,{role:'shared'}),active=true;
 const client={user:{id:ids.applicationId},guilds:{fetch:async()=>({members:{fetch:async({user})=>{if(!active)throw Error('Revoked');return {id:user,user:{bot:false}};}}})}};
 const store={view:()=>structuredClone(view),subscribe:()=>()=>{}};
 const controller=createDiscordTable({client,store,config:{...ids,members:[{ownerId:owner,actorId:'mara'}]},render:{scene:async()=>Buffer.from('scene'),tactical:async()=>Buffer.from('tactical'),combat:async()=>Buffer.from('combat'),architecture:renderer??(async()=>Buffer.from('architecture'))}});
 async function click(customId,{values,userId=owner}={}){let result,deferred=false;await controller.handleInteraction({customId,values,user:{id:userId},applicationId:ids.applicationId,guildId:ids.guildId,channelId:ids.channelId,id:'666666666666666666',message:{author:{id:ids.applicationId}},isModalSubmit:()=>false,deferReply:async()=>{deferred=true;},editReply:async body=>{result=body;},reply:async body=>{result=body;}});return {body:result,deferred};}
 return {controller,click,get view(){return view;},set view(value){view=value;},revoke:()=>{active=false;}};
}
test('every discovered location remains accessible across Discord atlas pages',async()=>{
 const f=fixture();try{let {body}=await f.click('coast:atlas');const found=[];
 for(let page=0;page<100;page++){
  const select=nodes(body).find(n=>n.type===3);assert.ok(select.options.length<=20);found.push(...select.options.map(o=>o.value));
  const next=nodes(body).find(n=>n.label==='More places');if(!next)break;
  ({body}=await f.click(next.custom_id));
 }
 assert.deepEqual(found,f.view.catalog.rooms.map(r=>r.id));assert.equal(new Set(found).size,found.length);
 }finally{await f.controller.close();}
});
test('architectural controls deliver chosen PNG and remain bound to their recipient',async()=>{
 const calls=[],f=fixture(async(view,id,layer)=>{calls.push({view,id,layer});return Buffer.from('layer-png');});
 try{
  const scene=(await f.click('coast:scene')).body,control=nodes(scene).find(n=>n.label==='Floor slice');assert.ok(control);
  const wrong=(await f.click(control.custom_id,{userId:ids.gmUserId})).body;assert.ok(wrong.content);assert.equal(calls.length,0);
  const reply=await f.click(control.custom_id);assert.equal(reply.deferred,true);assert.equal(reply.body.files[0].name,'architecture.png');assert.equal(calls[0].id,'R01');assert.equal(calls[0].layer,'r01-floor-slice');assert.equal(calls[0].view.identity.role,'shared');
  assert.ok(nodes(reply.body).some(n=>n.label==='Low cutaway'));
 }finally{await f.controller.close();}
});
test('revoked discovery and changed revisions prevent architectural delivery',async()=>{
 let f;f=fixture(async()=>{f.view={...f.view,state:{...f.view.state,revision:f.view.state.revision+1}};return Buffer.from('obsolete');});
 try{const scene=(await f.click('coast:scene')).body,control=nodes(scene).find(n=>n.label==='Full room');
  assert.ok((await f.click(control.custom_id)).body.content);
  f.view={...f.view,catalog:{...f.view.catalog,rooms:f.view.catalog.rooms.filter(r=>r.id!=='R01')}};
  assert.ok((await f.click(control.custom_id)).body.content);
 }finally{await f.controller.close();}
});
test('combat hides architectural controls and invalidates earlier map controls',async()=>{
 let draws=0;const f=fixture(async()=>{draws++;return Buffer.from('map');});
 try{const scene=(await f.click('coast:scene')).body,control=nodes(scene).find(n=>n.label==='Full room');
  f.view={...f.view,encounter:{roomId:'R01',round:1,enemies:[],surprise:''}};
  assert.ok((await f.click(control.custom_id)).body.content);assert.equal(draws,0);
  assert.ok(!nodes((await f.click('coast:scene')).body).some(n=>n.label==='Full room'));
 }finally{await f.controller.close();}
});
test('membership revocation after drawing prevents image delivery',async()=>{
 let f;f=fixture(async()=>{f.revoke();return Buffer.from('private');});
 try{const scene=(await f.click('coast:scene')).body;assert.ok((await f.click(nodes(scene).find(n=>n.label==='Full room').custom_id)).body.content);}finally{await f.controller.close();}
});
test('real architectural renderer produces a decoded Discord PNG',async()=>{
 const f=fixture();try{await assert.rejects(renderArchitecturePng(f.view,'R01','unknown-layer'));const png=await renderArchitecturePng(f.view,'R01','r01-cutaway');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1600);assert.equal(png.readUInt32BE(20),1200);assert.ok(png.length>100000&&png.length<10*1024*1024);const output=new URL('../qa/architecture/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('discord-cutaway.png',output),png);}finally{await f.controller.close();}
});
