import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {renderArchitecture} from './projection.mjs';
import {CATALOG} from '../catalog.mjs';
import {previewState} from '../table-server.mjs';
import {tableProject} from '../table-model.mjs';
const require=createRequire(new URL('../../../../raphael-council/package.json',import.meta.url));
const {chromium}=require('C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1600,height:1200}});
const geometry=JSON.parse(await readFile(new URL('../art/architecture/r01-projection.json',import.meta.url),'utf8'));
const view=tableProject(CATALOG,previewState());
// This is a labeled placement study; it never loads or changes campaign saves.
view.party=view.party.map((p,i)=>({...p,roomId:'R01',x:.28+i*.16,y:.28+i*.1}));view.state.poiIds={};
const portraits=Object.fromEntries(await Promise.all(view.party.map(async p=>[p.id,'data:image/png;base64,'+(await readFile(new URL('../art/table/'+p.id+'.png',import.meta.url))).toString('base64')])));
const output=new URL('./review/',import.meta.url);await mkdir(output,{recursive:true});
for(const layer of Object.keys(geometry.views)){
 const background='data:image/png;base64,'+(await readFile(new URL('../art/architecture/'+layer+'.png',import.meta.url))).toString('base64');
 let svg=renderArchitecture(view,{geometry,layer,images:{background,portraits},grid:true});
 svg=svg.replace('</svg>','<rect x="38" y="30" width="560" height="58" rx="5" fill="#132b28"/><text x="55" y="55" font-family="Georgia,serif" font-size="18" fill="#f1e6c8">Brass Vestibule · Marker alignment study</text><text x="55" y="76" font-family="Georgia,serif" font-size="14" fill="#c3d2c7">Illustrative party positions — not live campaign tracking</text></svg>');
 await writeFile(new URL(layer+'.svg',output),svg);
 await page.goto(new URL(layer+'.svg',output).href);
 await page.evaluate(()=>Promise.all([...document.querySelectorAll('image')].map(el=>new Promise((ok,no)=>{const img=new Image();img.onload=ok;img.onerror=()=>no(Error('Map image failed to decode.'));img.src=el.getAttributeNS('http://www.w3.org/1999/xlink','href')??el.getAttribute('href');}))));
 await page.locator('svg').screenshot({path:fileURLToPath(new URL(layer+'.png',output))});
 console.log(layer+' review saved with decoded artwork');
}
await browser.close();
