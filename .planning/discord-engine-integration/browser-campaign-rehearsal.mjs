import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'../../raphael-council');
const {startProdServer}=await import(pathToFileURL(join(root,'node_modules/vinext/dist/server/prod-server.js')).href);
const require=createRequire('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const output=`C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/browser-campaign-routing-${Date.now()}`;
await mkdir(output,{recursive:true});
const report={kind:'Compiled browser with synthetic API; not live Discord or engine acceptance',checks:[],errors:[]};
let server,browser;
try{
 server=await startProdServer({outDir:join(root,'dist'),host:'127.0.0.1',port:0,silent:true});
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
  const context=await browser.newContext({viewport});
  const page=await context.newPage();
  let sent,actions=0,receipts=0;const views=[];
  page.on('pageerror',error=>report.errors.push({viewport:name,message:error.message}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),campaign=url.searchParams.get('campaignId');
   const op=url.pathname.split('/').at(-1);
   if(!['table-a','table-b'].includes(campaign))return route.fulfill({status:400,json:{error:'Synthetic campaign selector missing'}});
   if(op==='view'){
    views.push(campaign);
    return route.fulfill({json:{campaignId:campaign,revision:campaign==='table-a'&&sent?1:0,mode:'exploration',viewToken:'synthetic-'+campaign,title:'Synthetic '+campaign,summary:'Isolated browser rehearsal',selectedActor:'hero',actions:[{id:'inspect:test',label:'Inspect',group:'inspect',fields:[]}],actor:{name:'Hero of '+campaign,hp:10,maxHp:10,details:'Synthetic character'}}});
   }
   if(op==='action'){
    actions++;sent={campaign,body:request.postDataJSON()};
    return route.abort('failed');
   }
   if(op==='receipt'){
    receipts++;assert.equal(campaign,'table-a');assert.equal(request.postDataJSON().commandId,sent?.body.commandId);
    return route.fulfill({json:{receipt:{contract:'rpg-core-runtime-bridge-v1',campaignId:'table-a',commandId:sent.body.commandId,success:true,revision:1,result:{message:'Original synthetic receipt'}}}});
   }
   return route.fulfill({status:404,json:{error:'Synthetic route unavailable'}});
  });
  const base=`http://127.0.0.1:${server.port}/hollow-lantern`;
  await page.goto(base+'?campaignId=table-a');
  await page.getByRole('heading',{name:'Synthetic table-a',exact:true}).waitFor();
  await page.getByRole('button',{name:'Inspect',exact:true}).click();
  await page.getByRole('button',{name:'Confirm Inspect',exact:true}).click();
  await page.getByRole('button',{name:'Recover original action',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover original action'&&!button.disabled));
  assert.equal(actions,1);assert.equal(sent.campaign,'table-a');
  await page.goto(base+'?campaignId=table-b');
  await page.getByRole('heading',{name:'Synthetic table-b',exact:true}).waitFor();
  await page.screenshot({path:join(output,name+'-pending-original-campaign.png'),fullPage:true});
  await page.getByRole('button',{name:'Recover original action',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('original receipt recovered'));
  assert.equal(actions,1);assert.equal(receipts,1);assert.equal(views.at(-1),'table-b');
  assert.equal(await page.getByRole('button',{name:'Recover original action',exact:true}).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(output,name+'-recovered.png'),fullPage:true});
  report.checks.push({viewport:name,originalCampaign:'table-a',openCampaign:'table-b',actionRequests:actions,receiptRequests:receipts,noRepeatedMutation:true,viewRemainsSelectedCampaign:true,noHorizontalOverflow:true});
  await context.close();
 }
 assert.equal(report.errors.length,0);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(done=>server.server.close(done));await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}));}
