import { ChannelType } from 'discord.js';

const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const safeName = value => String(value || 'Character').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 70) || 'Character';

/** One private thread per campaign owner, including retry/recovery paths. */
export function createCharacterThreadDelivery({ client, config, store, log = () => {} }) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS character_threads(
    campaign TEXT NOT NULL, owner TEXT NOT NULL, character_revision INTEGER NOT NULL,
    thread_id TEXT NOT NULL, parent_channel_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(campaign, owner)
  ); CREATE TABLE IF NOT EXISTS character_thread_delivery(
    campaign TEXT NOT NULL, owner TEXT NOT NULL, state TEXT NOT NULL,
    welcome TEXT NOT NULL DEFAULT 'new', announcement TEXT NOT NULL DEFAULT 'new',
    PRIMARY KEY(campaign, owner)
  )`);
  config.characterThreadIds ??= new Set();
  for (const row of store.db.prepare('SELECT thread_id FROM character_threads WHERE campaign=? AND parent_channel_id=?').all(config.campaignId,config.channelId)) config.characterThreadIds.add(row.thread_id);
  const inFlight=new Map();
  const get=scope=>store.db.prepare('SELECT * FROM character_threads WHERE campaign=? AND owner=?').get(scope.campaign,scope.owner);
  async function verify(thread) {
    if (!thread || thread.type!==ChannelType.PrivateThread || thread.parentId!==config.channelId || thread.guildId!==config.guildId || thread.invitable!==false || thread.ownerId!==client.user.id) throw Error('The recorded character thread is not privately bound to this campaign. No replacement was created.');
  }
  async function perform(scope,character) {
    let row=get(scope),reused=Boolean(row);
    let thread,parent;
    if(row){
      if(row.parent_channel_id!==config.channelId)throw Error('The recorded parent differs from this campaign.');
      thread=await client.channels.fetch(row.thread_id,{force:true});await verify(thread);
      // Older rows already sent their introduction before being committed.
      store.db.prepare("INSERT OR IGNORE INTO character_thread_delivery VALUES(?,?,'bound','sent','sent')").run(scope.campaign,scope.owner);
    }else{
      parent=await client.channels.fetch(config.channelId,{force:true});
      if(parent?.type!==ChannelType.GuildText || parent.guildId!==config.guildId || !parent.threads?.create)throw Error('Configured campaign parent must be a text channel in the verified guild.');
      // This committed reservation prevents another instance or a restart from
      // duplicating a remote creation whose response may have been lost.
      const reserved=store.db.prepare("INSERT OR IGNORE INTO character_thread_delivery(campaign,owner,state) VALUES(?,?,'creating')").run(scope.campaign,scope.owner);
      if(!reserved.changes)throw Error('A previous thread creation needs reconciliation in Discord before retrying. No duplicate was created.');
      thread=await parent.threads.create({name:`${safeName(character.name)} · private table`,type:ChannelType.PrivateThread,invitable:false,reason:`Raphael private character thread for ${scope.owner}`});
      if(!snowflake(thread?.id))throw Error('Discord did not return a thread identity. Reconcile the pending creation before retrying.');
      // Persist identity before membership, introductory messages or validation.
      row={campaign:scope.campaign,owner:scope.owner,character_revision:Number(character.revision)||0,thread_id:thread.id,parent_channel_id:config.channelId,created_at:Date.now()};
      store.db.prepare('INSERT INTO character_threads VALUES(?,?,?,?,?,?)').run(row.campaign,row.owner,row.character_revision,row.thread_id,row.parent_channel_id,row.created_at);
      await verify(thread);
      store.db.prepare("UPDATE character_thread_delivery SET state='bound' WHERE campaign=? AND owner=?").run(scope.campaign,scope.owner);
    }
    const permitted=new Set([scope.owner,client.user.id,...(config.dmIds??[])]);
    // Refuse unexpected existing members instead of removing people or sending
    // private character information to a thread with broader access.
    const members=await thread.members.fetch();
    if([...members.keys()].some(id=>!permitted.has(id)))throw Error('Unexpected members are present in the private thread. Review access before delivery.');
    if(thread.archived)await thread.setArchived(false,'Restore the existing private campaign thread');
    for(const id of [scope.owner,...(config.dmIds??[])]){
      await thread.members.add(id);
      const joined=await thread.members.fetch({member:id,force:true});
      if(joined.id!==id)throw Error('Private thread membership could not be confirmed.');
    }
    config.characterThreadIds.add(thread.id);
    async function sendOnce(field,send) {
      const status=store.db.prepare('SELECT * FROM character_thread_delivery WHERE campaign=? AND owner=?').get(scope.campaign,scope.owner);
      if(status[field]!=='new')return;
      // Mark before dispatch: an uncertain send is never automatically repeated.
      const reserved=store.db.prepare(`UPDATE character_thread_delivery SET ${field}='pending' WHERE campaign=? AND owner=? AND ${field}='new'`).run(scope.campaign,scope.owner);
      if(!reserved.changes)return;
      await send();
      store.db.prepare(`UPDATE character_thread_delivery SET ${field}='sent' WHERE campaign=? AND owner=?`).run(scope.campaign,scope.owner);
    }
    const allowed_mentions={parse:[]};
    await sendOnce('welcome',()=>thread.send({allowed_mentions,content:`## ${safeName(character.name)} · private character table\nYour character details, personal images, rolls, inventory and rewards belong here. Sharing rewards with the company is your choice. Shared campaign events remain in <#${config.channelId}>.`}));
    await sendOnce('announcement',async()=>{parent??=await client.channels.fetch(config.channelId,{force:true});if(parent.guildId!==config.guildId||parent.type!==ChannelType.GuildText)throw Error('Campaign parent changed.');return parent.send({allowed_mentions,content:`**${safeName(character.name)}** joined the campaign. Private character thread: <#${thread.id}>\nShared scenes remain in this campaign channel.`});});
    const status=store.db.prepare('SELECT * FROM character_thread_delivery WHERE campaign=? AND owner=?').get(scope.campaign,scope.owner);
    log({outcome:'character_thread_ready',campaign:scope.campaign,owner:scope.owner,threadId:thread.id});
    return {...row,reused,deliveryNeedsReview:status.welcome==='pending'||status.announcement==='pending'};
  }
  async function ensure(scope,character) {
    if(scope?.campaign!==config.campaignId || !snowflake(scope?.owner) || !snowflake(config.channelId) || !snowflake(config.guildId) || !snowflake(client.user?.id) || !character?.name || (config.dmIds??[]).some(id=>!snowflake(id)))throw Error('A matching campaign, verified Discord identities and approved character are required.');
    const key=JSON.stringify([scope.campaign,scope.owner]);
    if(inFlight.has(key))return inFlight.get(key);
    const job=perform(scope,character);inFlight.set(key,job);
    try{return await job;}finally{inFlight.delete(key);}
  }
  return {ensure};
}
