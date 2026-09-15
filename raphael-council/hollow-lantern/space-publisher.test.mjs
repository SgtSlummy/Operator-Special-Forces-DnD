import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSpacePublisher} from './space-publisher.mjs';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'hollow-spaces-')),manifestFile=join(dir,'spaces.json'),config={campaignId:'fixture',guildId:'guild',channelId:'parent',applicationId:'bot',gmUserId:'dm'};
 const keys=['dm','fighter','rogue','cleric','shop'];const manifest={campaign:'fixture',guildId:'guild',parentId:'parent',botId:'bot',dmUserId:'dm',spaces:Object.fromEntries(keys.map(k=>[k,{id:k,type:12,parentId:'parent'}]))};await writeFile(manifestFile,JSON.stringify(manifest));
 let intruder=false,failSend=false;const delivered=[],views=[],messages=new Map();
 const host={authorize:async s=>s.userId==='dm',engine:{project:async()=>({revision:5})},openPanel:async scope=>{views.push(scope);return {flags:32832,components:[{type:10,content:scope.actorId??'DM'}],files:[{name:'map.png',attachment:Buffer.from('flattened fixture')}]}},onCommitted:()=>()=>{},adapter:{panel:async()=>({})}};
 const discordClient={rest:{get:async path=>path.includes('thread-members')?[{user_id:'bot'},{user_id:'dm'},...(intruder?[{user_id:'other'}]:[])]:{id:path.split('/')[2],type:12,guild_id:'guild',parent_id:'parent',owner_id:'bot',thread_metadata:{invitable:false,archived:false}}},channels:{fetch:async id=>({isTextBased:()=>true,messages:{fetch:async messageId=>messages.get(messageId)},send:async payload=>{if(failSend)throw new Error('Network uncertain');const message={id:`message-${id}`,author:{id:'bot'},edit:async p=>{delivered.push({id,payload:p,edit:true});}};messages.set(message.id,message);delivered.push({id,payload});return message;}})}};
 return {manifestFile,config,host,discordClient,views,delivered,setIntruder:v=>intruder=v,setFailSend:v=>failSend=v,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test('private panels are scoped per actor, verified before delivery, and edit saved message IDs after restart',async()=>{
 const f=await fixture();let publisher;
 try{publisher=await createSpacePublisher(f);await publisher.publish({revision:5});assert.equal(f.delivered.length,5);assert.deepEqual(f.views.map(v=>v.actorId??'dm'),['dm','lantern-fighter','lantern-rogue','lantern-cleric']);assert(f.delivered.every(d=>d.payload.flags===32768));
  await publisher.close();publisher=await createSpacePublisher(f);await publisher.publish({revision:5});assert.equal(f.delivered.filter(d=>d.edit).length,5);
  f.setIntruder(true);await assert.rejects(publisher.publish(),/membership changed/);assert.equal(f.delivered.length,10);
 }finally{await publisher?.close();await f.cleanup();}
});
test('ambiguous first delivery records uncertainty and is not repeated on the next request',async()=>{
 const f=await fixture();let publisher;
 try{f.setFailSend(true);publisher=await createSpacePublisher(f);await assert.rejects(publisher.publish(),/Network uncertain/);assert.equal(JSON.parse(await readFile(f.manifestFile,'utf8')).spaces.dm.deliveryUncertain,true);
  f.setFailSend(false);await assert.rejects(publisher.publish(),/needs recovery/);assert.equal(f.delivered.length,0);
 }finally{await publisher?.close();await f.cleanup();}
});
