import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {composeProductionProfile,productionReadiness} from './production-profile.mjs';
import {archiveCampaign,hashProductionFile} from './production-files.mjs';

const descriptor=()=>({kind:'ops-dnd-production',version:1,campaignId:'production-fixture',guildId:'123456789012345678',channelId:'223456789012345678',gmUserId:'323456789012345678',applicationId:'423456789012345678',voiceChannelId:'523456789012345678',journalChannelId:'623456789012345678',admissionLimit:100,recovery:'resume-verified',voice:'shared-discord',companions:false,storageVersion:2,obusUrl:'http://127.0.0.1:38178',publicOrigin:'https://game.example',engineUrl:'http://127.0.0.1:18810',rpcPort:18812,...Object.fromEntries(['storeFile','engineSecretFile','draftFile','rpcSecretFile','spacesFile','admissionFile','directorFile','chronicleFile','serviceTokenFile','hostTokenFile','activityDataDir','runtimeRoot','artRoot','generatedArtDir','chronicleDataDir'].map(key=>[key,join(tmpdir(),'production-fixture',key)]))});
test('production opts into required services while preserving infrastructure and disabling human-seat companions',()=>{
 const d=descriptor(),result=composeProductionProfile({descriptor:d,infrastructureEnv:{DATABASE_URL:'private-db',DISCORD_TOKEN:'private-bot',HOLLOW_LANTERN_CAMPAIGN_ID:'old',RAPHAEL_OBUS_GAME_TOKEN:'old-secret',UNWRITTEN_COAST_ENABLED:'true'}});
 for(const name of ['HOLLOW_LANTERN_ADMISSION_ENABLED','HOLLOW_LANTERN_AI_ENABLED','RAPHAEL_CHRONICLE_ENABLED','HOLLOW_LANTERN_COMMIT_EVENTS_ENABLED'])assert.equal(result.env[name],'true');
 assert.equal(result.env.HOLLOW_LANTERN_AUTOPLAY_ENABLED,'false');assert.equal(result.env.HOLLOW_LANTERN_AI_COMPANIONS_ENABLED,'false');
 assert.equal(result.env.RAPHAEL_CHRONICLE_AUTHORITY,'unity');assert.equal(result.env.RAPHAEL_CAMPAIGN_ID,d.campaignId);assert.equal(result.env.RAPHAEL_DM_IDS,d.gmUserId);
 assert.equal(result.env.DATABASE_URL,'private-db');assert.equal(result.env.DISCORD_TOKEN,'private-bot');assert.equal(result.env.RAPHAEL_OBUS_GAME_TOKEN,undefined);
 for(const secret of ['private-db','private-bot','old-secret'])assert.equal(JSON.stringify(result.summary).includes(secret),false);assert.deepEqual(result.env,result.activityEnv);
});
test('production rejects alternate provider routes, reduced capacity, aliased secrets, and exposed private stores',()=>{
 for(const mutate of [d=>d.obusUrl='http://127.0.0.1:38174',d=>d.admissionLimit=3,d=>d.companions=true,d=>d.storageVersion=1,d=>d.directorFile=d.storeFile,d=>d.storeFile=join(d.artRoot,'save.json'),d=>d.voice='private-browser',d=>d.publicOrigin='http://game.example',d=>d.runtimeRoot='C:/Users/Hermes/OneDrive/runtime']){
  const d=descriptor();mutate(d);assert.throws(()=>composeProductionProfile({descriptor:d}));
 }
});
test('overall readiness requires every production component, not only the gateway',()=>{
 assert.equal(productionReadiness({gateway:'ready'}).status,'blocked');
 const checks=Object.fromEntries(['storage','engine','authentication','admission','ai','voice','publication','recovery'].map(k=>[k,'ready']));
 assert.equal(productionReadiness(checks).status,'ready');checks.ai='blocked-by-policy';assert.equal(productionReadiness(checks).status,'blocked');
});
test('campaign archive preserves full v1 and v2 data with verified hashes and never overwrites',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'production-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'campaign.json');
 for(const suffix of ['','.bak','.wal','.wal.meta'])await writeFile(source+suffix,'fixture'+suffix);
 await mkdir(source+'.v2/objects',{recursive:true});await writeFile(join(source+'.v2','objects','object.json'),'history');
 const destination=join(dir,'archive'),manifest=await archiveCampaign({file:source,destination});
 assert.equal(manifest.files.length,5);
 for(const entry of manifest.files)assert.equal((await hashProductionFile(join(destination,entry.name))).sha256,entry.sha256);
 assert.equal(JSON.parse(await readFile(join(destination,'manifest.json'),'utf8')).source,source);
 await assert.rejects(archiveCampaign({file:source,destination}),/EEXIST/);
});
test('an incomplete journal cannot produce a valid archive',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'production-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'campaign.json');await writeFile(file,'fixture');await writeFile(file+'.wal','tail');
 await assert.rejects(archiveCampaign({file,destination:join(dir,'archive')}),/PRODUCTION_JOURNAL_INCOMPLETE/);
});
