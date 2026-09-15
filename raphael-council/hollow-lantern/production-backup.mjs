import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {mkdir,writeFile,readdir,readFile,open} from 'node:fs/promises';
import {join,dirname,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {runPodman} from './production-launch.mjs';
import {archiveCampaign,productionPath,inspectProductionPath,hashProductionFile,readProductionJson} from './production-files.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
async function dumpPodman(args,destination,{env=process.env,spawnImpl=spawn,timeoutMs=300000}={}){
 await inspectProductionPath(dirname(destination),{directory:true});
 const output=createWriteStream(destination,{flags:'wx',mode:0o600});
 const child=spawnImpl('podman',args,{windowsHide:true,env,stdio:['ignore','pipe','ignore']});
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('dump failed')));});
 const timer=setTimeout(()=>child.kill(),timeoutMs);
 try{await Promise.all([pipeline(child.stdout,output),finished]);}catch{fail('PRODUCTION_DATABASE_EXPORT_FAILED');}finally{clearTimeout(timer);}
}
/** Only the named canonical containers are addressed. Passwords travel through
 * child environment inheritance, never arguments, logs or the backup manifest. */
export function createCanonicalDatabaseExporters({databaseUrl,redisUrl,run=runPodman,dump=dumpPodman,processEnv=process.env}={}){
 const pg=new URL(databaseUrl),redis=new URL(redisUrl),user=decodeURIComponent(pg.username),database=decodeURIComponent(pg.pathname.slice(1));
 if(!['postgres:','postgresql:'].includes(pg.protocol)||!['redis:','rediss:'].includes(redis.protocol)||!/^\w{1,63}$/.test(user)||!/^\w{1,63}$/.test(database))fail('PRODUCTION_DATABASE_CONFIGURATION_INVALID');
 return {
  async capturePostgres(destination){
   productionPath(destination);await dump(['exec','--env','PGPASSWORD','davy-postgres','pg_dump','--format=custom','--no-owner','--username',user,'--dbname',database],destination,{env:{...processEnv,PGPASSWORD:decodeURIComponent(pg.password)}});
   return {container:'davy-postgres',verified:true};
  },
  async captureRedis(destination){
   productionPath(destination);await inspectProductionPath(dirname(destination),{directory:true});
   const temporary=`/tmp/ops-dnd-${randomUUID()}.rdb`,env={...processEnv,REDISCLI_AUTH:decodeURIComponent(redis.password)};
   // Reserve a new destination before Podman copies the completed RDB.
   await writeFile(destination,'',{flag:'wx',mode:0o600});
   try{await run(['exec','--env','REDISCLI_AUTH','davy-redis','redis-cli','--rdb',temporary],{env,timeoutMs:300000});await run(['cp',`davy-redis:${temporary}`,destination],{timeoutMs:300000});}
   finally{await run(['exec','davy-redis','rm','-f',temporary]).catch(()=>{});}
   return {container:'davy-redis',verified:true};
  }
 };
}
export async function backupSqlite(source,destination){
 await inspectProductionPath(source);await inspectProductionPath(dirname(destination),{directory:true});
 // Exclusive target creation is checked before SQLite's online backup operation.
 await writeFile(destination,'',{flag:'wx',mode:0o600});
 const db=new DatabaseSync(source,{readOnly:true});
 try{await sqliteBackup(db,destination);}finally{db.close();}
 const check=new DatabaseSync(destination,{readOnly:true});try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('PRODUCTION_SQLITE_BACKUP_INVALID');}finally{check.close();}
}
async function tree(root){
 await inspectProductionPath(root,{directory:true});const files=[];
 for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())files.push(...await tree(path));else{await inspectProductionPath(path);files.push(path);}}
 return files;
}
/** The coordinator must drain ALL writers (including browser OAuth) at one cut.
 * Missing quiescence or database exporters is a hard failure, never a partial success. */
export function createProductionBackup({descriptor,backupRoot,quiesce,capturePostgres,captureRedis,sqliteFiles,protectedFiles,assetDirectories=[],onlineBackup=backupSqlite,now=Date.now}={}){
 productionPath(backupRoot);
 if(!descriptor?.campaignId||typeof quiesce!=='function'||typeof capturePostgres!=='function'||typeof captureRedis!=='function'||!Array.isArray(sqliteFiles)||!sqliteFiles.length||!Array.isArray(protectedFiles)||!protectedFiles.length)fail('PRODUCTION_BACKUP_INTEGRATION_REQUIRED');
 let flight;
 async function capture(reason){
  if(!['scheduled','predeploy','mission-complete','manual'].includes(reason))fail('PRODUCTION_BACKUP_REASON_INVALID');
  const lease=await quiesce();
  if(lease?.campaignId!==descriptor.campaignId||(lease.held!==true&&lease.allWritersStopped!==true)||lease.writersDrained!==true||!Number.isSafeInteger(lease.revision)||!Number.isSafeInteger(lease.authorityEpoch)||typeof lease.verify!=='function'||typeof lease.release!=='function')fail('PRODUCTION_BACKUP_QUIESCENCE_UNVERIFIED');
  const name=`backup-${new Date(now()).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`,destination=join(backupRoot,name);let complete=false;
  try{
   await mkdir(backupRoot,{recursive:true});await inspectProductionPath(backupRoot,{directory:true});await mkdir(destination);
   await archiveCampaign({file:descriptor.storeFile,destination:join(destination,'campaign'),reason});
   const sources=new Set(),catalog=[];
   async function copied(source,category,index){
    productionPath(source);if(sources.has(source))return;sources.add(source);
    const target=join(destination,category,String(index));await mkdir(dirname(target),{recursive:true});
    if(category==='sqlite')await onlineBackup(source,target);else await hashProductionFile(source,{destination:target});
    catalog.push({source,file:relative(destination,target),kind:category,...await hashProductionFile(target)});
   }
   for(const [index,source]of sqliteFiles.entries())await copied(source,'sqlite',index);
   for(const [index,source]of protectedFiles.entries())await copied(source,'protected',index);
   let index=0;for(const root of assetDirectories)for(const source of await tree(root))await copied(source,'assets',index++);
   const postgres=join(destination,'postgres.dump'),redis=join(destination,'redis.rdb');
   const pg=await capturePostgres(postgres),rd=await captureRedis(redis);
   if(pg?.container!=='davy-postgres'||pg.verified!==true||rd?.container!=='davy-redis'||rd.verified!==true)fail('PRODUCTION_DATABASE_BACKUP_UNVERIFIED');
   for(const [file,magic]of [[postgres,'PGDMP'],[redis,'REDIS']]){await inspectProductionPath(file);const handle=await open(file,'r');try{const bytes=Buffer.alloc(5);await handle.read(bytes,0,5,0);if(bytes.toString()!==magic)fail('PRODUCTION_DATABASE_BACKUP_INVALID');}finally{await handle.close();}}
   const proof=await lease.verify();if((proof?.held!==true&&proof?.allWritersStopped!==true)||proof.revision!==lease.revision||proof.authorityEpoch!==lease.authorityEpoch||proof.writersDrained!==true)fail('PRODUCTION_BACKUP_CUT_CHANGED');
   const files=[];for(const path of await tree(destination))files.push({file:relative(destination,path),...await hashProductionFile(path)});
   const manifest={kind:'ops-dnd-consistent-backup',version:1,campaignId:descriptor.campaignId,createdUtc:new Date(now()).toISOString(),reason,revision:lease.revision,authorityEpoch:lease.authorityEpoch,consistency:lease.allWritersStopped===true?'offline-all-writers-stopped':'held-and-drained',files,catalog,retention:{daily:7,weekly:4}};
   await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});complete=true;
   return {status:'complete',destination,manifest};
  }finally{
   // The lease restores the exact prior human pause state; it must never set play running.
   await lease.release({backupComplete:complete});
  }
 }
 function run(reason='manual'){if(flight)return flight;flight=capture(reason).finally(()=>{flight=null;});return flight;}
 return Object.freeze({run,predeploy:()=>run('predeploy'),afterMission:()=>run('mission-complete')});
}
export function createBackupSchedule({backup,onFailure=()=>{},setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
 if(typeof backup?.run!=='function')fail('PRODUCTION_BACKUP_INTEGRATION_REQUIRED');let flight,closed=false;
 const timer=setIntervalImpl(()=>{if(!closed&&!flight)flight=backup.run('scheduled').catch(()=>onFailure({code:'PRODUCTION_BACKUP_FAILED'})).finally(()=>{flight=null;});},900000);timer.unref?.();
 return {async close(){closed=true;clearIntervalImpl(timer);await flight;}};
}
/** Retention decisions only: callers may remove verified, owned completed backups.
 * Incomplete directories and unknown files are never deletion candidates. */
export function selectBackupRetention(entries,{campaignId,now=Date.now()}={}){
 const completed=entries.filter(e=>e?.manifest?.kind==='ops-dnd-consistent-backup'&&e.manifest.campaignId===campaignId&&Number.isFinite(Date.parse(e.manifest.createdUtc))).sort((a,b)=>Date.parse(b.manifest.createdUtc)-Date.parse(a.manifest.createdUtc));
 const keep=new Set(),days=new Set(),weeks=new Set();
 for(const e of completed){const at=Date.parse(e.manifest.createdUtc),day=Math.floor(at/86400000),week=Math.floor(day/7);if(now-at<86400000||days.size<7&&!days.has(day)||weeks.size<4&&!weeks.has(week)){keep.add(e);days.add(day);weeks.add(week);}}
 return {keep:[...keep],remove:completed.filter(e=>!keep.has(e))};
}

/** Offline production export requires renewed, external process/database writer
 * evidence before and after capture. The proof callback must inspect real owners. */
export function createOfflineProductionBackup({verifyStopped,...options}={}){
 if(typeof verifyStopped!=='function')fail('PRODUCTION_OFFLINE_WRITER_PROOF_REQUIRED');
 return createProductionBackup({...options,quiesce:async()=>{
  const proof=await verifyStopped();
  if(proof?.kind!=='ops-dnd-offline-writers-proof'||proof.allWritersStopped!==true||proof.writersDrained!==true)fail('PRODUCTION_OFFLINE_WRITER_PROOF_REQUIRED');
  return {...proof,verify:verifyStopped,release:async()=>{}};
 }});
}
export async function validateProductionBackup({directory,campaignId}={}){
 await inspectProductionPath(directory,{directory:true});
 const manifest=await readProductionJson(join(directory,'manifest.json'),8388608);
 if(manifest.kind!=='ops-dnd-consistent-backup'||manifest.version!==1||manifest.campaignId!==campaignId||!Array.isArray(manifest.files)||!manifest.files.length)fail('PRODUCTION_BACKUP_INVALID');
 const seen=new Set();for(const entry of manifest.files){
  if(typeof entry.file!=='string'||entry.file.startsWith('/')||entry.file.includes('..')||/^[A-Za-z]:/.test(entry.file)||seen.has(entry.file))fail('PRODUCTION_BACKUP_INVALID');seen.add(entry.file);
  const actual=await hashProductionFile(join(directory,entry.file));if(actual.sha256!==entry.sha256||actual.bytes!==entry.bytes)fail('PRODUCTION_BACKUP_INVALID');
 }
 const actualFiles=(await tree(directory)).map(p=>relative(directory,p)).filter(p=>p!=='manifest.json');
 if(actualFiles.length!==seen.size||actualFiles.some(p=>!seen.has(p)))fail('PRODUCTION_BACKUP_INVALID');
 for(const entry of manifest.catalog??[])if(entry.kind==='sqlite'){
  if(!seen.has(entry.file))fail('PRODUCTION_BACKUP_INVALID');
  const db=new DatabaseSync(join(directory,entry.file),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('PRODUCTION_BACKUP_INVALID');}finally{db.close();}
 }
 return {status:'verified',campaignId,revision:manifest.revision,files:manifest.files.length,restoreRehearsed:false};
}
