import {readFile,writeFile,open,rename,unlink,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CATALOG} from './catalog.mjs';
import {createTable} from './table-model.mjs';
const live='C:/Users/Hermes/Projects/Unwritten-Coast-Data/live';
const id=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
export function openingState(){
 const state=createTable({...CATALOG,party:[]});
 if(state.currentRoomId!=='f-deck'||state.currentPlaceId!=='brinewatch')throw Error('Opening catalog changed; review the public story before initializing.');
 state.table.opening={storyThreadId:'1548204446838689882',messageIds:['1548204449443487765','1548375898707861576','1548376269463355402'],rulesStatus:'Awaiting agreement on edition, characters and dice policy',description:'Eleven exhausted passengers wait aboard the ferry at Brinewatch. No character introductions or actions have been recorded.'};
 return state;
}
export async function initializeOpening(file){await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(openingState(),null,2),{flag:'wx'});return file;}

// Complete active and archived inventories before creating a new private thread.
export async function ensureDmThread({binding,request,manifestFile}){
 const {guildId,parentChannelId,applicationId,gmUserId}=binding;
 if(![guildId,parentChannelId,applicationId,gmUserId].every(id))throw Error('Explicit DM binding required.');
 const name='The Unwritten Coast · DM',scope={guildId,parentChannelId,applicationId,gmUserId};
 await mkdir(dirname(manifestFile),{recursive:true});
 const lock=await open(manifestFile+'.lock','wx');let record;
 const save=async()=>{const temp=manifestFile+'.tmp';await writeFile(temp,JSON.stringify(record,null,2));await rename(temp,manifestFile);};
 const verify=thread=>{if(thread.guild_id!==guildId||thread.parent_id!==parentChannelId||thread.type!==12||thread.owner_id!==applicationId||thread.thread_metadata?.invitable!==false)throw Error('DM thread privacy or ownership does not match.');};
 try{
  const [bot,parent,member]=await Promise.all([request('GET','/users/@me'),request('GET',`/channels/${parentChannelId}`),request('GET',`/guilds/${guildId}/members/${gmUserId}`)]);
  if(bot.id!==applicationId||parent.guild_id!==guildId||parent.type!==0||member.user?.id!==gmUserId||member.user.bot)throw Error('Discord binding could not be verified.');
  try{record=JSON.parse(await readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(record&&JSON.stringify(record.scope)!==JSON.stringify(scope))throw Error('Existing DM reservation belongs to another binding.');
  if(!record?.threadId){
   const active=await request('GET',`/guilds/${guildId}/threads/active`);let threads=[...active.threads],before;
   for(let page=0;;page++){
    if(page>=100)throw Error('Archived inventory is incomplete.');
    const archived=await request('GET',`/channels/${parentChannelId}/threads/archived/private?limit=100${before?'&before='+encodeURIComponent(before):''}`);
    threads.push(...archived.threads);if(!archived.has_more)break;
    const next=archived.threads.at(-1)?.thread_metadata?.archive_timestamp;if(!next||next===before)throw Error('Archived inventory is incomplete.');before=next;
   }
   const matches=[...new Map(threads.filter(t=>t.parent_id===parentChannelId&&t.name===name&&t.owner_id===applicationId).map(t=>[t.id,t])).values()];
   if(matches.length>1)throw Error('More than one DM thread exists; reconciliation required.');
   if(matches.length){verify(matches[0]);record={scope,threadId:matches[0].id,phase:'created'};await save();}
   else{
    if(record?.phase==='creating')throw Error('Previous creation is uncertain; do not create a duplicate.');
    record={scope,phase:'creating'};await save();
    const created=await request('POST',`/channels/${parentChannelId}/threads`,{name,type:12,invitable:false,auto_archive_duration:1440});
    record.threadId=created.id;record.phase='created';await save();verify(created);
   }
  }
  let thread=await request('GET',`/channels/${record.threadId}`);verify(thread);
  if(thread.thread_metadata.archived){thread=await request('PATCH',`/channels/${record.threadId}`,{archived:false});verify(thread);}
  await request('PUT',`/channels/${record.threadId}/thread-members/${gmUserId}`);
  let members=[],after;
  for(let page=0;;page++){
   if(page>=100)throw Error('Membership inventory is incomplete.');
   const batch=await request('GET',`/channels/${record.threadId}/thread-members?with_member=true&limit=100${after?'&after='+after:''}`);members.push(...batch);
   if(batch.length<100)break;const next=batch.at(-1)?.user_id;if(!id(next)||next===after)throw Error('Membership inventory is incomplete.');after=next;
  }
  const allowed=new Set([applicationId,gmUserId]);if(!members.some(m=>m.user_id===gmUserId)||members.some(m=>!allowed.has(m.user_id)))throw Error('DM thread membership is not private to the selected DM and bot.');
  record.phase='verified';record.checkedAt=new Date().toISOString();await save();return record;
 }finally{await lock.close();await unlink(manifestFile+'.lock');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--initialize'))console.log(JSON.stringify({stateFile:await initializeOpening(live+'/state.json')}));
 if(process.argv.includes('--dm-thread')){
  const binding=JSON.parse(await readFile(live+'/discord-binding.json','utf8'));
  if(process.env.DISCORD_APPLICATION_ID!==binding.applicationId||!process.env.DISCORD_TOKEN)throw Error('Expected Davy credentials required.');
  const request=async(method,path,body)=>{const response=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:'Bot '+process.env.DISCORD_TOKEN,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`Discord setup ${response.status}`);return response.status===204?null:response.json();};
  console.log(JSON.stringify(await ensureDmThread({binding,request,manifestFile:live+'/dm-thread.json'})));
 }
}
