import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';

const scenes=new Set(['briefing','coastal-road','signal-dungeon','rescue','harbor-shop','debrief']);
const materials=new Set(['floor','grass','sand','road']);
const invalid=()=>{throw new Error('HOLLOW_LANTERN_MATERIALS_INVALID');};
/** Reviewed material swatches only. Geometry and objects remain engine-owned. */
export function loadHollowLanternMaterials(manifestPath){
 if(typeof manifestPath!=='string'||!isAbsolute(manifestPath)||/^[\\/]{2}/.test(manifestPath))invalid();
 const path=realpathSync(manifestPath),root=dirname(path);
 if(/(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(path)||statSync(path).size>65536)invalid();
 const manifest=JSON.parse(readFileSync(path,'utf8'));
 if(manifest.version!==1||manifest.kind!=='terrain-materials'||!Array.isArray(manifest.entries)||manifest.entries.length>24)invalid();
 const output={};
 for(const entry of manifest.entries){
  if(!entry||!scenes.has(entry.sceneId)||!materials.has(entry.terrain)||entry.approved!==true||entry.purpose!=='material-only'||typeof entry.file!=='string'||isAbsolute(entry.file)||/^[\\/]/.test(entry.file)||!/^[a-f0-9]{64}$/.test(entry.sha256??''))invalid();
  const image=realpathSync(resolve(root,entry.file)),nested=relative(root,image);
  if(nested==='..'||nested.startsWith('..'+sep)||isAbsolute(nested)||statSync(image).size>8*1024*1024)invalid();
  const bytes=readFileSync(image);
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)invalid();
  output[entry.sceneId]??={};if(Object.hasOwn(output[entry.sceneId],entry.terrain))invalid();
  output[entry.sceneId][entry.terrain]=Buffer.from(bytes);
 }
 return output;
}
