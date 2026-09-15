import {lstat,realpath,readFile} from 'node:fs/promises';
import {isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createEngineClient} from './engine-client.mjs';
import {readCampaignSummary} from './campaign-summary.mjs';

const local = path => typeof path==='string' && isAbsolute(path) && !/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(path);
const snowflake = value => /^\d{17,20}$/.test(value??'');
async function validatePath(path,kind,allowMissing=false) {
  if(!local(path))throw Error();
  let stat;try{stat=await lstat(path);}catch(error){
    if(error.code!=='ENOENT'||!allowMissing)throw error;
    const parent=dirname(path);if(parent===path)throw Error();
    await validatePath(parent,'directory',true);return;
  }
  if(stat.isSymbolicLink()||!local(await realpath(path))||(kind==='file'?!stat.isFile():!stat.isDirectory()))throw Error();
  if(kind==='file'&&stat.nlink!==1)throw Error();
}
async function boundedFile(path,max) {
  await validatePath(path,'file');const stat=await lstat(path);if(stat.size>max)throw Error();
  const bytes=await readFile(path);if(bytes.length>max)throw Error();return bytes;
}

/** No host construction, database initialization, commands, or provider calls. */
export async function inspectStartup({env,fetchImpl=globalThis.fetch,timeoutMs=2500}={}) {
  const checks=[];
  const add=(id,label,status,message)=>checks.push({id,label,status,message});
  const result=()=>({status:checks.some(c=>c.status==='blocked')?'blocked':'ready',checks});
  if(!env||typeof env!=='object'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000){add('configuration','Configuration','blocked','Startup configuration is invalid.');return result();}
  let state,client;
  try {
    if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(env.HOLLOW_LANTERN_CAMPAIGN_ID??'')||![env.HOLLOW_LANTERN_CHANNEL_ID,env.HOLLOW_LANTERN_GUILD_ID,env.HOLLOW_LANTERN_GM_ID].every(snowflake))throw Error();
    state=readCampaignSummary(env.HOLLOW_LANTERN_STORE_FILE).state;
    if(state.version!==2||state.campaignId!==env.HOLLOW_LANTERN_CAMPAIGN_ID||state.channelId!==env.HOLLOW_LANTERN_CHANNEL_ID||state.gmId!==env.HOLLOW_LANTERN_GM_ID||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.actors))throw Error();
    add('save','Existing campaign','ready','The existing campaign save matches its configured binding.');
  }catch {state=null;add('save','Existing campaign','blocked','The existing campaign save is missing, invalid, or bound to another campaign.');}
  try {
    if(typeof env.HOLLOW_LANTERN_ENGINE_URL!=='string'||!env.HOLLOW_LANTERN_ENGINE_URL.trim())throw Error();
    const secret=(await boundedFile(env.HOLLOW_LANTERN_SECRET_FILE,1024)).toString('utf8').trim();
    client=createEngineClient({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID,channelId:env.HOLLOW_LANTERN_CHANNEL_ID,secret,fetchImpl,timeoutMs});
    add('bridge','Engine connection settings','ready','The local signed connection is configured.');
  }catch {add('bridge','Engine connection settings','blocked','The engine address or protected credential is invalid.');}
  try {
    await validatePath(env.HOLLOW_LANTERN_ACTIVITY_DATA_DIR,'directory',true);
    if(!snowflake(env.DISCORD_CLIENT_ID)||!['DISCORD_CLIENT_SECRET','DISCORD_TOKEN'].every(k=>typeof env[k]==='string'&&env[k].trim()))throw Error();
    if(env.RAPHAEL_PUBLIC_ORIGIN){const u=new URL(env.RAPHAEL_PUBLIC_ORIGIN);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error();}
    add('auth','Discord sign-in settings','ready','Sign-in is configured; Discord consent and credential validity are not verified by this check.');
  }catch {add('auth','Discord sign-in settings','blocked','Discord sign-in settings or its local data location are invalid.');}
  if(state&&client){
    try {
      const projection=await client.project({ownerId:env.HOLLOW_LANTERN_GM_ID,audience:'public',mapLevel:'regional'});
      // Active commits may change the disk revision between reads. Binding and
      // response contracts, rather than equality with an earlier revision, govern readiness.
      add('engine','Campaign engine','ready','The configured engine returned an authorized public campaign view.');
      return {...result(),campaignId:projection.campaignId,revision:projection.revision};
    }catch {add('engine','Campaign engine','blocked','The campaign engine is unavailable or returned an invalid view.');}
  }else add('engine','Campaign engine','blocked','Repair the campaign binding before checking the engine.');
  return result();
}
