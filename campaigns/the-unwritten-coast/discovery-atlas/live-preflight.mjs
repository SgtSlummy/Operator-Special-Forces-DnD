// GET-only destination verification. Load the existing gateway environment with node --env-file.
// Never print credentials, full messages, database payloads or private inventories.
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile} from 'node:fs/promises';
const guildId='1463393482306486387',channelId='1546676505780944979',storyId='1548204446838689882',applicationId='1540006061099188274';
if(process.env.DISCORD_APPLICATION_ID!==applicationId||!process.env.DISCORD_TOKEN)throw Error('Expected Davy identity is required.');
async function get(path){const response=await fetch('https://discord.com/api/v10'+path,{method:'GET',headers:{Authorization:'Bot '+process.env.DISCORD_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)return {unavailable:true,status:response.status};return response.json();}
const bot=await get('/users/@me');if(bot.id!==applicationId)throw Error('Davy identity could not be verified.');
const [guild,channel,story,active]=await Promise.all([get(`/guilds/${guildId}`),get(`/channels/${channelId}`),get(`/channels/${storyId}`),get(`/guilds/${guildId}/threads/active`)]);
if(channel.id!==channelId||channel.guild_id!==guildId)throw Error('Campaign destination could not be verified.');
const describe=c=>c.unavailable?c:{id:c.id,name:c.name,type:c.type,parentId:c.parent_id,ownerId:c.owner_id,archived:c.thread_metadata?.archived,invitable:c.thread_metadata?.invitable};
const messages=story.id===storyId?await get(`/channels/${storyId}/messages?limit=5`):[];
const db=new DatabaseSync(new URL('../../../raphael-council/.runtime/game/game.sqlite',import.meta.url),{readOnly:true});
let database;
try{database={campaigns:db.prepare('SELECT id,revision FROM game_campaigns').all(),memberships:db.prepare('SELECT campaign,owner,role FROM game_members').all(),membershipColumns:db.prepare('PRAGMA table_info(game_members)').all().map(c=>c.name),campaignColumns:db.prepare('PRAGMA table_info(game_campaigns)').all().map(c=>c.name),savedHostOwners:[...new Set(db.prepare('SELECT owner FROM game_members WHERE role=?').all('host').map(r=>r.owner).filter(id=>/^\d{17,20}$/.test(id)))]};}finally{db.close();}
const candidateOwners=await Promise.all([...new Set([story.owner_id,...database.savedHostOwners].filter(Boolean))].map(async id=>{const member=await get(`/guilds/${guildId}/members/${id}`);return member.unavailable?{id,...member}:{id:member.user.id,name:member.nick??member.user.global_name??member.user.username,bot:member.user.bot===true};}));
const report={candidateOwners,readOnly:true,checkedAt:new Date().toISOString(),bot:{id:bot.id,name:bot.username},guild:{id:guild.id,name:guild.name,ownerId:guild.owner_id},channel:describe(channel),story:describe(story),visibleActiveCampaignThreads:active.unavailable?active:(active.threads??[]).filter(t=>t.parent_id===channelId).map(describe),recentStoryMessages:Array.isArray(messages)?messages.map(m=>({id:m.id,authorId:m.author?.id,bot:m.author?.bot,embeds:m.embeds?.length??0,components:m.components?.length??0,attachments:(m.attachments??[]).map(a=>({filename:a.filename,contentType:a.content_type}))})):messages,database,adapterConfigured:process.env.UNWRITTEN_COAST_ENABLED==='true'||process.env.UNWRITTEN_COAST_ENABLED==='1'};
if(process.argv.includes('--report')){
 const directory='C:/Users/Hermes/LocalFiles/UnwrittenCoast/live-preflight';await mkdir(directory,{recursive:true});
 const file=directory+'/'+report.checkedAt.replace(/[:.]/g,'-')+'.json';
 await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({readOnly:true,report:file,adapterConfigured:report.adapterConfigured}));
}else console.log(JSON.stringify(report,null,2));
