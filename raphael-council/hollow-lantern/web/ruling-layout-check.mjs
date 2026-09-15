// Developer layout check with synthetic projections. No model participant,
// Unity process, live identity, or campaign store is involved.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createServer} from 'node:net';
import {createWebTable} from '../web-server.mjs';
import {presentProjection} from '../service.mjs';
const [runtimePackage,output]=process.argv.slice(2);
if(!runtimePackage||!isAbsolute(output??'')||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(output))throw Error('Use an installed browser runtime and a local evidence directory.');
const {chromium}=createRequire(resolve(runtimePackage))('playwright');
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const scope={campaignId:'fixture-ruling-layout',userId:'fixture-dm',audience:'gm'};
const projection={projectionVersion:2,campaignId:scope.campaignId,revision:7,audience:'gm',currentSceneId:'briefing',phase:'exploration',decisionOpen:true,characters:[],pendingActions:[{id:'request-1',kind:'ruling',text:'I would like to inspect the expedition records for signs of water damage before moving them.'}],map:{width:1,height:1,level:'tactical',cells:[{x:0,y:0,visibility:'visible',terrain:'floor'}],tokens:[]}};
let writes=0;
const table=createWebTable({port,getHost:()=>({authorize:s=>s.campaignId===scope.campaignId&&s.userId===scope.userId&&s.audience==='gm',service:{project:async()=>presentProjection(projection),command:async()=>{writes++;throw Error('No fixture gameplay writes are permitted.');}}})});
let browser;const results=[];await mkdir(output,{recursive:true});
try{
 await table.start();browser=await chromium.launch({headless:true,channel:'chrome'});
 for(const [name,viewport]of [['desktop',{width:1280,height:1000}],['phone',{width:390,height:844}]]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(await table.webLink(scope));await page.getByRole('button',{name:'Review pending rulings',exact:true}).click();
  await page.getByRole('heading',{name:'Pending rulings',exact:true}).waitFor();
  assert.equal(await page.locator('#submit').isDisabled(),true);assert.equal(await page.locator('#action').inputValue(),'');
  assert.equal(await page.locator('#submit').innerText(),'Choose a response above');
  const guide=page.locator('#stage #ruling-response-guide');assert.equal(await guide.isVisible(),true);assert.equal(await guide.locator('li').count(),2);
  for(const text of ['Approve request','Decline request','Approve request with explanation','Decline request with explanation','written ruling'])assert.ok((await guide.innerText()).includes(text));
  assert.equal(await page.locator('#action option').count(),5);
  assert.equal(await page.locator('#level').isVisible(),false);assert.equal(await page.locator('#dm-actor').isVisible(),false);
  if(name==='desktop'){
   for(const selector of ['#ruling-response-guide','#action','#submit']){const box=await page.locator(selector).boundingBox();assert.ok(box&&box.y+box.height<=viewport.height,`${selector} must fit in the desktop viewport`);}
  }
  if(name==='phone'){const box=await guide.boundingBox();assert.ok(box&&box.y+box.height<=viewport.height,'All response descriptions must fit in the phone viewport for this request');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(output,`${name}-review.png`),fullPage:true});
  await page.selectOption('#action','ruling:request-1:true');
  assert.equal(await page.locator('#submit').innerText(),'Confirm: Approve request (no explanation)');assert.match(await page.locator('#cost').innerText(),/No explanation will be recorded/);assert.equal(await page.getByRole('button',{name:'Add explanation',exact:true}).isVisible(),true);
  await page.locator('#submit').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(name==='desktop'){const box=await page.locator('#submit').boundingBox();assert.ok(box&&box.y+box.height<=viewport.height,'Plain approval confirmation must remain visible');}
  await page.screenshot({path:join(output,`${name}-plain-approval.png`),fullPage:true});
  await page.getByRole('button',{name:'Add explanation',exact:true}).click();assert.equal(await page.locator('#action').inputValue(),'ruling:request-1:true:note');assert.equal(await page.locator('#fields textarea').evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('#fields textarea').getAttribute('required'),'');
  assert.equal(await page.getByRole('button',{name:'Add explanation',exact:true}).isVisible(),false);assert.equal(await page.locator('#submit').innerText(),'Write an explanation above');assert.equal(await page.locator('#submit').isDisabled(),true);assert.equal(await page.getByLabel('2. Write your explanation (required)',{exact:true}).count(),1);
  await page.screenshot({path:join(output,`${name}-explanation-required.png`),fullPage:true});
  await page.locator('#fields textarea').fill('The request is approved after checking the visible records.');assert.equal(await page.locator('#submit').isDisabled(),false);assert.equal(await page.locator('#submit').innerText(),'Confirm: Approve request with explanation');await page.screenshot({path:join(output,`${name}-approval-explanation.png`),fullPage:true});
  await page.selectOption('#action','ruling:request-1:false:note');assert.equal(await page.locator('#fields textarea').count(),1);assert.equal(await page.locator('#fields textarea').getAttribute('required'),'');
  assert.equal(await page.locator('#submit').innerText(),'Write an explanation above');assert.equal(await page.locator('#submit').isDisabled(),true);
  await page.getByRole('button',{name:'Back to map',exact:true}).click();assert.equal(await page.locator('#level').isVisible(),true);assert.equal(await page.locator('#dm-actor').isVisible(),true);
  assert.deepEqual(errors,[]);results.push({viewport:name,passed:true,actualParticipant:false});await context.close();
 }
 assert.equal(writes,0);await writeFile(join(output,'layout-results.json'),JSON.stringify({kind:'developer browser check with synthetic projection',results,gameplayWrites:writes},null,2));console.log(JSON.stringify({output,results}));
}finally{await browser?.close();await table.close();}
