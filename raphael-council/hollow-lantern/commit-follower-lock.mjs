import {open,readFile,mkdir,realpath,lstat,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function regularFile(path){
 try{const stat=await lstat(path);if(!stat.isFile()||stat.nlink!==1)fail('COMMIT_FOLLOWER_LOCK_UNSAFE');return stat;}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function unlinkRecord(path,expected){
 for(let attempt=0;;attempt++){
  try{
   if(!await regularFile(path))return;
   if(await readFile(path,'utf8')!==expected)fail('COMMIT_FOLLOWER_LOCKED');
   await unlink(path);return;
  }catch(error){
   if(!['EBUSY','EPERM'].includes(error.code)||attempt===4)throw error;
   // Windows scanners can briefly hold a closed file. Revalidate on every retry.
   await delay(25*(attempt+1));
  }
 }
}
async function mutex(identity){
 const server=createServer(socket=>socket.destroy());let lost=false;
 server.on('error',()=>{lost=true;});server.on('close',()=>{lost=true;});
 const address=process.platform==='win32'
  ?{path:`\\\\.\\pipe\\hollow-lantern-commit-${identity}`,exclusive:true}
  :{host:'127.0.0.1',port:49152+Number.parseInt(identity.slice(0,8),16)%16384,exclusive:true};
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,()=>{server.removeListener('error',reject);resolve();});});}
 catch(error){if(error.code==='EADDRINUSE'||error.code==='EACCES')fail('COMMIT_FOLLOWER_LOCKED');throw error;}
 server.unref();
 return {
  assertHeld(){if(lost||!server.listening)fail('COMMIT_FOLLOWER_LOCK_LOST');},
  async close(){if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 };
}

/** A process-lifetime OS mutex serializes protocol-2 owners, including recovery.
 * Legacy, incomplete, remote-host and unverifiable owners require manual review.
 * The record is evidence; neither PID reuse nor elapsed time proves an owner dead.
 */
export async function acquireCommitFollowerLock(cursorFile){
 const requested=resolve(cursorFile);await mkdir(dirname(requested),{recursive:true});
 const cursorPath=join(await realpath(dirname(requested)),basename(requested));
 await regularFile(cursorPath);
 const identity=createHash('sha256').update(process.platform==='win32'?cursorPath.toLowerCase():cursorPath).digest('hex');
 const guard=await mutex(identity),lockFile=cursorPath+'.lock',instance=randomUUID();let owned=false,closed=false;
 const record={protocol:2,hostname:hostname(),identity,pid:process.pid,instance};
 async function removeOwned(){
  const stat=await regularFile(lockFile);if(!stat)return;
  const text=await readFile(lockFile,'utf8');let current;try{current=JSON.parse(text);}catch{return;}
  if(current.protocol===2&&current.instance===instance&&current.identity===identity)await unlinkRecord(lockFile,text);
 }
 try{
  guard.assertHeld();
  const priorStat=await regularFile(lockFile);
  if(priorStat){
   if(priorStat.size>4096)fail('COMMIT_FOLLOWER_LOCKED');
   const priorText=await readFile(lockFile,'utf8');let prior;
   try{prior=JSON.parse(priorText);}catch{fail('COMMIT_FOLLOWER_LOCKED');}
   if(prior?.protocol!==2||prior.hostname!==record.hostname||prior.identity!==identity||!Number.isSafeInteger(prior.pid)||prior.pid<1||!uuid.test(prior.instance??''))fail('COMMIT_FOLLOWER_LOCKED');
   try{process.kill(prior.pid,0);fail('COMMIT_FOLLOWER_LOCKED');}catch(error){if(error.code!=='ESRCH')fail('COMMIT_FOLLOWER_LOCKED');}
   // Archive fully before changing the record. An archive error preserves it.
   const archive=await open(`${lockFile}.abandoned-${randomUUID()}.json`,'wx',0o600);
   try{await archive.writeFile(priorText);await archive.sync();}finally{await archive.close();}
   guard.assertHeld();const currentStat=await regularFile(lockFile);
   if(!currentStat||currentStat.dev!==priorStat.dev||currentStat.ino!==priorStat.ino||await readFile(lockFile,'utf8')!==priorText)fail('COMMIT_FOLLOWER_LOCKED');
   await unlinkRecord(lockFile,priorText);
  }
  const handle=await open(lockFile,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(record));await handle.sync();owned=true;}finally{await handle.close();}
  return Object.freeze({cursorPath,assertHeld:()=>guard.assertHeld(),async close(){
   if(closed)return;closed=true;
   try{if(owned)await removeOwned();}finally{await guard.close();}
  }});
 }catch(error){
  try{if(owned)await removeOwned();}finally{await guard.close();}
  if(error.code==='EEXIST')fail('COMMIT_FOLLOWER_LOCKED');throw error;
 }
}
