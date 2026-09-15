import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignMusic,createDavyMusicBridge} from './music.mjs';

function fixture(tracks={drama:{id:'briefing-track',approval:'user-provided'},battle:{id:'battle-track',approval:'royalty-cleared'}}){
 const calls=[];let revision=1,open=true,phase='exploration',scene='briefing',allowed=true,observer;
 const host={engine:{campaignId:'fixture',project:async scope=>{assert.equal(scope.audience,'public');return {campaignId:'fixture',audience:'public',revision,decisionOpen:open,phase,currentSceneId:scene};}},authorize:async()=>allowed,onCommitted:fn=>{observer=fn;return()=>observer=null;}};
 const player=Object.fromEntries(['play','gain','pause','resume'].map(k=>[k,async v=>{calls.push([k,v]);return true;}]));
 const music=createCampaignMusic({host,campaignId:'fixture',gmUserId:'dm',player,tracks});
 return {music,calls,host,player,set:p=>{if('revision'in p)revision=p.revision;if('open'in p)open=p.open;if('phase'in p)phase=p.phase;if('scene'in p)scene=p.scene;if('allowed'in p)allowed=p.allowed;},emit:async receipt=>{observer?.({receipt});await music.flush();}};
}
test('committed public scene and combat changes select only approved tracks without duplicate playback',async()=>{
 const f=fixture();try{assert.equal(f.calls.length,0);await f.emit({revision:1});assert.equal(f.calls.find(c=>c[0]==='play')[1].id,'briefing-track');await f.emit({revision:1});assert.equal(f.calls.filter(c=>c[0]==='play').length,1);f.set({revision:2,phase:'combat'});await f.emit({revision:2,replayed:true});assert.equal(f.calls.filter(c=>c[0]==='play').length,1);await f.emit({revision:2});assert.equal(f.calls.filter(c=>c[0]==='play').at(-1)[1].id,'battle-track');}finally{await f.music.close();}
});
test('pause silences and overlapping authorized narration remains ducked until all speech ends',async()=>{
 const f=fixture();try{await f.emit({revision:1});assert.equal(await f.music.narration({userId:'other',narrationId:'speech',active:true}),false);await f.music.narration({userId:'dm',narrationId:'one',active:true});await f.music.narration({userId:'dm',narrationId:'two',active:true});await f.music.narration({userId:'dm',narrationId:'one',active:false});assert.deepEqual(f.calls.at(-1),['gain',0.35]);await f.music.narration({userId:'dm',narrationId:'two',active:false});assert.deepEqual(f.calls.at(-1),['gain',1]);f.set({revision:2,open:false});await f.emit({revision:2});assert.deepEqual(f.calls.slice(-2),[['gain',0],['pause',undefined]]);assert.equal(f.music.status().state,'paused');}finally{await f.music.close();}
});
test('missing approved tracks retain paused audio and never accept an arbitrary URL catalog',async()=>{
 const f=fixture({});try{await f.emit({revision:1});assert.equal(f.calls.length,0);assert.equal(f.music.status().state,'retained-no-approved-track');f.set({revision:2,open:false});await f.emit({revision:2});f.set({revision:3,open:true});await f.emit({revision:3});assert.equal(f.music.status().state,'paused-no-approved-track');assert.throws(()=>createCampaignMusic({host:f.host,campaignId:'fixture',gmUserId:'dm',player:{play(){},gain(){},pause(){},resume(){}},tracks:{drama:{id:'x',approval:'user-provided',url:'https://arbitrary'}}}),/catalog/);}finally{await f.music.close();}
});
test('revoked membership blocks cues and bridge never connects, disconnects or resumes a replaced source',async()=>{
 const f=fixture();try{f.set({allowed:false});await f.emit({revision:1});assert.equal(f.calls.length,0);}finally{await f.music.close();}
 const calls=[],state={player:{},currentSource:{id:'current'}},voicePlayer={guilds:new Map([['guild',state]]),pause:()=>true,resume:()=>{calls.push('resume');return true;},connect:()=>assert.fail('No new connection'),stop:()=>assert.fail('Must not disconnect')};
 const bridge=createDavyMusicBridge({voicePlayer,guildId:'guild'});assert.equal(await bridge.play({id:'track'}),false);assert.equal(await bridge.gain(0.35),false);assert.equal(bridge.capabilities().ducking,false);await bridge.pause();state.currentSource={id:'replacement'};assert.equal(await bridge.resume(),false);assert.equal(calls.length,0);
});


test('failed same-track resume stays paused and never substitutes another source',async()=>{
 const f=fixture();try{
  await f.emit({success:true,revision:1});f.set({revision:2,open:false});await f.emit({success:true,revision:2});
  let resumed=0;f.player.resume=async()=>{resumed++;return false;};
  f.set({revision:3,open:true});await f.emit({success:true,revision:3});
  assert.equal(f.music.status().state,'paused-resume-unavailable');assert.equal(f.music.status().ducking,false);
  assert.equal(f.calls.filter(c=>c[0]==='play').length,1);assert.equal(resumed,1);
  f.player.resume=async()=>{resumed++;return true;};f.set({revision:4});await f.emit({success:true,revision:4});
  assert.equal(resumed,2);assert.equal(f.music.status().state,'playing');assert.equal(f.calls.filter(c=>c[0]==='play').length,1);
 }finally{await f.music.close();}
});
