import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startTable,previewState} from '../table-server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=await mkdtemp(join(tmpdir(),'coast-architecture-browser-'));
let server,browser;
const errors=[];
try{
 server=await startTable({gmPort:0,playerPort:0,stateFile:join(root,'state.json'),seed:()=>{const s=previewState();s.currentRoomId='R01';s.party.forEach((p,i)=>Object.assign(p,{roomId:'R01',x:.25+i*.16,y:.30+i*.12}));return s;}});
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.player.address().port}`);
 await page.waitForSelector('#stage img');
 await page.locator('[data-view="dungeon"]').click();
 await page.locator('#floor').selectOption('0');
 const output=fileURLToPath(new URL('../qa/architecture/',import.meta.url));await mkdir(output,{recursive:true});
 const results=[];
 for(const layer of ['r01-cutaway','r01-floor-slice','r01-low-cutaway']){
  await page.locator(`[data-architecture-layer="${layer}"]`).click();
  await page.locator(`[data-architecture-map="${layer}"] svg`).waitFor();
  assert.ok(await page.locator('#stage svg').evaluate(svg=>svg.getBoundingClientRect().width<=svg.parentElement.getBoundingClientRect().width),'The complete map fits its panel');
  assert.equal(await page.locator('#stage [data-player]').count(),4);
  assert.equal(await page.locator('#stage [data-poi]').count(),0);
  await page.locator('#stage svg').evaluate(async svg=>{await Promise.all([...svg.querySelectorAll('image')].map(node=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('Map image failed to decode'));image.src=node.getAttribute('href')||node.getAttribute('xlink:href');})));});
  await page.locator('#stage').screenshot({path:join(output,layer+'.png')});
  results.push({layer,portraits:4,undiscoveredNotes:0,imagesDecoded:true});
 }
 await page.locator('#floor').selectOption('-1');
 assert.equal(await page.locator('#stage [data-architecture-map]').count(),0,'Selecting another story shows its map, not the R01 cutaway');
 await page.locator('#floor').selectOption('0');
 await page.locator('[data-view="tactical"]').click();await page.locator('[data-architecture-map="r01-floor-slice"] svg').waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
 await page.locator('#stage').screenshot({path:join(output,'mobile-floor.png')});
 await page.locator('[data-view="scene"]').click();await page.locator('#stage > img').waitFor();
 assert.equal(await page.locator('#stage [data-architecture-map]').count(),0);
 assert.deepEqual(errors,[]);
 await writeFile(join(output,'results.json'),JSON.stringify({kind:'Isolated table browser fixture; no live state changed',results,mobileOverflow:false,pageErrors:errors},null,2));
 console.log(JSON.stringify({views:results.length,mobileOverflow:false,pageErrors:errors,evidence:output}));
}finally{if(browser)await browser.close();if(server)await server.close();await rm(root,{recursive:true,force:true});}
