/** Verified native gateway membership shared by both transports. Without the
 * GuildMembers intent, fall back to fresh REST and never retain authorization. */
export function createAdmissionMembership({client,guildId,channelId,now=Date.now,ttlMs=300000}){
 const cache=new Map(),flights=new Map(),listeners=[];let generation=0,closed=false,disconnected=false,guildUnavailable=false;
 const events=['guildMemberAdd','guildMemberAvailable','guildMemberUpdate','guildMemberRemove','roleCreate','roleUpdate','roleDelete','guildUpdate','channelCreate','channelUpdate','channelDelete'];
 const invalidate=()=>{generation++;cache.clear();flights.clear();};
 const listen=(name,fn)=>{client.on(name,fn);listeners.push([name,fn]);};
 for(const event of events)listen(event,invalidate);
 // Uncached members do not reliably produce high-level update/remove events.
 // Invalidate at the packet boundary, before any later authorization can reuse a grant.
 listen('raw',packet=>{
  const data=packet?.d,type=packet?.t;
  if(['GUILD_MEMBER_ADD','GUILD_MEMBER_UPDATE','GUILD_MEMBER_REMOVE','GUILD_ROLE_CREATE','GUILD_ROLE_UPDATE','GUILD_ROLE_DELETE','CHANNEL_UPDATE','CHANNEL_DELETE'].includes(type)&&data?.guild_id===guildId)invalidate();
  if(data?.id!==guildId)return;
  if(type==='GUILD_DELETE'){guildUnavailable=true;invalidate();}
  if(type==='GUILD_CREATE'){guildUnavailable=data.unavailable===true;invalidate();}
  if(type==='GUILD_UPDATE')invalidate();
 });
 for(const event of ['guildDelete','guildUnavailable'])listen(event,guild=>{if(guild?.id===guildId){guildUnavailable=true;invalidate();}});
 for(const event of ['guildCreate','guildAvailable'])listen(event,guild=>{if(guild?.id===guildId){guildUnavailable=guild.available===false;invalidate();}});
 for(const event of ['shardDisconnect','shardReconnecting','shardError','invalidated'])listen(event,()=>{disconnected=true;invalidate();});
 for(const event of ['shardReady','shardResume','clientReady'])listen(event,()=>{disconnected=false;invalidate();});
 const canCache=()=>client.options?.intents?.has?.(2)===true&&client.isReady?.()===true;
 async function member(userId,{fresh=false}={}){
  if(closed||disconnected||guildUnavailable||!/^\d{17,20}$/.test(userId))return false;
  if(typeof client.isReady==='function'&&!client.isReady())return false;
  const reusable=canCache(),cached=cache.get(userId);
  if(reusable&&!fresh&&cached?.expires>now())return cached.allowed;
  const epoch=generation;
  let flight=flights.get(userId);
  if(!flight){flight=(async()=>{
   try{const guild=await client.guilds.fetch(guildId);if(guild?.available===false)return false;const person=await guild.members.fetch({user:userId,force:true,cache:false});
    if(!person||person.id!==userId||person.user?.bot===true||person.pending===true)return false;
    const channel=await guild.channels.fetch(channelId);const allowed=Boolean(channel?.permissionsFor(person)?.has('ViewChannel'));
    if(closed||disconnected||guildUnavailable||generation!==epoch)return false;
    if(reusable){if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(userId,{allowed,expires:now()+ttlMs});}return allowed;
   }catch{return false;}
  })();flights.set(userId,flight);}
  try{return await flight;}finally{if(flights.get(userId)===flight)flights.delete(userId);}
 }
 return {member,close(){closed=true;invalidate();for(const [event,fn]of listeners)client.off(event,fn);}};
}
