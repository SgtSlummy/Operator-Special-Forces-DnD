import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createWebTable} from '../web-server.mjs';
import {createInvestigationDraftStore} from '../investigation-drafts.mjs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderTacticalMap} from '../../discord/hollow-lantern/renderers.mjs';
// Browser proof: set PLAYWRIGHT_MODULE to an installed playwright/index.mjs path
// and optionally PLAYWRIGHT_CHANNEL=msedge, then run node --test this file.
// Explicit module configuration errors fail; ordinary discovery skips absent optional tooling.
let chromium, browserSkip=false, browserModule;
if(process.env.PLAYWRIGHT_MODULE)browserModule=pathToFileURL(process.env.PLAYWRIGHT_MODULE).href;
else {
 try{browserModule=import.meta.resolve('playwright');}
 catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;browserSkip='Optional Playwright is unavailable; set PLAYWRIGHT_MODULE to run browser acceptance tests.';}
}
if(browserModule)({chromium}=await import(browserModule));
const browserTest=(name,run)=>test(name,{skip:browserSkip},run);
browserTest('phone browser retains local intention across views, saves without action, handles conflict and restores server draft',async t=>{
 const server=createServer(async(req,res)=>{try{const name=req.url==='/'?'table.html':req.url.slice(1);if(!['table.html','table.js','table.css','draft.css'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL(name,import.meta.url)));}catch{res.writeHead(500).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:360,height:780}});page.setDefaultTimeout(5000);
 async function screenshot(name){if(process.env.DRAFT_SCREENSHOT_DIR){await mkdir(process.env.DRAFT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.DRAFT_SCREENSHOT_DIR,name),fullPage:true});}}
 const mapImage=await renderTacticalMap({id:'fixture-room',level:'tactical',width:5,height:5,scaleFeet:5,viewerCharacterId:'hero',cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:i%5===0||i%5===4||i<5||i>=20?'wall':'floor',visibility:'visible'})),tokens:[],objects:[]},{title:'Known room · test fixture'});
 let revision=4,draft=null,saves=[],commands=0,conflict=false;
 const action={id:'describe',type:'describe',group:'describe',label:'Describe action',payload:{},fields:[{id:'text',label:'Your intention',multiline:true,maxLength:1500}]};
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let data={};
 if(path==='/api/view')data={revision,viewToken:`v${revision}`,campaignId:'campaign',viewer:'player',draftEnabled:true,title:'Quiet room',summary:'A known door.',actor:{id:'hero',name:'Hero',conditions:[],inventory:[]},actions:[action,{...action,id:'talk',type:'talk',group:'talk',label:'Talk to guide'}],journal:['Known carving']};
 else if(path==='/api/draft')data={draft};
 else if(path==='/api/draft/save'){const body=req.postDataJSON();saves.push(body);if(conflict){await route.fulfill({status:409,json:{error:'Draft version conflict'}});return;}draft={draftId:'draft1',version:(draft?.version??0)+1,status:'editing',actionId:body.actionId,actionPayload:{},input:body.input,expectedRevision:Number(body.viewToken.slice(1)),intent:null,receipt:null};data={draft};}
 else if(path==='/api/draft/try'){commands++;draft={...draft,status:'completed',receipt:{result:'Recorded'}};data={draft};}
 else if(path==='/api/map'){await route.fulfill({contentType:'image/png',body:mapImage});return;}
 await route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#draft-fields textarea').fill('Inspect the visible hinges.');assert.doesNotMatch(await page.locator('#cost').textContent(),/No action is available/);await page.waitForFunction(()=>document.querySelector('#map').naturalWidth>0);
 await page.selectOption('#tab','journal');await page.selectOption('#tab','map');assert.equal(await page.locator('#draft-fields textarea').inputValue(),'Inspect the visible hinges.');
 await page.selectOption('#group','talk');assert.match(await page.locator('#draft-heading').textContent(),/Describe/);assert.equal(await page.locator('#draft-fields textarea').inputValue(),'Inspect the visible hinges.');await page.selectOption('#group','describe');
 await page.locator('#draft-fields textarea').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#draft-save').evaluate(el=>el===document.activeElement),true);await screenshot('phone-unsaved-fixture.png');
 await page.click('#draft-save');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('Saved'));assert.equal(saves.length,1);assert.equal(commands,0);await screenshot('phone-saved-fixture.png');
 await page.locator('#draft-fields textarea').fill('Keep this unsaved thought');conflict=true;await page.click('#draft-save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('conflict'));assert.equal(await page.locator('#draft-fields textarea').inputValue(),'Keep this unsaved thought');assert.equal(commands,0);
 conflict=false;revision=5;await page.click('#refresh');assert.equal(await page.locator('#draft-fields textarea').inputValue(),'Keep this unsaved thought');
 await page.click('#draft-save');await page.waitForFunction(()=>!document.querySelector('.game').matches('[aria-busy="true"]'));assert.equal(saves.at(-1).viewToken,'v4');assert.equal(await page.locator('#draft-try').isDisabled(),true);
 await page.locator('#draft-fields textarea').fill('Keep this unsaved thought');draft={...draft,version:draft.version+1,input:{text:'Saved from Discord'}};const newerVersion=draft.version;
 await page.click('#refresh');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('newer saved draft'));assert.equal(await page.locator('#draft-fields textarea').inputValue(),'Keep this unsaved thought');assert.equal(await page.locator('#draft-save').isDisabled(),true);await screenshot('phone-conflict-fixture.png');
 await page.click('#draft-rebase');await page.click('#draft-save');await page.waitForFunction(()=>!document.querySelector('#draft-try').disabled);assert.equal(saves.at(-1).viewToken,'v5');assert.equal(saves.at(-1).expectedDraftVersion,newerVersion);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#draft-fields textarea')?.value==='Keep this unsaved thought');
 await page.click('#draft-try');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('Recorded'));assert.equal(commands,1);assert.equal(await page.locator('#draft-try').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
browserTest('actual web table HTTP, cookie session and durable store accept browser Save then explicit Try',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'web-draft-real-'));let table,browser,store;
 t.after(async()=>{await browser?.close();await table?.close();await store?.close();await rm(directory,{recursive:true,force:true});});
 store=await createInvestigationDraftStore({file:join(directory,'draft.json')});
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 let revision=4,commands=[];const scope={campaignId:'fixture',userId:'owner',actorId:'actor',audience:'player'};
 const action={id:'describe',type:'describe',group:'describe',label:'Describe action',payload:{},fields:[{id:'text',label:'Your intention',multiline:true,maxLength:1500}]};
 const map={id:'fixture-room',level:'tactical',width:5,height:5,scaleFeet:5,viewerCharacterId:'actor',cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:'floor',visibility:'visible'})),tokens:[],objects:[]};
 const host={authorize:async s=>s.campaignId==='fixture'&&s.userId==='owner'&&s.actorId==='actor'&&s.audience==='player',service:{project:async()=>({revision,audience:'player',title:'HTTP fixture room',summary:'A known quiet room.',actor:{id:'actor',name:'Actor',conditions:[],inventory:[]},map,actions:[action],journal:['Known details']}),command:async request=>{commands.push(request);revision++;return {commandId:request.commandId,revision,result:{message:'Recorded'}};}}};
 table=createWebTable({getHost:()=>host,port,draftStore:store});await table.start();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:360,height:780}});page.setDefaultTimeout(5000);
 await page.goto(await table.webLink(scope));await page.locator('#draft-fields textarea').fill('Inspect the visible carving.');await page.click('#draft-save');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('Saved'));
 const saved=await store.get({campaignId:'fixture',userId:'owner',actorId:'actor',role:'player',visibility:'private'});assert.equal(saved.input.text,'Inspect the visible carving.');assert.equal(commands.length,0);
 await page.click('#draft-try');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('Recorded'));assert.equal(commands.length,1);assert.equal(commands[0].payload.text,'Inspect the visible carving.');assert.equal(await page.locator('#draft-try').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('#map').naturalWidth>0);
});
