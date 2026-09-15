import {createHash} from 'node:crypto';
import {DiscordAuth} from '../../../raphael-council/auth/discord.mjs';
const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
// The host supplies a dedicated OAuth database; gameplay remains in the open table store.
export function createCoastAuth({db,binding,config,fetchImpl,now}){
 if(![binding?.guildId,binding?.applicationId,binding?.gmUserId].every(snowflake)||config?.clientId!==binding.applicationId||!config.secret||!config.token)throw Error('Explicit Coast OAuth configuration required.');
 const publicUrl=new URL(config.publicOrigin);if(publicUrl.protocol!=='https:'||publicUrl.origin!==config.publicOrigin)throw Error('Coast sign-in requires its public HTTPS origin.');
 if(!Array.isArray(binding.members)||binding.members.some(m=>!snowflake(m.ownerId)||typeof m.actorId!=='string')||new Set(binding.members.map(m=>m.ownerId)).size!==binding.members.length||new Set(binding.members.map(m=>m.actorId)).size!==binding.members.length)throw Error('Unique Coast membership required.');
 const gm=binding.gmUserId,players=new Set(binding.members.map(m=>m.ownerId)),campaign='the-unwritten-coast';
 const cookieNamespace=createHash('sha256').update(JSON.stringify([campaign,binding.guildId,binding.applicationId])).digest('hex').slice(0,24);
 const scoped={...config,campaign,guild:binding.guildId,dmIds:[gm],playerIds:[...players],cookieNamespace,activityOrigin:`https://${binding.applicationId}.discordsays.com`};
 // DiscordAuth independently verifies current guild membership and eligibility on every session use.
 const game={readMember:({campaign:requested,owner})=>requested!==campaign?null:owner===gm?'host':players.has(owner)?'player':null};
 return new DiscordAuth({db,game,config:scoped,...(fetchImpl?{fetchImpl}:{}),...(now?{now}:{})});
}
