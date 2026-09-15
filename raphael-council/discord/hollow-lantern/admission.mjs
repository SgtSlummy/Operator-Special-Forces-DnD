import {EngineError} from '../../hollow-lantern/engine-client.mjs';

export function createAdmissionAdapter({admission,campaignId,guildId,applicationId}){
 const prefix='hl-admission:';
 const scope=i=>({campaignId,userId:i.user?.id});
 const payload=content=>({content,flags:64,allowedMentions:{parse:[]}});
 async function openEntry(i){
  if(i.guildId!==guildId||i.applicationId!==applicationId)throw new EngineError('ACCESS_DENIED','Open this campaign in its server.',403);
  const current=await admission.status(scope(i));
  const response={...payload(current.status==='enrolled'?'Your character is enrolled. Open your player panel.':current.status==='full'?'All seats for this release stage are reserved.':current.status==='available'?'Choose a validated level-three 2024 character. Your account receives one persistent seat.':'Your reserved character is '+current.status+'. Admission completes automatically at the next safe pause.'),components:current.status==='available'?[{type:1,components:[{type:3,custom_id:prefix+i.user.id,placeholder:'Choose a character preset',options:['fighter','rogue','cleric'].map(value=>({value,label:value}))}]}]:[]};
  return i.replied||i.deferred?i.editReply(response):i.reply(response);
 }
 async function handleInteraction(i){
  if(!i.customId?.startsWith(prefix))return false;
  const [owner,preset]=i.customId.slice(prefix.length).split(':');
  if(owner!==i.user?.id||i.guildId!==guildId||i.applicationId!==applicationId){await i.reply(payload('This admission control belongs to another account or campaign.'));return true;}
  try{
   await admission.status(scope(i));
   if(!preset&&!i.values){await openEntry(i);return true;}
   if(!preset){const selected=i.values?.[0];if(!['fighter','rogue','cleric'].includes(selected))throw Error();await i.showModal({custom_id:prefix+owner+':'+selected,title:'Join with a 2024 '+selected,components:[{type:1,components:[{type:4,custom_id:'name',label:'Character name',style:1,required:true,max_length:80}]}]});}
   else {await i.deferReply({flags:64});const result=await admission.join(scope(i),{presetId:preset,name:i.fields.getTextInputValue('name'),edition:'2024'});await i.editReply(payload(result.status==='enrolled'?'Your character is enrolled. Open your player panel.':'Your seat is reserved. Current status: '+result.status+'.'));}
  }catch(error){const response=payload(error instanceof EngineError?error.message:'Admission could not be confirmed. Reopen character setup to recover your existing reservation.');if(i.deferred||i.replied)await i.editReply(response);else await i.reply(response);}
  return true;
 }
 return {openEntry,handleInteraction,matches:i=>i.customId?.startsWith(prefix)===true,entryButton:({userId})=>({type:2,style:2,label:'Join campaign',custom_id:prefix+userId}),close(){}};
}
