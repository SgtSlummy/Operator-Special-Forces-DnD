import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,isAbsolute,parse,relative,join} from 'node:path';
import {composeRehearsalGateway} from './rehearsal-gateway.mjs';
const fail=()=>{throw new Error('REHEARSAL_BINDING_INVALID');};
const comparable=path=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
function lexical(path){
 if(typeof path!=='string'||!isAbsolute(path)||path!==path.trim()||/[\u0000-\u001f\u007f]/.test(path)||/^[\\/]{2}/.test(path)||/(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(path)||/(?:^|[\\/])\.\.?([\\/]|$)/.test(path)||/:/.test(path.slice(2)))fail();return resolve(path);
}
async function physical(path,directory=false,limit=Infinity){
 const absolute=lexical(path);let cursor=parse(absolute).root;const parts=relative(cursor,absolute).split(/[\\/]/).filter(Boolean);let info;
 for(let index=0;index<parts.length;index++){
  cursor=join(cursor,parts[index]);info=await lstat(cursor);if(info.isSymbolicLink())fail();
  if(index<parts.length-1&&!info.isDirectory())fail();
 }
 info??=await lstat(absolute);
 if(directory?!info.isDirectory():!info.isFile()||info.nlink!==1||info.size>limit)fail();
 if(comparable(await realpath(absolute))!==comparable(absolute))fail();return {path:absolute,info};
}
async function boundedRead(path,limit){
 const checked=await physical(path,false,limit),handle=await open(checked.path,'r');
 try{
  const current=await handle.stat();if(current.dev!==checked.info.dev||current.ino!==checked.info.ino||current.nlink!==1||current.size>limit)fail();
  const buffer=Buffer.alloc(limit+1);let offset=0;
  while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  if(offset>limit)fail();return buffer.subarray(0,offset).toString('utf8');
 }finally{await handle.close();}
}

/** Read an explicitly prepared binding. Never changes selection, provisions spaces, or starts services. */
export async function readRehearsalBinding({file,activityEnv}={}){
 try{
  const descriptor=JSON.parse(await boundedRead(file,16384));
  const keys=['version','kind','campaignId','engineUrl','guildId','channelId','gmUserId','applicationId','draftFile','rpcSecretFile','webPort','activityDataDir','campaignStore'];
  if(!descriptor||Array.isArray(descriptor)||Object.keys(descriptor).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptor,key))||descriptor.version!==1||descriptor.kind!=='hollow-lantern-rehearsal-binding')fail();
  const bindings={campaignId:'HOLLOW_LANTERN_CAMPAIGN_ID',engineUrl:'HOLLOW_LANTERN_ENGINE_URL',guildId:'HOLLOW_LANTERN_GUILD_ID',channelId:'HOLLOW_LANTERN_CHANNEL_ID',gmUserId:'HOLLOW_LANTERN_GM_ID',applicationId:'DISCORD_APPLICATION_ID'};
  for(const [key,envKey]of Object.entries(bindings))if(descriptor[key]!==activityEnv?.[envKey])fail();
  for(const [key,envKey]of [['activityDataDir','HOLLOW_LANTERN_ACTIVITY_DATA_DIR'],['campaignStore','HOLLOW_LANTERN_STORE_FILE']])if(comparable(lexical(descriptor[key]))!==comparable(lexical(activityEnv[envKey])))fail();
  const built=composeRehearsalGateway({activityEnv,draftFile:descriptor.draftFile,rpcSecretFile:descriptor.rpcSecretFile,webPort:descriptor.webPort});
  const paths=[file,descriptor.draftFile,descriptor.rpcSecretFile,descriptor.campaignStore,activityEnv.HOLLOW_LANTERN_SECRET_FILE];
  if(new Set(paths.map(path=>comparable(lexical(path)))).size!==paths.length)fail();
  await physical(descriptor.draftFile,false,4*1024*1024);await physical(descriptor.campaignStore,false);
  for(const path of [descriptor.activityDataDir,activityEnv.HOLLOW_LANTERN_RUNTIME_ROOT,activityEnv.HOLLOW_LANTERN_ART_ROOT])await physical(path,true);
  const secret=(await boundedRead(descriptor.rpcSecretFile,4096)).trim(),engineSecret=(await boundedRead(activityEnv.HOLLOW_LANTERN_SECRET_FILE,4096)).trim();
  if(Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>512||/[\s\u0000-\u001f\u007f]/u.test(secret)||[engineSecret,activityEnv.DISCORD_TOKEN,activityEnv.DISCORD_BOT_TOKEN,activityEnv.DISCORD_CLIENT_SECRET].filter(Boolean).includes(secret))fail();
  return built;
 }catch{fail();}
}
