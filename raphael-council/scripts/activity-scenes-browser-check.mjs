import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {startProdServer} from '../node_modules/vinext/dist/server/prod-server.js';
import {presentProjection} from '../hollow-lantern/service.mjs';
import {renderTacticalMap,renderIllustratedOverview} from '../discord/hollow-lantern/renderers.mjs';
const require=createRequire('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const root=resolve(import.meta.dirname,'..'),output='C:/Users/Hermes/LocalFiles/hollow-lantern/hybrid-design-20260913/browser-preview',fixture='C:/Users/Hermes/LocalFiles/hollow-lantern/map-routes-verification-20260910/attempt2',art=resolve(root,'../campaign-art/hollow-lantern');
await mkdir(output,{recursive:true});
const views={},pngs={};
const {loadHollowLanternRoomArt}=await import('../hollow-lantern/room-art.mjs');
const roomVignettes=loadHollowLanternRoomArt(join(root,'hollow-lantern/artwork/signal-dungeon-terrain-v1/rooms.json'));
// Explicit synthetic exploration, never a claim about the live player's knowledge.
const syntheticRoomCells={};
for(const [id,columns] of [['intake-hall',11],['turbine-gallery',5]]){
 const grid=roomVignettes[id].grid;
 syntheticRoomCells[id]=Array.from({length:11*columns},(_,i)=>({x:grid.x+1+i%columns,y:grid.y+1+Math.floor(i/columns)}));
}
for(const level of ['tactical','dungeon','regional']){const p=JSON.parse(await readFile(join(fixture,level+'.json'),'utf8'));p.decisionOpen=true;views[level]=presentProjection(p);if(level==='dungeon'){assert.equal(views[level].map.id,'signal-dungeon');for(const node of views[level].map.nodes)if(node.discovered===true&&syntheticRoomCells[node.id])node.knownCells=syntheticRoomCells[node.id];}pngs[level]=level==='tactical'?await renderTacticalMap(views[level].map,{title:views[level].title,portraits:{'lantern-fighter':join(art,'mara.png')}}):await renderIllustratedOverview({...views[level].map,title:views[level].title},{roomVignettes});await writeFile(join(output,level+'.png'),pngs[level]);}
pngs.tacticalNearby=await renderTacticalMap(views.tactical.map,{title:views.tactical.title,detail:true,portraits:{'lantern-fighter':join(art,'mara.png')}});assert.notDeepEqual(pngs.tacticalNearby,pngs.tactical);await writeFile(join(output,'tactical-nearby.png'),pngs.tacticalNearby);
const scene=await readFile(join(art,'scenes/signal-house-sd.png')),portrait=await readFile(join(art,'mara.png'));
let server,browser;const report={kind:'compiled Activity with synthetic API, copied Unity maps, explicitly synthetic room discovery cells and reviewed terrain artwork through production masked renderer; not live player knowledge, Discord or blind acceptance',checks:[],errors:[]};
try{
 server=await startProdServer({outDir:join(root,'dist'),host:'127.0.0.1',port:0,silent:true});browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
 const context=await browser.newContext({viewport});const page=await context.newPage();let commands=0,revision=0,mode='exploration';page.on('pageerror',e=>report.errors.push({name,message:e.message}));
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),level=u.searchParams.get('level')||'tactical',op=u.pathname.split('/').at(-1);if(op==='map')return route.fulfill({contentType:'image/png',body:level==='tactical'&&u.searchParams.get('detail')==='nearby'?pngs.tacticalNearby:pngs[level]});if(op==='illustration')return route.fulfill({contentType:'image/png',body:u.searchParams.get('kind')==='portrait'?portrait:scene});if(op==='view')return route.fulfill({json:{...views[level],mapDetailAvailable:level==='tactical',mode,revision,viewToken:'synthetic-view-'+revision,selectedActor:'lantern-fighter',illustrations:{scene:true,portrait:true}}});if(op==='action'){commands++;const body=route.request().postDataJSON();return route.fulfill({json:{receipt:{contract:'rpg-core-runtime-bridge-v1',campaignId:views[level].campaignId,commandId:body.commandId,success:true,revision:++revision}}});}return route.fulfill({status:404,json:{error:'Fixture route unavailable'}});});
 await page.goto(`http://127.0.0.1:${server.port}/hollow-lantern`);await page.locator('.hl-illustration img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));
 assert.equal(await page.locator('.hl-portrait').evaluate(e=>getComputedStyle(e).borderRadius),'50%');assert.equal(await page.locator('.hl-map').count(),0);
 const viewsNav=page.getByRole('navigation',{name:'Explore this location'});
 for(const button of await viewsNav.getByRole('button').all())assert((await button.boundingBox()).height>=44);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert((await page.locator('.hl-content>aside').boundingBox()).width>=(await page.locator('.hl-scene').boundingBox()).width-2);
 await page.screenshot({path:join(output,name+'-arrival.png'),fullPage:true});
 await viewsNav.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('heading',{name:'Clues and details'}).waitFor();assert.equal(await page.locator('.hl-map').count(),0);assert.equal(await page.locator('.hl-illustration').count(),0);
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hollow-lantern/view'),page.getByRole('button',{name:'Refresh',exact:true}).click()]);await page.waitForFunction(()=>document.querySelector('button[aria-pressed=true]')?.textContent==='Details');assert.equal(commands,0);
 await page.screenshot({path:join(output,name+'-details.png'),fullPage:true});
 mode='combat';revision++;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.hl-map img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await viewsNav.getByRole('button',{name:'Tactical',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.hl-illustration').count(),0);
 assert.equal(await page.getByLabel('Map view',{exact:true}).inputValue(),'nearby');assert(new URL(await page.locator('.hl-map img').getAttribute('src'),'http://localhost').searchParams.get('detail')==='nearby');
 const nearby=page.getByRole('region',{name:'Nearby movement'});const expectedMoves=views.tactical.actions.filter(a=>a.group==='move'&&a.id.startsWith('move:')&&a.fields.length===0).slice(0,8);assert.equal(await nearby.getByRole('button').count(),expectedMoves.length);assert(expectedMoves.length>1);
 for(const move of expectedMoves){const button=nearby.getByRole('button',{name:move.label,exact:true});assert((await button.boundingBox()).height>=44);await button.click();assert.equal(commands,0);assert.equal(await page.getByLabel('Choose an action',{exact:true}).inputValue(),move.id);assert.equal(await page.locator('form input').count(),0);assert.equal(await page.locator('form .hl-lines').textContent(),move.description);}
 await page.screenshot({path:join(output,name+'-tactical.png'),fullPage:true});
 await page.getByRole('button',{name:/Expand map/}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();const expanded=dialog.locator('img');await expanded.evaluate(i=>i.decode());assert(await expanded.evaluate(i=>i.clientWidth===i.naturalWidth));
 if(name==='phone'){const scroll=dialog.locator('.hl-map-scroll');assert(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));await scroll.evaluate(e=>{e.scrollLeft=100;});assert(await scroll.evaluate(e=>e.scrollLeft>0));}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,name+'-expanded-map.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await page.getByRole('button',{name:/Expand map/}).evaluate(e=>e===document.activeElement));

 const nearbyWidth=await page.locator('.hl-map img').evaluate(i=>i.naturalWidth);await page.getByLabel('Map view',{exact:true}).selectOption('full');await page.waitForFunction(w=>{const i=document.querySelector('.hl-map img');return i?.complete&&i.naturalWidth>w;},nearbyWidth);assert.equal(commands,0);await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/hollow-lantern/view'),page.getByRole('button',{name:'Refresh',exact:true}).click()]);assert.equal(await page.getByLabel('Map view',{exact:true}).inputValue(),'full');await page.getByLabel('Map view',{exact:true}).selectOption('nearby');await page.waitForFunction(w=>document.querySelector('.hl-map img')?.naturalWidth===w,nearbyWidth);
 const primary=page.locator('aside .hl-shortcuts button').first();await primary.click();assert.equal(commands,0);const selected=await page.getByLabel('Choose an action',{exact:true}).inputValue();assert(selected);assert.equal(await page.getByLabel('Choose an action',{exact:true}).locator('option:checked').getAttribute('value'),selected);
 await page.getByLabel('Open',{exact:true}).selectOption('inventory');assert.equal(await page.locator('form').count(),0);await page.getByLabel('Open',{exact:true}).selectOption('map');
 const move=views.tactical.actions.find(a=>a.group==='move');assert(move);await page.getByLabel('Choose an action',{exact:true}).selectOption({label:views.tactical.actions.find(a=>!['move','inspect','interact','talk'].includes(a.group))?.label});assert.equal(commands,0);
 await page.locator('aside .hl-shortcuts button').filter({hasText:move.label}).first().click();for(const field of move.fields)await page.getByLabel(field.label,{exact:true}).fill('4');await page.getByRole('button',{name:'Confirm '+move.label,exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Action confirmed'));assert.equal(commands,1);
 await viewsNav.getByRole('button',{name:'Tactical',exact:true}).click();
 for(const level of ['dungeon','regional']){await page.getByLabel('Map scale',{exact:true}).selectOption(level);await page.locator('.hl-map img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:join(output,name+'-'+level+'.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 report.checks.push({viewport:name,arrivalScene:true,arrivalActionsFullWidth:true,detailsSurvivesRefresh:true,combatOpensTactical:true,viewControls44px:true,imagesLoaded:true,roundPortrait:true,shortcutDoesNotCommit:true,dropdownSelection:true,tabClearsSelection:true,confirmationCommands:commands,noHorizontalOverflow:true});await context.close();
 }
 assert.equal(report.errors.length,0);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}finally{await browser?.close();if(server)await new Promise(resolve=>server.server.close(resolve));await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
