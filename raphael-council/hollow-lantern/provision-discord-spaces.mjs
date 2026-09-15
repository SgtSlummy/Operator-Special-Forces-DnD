import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
// User-confirmed identities; this setup never chooses a different guild or DM.
const guild='1463393482306486387',parent='1546676505780944979',bot='1540006061099188274',dm='1230264975533281312';
if(process.argv.slice(2).some(arg=>!['--apply','--rehearsal'].includes(arg)))throw new Error('Use --apply and/or --rehearsal.');
const rehearsal=process.argv.includes('--rehearsal');
const campaign=rehearsal?'hollow-lantern-rehearsal-20260910':'operation-hollow-lantern';
const file=rehearsal?'C:/Users/Hermes/LocalFiles/hollow-lantern/live-discord-rehearsal-20260910/discord-spaces.json':'C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons/raphael-council/.runtime/hollow-lantern/live/discord-spaces.json';
const prefix=rehearsal?'REHEARSAL · Hollow':'Hollow Lantern';
const definitions=[['dm',`${prefix} · DM`],['fighter',`${prefix} · Mara`],['rogue',`${prefix} · Kestrel`],['cleric',`${prefix} · Ash`],['shop',`${prefix} · Outfitter`]];
const apply=process.argv.includes('--apply');
if(process.env.DISCORD_APPLICATION_ID!==bot||!process.env.DISCORD_TOKEN)throw new Error('The existing Davy identity is required.');
async function request(method,path,body){
 const r=await fetch(`https://discord.com/api/v10${path}`,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`,'Content-Type':'application/json','X-Audit-Log-Reason':'Operation%20Hollow%20Lantern%20private%20campaign%20setup'},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error(`Discord setup stopped at ${method} ${path}: HTTP ${r.status}. No automatic mutation retry.`);
 return r.status===204?null:r.json();
}
const [identity,target,member,active]=await Promise.all([request('GET','/users/@me'),request('GET',`/channels/${parent}`),request('GET',`/guilds/${guild}/members/${dm}`),request('GET',`/guilds/${guild}/threads/active`)]);
if(identity.id!==bot||target.id!==parent||target.guild_id!==guild||target.type!==0||member.user?.id!==dm||member.user?.bot)throw new Error('Verified campaign identities are required.');
let manifest={campaign,guildId:guild,parentId:parent,botId:bot,dmUserId:dm,spaces:{}};
try{manifest=JSON.parse(await readFile(file,'utf8'));if(manifest.campaign!==campaign||manifest.guildId!==guild||manifest.parentId!==parent||manifest.botId!==bot||manifest.dmUserId!==dm)throw new Error('Existing space manifest mismatch.');}catch(error){if(error.code!=='ENOENT')throw error;}
const save=async()=>{await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(manifest,null,2));await rename(file+'.tmp',file);};
const plan=[];
for(const [key,name]of definitions){
 const recorded=manifest.spaces[key];
 const matches=active.threads.filter(t=>t.parent_id===parent&&t.name===name&&t.owner_id===bot);
 if(matches.length>1)throw new Error('Multiple matching campaign spaces need review.');
 let thread=recorded?await request('GET',`/channels/${recorded.id}`):matches[0];
 if(thread&&(thread.type!==12||thread.parent_id!==parent||thread.guild_id!==guild||thread.owner_id!==bot||thread.thread_metadata?.invitable!==false))throw new Error('A campaign space is not privately bound as expected.');
 plan.push({key,name,action:thread?'verify':'create-private-thread',id:thread?.id});
 if(!apply)continue;
 if(!thread)thread=await request('POST',`/channels/${parent}/threads`,{name,type:12,auto_archive_duration:1440,invitable:false});
 if(thread.type!==12||thread.parent_id!==parent||thread.guild_id!==guild)throw new Error('Created thread scope mismatch.');
 // Save the exact returned ID before the next external operation for recovery.
 manifest.spaces[key]={id:thread.id,name,parentId:parent,type:12,dmAdded:false};await save();
 if(thread.thread_metadata?.archived)await request('PATCH',`/channels/${thread.id}`,{archived:false});
 await request('PUT',`/channels/${thread.id}/thread-members/${dm}`);
 const joined=await request('GET',`/channels/${thread.id}/thread-members/${dm}`);if(joined.user_id!==dm)throw new Error('DM membership was not confirmed.');
 manifest.spaces[key].dmAdded=true;await save();
}
console.log(JSON.stringify({applied:apply,campaign,parent:{id:parent,name:target.name},dm:{id:dm,name:member.nick??member.user.global_name??member.user.username},plan,manifest:apply?file:null,messagesSent:0},null,2));
