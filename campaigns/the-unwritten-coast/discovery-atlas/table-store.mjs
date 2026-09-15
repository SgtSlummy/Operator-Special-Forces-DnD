import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {tableProject,tableAction} from './table-model.mjs';

// One authority, shared by browser and Discord. Transport code never gets raw state.
export async function openTableStore({catalog,stateFile,seed}){
 const file=resolve(stateFile);
 if(/(^|[\\/])OneDrive([\\/]|$)/i.test(file))throw Error('Use a local data folder.');
 await mkdir(dirname(file),{recursive:true});
 const lockFile=file+'.lock',lease=randomUUID();
 let lock;
 try{lock=await open(lockFile,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;
  throw Error('This table already has a writer reservation. Close its owner or recover the stopped reservation first.');
 }
 await lock.writeFile(JSON.stringify({pid:process.pid,lease}));await lock.close();
 const release=async()=>{try{const current=JSON.parse(await readFile(lockFile,'utf8'));if(current.lease===lease)await unlink(lockFile);}catch(e){if(e.code!=='ENOENT')throw e;}};
 let state;
 try{try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=seed();}
  if(!state.table||!state.roomIds||!Number.isInteger(state.revision))throw Error('Invalid campaign table state.');
 }catch(e){await release();throw e;}
 let queue=Promise.resolve(),closed=false;const listeners=new Set();
 const view=(identity={role:'shared'})=>{if(closed)throw Error('Table is closed.');return tableProject(catalog,state,identity);};
 const execute=(identity,action,{commandId}={})=>{
  if(closed)return Promise.reject(Error('Table is closed.'));
  const actor=structuredClone(identity),input=structuredClone(action);
  const task=queue.then(async()=>{
   const scope=actor.role==='gm'?'gm':actor.role==='player'?`player:${actor.actorId}`:'shared';
   if(commandId!==undefined&&!(typeof commandId==='string'&&/^[A-Za-z0-9:_-]{1,100}$/.test(commandId)))throw Error('Invalid command identifier.');
   const fingerprint=createHash('sha256').update(JSON.stringify({scope,input})).digest('hex');
   const receipts=state.table.transportReceipts??[];
   const prior=commandId&&receipts.find(r=>r.id===commandId);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('That command identifier belongs to a different action.');return {...prior.result,replayed:true};}
   const next=tableAction(catalog,state,actor,input),result={revision:next.revision};
   if(commandId)next.table.transportReceipts=[...receipts,{id:commandId,fingerprint,result}].slice(-500);
   const tmp=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(tmp,JSON.stringify(next,null,2),{flag:'wx'});await rename(tmp,file);}catch(e){await unlink(tmp).catch(()=>{});throw e;}
   state=next;
   for(const listener of listeners){try{Promise.resolve(listener({revision:next.revision})).catch(()=>{});}catch{}}
   return result;
  });queue=task.catch(()=>{});return task;
 };
 return {view,execute,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},async close(){if(closed)return;closed=true;await queue;listeners.clear();await release();}};
}
