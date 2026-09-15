import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {EngineError} from './engine-client.mjs';

const fail=(code,message,status=409)=>{throw new EngineError(code,message,status);};
const choices=['fighter','rogue','cleric'];
export function validAdmissionInput(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&Object.keys(value).every(k=>['presetId','name','edition'].includes(k))&&choices.includes(value.presetId)&&value.edition==='2024'&&typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=80&&!/[\x00-\x1f\x7f]/.test(value.name);}

/** One native owner. Reservations precede engine calls; uncertain identities survive restart. */
export function createAdmissionService({engine,dbPath,gmUserId,authorize,seatLimit=100,onCommitted=async()=>{},now=Date.now}){
 if(!engine?.project||!engine?.command||!gmUserId||typeof authorize!=='function'||!dbPath||!Number.isInteger(seatLimit)||seatLimit<1||seatLimit>100)throw Error('Admission configuration required.');
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS admission(campaign TEXT NOT NULL,owner TEXT NOT NULL,character TEXT NOT NULL UNIQUE,preset TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,intent TEXT,PRIMARY KEY(campaign,owner));`);
 let flight,closed=false,recoveryHeld=typeof engine.recovery==='function';
 const row=owner=>db.prepare('SELECT * FROM admission WHERE campaign=? AND owner=?').get(engine.campaignId,owner);
 const update=(owner,status,intent=null)=>db.prepare('UPDATE admission SET status=?,intent=? WHERE campaign=? AND owner=?').run(status,intent&&JSON.stringify(intent),engine.campaignId,owner);
 async function auth(scope){if(closed||scope?.campaignId!==engine.campaignId||!/^\d{17,20}$/.test(scope.userId??'')||!await authorize(scope))fail('ACCESS_DENIED','Current campaign membership is required.',403);}
 const view=r=>({status:r?.status??'available',characterId:r?.character??null,name:r?.name??null,presetId:r?.preset??null,presets:[...choices],capacity:100,admissionLimit:seatLimit});
 const roster=p=>(p.characters??[]).filter(c=>c.characterType==='player');
 async function status(scope){await auth(scope);const r=row(scope.userId),result=view(r);if(!r&&db.prepare('SELECT COUNT(*) AS count FROM admission WHERE campaign=?').get(engine.campaignId).count>=seatLimit)result.status='full';await auth(scope);return result;}
 async function join(scope,input){
  await auth({...scope,freshMembership:true});if(!validAdmissionInput(input))fail('INVALID_INPUT','Choose a supported 2024 preset and a name up to 80 characters.',400);
  const p=await engine.project({ownerId:gmUserId,audience:'gm'});await auth(scope);
  const owned=roster(p).filter(c=>c.ownerId===scope.userId);if(owned.length>1)fail('ROSTER_CONFLICT','The GM must reconcile your existing characters.');
  db.exec('BEGIN IMMEDIATE');try{
   if(!row(scope.userId)){
    const reservations=db.prepare('SELECT owner FROM admission WHERE campaign=?').all(engine.campaignId);
    const existingOwners=new Set(roster(p).map(c=>c.ownerId));const occupied=roster(p).length+reservations.filter(r=>!existingOwners.has(r.owner)).length;
    if(!owned.length&&occupied>=seatLimit)fail('PLAYER_CAPACITY',`This release has reserved all ${seatLimit} available seats.`);
    db.prepare('INSERT INTO admission VALUES(?,?,?,?,?,?,?,?)').run(engine.campaignId,scope.userId,owned[0]?.characterId??`player-${randomUUID()}`,input.presetId,input.name.trim(),owned.length?'enrolled':'waiting',now(),null);
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  await drain();return status(scope);
 }
 function health(){if(closed)return {state:'closed'};const counts=Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS count FROM admission WHERE campaign=? GROUP BY status').all(engine.campaignId).map(r=>[r.status,r.count]));return {state:closed?'closed':recoveryHeld?'recovery_held':'ready',reserved:Object.values(counts).reduce((a,b)=>a+b,0),waiting:counts.waiting??0,uncertain:counts.recovering??0,enrolled:counts.enrolled??0,needsGm:counts.needs_gm??0};}
 async function reconcileReceipts(){
  for(const r of db.prepare("SELECT * FROM admission WHERE campaign=? AND status='recovering' AND intent IS NOT NULL").all(engine.campaignId)){
   const intent=JSON.parse(r.intent);try{const receipt=await engine.receipt({ownerId:gmUserId,actorId:'',commandId:intent.commandId});if(receipt.commandId===intent.commandId&&receipt.success===true)update(r.owner,'enrolled');}catch{/* Absence is not cancellation proof; keep unknown identity. */}
  }return health();
 }
 async function run(){
  if(typeof engine.recovery==='function'){const gate=await engine.recovery({ownerId:gmUserId,operation:'status'});recoveryHeld=gate.held!==false;if(recoveryHeld){await reconcileReceipts();return;}}
  const waiting=db.prepare("SELECT * FROM admission WHERE campaign=? AND status IN ('waiting','recovering') ORDER BY created,owner").all(engine.campaignId);
  if(!waiting.length)return;
  const initial=await engine.project({ownerId:gmUserId,audience:'gm'});
  if((initial.decisionOpen!==false||initial.phase==='combat'||initial.rollPending||(initial.pendingActions??[]).length)&&!waiting.some(r=>r.intent))return;
  for(const r of waiting){
   if(closed)return;
   const scope={campaignId:engine.campaignId,userId:r.owner};
   if(!await authorize(scope))continue;
   let intent=r.intent&&JSON.parse(r.intent);
   if(intent){
    // A missing receipt alone is not proof of non-delivery. Retry exactly the durable identity.
    try{const receipt=await engine.command(intent);update(r.owner,'enrolled');await Promise.resolve().then(()=>onCommitted({scope,receipt})).catch(()=>{});continue;}
    catch(error){if(error.code==='STALE_REVISION'){update(r.owner,'waiting');intent=null;}else {update(r.owner,'recovering',intent);continue;}}
   }
   const p=await engine.project({ownerId:gmUserId,audience:'gm'});
   const owned=roster(p).filter(c=>c.ownerId===r.owner);
   if(owned.length){if(owned.length===1&&owned[0].characterId===r.character)update(r.owner,'enrolled');else update(r.owner,'needs_gm');continue;}
   if(p.decisionOpen!==false||p.phase==='combat'||p.rollPending||(p.pendingActions??[]).length)continue;
   if(!await authorize(scope))continue;
   intent={ownerId:gmUserId,actorId:'',commandId:randomUUID(),expectedRevision:p.revision,type:'gm_add_player',payload:{characterId:r.character,ownerId:r.owner,presetId:r.preset,name:r.name}};
   update(r.owner,'recovering',intent);
   try{const receipt=await engine.command(intent);update(r.owner,'enrolled');await Promise.resolve().then(()=>onCommitted({scope,receipt})).catch(()=>{});}
   catch(error){if(['STALE_REVISION','ENROLLMENT_CLOSED'].includes(error.code))update(r.owner,'waiting');else if(['INVALID_INPUT','PLAYER_CAPACITY','EQUIPMENT_MIGRATION_REQUIRED','SCENE_CAPACITY'].includes(error.code))update(r.owner,'needs_gm');}
  }
 }
 function drain(){if(closed)return Promise.resolve();if(!flight)flight=run().finally(()=>{flight=null;});return flight;}
 return Object.freeze({status,join,drain,health,reconcileReceipts,async close(){closed=true;await flight;db.close();}});
}
