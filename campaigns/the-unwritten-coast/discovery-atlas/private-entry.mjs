import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
const snowflake=v=>typeof v==='string'&&/^\d{17,20}$/.test(v);
const heading='## The Unwritten Coast · Your private table';
export function privateEntryCard({dm=false}={}){
 const button=(label,action)=>({type:2,style:2,label,custom_id:'coast:'+action});
 return {flags:32768,allowed_mentions:{parse:[]},components:[{type:17,accent_color:0xc8a36a,components:[
  {type:10,content:heading},
  {type:10,content:dm?'Your campaign desk. Review player requests here; the company’s scene and maps remain within reach.':'Your place beside the story. Open your belongings, visit an available shop, or describe an action without announcing it to the company.'},
  {type:14,divider:true,spacing:1},
  {type:10,content:'**Scene** · Return to the current moment.\n**Maps** · Inspect the tactical view or charted places.\n**Raphael** · Recall what you are allowed to know.'},
  {type:1,components:[button('Scene','scene'),button('Tactical map','tactical'),button('Known places','atlas'),button(dm?'DM desk':'My belongings','private'),button('Raphael','recall')]}
 ]}]};
}
const isEntry=(message,applicationId)=>message?.author?.id===applicationId&&message.components?.some(c=>c.type===17&&c.components?.some(x=>x.type===10&&x.content===heading));

// Call only after the host has mounted the Coast interaction adapter.
// This card contains navigation, never loot, preparation or unrevealed locations.
export async function ensurePrivateEntry({binding,threadId,ownerId,request,manifestFile}){
 const {guildId,parentChannelId,applicationId,gmUserId}=binding;
 const expected=ownerId===gmUserId?binding.dmThreadId:binding.members?.find(m=>m.ownerId===ownerId)?.threadId;
 if(![guildId,parentChannelId,applicationId,gmUserId,threadId,ownerId].every(snowflake)||expected!==threadId||threadId===binding.channelId||threadId===parentChannelId)throw Error('Explicit private entry binding required.');
 const scope={guildId,parentChannelId,applicationId,ownerId,threadId};
 const verify=async()=>{
  const [bot,thread,member]=await Promise.all([request('GET','/users/@me'),request('GET',`/channels/${threadId}`),request('GET',`/guilds/${guildId}/members/${ownerId}`)]);
  if(bot.id!==applicationId||thread.id!==threadId||thread.guild_id!==guildId||thread.parent_id!==parentChannelId||thread.type!==12||thread.owner_id!==applicationId||thread.thread_metadata?.invitable!==false||thread.thread_metadata?.archived!==false||member.user?.id!==ownerId||member.user.bot)throw Error('Private entry destination could not be verified.');
  let found=false,after;
  for(let page=0;;page++){
   if(page>=100)throw Error('Private membership inventory incomplete.');
   const batch=await request('GET',`/channels/${threadId}/thread-members?with_member=true&limit=100${after?'&after='+after:''}`);
   if(!Array.isArray(batch)||batch.some(m=>m.user_id!==ownerId&&m.user_id!==applicationId))throw Error('Unexpected private thread member.');
   found ||= batch.some(m=>m.user_id===ownerId);
   if(batch.length<100)break;
   const next=batch.at(-1)?.user_id;if(!snowflake(next)||next===after)throw Error('Private membership inventory incomplete.');after=next;
  }
  if(!found)throw Error('Private owner is absent.');
 };
 await mkdir(dirname(manifestFile),{recursive:true});const lock=await open(manifestFile+'.lock','wx');let record;
 const save=async()=>{await writeFile(manifestFile+'.tmp',JSON.stringify(record,null,2));await rename(manifestFile+'.tmp',manifestFile);};
 try{
  await verify();
  try{record=JSON.parse(await readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(record&&JSON.stringify(record.scope)!==JSON.stringify(scope))throw Error('Private entry reservation belongs to another destination.');
  if(record?.messageId){
   if(!snowflake(record.messageId))throw Error('Invalid saved private entry ID.');
   const message=await request('GET',`/channels/${threadId}/messages/${record.messageId}`);
   if(message?.id!==record.messageId||!isEntry(message,applicationId))throw Error('Saved private entry no longer matches.');
   record.phase='verified';await save();return record;
  }
  let before;const matches=new Map();
  for(let page=0;;page++){
   if(page>=100)throw Error('Private message inventory incomplete.');
   const batch=await request('GET',`/channels/${threadId}/messages?limit=100${before?'&before='+before:''}`);
   if(!Array.isArray(batch))throw Error('Private message inventory incomplete.');
   for(const message of batch)if(isEntry(message,applicationId))matches.set(message.id,message);
   if(batch.length<100)break;
   const next=batch.at(-1)?.id;if(!snowflake(next)||next===before)throw Error('Private message inventory incomplete.');before=next;
  }
  if(matches.size>1)throw Error('Multiple private entry cards require reconciliation.');
  if(matches.size===1){record={scope,messageId:[...matches.keys()][0],phase:'verified'};await save();return record;}
  if(record?.phase==='posting')throw Error('Previous private entry delivery is uncertain; do not post again.');
  await verify();
  record={scope,phase:'posting'};await save();
  const message=await request('POST',`/channels/${threadId}/messages`,privateEntryCard({dm:ownerId===gmUserId}));
  if(!snowflake(message?.id))throw Error('Private entry response lacks a message ID.');
  record.messageId=message.id;record.phase='posted';await save();
  if(!isEntry(message,applicationId))throw Error('Posted private entry could not be verified.');
  record.phase='verified';await save();return record;
 }finally{await lock.close();await unlink(manifestFile+'.lock');}
}
