import {readFile,writeFile,rename,copyFile,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

// Controller-only recovery records. Screenshots, model history and GM material
// never enter this file. A missing receipt is not evidence that execution failed.
export async function openVisualActionStore({file,campaignId,actors}){
 if(!isAbsolute(file??'')||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(file)||!campaignId)throw Error('VISUAL_ACTION_STORE_REQUIRED');
 let entries={},opportunities=[],window=null,tail=Promise.resolve();
 const valid=(actorId,p)=>actors.some(a=>a.actorId===actorId)&&p?.actorId===actorId&&p.campaignId===campaignId&&/^[a-f0-9-]{36}$/.test(p.commandId??'')&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0&&Object.keys(p).length===4;
 try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.contract!=='hollow-visual-actions-v1'||saved.campaignId!==campaignId||!saved.entries||Array.isArray(saved.entries)||Object.entries(saved.entries).some(([a,p])=>!valid(a,p))||!Array.isArray(saved.opportunities)||saved.opportunities.length>4096||saved.opportunities.some(id=>typeof id!=='string'||!id||id.length>100))throw Error('VISUAL_ACTION_STORE_INVALID');entries=saved.entries;opportunities=saved.opportunities;window=saved.window??null;if(window&&!validWindow(window))throw Error("VISUAL_WINDOW_INVALID");}
 catch(error){if(error.code!=='ENOENT')throw error;try{await readFile(file+'.bak');throw Error('VISUAL_ACTION_STORE_RECOVERY_REQUIRED');}catch(backup){if(backup.code!=='ENOENT')throw backup;}}
 function validWindow(w){return w&&typeof w.id==="string"&&Number.isSafeInteger(w.deadline)&&Number.isInteger(w.maxActions)&&w.maxActions>=1&&w.maxActions<=3&&Number.isInteger(w.maxChoices)&&w.maxChoices>=1&&w.maxChoices<=64&&typeof w.closed==="boolean"&&Array.isArray(w.actions)&&w.actions.length<=w.maxActions&&Array.isArray(w.choices)&&w.choices.length<=w.maxChoices&&[...w.actions,...w.choices].every(x=>actors.some(a=>a.actorId===x.actorId)&&/^[a-f0-9-]{36}$/.test(x.commandId??""));}
 async function persist(next,started,nextWindow=window){await mkdir(dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({contract:'hollow-visual-actions-v1',campaignId,entries:next,opportunities:started,window:nextWindow}),{flag:'wx'});try{await copyFile(file,file+'.bak');}catch(error){if(error.code!=='ENOENT')throw error;}await rename(tmp,file);entries=next;opportunities=started;window=nextWindow;}
 function serialize(work){const task=tail.catch(()=>{}).then(work);tail=task;return task;}
 return {getOpportunity:()=>structuredClone(window),async beginOpportunity(record){return serialize(async()=>{if(!validWindow(record)||window&&!window.closed)throw Error('VISUAL_WINDOW_INVALID');await persist(structuredClone(entries),[...opportunities],structuredClone(record));});},async closeOpportunity(id){return serialize(async()=>{if(window?.id===id&&!window.closed)await persist(structuredClone(entries),[...opportunities],{...window,closed:true});});},async reserveCommand(id,actorId,commandId,choice=false){return serialize(async()=>{if(!window||window.id!==id||window.closed||Date.now()>=window.deadline)throw Error('VISUAL_WINDOW_CLOSED');const next=structuredClone(window),list=choice?next.choices:next.actions;if([...next.actions,...next.choices].some(x=>x.commandId===commandId))return; if(list.length>=(choice?next.maxChoices:next.maxActions)||!choice&&list.some(x=>x.actorId===actorId))throw Error('VISUAL_WINDOW_BUDGET');list.push({actorId,commandId});if(!validWindow(next))throw Error('VISUAL_WINDOW_INVALID');await persist(structuredClone(entries),[...opportunities],next);});},get:actorId=>structuredClone(entries[actorId]??null),async reserveOpportunity(id){
  if(typeof id!=='string'||!id||id.length>100)throw Error('VISUAL_OPPORTUNITY_INVALID');
  return serialize(async()=>{if(opportunities.includes(id))return false;if(opportunities.length>=4096)throw Error('VISUAL_OPPORTUNITY_STORE_FULL');await persist(structuredClone(entries),[...opportunities,id]);return true;});
 },async set(actorId,pending){
  if(!actors.some(a=>a.actorId===actorId)||pending!==null&&!valid(actorId,pending))throw Error('VISUAL_ACTION_STORE_INVALID');
  return serialize(async()=>{const next=structuredClone(entries);if(pending===null)delete next[actorId];else next[actorId]=structuredClone(pending);await persist(next,[...opportunities]);});
 }};
}
