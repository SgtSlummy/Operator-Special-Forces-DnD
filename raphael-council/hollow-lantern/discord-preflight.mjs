// Read-only checks of the user's configured Davy / DMD Arcade destination.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const guildId='1463393482306486387',channelId='1546676505780944979',applicationId='1540006061099188274';
if(process.env.DISCORD_APPLICATION_ID!==applicationId||!process.env.DISCORD_TOKEN)throw new Error('Expected Davy identity is required.');
async function get(path){const r=await fetch(`https://discord.com/api/v10${path}`,{headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Discord preflight ${r.status}`);return r.json();}
const [bot,guild,channel,commands]=await Promise.all([get('/users/@me'),get(`/guilds/${guildId}`),get(`/channels/${channelId}`),get(`/applications/${applicationId}/guilds/${guildId}/commands`)]);
if(bot.id!==applicationId||channel.guild_id!==guildId||channel.id!==channelId)throw new Error('The configured game destination changed.');
const db=new DatabaseSync(new URL('../.runtime/game/game.sqlite',import.meta.url),{readOnly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%member%' OR name LIKE '%campaign%')").all();
const membershipSchema=tables.map(t=>({table:t.name,columns:db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all().map(c=>c.name)}));
const savedHosts=[...new Set(db.prepare('SELECT owner FROM game_members WHERE role=?').all('host').map(m=>m.owner).filter(id=>/^\d{17,20}$/.test(id)))];db.close();
const priorCampaignDMs=await Promise.all(savedHosts.map(async id=>{const member=await get(`/guilds/${guildId}/members/${id}`);return {id:member.user.id,name:member.nick??member.user.global_name??member.user.username,roles:member.roles};}));
const owner=await get(`/guilds/${guildId}/members/${guild.owner_id}`);
const report={bot:{id:bot.id,name:bot.username},guild:{id:guild.id,name:guild.name,ownerId:guild.owner_id},channel:{id:channel.id,name:channel.name,type:channel.type,parentId:channel.parent_id},guildOwner:{id:owner.user.id,name:owner.nick??owner.user.global_name??owner.user.username,roles:owner.roles},priorCampaignDMs,commands:commands.map(c=>({id:c.id,name:c.name})),membershipSchema,checkedAt:new Date().toISOString(),readOnly:true};
const out='C:/Users/Hermes/LocalFiles/hollow-lantern/discord-preflight';await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
