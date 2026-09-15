import {randomBytes} from 'node:crypto';

const flags=32768|64;
const card=(components)=>({flags,allowedMentions:{parse:[]},components:[{type:17,accent_color:0xd8ac55,components}]});
const text=content=>({type:10,content});
const plain=value=>String(value??'').replace(/[\\`*_~<>@]/g,'').slice(0,100);

/** Mount into the existing client's adapter registry. No client, login, or send occurs here.
 * Append entryButton({userId}) only to an authorized DM panel. Route matches() before
 * the general game adapter. getRuntime() supports lazy AI startup by the owning host.
 */
export function createArtReviewAdapter({getRuntime,campaignId,gmUserId,guildId,applicationId,authorize,now=Date.now}={}){
 if(![getRuntime,authorize].every(f=>typeof f==='function')||![campaignId,gmUserId,guildId,applicationId].every(v=>typeof v==='string'&&v))throw new Error('Scoped DM art review configuration is required.');
 const controls=new Map();let closed=false;
 const scope=userId=>({campaignId,userId,audience:'gm'});
 const allowed=async userId=>!closed&&userId===gmUserId&&await authorize(scope(userId));
 function issue(userId,action,candidateId){
  for(const [id,value]of controls)if(value.expires<=now())controls.delete(id);
  while(controls.size>=64)controls.delete(controls.keys().next().value);
  const id=`hl-art:${randomBytes(18).toString('base64url')}`;controls.set(id,{userId,action,candidateId,expires:now()+600000});return id;
 }
 async function panel({userId}={}){
  if(!await allowed(userId))throw new Error('DM access required');
  const runtime=getRuntime();
  if(!runtime)return card([text('## Scene art'),text('Local image preparation is not running. Your current artwork stays in place.')]);
  const review=await runtime.getArtReview({userId});
  if(!await allowed(userId))throw new Error('DM access changed');
  if(review.status!=='awaiting-review')return card([text('## Scene art'),text('No image is waiting for review. Your approved artwork stays in place.')]);
  if(!Buffer.isBuffer(review.image)||review.image.length>4*1024*1024)throw new Error('Art candidate unavailable');
  const payload=card([text('## Review scene art'),text(`**${plain(review.sceneId).replaceAll('-',' ')}** · Revision ${review.revision}\nPrivate preview — approve this illustration for the public adventure, or keep the current art.`),
   {type:12,items:[{media:{url:'attachment://scene-candidate.png'},description:'Unapproved local scene illustration. Visible only to the DM.'}]},
   {type:14,divider:true,spacing:1},
   {type:1,components:[{type:2,style:3,label:'Approve',custom_id:issue(userId,'approve',review.candidateId)},{type:2,style:2,label:'Keep current',custom_id:issue(userId,'decline',review.candidateId)}]}]);
  payload.files=[{attachment:review.image,name:'scene-candidate.png'}];return payload;
 }
 const matches=interaction=>typeof interaction?.customId==='string'&&interaction.customId.startsWith('hl-art:');
 async function handleInteraction(interaction){
  if(!matches(interaction))return false;
  const token=controls.get(interaction.customId),userId=interaction.user?.id;
  const deny=content=>interaction.reply({content,flags:64,allowedMentions:{parse:[]}});
  if(closed||!token||token.expires<=now()||token.userId!==userId||interaction.guildId!==guildId||interaction.applicationId!==applicationId){await deny('This private art control is unavailable. Open the DM art review again.');return true;}
  await interaction.deferReply({flags:64});
  try{
   if(!await allowed(userId))throw new Error('DM access changed');
   if(token.action==='open'){const payload=await panel({userId});if(!await allowed(userId))throw new Error('DM access changed');await interaction.editReply(payload);return true;}
   const runtime=getRuntime();if(!runtime)throw new Error('Art runtime unavailable');
   // Consume only after user/scope authorization. A copied control cannot invalidate
   // the DM's genuine control, and replay cannot repeat approval or publication.
   controls.delete(interaction.customId);
   const result=await runtime[token.action==='approve'?'approveArt':'declineArt']({userId,candidateId:token.candidateId});
   if(!await allowed(userId))throw new Error('DM access changed');
   await interaction.editReply(card([text(token.action==='approve'?'## Art approved':'## Current art retained'),text(result.status==='approved'?(result.published?'The new illustration is now in the public adventure.':'The illustration is approved. Reopen the public scene to show it.'):'The candidate stays out of the public adventure.')]));
  }catch(error){await interaction.editReply({content:error.name==='ArtReviewError'?String(error.message).slice(0,220):'The art review could not be completed. Reopen it to check the current scene.',allowedMentions:{parse:[]}});}
  return true;
 }
 return Object.freeze({matches,panel,handleInteraction,entryButton({userId}={}){if(closed||userId!==gmUserId)return null;return {type:2,style:2,label:'Review scene art',custom_id:issue(userId,'open')};},close(){closed=true;controls.clear();}});
}
