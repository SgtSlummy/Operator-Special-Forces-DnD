import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../../raphael-council');
const {startProdServer}=await import(pathToFileURL(join(root,'node_modules/vinext/dist/server/prod-server.js')).href);
const {chromium}=createRequire('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const output=join('C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12','browser-resolution-'+Date.now());
await mkdir(output,{recursive:true});
const server=await startProdServer({outDir:join(root,'dist'),host:'127.0.0.1',port:0,silent:true});
let browser;const results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const address=server.server.address();const origin='http://127.0.0.1:'+address.port;
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];let sent,actions=0,resolutions=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),campaign=url.searchParams.get('campaignId'),operation=url.pathname.split('/').at(-1);
   if(!['table-a','table-b'].includes(campaign))return route.fulfill({status:404,json:{error:'No synthetic campaign.'}});
   if(operation==='view')return route.fulfill({json:{campaignId:campaign,revision:campaign==='table-a'&&sent?1:0,mode:'exploration',viewToken:'synthetic-'+campaign,title:'Synthetic '+campaign,summary:'Isolated browser rehearsal',selectedActor:'hero',actions:[{id:'inspect:test',label:'Inspect',group:'inspect',fields:[]}],actor:{name:'Hero of '+campaign,hp:10,maxHp:10,details:'Synthetic character'}}});
   if(operation==='action'){actions++;sent={campaign,body:request.postDataJSON()};return route.abort('failed');}
   if(operation==='resolve'){
    resolutions++;const body=request.postDataJSON();assert.equal(campaign,'table-a');assert.equal(url.searchParams.get('actorId'),'hero');assert.deepEqual(body,{commandId:sent.body.commandId,expectedRevision:0});
    if(resolutions===1)return route.fulfill({status:503,json:{error:'Temporary recovery outage.'}});
    const identity={contract:'rpg-core-runtime-bridge-v1',campaignId:'table-a',commandId:sent.body.commandId,ownerId:'synthetic-player',actorId:'hero',originalExpectedRevision:0,revision:1};
    return route.fulfill({json:{resolution:{...identity,success:true,replayed:false,resolution:'cancelled',rejection:{...identity,code:'COMMAND_CANCELLED',terminal:true}}}});
   }
   return route.fulfill({status:404,json:{error:'Synthetic endpoint unavailable.'}});
  });
  await page.goto(origin+'/hollow-lantern?campaignId=table-a');await page.getByRole('heading',{name:'Synthetic table-a',exact:true}).waitFor();
  await page.getByRole('button',{name:'Inspect',exact:true}).click();await page.getByRole('button',{name:'Confirm Inspect',exact:true}).click();
  await page.getByRole('button',{name:'Resolve missing action',exact:true}).waitFor();
  await page.goto(origin+'/hollow-lantern?campaignId=table-b');await page.getByRole('heading',{name:'Synthetic table-b',exact:true}).waitFor();
  await page.getByRole('button',{name:'Resolve missing action',exact:true}).click();await page.getByText('Temporary recovery outage.',{exact:true}).waitFor();
  assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('hollow-pending-command')),null);
  await page.getByRole('button',{name:'Resolve missing action',exact:true}).click();await page.getByRole('button',{name:'Resolve missing action',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('hollow-pending-command')),null);
  await page.getByRole('heading',{name:'Synthetic table-b',exact:true}).waitFor();assert.equal(actions,1);assert.equal(resolutions,2);assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:join(output,name+'.png'),fullPage:true});results.push({name,actions,resolutions,uncertaintyRetained:true,cancellationCleared:true,currentCampaign:'table-b',pageErrors:errors});await context.close();
 }
 await writeFile(join(output,'report.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,output,results}));
}finally{if(browser)await browser.close();await new Promise(resolveClose=>server.server.close(resolveClose));}
