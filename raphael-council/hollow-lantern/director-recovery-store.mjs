import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdir,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,dirname} from 'node:path';
const CONTRACT='hollow-director-recovery-v1';
const fail=()=>{throw new Error('DIRECTOR_RECOVERY_REQUIRED');};
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail();};
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const local=path=>!path.split(/[\\/]/).some(part=>/^onedrive(?:$|[ -])/i.test(part));
function commandCopy(value,production=false){
 exact(value,['ownerId','actorId','commandId','expectedRevision','authorityEpoch','type','payload']);
 if(production&&['gm_decision','move','attack','end_turn'].includes(value.type)){
  if(!/^ai-director:[A-Za-z0-9_.:-]{1,116}$/.test(value.ownerId)||!/^director:[a-f0-9]{48}$/.test(value.commandId)||!integer(value.expectedRevision)||!integer(value.authorityEpoch))fail();
  const payload=value.payload;
  if(value.type==='gm_decision'){exact(payload,['open']);if(value.actorId!==''||typeof payload.open!=='boolean')fail();}
  else{
   if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(value.actorId))fail();
   if(value.type==='move'){exact(payload,['x','y']);if(![payload.x,payload.y].every(n=>Number.isInteger(n)&&n>=0&&n<=24))fail();}
   if(value.type==='attack'){exact(payload,['targetId','weaponId']);if(![payload.targetId,payload.weaponId].every(id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)))fail();}
   if(value.type==='end_turn')exact(payload,[]);
  }
  return structuredClone(value);
 }
 exact(value.payload,['pendingId','approved','text']);
 if(!/^ai-director:[A-Za-z0-9_.:-]{1,116}$/.test(value.ownerId)||value.actorId!==''||!/^director:[a-f0-9]{48}$/.test(value.commandId)||!integer(value.expectedRevision)||!integer(value.authorityEpoch)||value.type!=='gm_resolve'||typeof value.payload.pendingId!=='string'||!value.payload.pendingId||value.payload.pendingId.length>128||typeof value.payload.approved!=='boolean'||typeof value.payload.text!=='string'||!value.payload.text.trim()||value.payload.text.length>1500)fail();
 return {ownerId:value.ownerId,actorId:'',commandId:value.commandId,expectedRevision:value.expectedRevision,authorityEpoch:value.authorityEpoch,type:'gm_resolve',payload:{pendingId:value.payload.pendingId,approved:value.payload.approved,text:value.payload.text}};
}
const digest=(campaignId,command)=>createHash('sha256').update(JSON.stringify([campaignId,command])).digest('hex');
const encode=(campaignId,command)=>JSON.stringify({contract:CONTRACT,campaignId,command,digest:digest(campaignId,command)});
function decode(text,campaignId,production=false){
 if(typeof text!=='string'||Buffer.byteLength(text)>16384)fail();
 const value=JSON.parse(text);exact(value,['contract','campaignId','command','digest']);
 if(value.contract!==CONTRACT||value.campaignId!==campaignId)fail();
 const command=value.command===null?null:commandCopy(value.command,production);
 if(value.digest!==digest(campaignId,command))fail();
 return command;
}
/** A single immutable pending slot. SQLite owns crash-released locks and atomic FULL-synchronous commits. */
export async function openDirectorRecoveryStore({file,campaignId,production=false}){
 if(typeof production!=='boolean')fail();
 if(!isAbsolute(file??'')||!local(resolve(file))||typeof campaignId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(campaignId))fail();
 file=resolve(file);await mkdir(dirname(file),{recursive:true});if(!local(await realpath(dirname(file))))fail();
 let existed=true;try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)fail();}catch(error){if(error.code!=='ENOENT')throw error;existed=false;try{await lstat(file+'.bak');fail();}catch(backup){if(backup.code!=='ENOENT')throw backup;}}
 function connect(){const db=new DatabaseSync(file);try{db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;');return db;}catch(error){db.close();throw error;}}
 function read(db){const rows=db.prepare('SELECT id,record FROM director_journal').all();if(rows.length!==1||rows[0].id!==1)fail();decode(rows[0].record,campaignId,production);return rows[0].record;}
 let baseline;const initial=connect();try{
  initial.exec('BEGIN IMMEDIATE');
  if(!existed){initial.exec('CREATE TABLE IF NOT EXISTS director_journal(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL)');initial.prepare('INSERT OR IGNORE INTO director_journal(id,record) VALUES(1,?)').run(encode(campaignId,null));}
  baseline=read(initial);initial.exec('COMMIT');
 }finally{initial.close();}
 let pending=decode(baseline,campaignId,production);
 function persist(next){
  const db=connect();try{
   db.exec('BEGIN IMMEDIATE');if(read(db)!==baseline)fail();
   const encoded=encode(campaignId,next);db.prepare('UPDATE director_journal SET record=? WHERE id=1').run(encoded);db.exec('COMMIT');
   baseline=encoded;pending=next;
  }finally{db.close();}
 }
 return Object.freeze({
  get:()=>structuredClone(pending),
  async save(command){const next=commandCopy(command,production);if(pending!==null)fail();persist(next);},
  async clear(commandId){if(!pending||pending.commandId!==commandId)fail();persist(null);},
 });
}
