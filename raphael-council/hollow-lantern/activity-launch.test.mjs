import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rmdir,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {activityEnvironment,prepareActivityRelease,selectedActivityCampaign} from './activity-launch.mjs';
import {createActivityDraftStore} from './activity-runtime.mjs';
import {startProdServer} from '../node_modules/vinext/dist/server/prod-server.js';

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'activity-release-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'dist/server'),{recursive:true});await mkdir(join(dir,'dist/client/_next/static'),{recursive:true});return dir;}
async function build(dir,name){await writeFile(join(dir,'dist/server/index.js'),`export default ()=>new Response('${name}');`);await writeFile(join(dir,`dist/client/_next/static/${name}.js`),`console.log('${name}')`);await writeFile(join(dir,'dist/server/vinext-server.json'),JSON.stringify({prerenderSecret:'fixture-build-secret'}));}
async function serve(t,release){const running=await startProdServer({outDir:release.outDir,host:'127.0.0.1',port:0,silent:true});t.after(()=>new Promise(resolve=>{running.server.closeAllConnections();running.server.close(resolve);}));return `http://127.0.0.1:${running.port}`;}

function environmentFixture(){
 const directory=join(tmpdir(),'activity-binding'),baseFile=join(directory,'base.env'),nativeFile=join(directory,'native.env'),campaignFile=join(directory,'campaign.env');
 const base={DISCORD_TOKEN:'fixture-token',DISCORD_CLIENT_ID:'1540006061099188274',DISCORD_CLIENT_SECRET:'fixture-secret'};
 const native={HOLLOW_LANTERN_CAMPAIGN_ID:'operation-hollow-lantern',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18791',HOLLOW_LANTERN_SECRET_FILE:join(directory,'original.secret'),HOLLOW_LANTERN_STORE_FILE:join(directory,'original.json'),HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(directory,'original-auth'),HOLLOW_LANTERN_ART_ROOT:join(directory,'art'),HOLLOW_LANTERN_CHANNEL_ID:'1546676505780944979',HOLLOW_LANTERN_GUILD_ID:'1463393482306486387',HOLLOW_LANTERN_GM_ID:'1230264975533281312'};
 const campaign={HOLLOW_LANTERN_CAMPAIGN_ID:'hollow-lantern-rehearsal',HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18810',HOLLOW_LANTERN_SECRET_FILE:join(directory,'rehearsal.secret'),HOLLOW_LANTERN_STORE_FILE:join(directory,'rehearsal.json'),HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(directory,'rehearsal-auth')};
 return {base,native,campaign,options:{baseFile,nativeFile,campaignFile,inherited:{UNRELATED_ENV:'preserved'},read:path=>path===baseFile?base:path===nativeFile?native:campaign}};
}

test('selected campaign RPC pair survives without reading its secret file',()=>{
 const f=environmentFixture();f.campaign.HOLLOW_LANTERN_DRAFT_RPC_URL='http://127.0.0.1:18792';f.campaign.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE=join(tmpdir(),'selected-draft.secret');let reads=0;const read=f.options.read;
 const env=activityEnvironment({...f.options,read:path=>{reads++;return read(path);}});assert.equal(reads,3);assert.equal(env.HOLLOW_LANTERN_DRAFT_RPC_URL,f.campaign.HOLLOW_LANTERN_DRAFT_RPC_URL);assert.equal(env.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE,f.campaign.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE);
});
test('selected campaign without RPC pair disables inherited base and native pair',()=>{
 const f=environmentFixture();for(const source of [f.base,f.native,f.options.inherited]){source.HOLLOW_LANTERN_DRAFT_RPC_URL='http://127.0.0.1:18000';source.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE=join(tmpdir(),'foreign.secret');}
 const env=activityEnvironment(f.options);assert.equal(createActivityDraftStore(env),undefined);assert.equal(Object.hasOwn(env,'HOLLOW_LANTERN_DRAFT_RPC_URL'),false);assert.equal(Object.hasOwn(env,'HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE'),false);
 const ordinary=activityEnvironment({...f.options,campaignFile:undefined});assert.equal(ordinary.HOLLOW_LANTERN_DRAFT_RPC_URL,f.native.HOLLOW_LANTERN_DRAFT_RPC_URL);assert.equal(ordinary.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE,f.native.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE);
});
test('partial selected RPC pair cannot borrow an inherited counterpart',()=>{
 for(const key of ['HOLLOW_LANTERN_DRAFT_RPC_URL','HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE']){const f=environmentFixture();f.native.HOLLOW_LANTERN_DRAFT_RPC_URL='http://127.0.0.1:18792';f.native.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE=join(tmpdir(),'foreign.secret');f.campaign[key]=f.native[key];assert.throws(()=>activityEnvironment(f.options),/complete.*draft/i);}
});
test('RPC launch binding rejects unsafe endpoint and secret path',()=>{
 const f=environmentFixture();f.campaign.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE=join(tmpdir(),'draft.secret');
 for(const endpoint of ['http://[::1]:18792','http://localhost:18792','http://127.1:18792','http://127.0.0.1:99999','http://127.0.0.1/path','http://user@127.0.0.1','http://127.0.0.1?x=1','https://example.com']){f.campaign.HOLLOW_LANTERN_DRAFT_RPC_URL=endpoint;assert.throws(()=>activityEnvironment(f.options),/draft/i);}
 f.campaign.HOLLOW_LANTERN_DRAFT_RPC_URL='http://127.0.0.1:18792';for(const path of ['relative.secret','//server/share/secret',join(tmpdir(),'OneDrive/secret'),tmpdir()+'/../secret']){f.campaign.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE=path;assert.throws(()=>activityEnvironment(f.options),/local|draft/i);}
});

test('saved selection is optional, stable across reads, and explicit selection wins',async t=>{
 const dir=await fixture(t),pointer=join(dir,'.runtime/hollow-lantern/activity-selection.json'),campaignFile=join(dir,'campaign.env');
 assert.equal(await selectedActivityCampaign({projectRoot:dir}),undefined);
 await mkdir(join(dir,'.runtime/hollow-lantern'),{recursive:true});await writeFile(campaignFile,'FIXTURE=1');
 await writeFile(pointer,JSON.stringify({version:1,campaignFile}));
 for(let i=0;i<2;i++)assert.equal(await selectedActivityCampaign({projectRoot:dir}),campaignFile);
 await writeFile(pointer,'bad json');
 assert.equal(await selectedActivityCampaign({projectRoot:dir,explicitFile:campaignFile}),campaignFile);
 await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);
 await assert.rejects(selectedActivityCampaign({projectRoot:dir,explicitFile:''}),/canonical local/);
});

test('malformed, missing, network and noncanonical saved targets never fall back',async t=>{
 const dir=await fixture(t),pointer=join(dir,'.runtime/hollow-lantern/activity-selection.json');
 await mkdir(join(dir,'.runtime/hollow-lantern'),{recursive:true});
 const bad=[null,[],{version:2,campaignFile:join(dir,'a.env')},{version:1,campaignFile:join(dir,'a.env'),secret:'must not be accepted'},
 ...['relative.env','https://example.com/a.env','\\\\server\\share\\a.env',join(dir,'OneDrive/a.env'),dir+'/../a.env',join(dir,'missing.env'),dir].map(campaignFile=>({version:1,campaignFile}))];
 for(const value of bad){await writeFile(pointer,JSON.stringify(value));await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);}
 await writeFile(pointer,' '.repeat(4097));await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);
});

test('selection rejects linked metadata, target files and parent directories',async t=>{
 const dir=await fixture(t),parent=join(dir,'.runtime/hollow-lantern'),pointer=join(parent,'activity-selection.json'),target=join(dir,'campaign.env');
 await mkdir(parent,{recursive:true});await writeFile(target,'FIXTURE=1');
 await link(target,pointer);await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);await rm(pointer);
 const alias=join(dir,'alias.env');await link(target,alias);await writeFile(pointer,JSON.stringify({version:1,campaignFile:alias}));
 await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);await rm(alias);
 const linked=join(dir,'linked');await symlink(parent,linked,process.platform==='win32'?'junction':'dir');
 await writeFile(pointer,JSON.stringify({version:1,campaignFile:join(linked,'campaign.env')}));
 await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);
 await rm(pointer);await rmdir(parent);await symlink(linked,parent,process.platform==='win32'?'junction':'dir');
 await assert.rejects(selectedActivityCampaign({projectRoot:dir}),/Saved Activity campaign selection/);
});
test('explicit rehearsal binding switches the complete authority and auth store together',()=>{
 const f=environmentFixture(),env=activityEnvironment(f.options);
 assert.equal(env.RAPHAEL_CAMPAIGN_ID,'hollow-lantern-rehearsal');assert.equal(env.HOLLOW_LANTERN_CAMPAIGN_ID,env.RAPHAEL_CAMPAIGN_ID);
 assert.equal(env.HOLLOW_LANTERN_ENGINE_URL,'http://127.0.0.1:18810');assert.equal(env.HOLLOW_LANTERN_STORE_FILE,f.campaign.HOLLOW_LANTERN_STORE_FILE);assert.equal(env.HOLLOW_LANTERN_ACTIVITY_DATA_DIR,f.campaign.HOLLOW_LANTERN_ACTIVITY_DATA_DIR);
 assert.equal(env.DISCORD_CLIENT_SECRET,'fixture-secret');assert.equal(env.RAPHAEL_DM_IDS,f.native.HOLLOW_LANTERN_GM_ID);assert.equal(env.UNRELATED_ENV,'preserved');
 assert.equal(activityEnvironment({...f.options,campaignFile:undefined}).RAPHAEL_CAMPAIGN_ID,'operation-hollow-lantern');assert.equal(f.native.HOLLOW_LANTERN_ENGINE_URL,'http://127.0.0.1:18791');
});
test('partial campaign bindings and credential changes cannot launch an Activity',()=>{
 const f=environmentFixture();delete f.campaign.HOLLOW_LANTERN_ACTIVITY_DATA_DIR;assert.throws(()=>activityEnvironment(f.options),/complete campaign/);
 const g=environmentFixture();g.campaign.DISCORD_CLIENT_SECRET='untrusted';assert.throws(()=>activityEnvironment(g.options),/credentials/);
 const h=environmentFixture();h.campaign.HOLLOW_LANTERN_ENGINE_URL='https://example.com';assert.throws(()=>activityEnvironment(h.options),/loopback/);
});

test('launcher accepts exactly the engine client loopback endpoint shape',()=>{
 for(const endpoint of ['http://localhost:18791','http://127.0.0.1:18791/api','http://127.0.0.1:18791/?token=x','http://127.0.0.1:18791/#fragment','http://user:pass@127.0.0.1:18791']){
  const f=environmentFixture();f.campaign.HOLLOW_LANTERN_ENGINE_URL=endpoint;assert.throws(()=>activityEnvironment(f.options),/loopback/);
 }
 const f=environmentFixture();f.campaign.HOLLOW_LANTERN_ENGINE_URL='http://[::1]:18791';assert.equal(activityEnvironment(f.options).HOLLOW_LANTERN_ENGINE_URL,'http://[::1]:18791');
});

test('actual Vinext servers retain distinct assets when source build is replaced',async t=>{
 const dir=await fixture(t);await build(dir,'first');const a=await prepareActivityRelease({projectRoot:dir}),urlA=await serve(t,a);
 assert.equal(await (await fetch(urlA+'/')).text(),'first');
 await rm(join(dir,'dist/client/_next/static/first.js'));await build(dir,'second');const b=await prepareActivityRelease({projectRoot:dir}),urlB=await serve(t,b);
 assert.notEqual(a.id,b.id);assert.equal(await (await fetch(urlA+'/_next/static/first.js')).text(),"console.log('first')");assert.equal(await (await fetch(urlB+'/_next/static/second.js')).text(),"console.log('second')");assert.equal(await (await fetch(urlA+'/')).text(),'first');assert.equal(await (await fetch(urlB+'/')).text(),'second');
 assert.equal((await prepareActivityRelease({projectRoot:dir})).id,b.id);
 await assert.rejects(readFile(join(a.outDir,'server/vinext-server.json')),error=>error.code==='ENOENT');
 assert.deepEqual(JSON.parse(await readFile(join(a.directory,'package.json'),'utf8')),{private:true,type:'module'});
});
test('tampered existing assets fail closed without replacement',async t=>{const dir=await fixture(t);await build(dir,'one');const a=await prepareActivityRelease({projectRoot:dir});await writeFile(join(a.outDir,'client/_next/static/one.js'),'tampered');await assert.rejects(prepareActivityRelease({projectRoot:dir}),/integrity/);assert.equal(await readFile(join(a.outDir,'client/_next/static/one.js'),'utf8'),'tampered');});
test('protected files and unresolved relative imports cannot be promoted',async t=>{const dir=await fixture(t);await build(dir,'one');await writeFile(join(dir,'dist/client/.env'),'fixture');await assert.rejects(prepareActivityRelease({projectRoot:dir}),/Protected configuration/);await rm(join(dir,'dist/client/.env'));await writeFile(join(dir,'dist/server/index.js'),"import './missing.js'; export default ()=>new Response('x');\nimport('./missing.js');");await assert.rejects(prepareActivityRelease({projectRoot:dir}),/missing or external/);});
test('directory links are rejected',async t=>{const dir=await fixture(t);await build(dir,'one');await mkdir(join(dir,'outside'));try{await symlink(join(dir,'outside'),join(dir,'dist/client/link'),'junction');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('OS does not permit fixture junctions');return;}throw error;}await assert.rejects(prepareActivityRelease({projectRoot:dir}),/links/);});
test('unexpected build secret in an existing release is rejected',async t=>{const dir=await fixture(t);await build(dir,'one');const a=await prepareActivityRelease({projectRoot:dir});await writeFile(join(a.outDir,'server/vinext-server.json'),'{}');await assert.rejects(prepareActivityRelease({projectRoot:dir}),/Build-only secrets/);});
test('incomplete existing release is not overwritten',async t=>{const dir=await fixture(t);await build(dir,'one');const a=await prepareActivityRelease({projectRoot:dir});await rm(join(a.directory,'release.json'));await assert.rejects(prepareActivityRelease({projectRoot:dir}),error=>error.code==='ENOENT');assert.equal(await readFile(join(a.outDir,'client/_next/static/one.js'),'utf8'),"console.log('one')");});

test('campaign selection retains approved material binding without changing credentials',()=>{
 const f=environmentFixture();f.campaign.HOLLOW_LANTERN_MATERIALS_FILE=join(tmpdir(),'reviewed-materials.json');
 const env=activityEnvironment(f.options);assert.equal(env.HOLLOW_LANTERN_MATERIALS_FILE,f.campaign.HOLLOW_LANTERN_MATERIALS_FILE);assert.equal(env.DISCORD_CLIENT_SECRET,f.base.DISCORD_CLIENT_SECRET);
 for(const path of ['relative.json','https://example.com/materials.json',join(tmpdir(),'OneDrive/materials.json'),'//server/share/materials.json']){f.campaign.HOLLOW_LANTERN_MATERIALS_FILE=path;assert.throws(()=>activityEnvironment(f.options),/local/);}
});
