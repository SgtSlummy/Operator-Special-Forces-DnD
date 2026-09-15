import {lstat,realpath,open,mkdir,writeFile,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,isAbsolute,parse,relative,join,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const comparable=p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
export function productionPath(path){
 if(typeof path!=='string'||!isAbsolute(path)||path!==path.trim()||/[\x00-\x1f\x7f]/.test(path)||/^[/\\]{2}/.test(path)||/(?:^|[/\\])OneDrive(?: - [^/\\]+)?(?:[/\\]|$)/i.test(path)||/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)||/:/.test(path.slice(2)))fail('PRODUCTION_LOCAL_PATH_REQUIRED');
 return resolve(path);
}
export async function inspectProductionPath(path,{directory=false,limit=Infinity}={}){
 const absolute=productionPath(path);let cursor=parse(absolute).root;
 for(const component of relative(cursor,absolute).split(/[/\\]/).filter(Boolean)){
  cursor=join(cursor,component);if((await lstat(cursor)).isSymbolicLink())fail('PRODUCTION_LINK_REJECTED');
 }
 const info=await lstat(absolute);
 if(directory?!info.isDirectory():!info.isFile()||info.nlink!==1||info.size>limit)fail('PRODUCTION_FILE_INVALID');
 if(comparable(await realpath(absolute))!==comparable(absolute))fail('PRODUCTION_LINK_REJECTED');
 return info;
}
/** Node opens Windows readers with compatible sharing while Unity retains its writer lock. */
export async function hashProductionFile(path,{destination}={}){
 const before=await inspectProductionPath(path),handle=await open(path,'r');
 try{
  const current=await handle.stat();
  if(current.dev!==before.dev||current.ino!==before.ino||current.size!==before.size||current.nlink!==1)fail('PRODUCTION_FILE_CHANGED');
  const hash=createHash('sha256'),source=handle.createReadStream({autoClose:false});
  if(destination){
   productionPath(destination);await inspectProductionPath(dirname(destination),{directory:true});
   const hashing=new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk);}});
   await pipeline(source,hashing,createWriteStream(destination,{flags:'wx',mode:0o600}));
  }else for await(const chunk of source)hash.update(chunk);
  const after=await inspectProductionPath(path);
  if(['dev','ino','size','mtimeMs','ctimeMs'].some(k=>after[k]!==before[k]))fail('PRODUCTION_FILE_CHANGED');
  return {sha256:hash.digest('hex'),bytes:before.size};
 }finally{await handle.close();}
}
export async function readProductionJson(file,limit=65536){
 await inspectProductionPath(file,{limit});const handle=await open(file,'r');
 try{const bytes=Buffer.alloc(limit+1);let count=0;while(count<bytes.length){const part=await handle.read(bytes,count,bytes.length-count,count);if(!part.bytesRead)break;count+=part.bytesRead;}if(count>limit)fail('PRODUCTION_FILE_INVALID');return JSON.parse(bytes.subarray(0,count).toString('utf8'));}finally{await handle.close();}
}
export async function campaignBundleFiles(file){
 productionPath(file);const result=[file];
 for(const suffix of ['.bak','.wal','.wal.meta'])try{await inspectProductionPath(file+suffix);result.push(file+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(result.includes(file+'.wal')!==result.includes(file+'.wal.meta'))fail('PRODUCTION_JOURNAL_INCOMPLETE');
 async function walk(dir){await inspectProductionPath(dir,{directory:true});for(const name of (await readdir(dir)).sort()){if(name.endsWith('.lock')||name.endsWith('.tmp'))continue;const path=join(dir,name),info=await lstat(path);if(info.isDirectory())await walk(path);else{await inspectProductionPath(path);result.push(path);}}}
 try{await walk(file+'.v2');}catch(error){if(error.code!=='ENOENT')throw error;}
 return result;
}
/** Caller quiesces writers. A changed source leaves an incomplete destination, never a valid manifest. */
export async function archiveCampaign({file,destination,reason='deployment'}={}){
 productionPath(destination);const parent=dirname(destination);await mkdir(parent,{recursive:true});await inspectProductionPath(parent,{directory:true});
 const sources=await campaignBundleFiles(file),before=[];
 for(const source of sources)before.push({source,...await hashProductionFile(source)});
 await mkdir(destination); // Never overwrite an earlier archive, including an interrupted one.
 const entries=[];
 for(const entry of before){
  const name=relative(dirname(file),entry.source),target=join(destination,name);await mkdir(dirname(target),{recursive:true});
  const copied=await hashProductionFile(entry.source,{destination:target});
  if(copied.sha256!==entry.sha256||(await hashProductionFile(target)).sha256!==entry.sha256)fail('PRODUCTION_ARCHIVE_CHANGED');
  entries.push({name,sha256:entry.sha256,bytes:entry.bytes});
 }
 for(const entry of before)if((await hashProductionFile(entry.source)).sha256!==entry.sha256)fail('PRODUCTION_ARCHIVE_CHANGED');
 if(JSON.stringify(await campaignBundleFiles(file))!==JSON.stringify(sources))fail('PRODUCTION_ARCHIVE_CHANGED');
 const manifest={kind:'ops-dnd-campaign-archive',version:1,createdUtc:new Date().toISOString(),reason,source:file,campaignFile:basename(file),files:entries};
 await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 return manifest;
}
