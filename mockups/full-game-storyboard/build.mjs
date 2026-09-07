import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderPrint, renderRecap } from './views.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const require=createRequire(resolve(root,'../../raphael-council/package.json'));
const {createCanvas,loadImage}=require('@napi-rs/canvas');
await mkdir(join(root,'assets'),{recursive:true});
const library=resolve(root,'../../campaign-art/witnesslight');
const sources={shore:'on-discovery/11-saltglass-shore.png',abbey:'on-discovery/12-drowned-abbey.png',hearth:'opening/02-last-hearth.png',island:'world/established-region/27-nareth-island.png',counsel:'lore/on-discovery/61-raphael-counsel.png',mara:'people/portraits/52-mara.png'};
const manifest=[];
for(const [name,path]of Object.entries(sources)){
  const original=await loadImage(await readFile(join(library,path)));
  for(const [suffix,width,quality]of [['',1440,84],['-small',600,66]]){
    const ratio=Math.min(1,width/original.width), canvas=createCanvas(Math.round(original.width*ratio),Math.round(original.height*ratio));
    canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
    const bytes=await canvas.encode('jpeg',quality);await writeFile(join(root,'assets',`${name}${suffix}.jpg`),bytes);
    manifest.push({file:`${name}${suffix}.jpg`,source:path,width:canvas.width,height:canvas.height,bytes:bytes.length});
  }
}
await writeFile(join(root,'assets','manifest.json'),JSON.stringify(manifest,null,2));
const css=await readFile(join(root,'style.css'),'utf8');
function document(title,body){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;}
await writeFile(join(root,'storyboard.html'),document('Raphael · Complete 30-frame printable storyboard',renderPrint().replace('onclick="window.print()"','data-print')+'<script type="module" src="print.mjs"></script>'));
let recap=renderRecap({embedded:true});
// Portable recap: all images embedded, including expanded source-record images.
for(const [name]of Object.entries(sources))for(const suffix of ['','-small']){
  const bytes=await readFile(join(root,'assets',`${name}${suffix}.jpg`));
  recap=recap.replaceAll(`assets/${name}${suffix}.jpg`,`data:image/jpeg;base64,${bytes.toString('base64')}`);
}
recap=recap.replace(/<button data-source="([^"]+)">([^<]+)<\/button>/g,'<a href="#$1">$2</a>');
await writeFile(join(root,'recap.html'),document('The shore remembers · Illustrated session recap',`<main class="recap-container">${recap}</main>`));
console.log(`Built 30 printable frames, a self-contained illustrated recap and ${manifest.length} optimized local art assets.`);
