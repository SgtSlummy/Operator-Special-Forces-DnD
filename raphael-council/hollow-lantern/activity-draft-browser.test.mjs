import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createActivityRuntime} from './activity-runtime.mjs';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';

// Run against an owned local Activity dev server. The page is real; only the
// browser transport is connected to a controlled engine and real durable store.
// Set ACTIVITY_BROWSER_URL, optionally PLAYWRIGHT_MODULE and PLAYWRIGHT_CHANNEL.
const base=process.env.ACTIVITY_BROWSER_URL;
let chromium,skip=base?undefined:'Set ACTIVITY_BROWSER_URL to an owned local Activity dev server.';
if(base){
 const url=new URL(base);if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Activity browser tests require a local HTTP server.');
 const specified=process.env.PLAYWRIGHT_MODULE;
 try{({chromium}=await import(specified?(isAbsolute(specified)?pathToFileURL(specified).href:specified):'playwright'));}
 catch(error){if(specified||error.code!=='ERR_MODULE_NOT_FOUND')throw error;skip='Playwright is unavailable; set PLAYWRIGHT_MODULE to the installed browser test runtime.';}
}
const playerScope={campaignId:'hollow',userId:'player',actorId:'one',role:'player',visibility:'private'};
async function fixture(t,{delayFirstDraft=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'activity-draft-browser-'));
 const store=await createInvestigationDraftStore({file:join(directory,'drafts.json')});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 t.after(async()=>{await browser.close();await store.close();await rm(directory,{recursive:true,force:true});});
 const context=await browser.newContext({viewport:{width:360,height:800}}),origin=new URL(base).origin;
 await context.addCookies([{name:'draft-fixture',value:'private',url:origin}]);
 const identity={campaign:'hollow',owner:'player',role:'player'},requests=[],commands=[],errors=[];
 let revision=3,draftRequests=0,releaseOldDraft;
 const oldDraftReleased=new Promise(resolve=>{releaseOldDraft=resolve;});
 const client={campaignId:'hollow',project:async request=>({projectionVersion:2,campaignId:'hollow',revision,audience:request.audience,characterId:request.actorId??'one',currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[{characterId:'one',ownerId:'player',characterType:'player',displayName:'Hero',primaryHealth:10,primaryHealthMaximum:10,position:{x:12,y:12},factionId:'party',resources:{movementFeet:30}}],pendingActions:[]}),command:async request=>{commands.push(structuredClone(request));return {commandId:request.commandId,revision:++revision,replayed:false,result:{message:'You study the known inscription.'}};}};
 const auth={config:{activityOrigin:origin},authenticate:async request=>request.headers.get('cookie')?.includes('draft-fixture=private')?identity:null,member:async()=>identity};
 const runtime=createActivityRuntime({auth,client,gmUserId:'dm',draftStore:store});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/hollow-lantern/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const suffix=url.pathname.slice('/api/hollow-lantern/'.length),operation={'draft/save':'draft-save','draft/try':'draft-try'}[suffix]??suffix;
  const body=request.postData();requests.push({operation,level:url.searchParams.get('level'),campaignId:url.searchParams.get('campaignId'),actorId:url.searchParams.get('actorId'),body:body?JSON.parse(body):null});
  if(operation==='draft'&&++draftRequests===1&&delayFirstDraft){await oldDraftReleased;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Obsolete draft request failed.'})});return;}
  // The real route wrapper resolves campaignId before runtime.handle.
  assert.equal(url.searchParams.get('campaignId'),'hollow');url.searchParams.delete('campaignId');
  const response=await runtime.handle(operation,new Request(url,{method:request.method(),headers:await request.allHeaders(),...(body?{body}:{})}));
  const headers=Object.fromEntries(response.headers);
  if(operation==='view'&&response.ok){const view=await response.json();view.title='The Quiet Hall';view.summary='A known inscription rests beside the door.';view.journal=['The visible inscription is recorded in your journal.'];view.actions=view.actions.filter(a=>a.id==='interact'||a.id==='talk').map(a=>({...a,label:a.id==='interact'?'Inspect door':'Talk to guide'}));await route.fulfill({status:response.status,headers,body:JSON.stringify(view)});}
  else await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(`${origin}/hollow-lantern?campaignId=hollow&actorId=one`);
 try{await page.getByRole('heading',{name:'The Quiet Hall',exact:true}).waitFor({timeout:10000});}catch(error){throw new Error(`${error.message}\nFixture requests: ${JSON.stringify(requests)}\nPage errors: ${JSON.stringify(errors)}\nVisible page: ${await page.locator('body').innerText()}`);}
 return {page,store,requests,commands,errors,runtime,releaseOldDraft,advance:()=>revision++};
}
async function chooseIntention(page){await page.getByRole('button',{name:'Inspect door',exact:true}).click();await page.getByLabel('Your written intention',{exact:true}).waitFor();}
async function savedDraft(store){return store.get(playerScope);}

test('real Activity page retains text across views, saves original context and explicitly tries once',{skip},async t=>{
 const f=await fixture(t),{page}=f;await chooseIntention(page);
 const input=page.getByLabel('Your written intention',{exact:true}),writing='I read the known inscription carefully before touching the door.';
 await input.fill(writing);
 await page.getByLabel('Open',{exact:true}).selectOption('journal');assert.equal(await input.inputValue(),writing);
 await page.getByLabel('Open',{exact:true}).selectOption('map');
 await Promise.all([page.waitForResponse(response=>response.url().includes('/api/hollow-lantern/view')&&new URL(response.url()).searchParams.get('level')==='dungeon'),page.getByRole('button',{name:'Dungeon',exact:true}).click()]);
 assert.equal(await input.inputValue(),writing);assert.equal(f.commands.length,0);
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByRole('button',{name:'Try action',exact:true}).waitFor();
 await assertEventually(async()=>Boolean((await savedDraft(f.store))?.draftId));
 assert.equal((await savedDraft(f.store)).input.text,writing);assert.equal(f.commands.length,0);
 const save=f.requests.find(r=>r.operation==='draft-save');assert.equal(save.level,'tactical');assert.equal(save.actorId,'one');
 await page.reload();await page.getByRole('heading',{name:'The Quiet Hall',exact:true}).waitFor();
 await input.waitFor();assert.equal(await input.inputValue(),writing);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 if(process.env.ACTIVITY_DRAFT_SCREENSHOTS){await mkdir(process.env.ACTIVITY_DRAFT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.ACTIVITY_DRAFT_SCREENSHOTS,'activity-phone-saved-fixture.png'),fullPage:true});}
 await page.getByRole('button',{name:'Try action',exact:true}).click();
 await assertEventually(async()=>f.commands.length===1&&(await savedDraft(f.store)).status==='completed');
 assert.equal(f.commands[0].payload.text,writing);assert.equal(f.requests.filter(r=>r.operation==='action').length,0);assert.deepEqual(f.errors,[]);
});

test('Activity dirty writing survives a newer remote draft and requires explicit replacement',{skip},async t=>{
 const f=await fixture(t),{page}=f;await chooseIntention(page);const input=page.getByLabel('Your written intention',{exact:true});
 await input.fill('My unsaved careful inspection.');
 const remote=await f.store.save(playerScope,{actionId:'interact',actionPayload:{},input:{text:'A newer draft saved from Discord.'},expectedRevision:3},null);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.getByRole('button',{name:'Use saved draft',exact:true}).waitFor();assert.equal(await input.inputValue(),'My unsaved careful inspection.');assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Use saved draft',exact:true}).click();assert.equal(await input.inputValue(),remote.input.text);assert.equal(f.commands.length,0);assert.deepEqual(f.errors,[]);
});
test('Activity action selection needs explicit replacement and private text stays out of browser storage',{skip},async t=>{
 const f=await fixture(t),{page}=f;await chooseIntention(page);
 const input=page.getByLabel('Your written intention',{exact:true}),writing='My private theory about the inscription.';await input.fill(writing);
 await input.focus();await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement?.tagName),'BODY');
 await page.getByRole('button',{name:'Talk to guide',exact:true}).click();
 await page.getByRole('button',{name:'Replace intention',exact:true}).waitFor();assert.equal(await input.inputValue(),writing);assert.equal(await page.getByRole('heading',{name:'Inspect door',exact:true}).isVisible(),true);
 const persisted=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert.equal(persisted.includes(writing),false);assert.equal(f.commands.length,0);
 await page.getByRole('button',{name:'Replace intention',exact:true}).click();await page.getByRole('heading',{name:'Talk to guide',exact:true}).waitFor();assert.equal(f.commands.length,0);assert.deepEqual(f.errors,[]);
});

test('an obsolete failed draft refresh cannot replace the latest successful state',{skip},async t=>{
 const f=await fixture(t,{delayFirstDraft:true}),{page}=f;await chooseIntention(page);await page.getByLabel('Your written intention',{exact:true}).fill('Keep this current intention.');
 await assertEventually(()=>f.requests.some(r=>r.operation==='draft'));
 await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/hollow-lantern/draft'&&response.status()===200),page.getByRole('button',{name:'Refresh',exact:true}).click()]);
 const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/hollow-lantern/draft'&&response.status()===503);f.releaseOldDraft();await oldResponse;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal((await page.locator('body').innerText()).includes('Obsolete draft request failed.'),false);assert.equal(await page.getByLabel('Your written intention',{exact:true}).inputValue(),'Keep this current intention.');assert.equal(f.commands.length,0);assert.deepEqual(f.errors,[]);
});

async function assertEventually(check){for(let attempt=0;attempt<60;attempt++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Expected Activity draft state was not observed.');}
