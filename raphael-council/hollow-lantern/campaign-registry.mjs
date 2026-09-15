import {realpathSync,statSync} from 'node:fs';
import {isAbsolute,resolve,dirname,basename,join} from 'node:path';
import {AuthError} from '../auth/discord.mjs';

const fields=['campaignId','guildId','channelId','gmUserId','storeFile','activityDataDir','engineUrl','secretFile','artRoot','materialsFile','draftRpcUrl','draftRpcSecretFile'];
const pathFields=['storeFile','activityDataDir','secretFile','artRoot','materialsFile','draftRpcSecretFile'];
const privateFields=['storeFile','activityDataDir','secretFile','draftRpcSecretFile'];
const cloud=path=>path.split(/[\\/]/).some(part=>/^onedrive(?:$|[ -])/i.test(part));
function localPath(path){
 if(typeof path!=='string'||!isAbsolute(path)||path.startsWith('\\\\')||path.startsWith('//')||cloud(path))throw Error('Dedicated local campaign paths required.');
 let parent=resolve(path),tail=[];
 for(;;){try{parent=realpathSync(parent);break;}catch(error){if(error.code!=='ENOENT')throw error;const next=dirname(parent);if(next===parent)throw error;tail.unshift(basename(parent));parent=next;}}
 const canonical=join(parent,...tail);if(cloud(canonical))throw Error('Dedicated local campaign paths required.');return canonical;
}
/** Configuration is copied, frozen and checked before any campaign is opened. */
export function createCampaignCatalog(entries,{defaultCampaignId}={}){
 if(!Array.isArray(entries)||entries.length<1||entries.length>32)throw Error('A bounded campaign catalog is required.');
 const configs=new Map(),privatePaths=[],endpoints=new Set(),draftEndpoints=new Set(),channels=new Set();
 for(const input of entries){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key)))throw Error('Invalid campaign configuration.');
  const config={...input};
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(config.campaignId??'')||configs.has(config.campaignId))throw Error('Invalid or duplicate campaign identity.');
  for(const field of ['guildId','channelId','gmUserId'])if(typeof config[field]!=='string'||!config[field]||config[field].length>128)throw Error('Explicit Discord campaign bindings required.');
  if((config.draftRpcUrl!==undefined)!==(config.draftRpcSecretFile!==undefined))throw Error('Draft RPC endpoint and secret must be configured together.');
  for(const field of pathFields)if(!['materialsFile','draftRpcSecretFile'].includes(field)||config[field]!==undefined)config[field]=localPath(config[field]);
  if(config.draftRpcUrl!==undefined){
   if(typeof config.draftRpcUrl!=='string'||!/^http:\/\/127\.0\.0\.1(?::\d{1,5})?\/?$/.test(config.draftRpcUrl))throw Error('Explicit literal loopback draft RPC URL required.');
   let rpc;try{rpc=new URL(config.draftRpcUrl);}catch{throw Error('Explicit local draft RPC URL required.');}
   if(rpc.port==='0')throw Error('Explicit local draft RPC port required.');
   if(!statSync(config.draftRpcSecretFile).isFile()||config.draftRpcSecretFile.toLowerCase()===config.secretFile.toLowerCase())throw Error('Dedicated draft RPC secret file required.');
   const endpoint=`loopback:${rpc.port||'80'}`;if(draftEndpoints.has(endpoint))throw Error('Campaign draft RPC endpoints must not alias.');draftEndpoints.add(endpoint);config.draftRpcUrl=rpc.origin;
  }
  for(const field of privateFields){if(config[field]===undefined)continue;const path=config[field].replaceAll('\\','/').toLowerCase();if(privatePaths.some(other=>other.campaignId!==config.campaignId&&(path===other.path||path.startsWith(other.path+'/')||other.path.startsWith(path+'/'))))throw Error('Campaign private paths must not alias.');privatePaths.push({campaignId:config.campaignId,path});}
  let url;try{url=new URL(config.engineUrl);}catch{throw Error('Explicit local campaign engine URL required.');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Explicit local campaign engine URL required.');
  const endpoint=`loopback:${url.port||'80'}`;if(endpoints.has(endpoint))throw Error('Campaign engine endpoints must not alias.');endpoints.add(endpoint);config.engineUrl=url.origin;
  const channel=JSON.stringify([config.guildId,config.channelId]);if(channels.has(channel))throw Error('Campaign Discord channels must not alias.');channels.add(channel);
  configs.set(config.campaignId,Object.freeze(config));
 }
 if(!configs.has(defaultCampaignId))throw Error('A known default campaign is required.');
 return Object.freeze({defaultCampaignId,ids:Object.freeze([...configs.keys()]),get(id=defaultCampaignId){const config=configs.get(id);if(!config)throw new AuthError('Unknown campaign.',404);return config;}});
}

/** Platforms contain authentication only; engine runtimes require current membership. */
export function createCampaignRegistry({catalog,createPlatform,createRuntime}){
 const platforms=new Map(),runtimes=new Map();
 function platform(id){const config=catalog.get(id);if(!platforms.has(config.campaignId))platforms.set(config.campaignId,createPlatform(config));return platforms.get(config.campaignId);}
 // This synchronous API is for trusted server callers preserving the legacy interface.
 function runtime(id){const config=catalog.get(id);if(!runtimes.has(config.campaignId))runtimes.set(config.campaignId,createRuntime(config,platform(config.campaignId)));return runtimes.get(config.campaignId);}
 async function authenticatedRuntime(id,request){
  const config=catalog.get(id),{auth}=platform(config.campaignId),session=await auth.authenticate(request);
  if(!session||session.campaign!==config.campaignId||typeof session.owner!=='string'||!['host','player'].includes(session.role))throw new AuthError('Sign in to the selected campaign.',401);
  const member=await auth.member(session.owner);
  if(!member||member.campaign!==config.campaignId||member.role!==session.role)throw new AuthError('Current campaign membership is required.',403);
  return runtime(config.campaignId);
 }
 return Object.freeze({catalog,platform,runtime,authenticatedRuntime});
}
