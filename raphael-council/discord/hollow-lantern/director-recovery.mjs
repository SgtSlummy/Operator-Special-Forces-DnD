import {randomBytes} from 'node:crypto';

const card=components=>({flags:32768|64,allowedMentions:{parse:[]},components:[{type:17,accent_color:0xd8ac55,components}]});
const text=content=>({type:10,content});
const pending=r=>r?.status==='pending'&&typeof r.commandId==='string'&&r.commandId.length>0&&r.commandId.length<=128;

/** Mount before the general game adapter. The owning host supplies its shared AI
 * instance through getRuntime; this adapter never allocates a controller or client.
 * Append entryButton only to an authorized human DM panel.
 */
export function createDirectorRecoveryAdapter({getRuntime,campaignId,gmUserId,guildId,applicationId,authorize,now=Date.now}={}){
 if(![getRuntime,authorize].every(f=>typeof f==='function')||![campaignId,gmUserId,guildId,applicationId].every(v=>typeof v==='string'&&v))throw new Error('Scoped DM recovery configuration is required.');
 const controls=new Map();let closed=false;
 const allowed=async userId=>!closed&&userId===gmUserId&&await authorize({campaignId,userId,audience:'gm'});
 function issue(userId,action,runtime,commandId){
  for(const [id,value]of controls)if(value.expires<=now())controls.delete(id);
  while(controls.size>=64)controls.delete(controls.keys().next().value);
  const id=`hl-director-recovery:${randomBytes(18).toString('base64url')}`;
  controls.set(id,{userId,action,runtime,commandId,expires:now()+600000});return id;
 }
 async function panel({userId}={}){
  if(!await allowed(userId))throw new Error('DM access required');
  const runtime=await getRuntime();
  if(!await allowed(userId))throw new Error('DM access changed');
  if(!runtime)return card([text('## AI ruling recovery'),text('The local AI host is unavailable. Reopen recovery when it is running.')]);
  const recovery=await runtime.getDirectorRecovery({userId});
  if(!await allowed(userId))throw new Error('DM access changed');
  if(recovery?.status==='empty')return card([text('## AI ruling recovery'),text('No saved AI ruling needs recovery.')]);
  if(!pending(recovery))return card([text('## AI ruling recovery'),text('The saved ruling needs host recovery. Reopen recovery after the host is available.')]);
  if(recovery.ready!==true)return card([text('## AI ruling recovery'),text('Pause decisions and switch to Human DM before recovering this ruling.')]);
  return card([text('## Recover saved AI ruling'),text('Recover the original result or permanently cancel the saved ruling if it never committed. This never repeats the ruling. Decisions stay paused.'),{type:1,components:[{type:2,style:2,label:'Resolve saved AI ruling',custom_id:issue(userId,'resolve',runtime,recovery.commandId)}]}]);
 }
 const matches=interaction=>typeof interaction?.customId==='string'&&interaction.customId.startsWith('hl-director-recovery:');
 async function handleInteraction(interaction){
  if(!matches(interaction))return false;
  const token=controls.get(interaction.customId),userId=interaction.user?.id;
  const deny=()=>interaction.reply({content:'This private recovery control is unavailable. Reopen AI ruling recovery.',flags:64,allowedMentions:{parse:[]}});
  if(closed||!token||token.expires<=now()||token.userId!==userId||interaction.guildId!==guildId||interaction.applicationId!==applicationId){await deny();return true;}
  await interaction.deferReply({flags:64});
  try{
   if(!await allowed(userId))throw new Error('DM access changed');
   // Claim synchronously after authorization, before any further awaits. Copied
   // controls cannot consume the original; concurrent genuine clicks resolve once.
   if(controls.get(interaction.customId)!==token||token.expires<=now())throw new Error('Control expired');
   controls.delete(interaction.customId);
   if(token.action==='open'){const payload=await panel({userId});if(!await allowed(userId))throw new Error('DM access changed');await interaction.editReply(payload);return true;}
   const runtime=await getRuntime();
   if(!runtime||runtime!==token.runtime)throw new Error('Runtime changed');
   const current=await runtime.getDirectorRecovery({userId});
   if(!await allowed(userId))throw new Error('DM access changed');
   if(!pending(current)||current.ready!==true||current.commandId!==token.commandId)throw new Error('Saved ruling changed');
   const result=await runtime.resolveDirectorRecovery({userId,commandId:token.commandId});
   if(!await allowed(userId))throw new Error('DM access changed');
   if(result?.success!==true||!['committed','cancelled'].includes(result.resolution))throw new Error('Recovery outcome unavailable');
   await interaction.editReply(card([text(result.resolution==='committed'?'## Original ruling recovered':'## Saved ruling cancelled'),text(result.resolution==='committed'?'The original result is confirmed. The ruling was not repeated. Decisions stay paused.':'The saved ruling cannot run later. Decisions stay paused; choose when to resume.')]));
  }catch{await interaction.editReply({content:'Recovery could not be confirmed here. Reopen AI ruling recovery to check the saved ruling. This control never repeats it.',allowedMentions:{parse:[]}});}
  return true;
 }
 return Object.freeze({matches,panel,handleInteraction,entryButton({userId}={}){if(closed||userId!==gmUserId)return null;return {type:2,style:2,label:'Recover AI ruling',custom_id:issue(userId,'open')};},close(){closed=true;controls.clear();}});
}
