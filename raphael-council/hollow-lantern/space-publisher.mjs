import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

/** Deliver only flattened, character-scoped panels into verified private threads.
 * Logical AI seats have no Discord identity; the confirmed human DM receives their panels.
 * Existing message IDs are retained across gateway restarts.
 */
export async function createSpacePublisher({host,discordClient,manifestFile,config,onError=()=>{}}){
 const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 if(manifest.campaign!==config.campaignId||manifest.guildId!==config.guildId||manifest.parentId!==config.channelId||manifest.botId!==config.applicationId||manifest.dmUserId!==config.gmUserId)throw new Error('Private campaign space binding mismatch.');
 const expected=['dm','fighter','rogue','cleric','shop'];
 if(expected.some(key=>manifest.spaces[key]?.type!==12||manifest.spaces[key]?.parentId!==config.channelId))throw new Error('Verified private campaign spaces are required.');
 let closed=false,generation=0,queue=Promise.resolve(),unsubscribe;
 const controls=new Map();
 const gmScope={campaignId:config.campaignId,userId:config.gmUserId,audience:'gm'};
 const save=async()=>{await writeFile(manifestFile+'.publisher.tmp',JSON.stringify(manifest,null,2));await rename(manifestFile+'.publisher.tmp',manifestFile);};
 const error=code=>{try{onError({code});}catch{}};
 const issue=actorId=>{const id=`hl-space:${randomBytes(18).toString('base64url')}`;controls.set(id,{actorId,expires:Date.now()+24*60*60*1000});if(controls.size>100)controls.delete(controls.keys().next().value);return id;};
 async function verifyThread(key){
  const entry=manifest.spaces[key],raw=await discordClient.rest.get(`/channels/${entry.id}`);
  if(raw.id!==entry.id||raw.type!==12||raw.guild_id!==config.guildId||raw.parent_id!==config.channelId||raw.owner_id!==config.applicationId||raw.thread_metadata?.invitable!==false)throw new Error('Private thread changed.');
  const members=await discordClient.rest.get(`/channels/${entry.id}/thread-members?limit=100`);
  if(!Array.isArray(members)||members.some(m=>![config.applicationId,config.gmUserId].includes(m.user_id))||!members.some(m=>m.user_id===config.gmUserId))throw new Error('Private thread membership changed.');
  if(raw.thread_metadata.archived)await discordClient.rest.patch(`/channels/${entry.id}`,{body:{archived:false}});
  return discordClient.channels.fetch(entry.id);
 }
 async function publish({revision}={}){
  const requested=++generation;
  const task=queue.then(async()=>{
   if(closed||requested!==generation||!await host.authorize(gmScope))return false;
   const state=await host.engine.project({ownerId:config.gmUserId,audience:'gm'});
   if(revision!==undefined&&state.revision<revision)return false;
   for(const key of expected){
    if(closed||requested!==generation)return false;
    const channel=await verifyThread(key);
    if(!channel?.isTextBased?.())throw new Error('Private thread unavailable.');
    let payload;
    if(key==='shop')payload={flags:32768,allowedMentions:{parse:[]},components:[{type:17,accent_color:0xd7b54a,components:[{type:10,content:'## Harbor Outfitter\nBrowse stock, inspect an item, then buy or sell from a character’s private inventory. Prices and quantities are checked when the engine commits the trade.'},{type:14,divider:true,spacing:1},{type:1,components:['fighter','rogue','cleric'].map((seat,i)=>({type:2,style:2,label:['Mara · inventory','Kestrel · inventory','Ash · inventory'][i],custom_id:issue(`lantern-${seat}`)}))}]}]};
    else{
     const scope=key==='dm'?gmScope:{...gmScope,audience:'player',actorId:`lantern-${key}`};
     payload=await host.openPanel(scope);
     payload={...payload,flags:32768,allowedMentions:{parse:[]},attachments:[]};
    }
    // Recheck authority and the recipient set after image rendering.
    const current=await host.engine.project({ownerId:config.gmUserId,audience:'gm'});
    if(closed||requested!==generation||current.revision!==state.revision||!await host.authorize(gmScope))return false;
    await verifyThread(key);
    const entry=manifest.spaces[key];let message;
    if(entry.panelMessageId){
     message=await channel.messages.fetch(entry.panelMessageId);
     if(message?.author?.id!==config.applicationId)throw new Error('Private panel author changed.');
     await message.edit(payload);
    }else{
     // A failed/ambiguous send is never blindly repeated by this instance.
     if(entry.deliveryUncertain)throw new Error('Private panel delivery needs recovery.');
     entry.deliveryUncertain=true;await save();
     message=await channel.send(payload);entry.panelMessageId=message.id;
    }
    entry.deliveryUncertain=false;entry.panelRevision=state.revision;await save();
   }
   return true;
  });queue=task.catch(()=>error('PRIVATE_PANEL_REFRESH_FAILED'));return task;
 }
 unsubscribe=host.onCommitted(({receipt})=>{if(!receipt.replayed)void publish({revision:receipt.revision}).catch(()=>{});});
 const matches=i=>typeof i.customId==='string'&&i.customId.startsWith('hl-space:');
 async function handleInteraction(i){
  if(!matches(i))return false;const token=controls.get(i.customId);
  if(closed||!token||token.expires<Date.now()||i.user?.id!==config.gmUserId||i.guildId!==config.guildId||i.applicationId!==config.applicationId||!await host.authorize(gmScope)){await i.reply({content:'Open your current private character panel to use this control.',flags:64,allowedMentions:{parse:[]}});return true;}
  await i.deferReply({flags:64});
  try{await i.editReply(await host.adapter.panel({...gmScope,audience:'player',actorId:token.actorId,tab:'inventory'}));}
  catch{await i.editReply({content:'The private inventory is unavailable. Reopen your character panel.',allowedMentions:{parse:[]}});}
  return true;
 }
 return Object.freeze({publish,matches,handleInteraction,async close(){closed=true;generation++;unsubscribe?.();controls.clear();await queue;}});
}
