import {createRequire} from 'node:module';
import {architectureIllustration} from './delivery.mjs';
const require=createRequire(import.meta.url);
let queue=Promise.resolve(),pending=0;

// Chrome correctly decodes the embedded local PNGs; the canvas SVG loader did not.
// Serialize jobs so simultaneous Discord controls cannot start many browsers.
export async function renderArchitecturePng(view,roomId,layer='r01-cutaway'){
 if(pending>=4)throw Error('The map studio is busy. Try again shortly.');
 const snapshot=structuredClone(view);pending++;
 const task=queue.then(async()=>{
  const svg=await architectureIllustration(snapshot,{roomId,layer});
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Hermes/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
   const page=await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:1});
   await page.route('**/*',route=>route.abort());
   await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`);
   await page.locator('svg').evaluate(async element=>{await Promise.all([...element.querySelectorAll('image')].map(async node=>{const image=new Image();image.src=node.getAttribute('href')||node.getAttribute('xlink:href');await image.decode();}));});
   return await page.locator('svg').screenshot({type:'png',timeout:15000});
  }finally{await browser.close();}
 });
 queue=task.catch(()=>{});
 try{return await task;}finally{pending--;}
}
