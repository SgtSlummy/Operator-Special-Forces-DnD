import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../../raphael-council');
const {startProdServer}=await import(pathToFileURL(join(root,'node_modules/vinext/dist/server/prod-server.js')).href);
const {chromium}=createRequire('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const output=join('C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12','browser-camp-'+Date.now());
await mkdir(output,{recursive:true});
const server=await startProdServer({outDir:join(root,'dist'),host:'127.0.0.1',port:0,silent:true});
let browser;const results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const origin='http://127.0.0.1:'+server.server.address().port;
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[],commands=[];let state='open',revision=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),operation=url.pathname.split('/').at(-1);
   if(url.searchParams.get('campaignId')!=='camp-fixture')return route.fulfill({status:404,json:{error:'Synthetic campaign required.'}});
   if(operation==='view')return route.fulfill({json:{campaignId:'camp-fixture',revision,mode:'exploration',viewToken:'synthetic-'+revision,title:'Shelter after the mission',summary:'The group has stopped to discuss its next steps.',selectedActor:state==='gm'?'':'hero',actions:state==='open'?[{id:'describe',label:'Describe',description:'Submit your intention for a ruling.',group:'describe',fields:[{id:'text',label:'Your intention',maxLength:1500}]},{id:'long-rest',label:'Long rest',group:'rest',fields:[]}]:[],...(state==='gm'?{dmStatus:{decisionOpen:false,pendingRulings:[]}}:{actor:{name:'Synthetic hero',hp:9,maxHp:20,details:'No resources change when making a proposal.'}})}});
   if(operation==='action'){
    const body=request.postDataJSON();commands.push(body);assert.equal(url.searchParams.get('actorId'),'hero');assert.equal(body.action,'describe');assert.equal(body.revision,0);assert.equal(body.viewToken,'synthetic-0');assert.deepEqual(body.payload,{text:'I would like a short rest after we check that everyone is safe.'});
    state='pending';revision=1;
    return route.fulfill({json:{receipt:{contract:'rpg-core-runtime-bridge-v1',campaignId:'camp-fixture',commandId:body.commandId,revision,success:true,replayed:false,result:{status:'pending',pendingId:'downtime-fixture'}}}});
   }
   return route.fulfill({status:404,json:{error:'Synthetic endpoint unavailable.'}});
  });
  await page.goto(origin+'/hollow-lantern?campaignId=camp-fixture');await page.getByRole('heading',{name:'Shelter after the mission',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Open',exact:true}).selectOption('camp');await page.getByRole('heading',{name:'Camp and downtime',exact:true}).waitFor();
  assert.equal(await page.getByRole('option',{name:'Long rest',exact:true}).count(),0);
  const rest=page.getByRole('button',{name:'Ask for a rest',exact:true});await rest.focus();await page.keyboard.press('Enter');
  assert.equal(commands.length,0);const intention=page.getByRole('textbox',{name:'Your intention',exact:true});assert.match(await intention.inputValue(),/Can the DM confirm/);
  await intention.fill('I would like a short rest after we check that everyone is safe.');
  await page.screenshot({path:join(output,name+'-review.png'),fullPage:true});
  await page.getByRole('button',{name:'Send downtime request',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByText(/Downtime request received; awaiting a ruling/).waitFor();assert.equal(commands.length,1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('hollow-pending-command')),null);
  assert.equal(await page.getByText('9 / 20 HP',{exact:true}).count(),1);assert.equal(await rest.isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Send downtime request',exact:true}).count(),0);
  await page.screenshot({path:join(output,name+'-pending.png'),fullPage:true});
  state='gm';revision=2;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Choose a character you control to propose their downtime.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Ask for a rest',exact:true}).count(),0);assert.equal(commands.length,1);
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  results.push({name,keyboardSubmission:true,commands:commands.length,action:'describe',draftDidNotSend:true,requestAwaitingRuling:true,hpUnchanged:true,unavailableActionsBlocked:true,gmOverviewCannotPropose:true,pageErrors:errors});await context.close();
 }
 await writeFile(join(output,'report.json'),JSON.stringify({passed:true,scope:'Compiled UI with isolated synthetic API; no live campaign or model',results},null,2));console.log(JSON.stringify({passed:true,output,results}));
}finally{if(browser)await browser.close();await new Promise(done=>server.server.close(done));}
