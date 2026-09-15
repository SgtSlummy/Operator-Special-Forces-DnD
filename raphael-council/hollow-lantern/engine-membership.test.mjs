import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createEngineMembership} from './engine-membership.mjs';
test('Chronicle membership follows current committed Unity ownership and never revives revoked access from backup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hollow-membership-')),file=join(dir,'campaign.json');
 const state={version:2,campaignId:'fixture',channelId:'channel',gmId:'dm',actors:[{team:'party',ownerId:'player'}]};
 const save=value=>{const body=JSON.stringify(value);writeFileSync(file+'.tmp',JSON.stringify({body,sha256:createHash('sha256').update(body).digest('hex')}));renameSync(file+'.tmp',file);};
 try{save(state);const membership=createEngineMembership({file,campaignId:'fixture',channelId:'channel'});
  assert.equal(membership.member({campaign:'fixture',owner:'dm'}),'host');assert.equal(membership.member({campaign:'fixture',owner:'player'}),'player');
  save({...state,actors:[{team:'party',ownerId:'new-player'}]});assert.equal(membership.member({campaign:'fixture',owner:'player'}),null);assert.equal(membership.member({campaign:'fixture',owner:'new-player'}),'player');
  writeFileSync(file+'.bak',JSON.stringify(state));writeFileSync(file,'corrupt');assert.equal(membership.hasCampaign('fixture'),false);assert.equal(membership.member({campaign:'fixture',owner:'dm'}),null);
  save({...state,channelId:'wrong'});assert.equal(membership.member({campaign:'fixture',owner:'dm'}),null);
  membership.close();save(state);assert.equal(membership.member({campaign:'fixture',owner:'dm'}),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('authentication can distinguish unavailable committed authority from an absent or revoked seat',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hollow-membership-auth-')),file=join(dir,'campaign.json');
 const state={version:2,campaignId:'fixture',channelId:'channel',gmId:'dm',actors:[{team:'party',ownerId:'player'}]};
 const save=value=>{const body=JSON.stringify(value);writeFileSync(file,JSON.stringify({body,sha256:createHash('sha256').update(body).digest('hex')}));};
 const dm={campaign:'fixture',owner:'dm'},player={campaign:'fixture',owner:'player'};
 try{
  save(state);const membership=createEngineMembership({file,campaignId:'fixture',channelId:'channel'});
  assert.equal(membership.readMember(dm),'host');assert.equal(membership.readMember(player),'player');
  assert.equal(membership.readMember({campaign:'fixture',owner:'unseated'}),null);
  assert.equal(membership.readMember({campaign:'other',owner:'dm'}),null);
  const committedBackup=JSON.parse(JSON.stringify(state));
  save({...state,actors:[]});writeFileSync(file+'.bak',JSON.stringify(committedBackup));
  assert.equal(membership.readMember(player),null,'a removed seat is not a storage failure');
  writeFileSync(file,JSON.stringify({body:JSON.stringify(state),sha256:'invalid'}));
  assert.throws(()=>membership.readMember(dm),/Uncommitted Unity save/);
  assert.equal(membership.member(dm),null,'existing guards still deny a bad checksum');
  save({...state,channelId:'wrong'});assert.throws(()=>membership.readMember(dm),/binding changed/);
  rmSync(file);assert.throws(()=>membership.readMember(dm),{code:'ENOENT'});
  assert.equal(membership.member(dm),null,'no authority is restored from backup');
  save(state);assert.equal(membership.readMember(dm),'host','a restored current save is read without cached failure');
  membership.close();assert.throws(()=>membership.readMember(dm),/closed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

function journalFixture(run){
 const dir=mkdtempSync(join(tmpdir(),'hollow-membership-journal-')),file=join(dir,'campaign.json');
 const state={version:2,campaignId:'fixture',channelId:'channel',gmId:'dm',actors:[{team:'party',ownerId:'player'}]};
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const tip=(sequence=1,changes={})=>({contract:'lantern-state-wal-v1',journalId:'1'.repeat(32),campaignId:'fixture',channelId:'channel',gmId:'dm',sequence,hash:String(sequence).repeat(64),...changes});
 const writeTip=value=>writeFileSync(file+'.wal.meta',JSON.stringify({...value,sha256:digest(JSON.stringify(value))}));
 const cache=(value,head,markers=true)=>{const body=JSON.stringify(value);writeFileSync(file,JSON.stringify({body,sha256:digest(body),...(markers?{journalRequired:true,journalId:head.journalId,journalSequence:head.sequence,journalHash:head.hash}:{})}));};
 try{
  // This component validates the published tip; the engine validates journal frames.
  writeFileSync(file+'.wal','synthetic journal presence');writeTip(tip());cache(state,tip());
  run({file,state,tip,writeTip,cache,open:()=>createEngineMembership({file,campaignId:'fixture',channelId:'channel'})});
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('journal advancement denies stale Chronicle ownership until the primary cache catches up',()=>journalFixture(({file,state,tip,writeTip,cache,open})=>{
 const membership=open(),player={campaign:'fixture',owner:'player'},replacement={campaign:'fixture',owner:'replacement'};
 assert.equal(membership.readMember(player),'player');
 writeTip(tip(2));
 assert.throws(()=>membership.readMember(player),/journal/i);
 assert.equal(membership.member(player),null);assert.equal(membership.hasCampaign('fixture'),false);
 cache({...state,actors:[{team:'party',ownerId:'replacement'}]},tip(2));
 assert.equal(membership.readMember(player),null);assert.equal(membership.readMember(replacement),'player');
 writeTip(tip());cache(state,tip());
 assert.equal(membership.member(player),null,'an observed journal cannot move backwards');
 rmSync(file+'.wal');rmSync(file+'.wal.meta');cache(state,tip(),false);
 assert.equal(membership.member(player),null,'a live adopted membership source cannot downgrade to legacy');
 membership.close();
}));

test('adopted membership rejects missing, corrupt or mismatched journal authority',()=>{
 const cases={
  missingMeta:({file})=>rmSync(file+'.wal.meta'),
  missingJournal:({file})=>rmSync(file+'.wal'),
  corruptMeta:({file})=>writeFileSync(file+'.wal.meta','corrupt'),
  invalidChecksum:({file,tip})=>writeFileSync(file+'.wal.meta',JSON.stringify({...tip(),sha256:'0'.repeat(64)})),
  wrongCampaign:({tip,writeTip})=>writeTip(tip(1,{campaignId:'other'})),
  wrongJournal:({tip,writeTip})=>writeTip(tip(1,{journalId:'2'.repeat(32)})),
  unsafeSequence:({state,tip,writeTip,cache})=>{const head=tip(Number.MAX_SAFE_INTEGER+1,{hash:'a'.repeat(64)});writeTip(head);cache(state,head);},
  missingCacheMarkers:({state,tip,cache})=>cache(state,tip(),false),
  deletedSidecars:({file})=>{rmSync(file+'.wal');rmSync(file+'.wal.meta');},
 };
 for(const [name,damage] of Object.entries(cases))journalFixture(fixture=>{damage(fixture);assert.throws(fixture.open,undefined,name);});
});
