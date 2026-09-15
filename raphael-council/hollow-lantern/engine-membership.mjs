import {readFileSync,statSync,realpathSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {readCampaignSummary} from './campaign-summary.mjs';

/** Synchronous membership ceiling for Chronicle's commit guards.
 * Reads Unity's committed cache and adopted journal tip on EVERY check.
 * No backup fallback, game database, mechanics or write method is exposed here.
 */
export function createEngineMembership({file,campaignId,channelId}){
 if(!isAbsolute(file??'')||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(file)||typeof campaignId!=='string'||typeof channelId!=='string')throw new Error('Invalid Unity membership source.');
 const path=realpathSync(file);let closed=false,journalRequired=false,observedJournal=null;
 if(/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(path))throw new Error('Unity membership must remain local.');
 const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
 function journal(envelope,state){
  const markers=['journalRequired','journalId','journalSequence','journalHash'];
  journalRequired=journalRequired||markers.some(key=>Object.hasOwn(envelope,key))||existsSync(path+'.wal.meta')||existsSync(path+'.wal');
  if(!journalRequired)return;
  try{
   const walStat=statSync(path+'.wal'),metaStat=statSync(path+'.wal.meta');
   if(!walStat.isFile()||walStat.size===0||!metaStat.isFile()||metaStat.size>16384)throw new Error();
   const raw=readFileSync(path+'.wal.meta','utf8');
   // LanternStore seals compact JSON with the checksum as its final property.
   // Hash those exact bytes, avoiding cross-language Unicode reserialization.
   const seal=/,"sha256":"([a-f0-9]{64})"}$/.exec(raw);
   if(!seal||digest(raw.slice(0,seal.index)+'}')!==seal[1])throw new Error();
   const meta=JSON.parse(raw);
   if(Object.keys(meta).length!==8||meta.contract!=='lantern-state-wal-v1'||!/^[a-f0-9]{32}$/.test(meta.journalId)||!Number.isSafeInteger(meta.sequence)||meta.sequence<1||!/^[a-f0-9]{64}$/.test(meta.hash)||meta.campaignId!==campaignId||meta.channelId!==channelId||meta.gmId!==state.gmId)throw new Error();
   if(observedJournal&&(meta.journalId!==observedJournal.id||meta.sequence<observedJournal.sequence||meta.sequence===observedJournal.sequence&&meta.hash!==observedJournal.hash))throw new Error();
   observedJournal={id:meta.journalId,sequence:meta.sequence,hash:meta.hash};
   if(envelope.journalRequired!==true||envelope.journalId!==meta.journalId||envelope.journalSequence!==meta.sequence||envelope.journalHash!==meta.hash)throw new Error();
  }catch{throw new Error('Unity journal authority is unavailable or the save is behind its durable tip.');}
 }
 function current(){
  if(closed)throw new Error('Membership is closed.');
  let selected;try{selected=readCampaignSummary(path);}catch(error){if(error.code)throw error;throw new Error('Uncommitted Unity save.');}
  const {state,envelope,bytes}=selected;
  if(state.version!==2||state.campaignId!==campaignId||state.channelId!==channelId||typeof state.gmId!=='string'||!Array.isArray(state.actors))throw new Error('Unity campaign binding changed.');
  // Read the tip after the cache so a concurrent journal advance denies stale access.
  if(state.storageVersion===2){
   if(observedJournal&&(envelope.journalId!==observedJournal.id||envelope.sequence<observedJournal.sequence||envelope.sequence===observedJournal.sequence&&envelope.sha256!==observedJournal.hash))throw new Error('Unity journal authority moved backwards.');
   if(!readFileSync(path).equals(bytes))throw new Error('Unity membership changed during verification.');
   observedJournal={id:envelope.journalId,sequence:envelope.sequence,hash:envelope.sha256};journalRequired=true;
  }else journal(envelope,state);
  return state;
 }
 current();
 // Authentication needs to distinguish unavailable authority from a valid save
 // with no seat. Existing Chronicle guards retain their fail-closed null result.
 function readMember({campaign,owner}){
  if(campaign!==campaignId||typeof owner!=='string')return null;
  const state=current();
  if(state.gmId===owner)return 'host';
  return state.actors.some(a=>a.team==='party'&&a.ownerId===owner)?'player':null;
 }
 return Object.freeze({
  hasCampaign(id){try{return id===campaignId&&Boolean(current());}catch{return false;}},
  readMember,
  member(scope){try{return readMember(scope);}catch{return null;}},
  close(){closed=true;},
 });
}
