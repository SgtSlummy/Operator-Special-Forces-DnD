const sceneMoods=Object.freeze({briefing:'drama','coastal-road':'exploration','signal-dungeon':'tension',rescue:'aftermath','harbor-shop':'sanctuary',debrief:'aftermath'});
const moods=new Set(['drama','exploration','tension','battle','sanctuary','aftermath']);

/** Reuses Davy's existing connection. playApprovedTrack must use Davy's repository /
 * approved source resolver so music queue receipts and playbackId remain authoritative.
 * setGain is a multiplicative campaign gain hook, separate from the user's base volume.
 * This bridge never connects, disconnects, downloads audio, or constructs resources.
 */
export function createDavyMusicBridge({voicePlayer,guildId,playApprovedTrack,setGain}={}){
 if(!voicePlayer?.guilds?.get||!guildId||typeof voicePlayer.pause!=='function'||typeof voicePlayer.resume!=='function')throw new TypeError('An existing Davy-owned voice player is required.');
 setGain??=typeof voicePlayer.setCampaignGain==='function'?({guildId,gain})=>voicePlayer.setCampaignGain(guildId,gain):undefined;
 let paused;
 const state=()=>voicePlayer.guilds.get(guildId);
 return Object.freeze({
  capabilities:()=>({connected:Boolean(state()?.player),approvedPlayback:typeof playApprovedTrack==='function',ducking:typeof setGain==='function'&&voicePlayer.inlineVolumeAvailable!==false}),
  async play(track,context={}){if(!state()?.player||typeof playApprovedTrack!=='function')return false;await playApprovedTrack({guildId,trackId:track.id,approval:track.approval,...context});paused=null;return true;},
  async gain(value){if(!state()?.player||typeof setGain!=='function')return false;if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Invalid campaign music gain.');await setGain({guildId,gain:value});return true;},
  async pause(){const current=state();if(!current?.player)return false;const source=current.currentSource;
   if(voicePlayer.pause(guildId)){paused={state:current,source};return true;}return false;},
  async resume(){const prior=paused;paused=null;if(!prior||state()!==prior.state||state()?.currentSource!==prior.source)return false;return Boolean(voicePlayer.resume(guildId));},
 });
}

/** Construction is inert. Reacts to committed receipts by reading a fresh PUBLIC
 * engine projection. No private scene details, speculative intent or model prose
 * select music. Caller supplies only already-approved track catalog identifiers.
 * narration() is called at actual approved public speech start/end, never when a
 * private draft is generated. Live narration authority remains the human DM.
 */
export function createCampaignMusic({host,campaignId,gmUserId,player,tracks={},narrationGain=0.35}={}){
 if(host?.engine?.campaignId!==campaignId||typeof host.onCommitted!=='function'||typeof host.authorize!=='function'||!['play','gain','pause','resume'].every(k=>typeof player?.[k]==='function')||!Number.isFinite(narrationGain)||narrationGain<0||narrationGain>1)throw new TypeError('Bound campaign, DM, and music adapters are required.');
 const catalog=new Map();for(const [mood,track]of Object.entries(tracks)){
  if(!moods.has(mood)||!track||typeof track.id!=='string'||!track.id||track.id.length>100||!['user-provided','royalty-cleared'].includes(track.approval)||Object.keys(track).some(k=>!['id','approval'].includes(k)))throw new TypeError('Use approved music catalog identifiers only.');
  catalog.set(mood,Object.freeze({...track}));
 }
 let closed=false,serial=Promise.resolve(),generation=0,requestedRevision=-1,playingId=null,silent=false;
 const speech=new Set(),status={state:'idle',mood:null,revision:null,ducking:false};
 const authorized=()=>!closed&&host.authorize({campaignId,userId:gmUserId,audience:'gm'});
 const enqueue=task=>{const result=serial.catch(()=>{}).then(task);serial=result.catch(()=>{});return result;};
 const publicView=async()=>{const p=await host.engine.project({ownerId:gmUserId,audience:'public',mapLevel:'regional'});if(p.campaignId!==campaignId||p.audience!=='public'||!Number.isSafeInteger(p.revision))throw new Error('Public projection required.');return p;};
 async function onCommitted({receipt}={}){
  if(closed||receipt?.replayed||!Number.isSafeInteger(receipt?.revision)||receipt.revision<=requestedRevision)return false;
  requestedRevision=receipt.revision;const ownGeneration=++generation;
  return enqueue(async()=>{
   try{
    if(!await authorized())return false;const p=await publicView();if(closed||ownGeneration!==generation||p.revision<receipt.revision||!await authorized())return false;
    status.revision=p.revision;
    if(!p.decisionOpen){silent=true;speech.clear();try{await player.gain(0);}catch{}await player.pause();status.state='paused';status.ducking=false;return true;}
    const mood=p.phase==='combat'?'battle':sceneMoods[p.currentSceneId],track=catalog.get(mood);status.mood=mood??null;
    if(!track){status.state=silent?'paused-no-approved-track':'retained-no-approved-track';return false;}
    const desiredGain=speech.size?narrationGain:1;
    // Set gain before any replacement/resume, preventing an unducked first frame.
    const gainApplied=await player.gain(desiredGain);
    if(closed||ownGeneration!==generation)return false;
    if(playingId!==track.id){if(!await player.play(track,{revision:p.revision,sceneId:p.currentSceneId})){status.state='playback-unavailable';return false;}playingId=track.id;}
    else if(silent&&!await player.resume()){status.state='paused-resume-unavailable';status.ducking=false;return false;}
    silent=false;status.state='playing';status.ducking=speech.size>0&&gainApplied;return true;
   }catch{status.state='unavailable';return false;}
  });
 }
 const detach=host.onCommitted(event=>{void onCommitted(event);});
 async function narration({userId,narrationId,active}={}){
  if(userId!==gmUserId||typeof narrationId!=='string'||!narrationId||narrationId.length>100||typeof active!=='boolean')return false;
  return enqueue(async()=>{
   if(!await authorized())return false;
   if(active){const p=await publicView();if(!p.decisionOpen||silent||closed)return false;speech.add(narrationId);}else speech.delete(narrationId);
   const applied=await player.gain(silent?0:speech.size?narrationGain:1);status.ducking=!silent&&speech.size>0&&applied;return applied;
  }).catch(()=>false);
 }
 return Object.freeze({onCommitted,narration,status:()=>Object.freeze({...status}),async flush(){await serial;},async close(){if(closed)return;closed=true;generation++;detach();speech.clear();await serial;await player.gain(1).catch(()=>{});}});
}
