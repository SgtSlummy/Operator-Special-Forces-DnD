import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,parse,relative,join} from 'node:path';
import {productionPath} from './production-files.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Error('CAMPAIGN_SUMMARY_INVALID');};

/** Metadata only. Engine startup validates checkpoint/tail; archive descendants validate on lookup. */
export function readCampaignSummary(file){
 const path=productionPath(file);let cursor=parse(path).root;
 for(const part of relative(cursor,path).split(/[/\\]/).filter(Boolean)){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())fail();}
 const info=lstatSync(path);
 if(!info.isFile()||info.nlink!==1||info.size>128*1024*1024||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())fail();
 const bytes=readFileSync(path);if(bytes.length>128*1024*1024)fail();
 const raw=bytes.toString('utf8'),envelope=JSON.parse(raw);
 if(envelope.contract==='lantern-storage-v2'){
  if(bytes.length>65536)fail();
  const seal=/,"sha256":"([a-f0-9]{64})"}$/.exec(raw);
  if(!seal||hash(raw.slice(0,seal.index)+'}')!==seal[1]||envelope.storageVersion!==2||!Array.isArray(envelope.members)||envelope.members.length>101||!Number.isSafeInteger(envelope.sequence)||envelope.sequence<0||!Number.isSafeInteger(envelope.revision)||envelope.revision<0||typeof envelope.decisionOpen!=='boolean'||!Number.isSafeInteger(envelope.authorityEpoch)||envelope.authorityEpoch<0)fail();
  if(!/^[a-f0-9]{32}$/.test(envelope.journalId??'')||!['checkpoint','tip','indexRoot'].every(key=>/^[a-f0-9]{64}$/.test(envelope[key]??'')))fail();
  if(new Set(envelope.members.map(m=>m?.ownerId)).size!==envelope.members.length||envelope.members.some(m=>typeof m.ownerId!=='string'||!m.ownerId||m.ownerId.length>128||!['gm','player'].includes(m.role))||envelope.members.filter(m=>m.role==='gm').length!==1||!envelope.members.some(m=>m.role==='gm'&&m.ownerId===envelope.gmId))fail();
  return {bytes,envelope,state:{version:2,storageVersion:2,campaignId:envelope.campaignId,channelId:envelope.channelId,gmId:envelope.gmId,revision:envelope.revision,decisionOpen:envelope.decisionOpen,authorityEpoch:envelope.authorityEpoch,directorMode:envelope.directorMode,aiDirectorId:envelope.aiDirectorId,productionVersion:envelope.productionVersion,runRequested:envelope.runRequested,actors:envelope.members.filter(m=>m.role==='player').map(m=>({team:'party',ownerId:m.ownerId}))}};
 }
 if(typeof envelope.body!=='string'||hash(envelope.body)!==envelope.sha256)fail();
 const state=JSON.parse(envelope.body);if(state.version!==2||!Array.isArray(state.actors))fail();return {bytes,envelope,state};
}
