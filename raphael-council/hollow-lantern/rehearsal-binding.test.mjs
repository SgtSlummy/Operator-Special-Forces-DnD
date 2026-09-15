import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRehearsalBinding} from './rehearsal-binding.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'rehearsal-binding-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:30}));
 for(const name of ['runtime','art','activity'])await mkdir(join(dir,name));
 for(const [name,text]of [['engine.secret','a'.repeat(64)],['rpc.secret','b'.repeat(64)],['campaign.json','{}'],['drafts.json','{}']])await writeFile(join(dir,name),text);
 const activityEnv={HOLLOW_LANTERN_CAMPAIGN_ID:'selected-rehearsal',RAPHAEL_CAMPAIGN_ID:'selected-rehearsal',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18810',HOLLOW_LANTERN_GUILD_ID:'111111111111111111',HOLLOW_LANTERN_CHANNEL_ID:'222222222222222222',HOLLOW_LANTERN_GM_ID:'444444444444444444',DISCORD_APPLICATION_ID:'333333333333333333',DISCORD_CLIENT_ID:'333333333333333333',DISCORD_TOKEN:'private-discord-token',HOLLOW_LANTERN_SECRET_FILE:join(dir,'engine.secret'),HOLLOW_LANTERN_STORE_FILE:join(dir,'campaign.json'),HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(dir,'activity'),HOLLOW_LANTERN_RUNTIME_ROOT:join(dir,'runtime'),HOLLOW_LANTERN_ART_ROOT:join(dir,'art')};
 const descriptor={version:1,kind:'hollow-lantern-rehearsal-binding',campaignId:activityEnv.HOLLOW_LANTERN_CAMPAIGN_ID,engineUrl:activityEnv.HOLLOW_LANTERN_ENGINE_URL,guildId:activityEnv.HOLLOW_LANTERN_GUILD_ID,channelId:activityEnv.HOLLOW_LANTERN_CHANNEL_ID,gmUserId:activityEnv.HOLLOW_LANTERN_GM_ID,applicationId:activityEnv.DISCORD_APPLICATION_ID,draftFile:join(dir,'drafts.json'),rpcSecretFile:join(dir,'rpc.secret'),webPort:18812,activityDataDir:activityEnv.HOLLOW_LANTERN_ACTIVITY_DATA_DIR,campaignStore:activityEnv.HOLLOW_LANTERN_STORE_FILE};
 const file=join(dir,'binding.json');await writeFile(file,JSON.stringify(descriptor));return {dir,file,activityEnv,descriptor};
}
test('physical binding composes matching isolated native and Activity environments',async t=>{
 const f=await fixture(t),result=await readRehearsalBinding(f);assert.equal(result.env.HOLLOW_LANTERN_DRAFT_FILE,f.descriptor.draftFile);assert.equal(result.activityEnv.HOLLOW_LANTERN_DRAFT_RPC_URL,'http://127.0.0.1:18812');assert.equal(Object.hasOwn(result.env,'HOLLOW_LANTERN_SPACES_FILE'),false);assert.equal(JSON.stringify(result.summary).includes('b'.repeat(64)),false);
});
test('any saved identity or selected store change refuses without fallback',async t=>{
 const f=await fixture(t);
 for(const key of ['campaignId','engineUrl','guildId','channelId','gmUserId','applicationId','campaignStore','activityDataDir']){await writeFile(f.file,JSON.stringify({...f.descriptor,[key]:'changed'}));await assert.rejects(()=>readRehearsalBinding(f),/REHEARSAL_BINDING_INVALID/);}
});
test('unknown descriptor fields oversized input and non-dedicated key reject',async t=>{
 const f=await fixture(t);
 for(const text of [JSON.stringify({...f.descriptor,extra:true}),JSON.stringify({...f.descriptor,version:2}),'null','x'.repeat(16385)]){await writeFile(f.file,text);await assert.rejects(()=>readRehearsalBinding(f),/REHEARSAL_BINDING_INVALID/);}
 await writeFile(f.file,JSON.stringify(f.descriptor));await writeFile(f.descriptor.rpcSecretFile,'a'.repeat(64));await assert.rejects(()=>readRehearsalBinding(f),/REHEARSAL_BINDING_INVALID/);
 await writeFile(f.descriptor.rpcSecretFile,'short');await assert.rejects(()=>readRehearsalBinding(f),/REHEARSAL_BINDING_INVALID/);
});
test('hardlinked key and linked ancestor are refused',async t=>{
 const f=await fixture(t);await rm(f.descriptor.rpcSecretFile);await link(f.activityEnv.HOLLOW_LANTERN_SECRET_FILE,f.descriptor.rpcSecretFile);await assert.rejects(()=>readRehearsalBinding(f),/REHEARSAL_BINDING_INVALID/);await rm(f.descriptor.rpcSecretFile);await writeFile(f.descriptor.rpcSecretFile,'b'.repeat(64));
 const alias=join(f.dir,'alias');await symlink(f.dir,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>readRehearsalBinding({...f,file:join(alias,'binding.json')}),/REHEARSAL_BINDING_INVALID/);
});
