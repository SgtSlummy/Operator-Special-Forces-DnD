import test from 'node:test';
import assert from 'node:assert/strict';
import {enterCoast} from './coast-connect.mjs';
import {discordSdkBundle} from './table-sdk.mjs';
import {createCoastWeb} from './table-web.mjs';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const app='1540006061099188274',owner='1230264975533281312',campaign='the-unwritten-coast';
function connection(){
 const calls=[],scope={campaign,owner,role:'host'};
 const fetchImpl=async path=>{calls.push(path);return Response.json(path==='/api/auth/config'?{clientId:app,experience:'legacy',campaignId:campaign}:path==='/api/auth/activity'?{experience:'legacy',scope,access_token:'private-access'}:{experience:'legacy',scope});};
 const createSDK=async id=>{assert.equal(id,app);return {ready:async()=>calls.push('ready'),commands:{authorize:async args=>{assert.deepEqual(args.scope,['identify']);calls.push('authorize');return {code:'private-code'};},authenticate:async args=>{assert.equal(args.access_token,'private-access');calls.push('authenticate');}}};};
 return {calls,fetchImpl,createSDK};
}
test('Activity authorization verifies session before entering the shared table without returning tokens',async()=>{
 const f=connection();const result=await enterCoast({...f,signal:new AbortController().signal,navigate:()=>f.calls.push('navigate')});
 assert.deepEqual(f.calls,['/api/auth/config','ready','authorize','/api/auth/activity','authenticate','/api/auth/session','navigate']);
 assert.deepEqual(result,{owner,role:'host'});assert.doesNotMatch(JSON.stringify(result),/private-access|private-code/);
});
test('closing during consent prevents exchange and navigation',async()=>{
 const f=connection(),controller=new AbortController();let release,entered;const waiting=new Promise(r=>entered=r);
 f.createSDK=async()=>({ready:async()=>{},commands:{authorize:()=>{entered();return new Promise(r=>release=r);}}});
 let navigated=false;const flight=enterCoast({...f,signal:controller.signal,navigate:()=>navigated=true});
 await waiting;controller.abort();release({code:'late'});await assert.rejects(flight);assert.equal(navigated,false);assert.deepEqual(f.calls,['/api/auth/config']);
});
test('Activity host serves official local SDK and exact entry assets',async()=>{
 const config={guildId:'1463393482306486387',applicationId:app,gmUserId:owner,members:[]};
 const auth={config:{campaign,guild:config.guildId,clientId:app,publicOrigin:'https://coast.example',activityOrigin:`https://${app}.discordsays.com`},authenticate:async()=>null};
 const web=createCoastWeb({config,auth,store:{view(){},execute(){}},client:{guilds:{fetch(){}},user:{id:app}}});
 try{
  const response=await web.handle(new Request(auth.config.activityOrigin+'/?frame_id=123'));assert.equal(response.headers.get('location'),'/activity?frame_id=123');
  for(const path of ['/activity','/coast-connect.mjs','/raphael-council/client/activity-connection.mjs','/discord-sdk.mjs']){const r=await web.handle(new Request(auth.config.activityOrigin+path));assert.equal(r.status,200,path);assert.ok((await r.text()).length>100);}
  assert.equal((await web.handle(new Request(auth.config.activityOrigin+'/raphael-council/auth/discord.mjs'))).status,404);
  const bundle=await discordSdkBundle();assert.match(bundle,/DiscordSDK/);assert.doesNotMatch(bundle,/sourceMappingURL/);
  const {chromium}=createRequire(import.meta.url)('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
   const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://coast.example/**',async route=>{const response=await web.handle(new Request(route.request().url()));await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
   await page.goto('https://coast.example/activity');await page.locator('#web-signin').waitFor({state:'visible'});assert.equal(await page.locator('#connect').isHidden(),true);
   assert.equal(await page.evaluate(async()=>typeof(await import('/discord-sdk.mjs')).DiscordSDK),'function');
   await page.evaluate(()=>document.fonts.ready);
   const directory='C:/Users/Hermes/LocalFiles/UnwrittenCoast/activity-entry';await mkdir(directory,{recursive:true});await page.screenshot({path:directory+'/desktop.png'});
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:directory+'/mobile.png'});assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }finally{web.close();}
});
