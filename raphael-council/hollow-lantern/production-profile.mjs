import {composeRehearsalGateway} from './rehearsal-gateway.mjs';
import {productionPath,inspectProductionPath,readProductionJson} from './production-files.mjs';
import {relative,isAbsolute,resolve} from 'node:path';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const snowflake=value=>typeof value==='string'&&/^[1-9]\d{16,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
const inside=(root,file)=>{const p=relative(resolve(root),resolve(file));return !p||!isAbsolute(p)&&p!=='..'&&!p.startsWith('../')&&!p.startsWith('..\\');};
const files={storeFile:'HOLLOW_LANTERN_STORE_FILE',engineSecretFile:'HOLLOW_LANTERN_SECRET_FILE',draftFile:'HOLLOW_LANTERN_DRAFT_FILE',rpcSecretFile:'HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE',spacesFile:'HOLLOW_LANTERN_SPACES_FILE',admissionFile:'HOLLOW_LANTERN_ADMISSION_STORE_FILE',directorFile:'HOLLOW_LANTERN_DIRECTOR_RECOVERY_FILE',chronicleFile:'RAPHAEL_CHRONICLE_DB_FILE',serviceTokenFile:'RAPHAEL_OBUS_TOKEN_FILE',hostTokenFile:'RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE'};
const directories={activityDataDir:'HOLLOW_LANTERN_ACTIVITY_DATA_DIR',runtimeRoot:'HOLLOW_LANTERN_RUNTIME_ROOT',artRoot:'HOLLOW_LANTERN_ART_ROOT',generatedArtDir:'HOLLOW_LANTERN_GENERATED_ART_DIR',chronicleDataDir:'RAPHAEL_CHRONICLE_DATA_DIR'};

/** Explicit production configuration. Never reads credentials, provisions channels or starts a worker. */
export function composeProductionProfile({descriptor,infrastructureEnv={}}={}){
 const d=descriptor;
 if(!d||d.kind!=='ops-dnd-production'||d.version!==1||!/^[A-Za-z0-9_-]{1,64}$/.test(d.campaignId??'')||![d.guildId,d.channelId,d.gmUserId,d.applicationId,d.voiceChannelId,d.journalChannelId].every(snowflake))fail('PRODUCTION_BINDING_INVALID');
 if(d.admissionLimit!==100||d.recovery!=='resume-verified'||d.voice!=='shared-discord'||d.companions!==false||d.storageVersion!==2)fail('PRODUCTION_POLICY_INVALID');
 const admissionStageLimit=d.admissionStageLimit??20;if(![20,50,100].includes(admissionStageLimit))fail('PRODUCTION_ADMISSION_STAGE_INVALID');
 if(d.obusUrl!=='http://127.0.0.1:38178')fail('PRODUCTION_OBUS_BINDING_INVALID');
 const parsed=new URL(d.publicOrigin);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||d.publicOrigin!==parsed.origin)fail('PRODUCTION_ORIGIN_INVALID');
 const env={...infrastructureEnv};
 for(const [key,name] of Object.entries({...files,...directories}))env[name]=productionPath(d[key]);
 if(new Set(Object.keys(files).map(key=>resolve(d[key]).toLowerCase())).size!==Object.keys(files).length)fail('PRODUCTION_STORES_MUST_BE_DISTINCT');
 for(const key of ['storeFile','draftFile','admissionFile','directorFile','chronicleFile','engineSecretFile','rpcSecretFile','serviceTokenFile','hostTokenFile'])
  if([d.artRoot,d.generatedArtDir,resolve(d.runtimeRoot,'public'),resolve(d.runtimeRoot,'dist')].some(root=>inside(root,d[key])))fail('PRODUCTION_PRIVATE_STORE_EXPOSED');
 Object.assign(env,{HOLLOW_LANTERN_CAMPAIGN_ID:d.campaignId,RAPHAEL_CAMPAIGN_ID:d.campaignId,HOLLOW_LANTERN_ENGINE_URL:d.engineUrl,HOLLOW_LANTERN_GUILD_ID:d.guildId,RAPHAEL_GUILD_ID:d.guildId,HOLLOW_LANTERN_CHANNEL_ID:d.channelId,HOLLOW_LANTERN_GM_ID:d.gmUserId,RAPHAEL_DM_IDS:d.gmUserId,RAPHAEL_PLAYER_IDS:'',RAPHAEL_DM_ROLE_ID:'',RAPHAEL_PLAYER_ROLE_ID:'',DISCORD_APPLICATION_ID:d.applicationId,DISCORD_CLIENT_ID:d.applicationId,RAPHAEL_PUBLIC_ORIGIN:d.publicOrigin,RAPHAEL_LOCAL_HOST:'1'});
 const rehearsalInput={...env};delete rehearsalInput.HOLLOW_LANTERN_DRAFT_FILE;delete rehearsalInput.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE;
 const base=composeRehearsalGateway({activityEnv:rehearsalInput,draftFile:d.draftFile,rpcSecretFile:d.rpcSecretFile,webPort:d.rpcPort});
 const result={...base.env};
 for(const name of Object.values({...files,...directories}))result[name]=env[name];
 Object.assign(result,{HOLLOW_LANTERN_PRODUCTION:'true',HOLLOW_LANTERN_ADMISSION_ENABLED:'true',HOLLOW_LANTERN_ADMISSION_LIMIT:'100',HOLLOW_LANTERN_ENROLLMENT_ENABLED:'false',HOLLOW_LANTERN_AI_ENABLED:'true',HOLLOW_LANTERN_AI_COMPANIONS_ENABLED:'false',HOLLOW_LANTERN_PRODUCTION_DIRECTOR_ENABLED:'true',HOLLOW_LANTERN_AUTOPLAY_ENABLED:'false',HOLLOW_LANTERN_COMMIT_EVENTS_ENABLED:'true',HOLLOW_LANTERN_PUBLISH_ON_START:'true',HOLLOW_LANTERN_VOICE_CHANNEL_ID:d.voiceChannelId,HOLLOW_LANTERN_PLAYER_WEB_ORIGIN:d.publicOrigin,RAPHAEL_OBUS_URL:d.obusUrl,RAPHAEL_CHRONICLE_ENABLED:'true',RAPHAEL_CHRONICLE_AUTHORITY:'unity',RAPHAEL_CHRONICLE_APPLICATION_ID:d.applicationId,RAPHAEL_CHRONICLE_CAMPAIGN_ID:d.campaignId,RAPHAEL_CHRONICLE_GUILD_ID:d.guildId,RAPHAEL_CHRONICLE_CHANNEL_ID:d.channelId,RAPHAEL_CHRONICLE_JOURNAL_CHANNEL_ID:d.journalChannelId,RAPHAEL_CHRONICLE_RUNTIME_ROOT:d.runtimeRoot});
 // Private credential files are the sole production provider credential source.
 result.HOLLOW_LANTERN_ADMISSION_LIMIT=String(admissionStageLimit);
 delete result.RAPHAEL_OBUS_GAME_TOKEN;delete result.RAPHAEL_OBUS_HOST_CONTROL_TOKEN;
 return {env:Object.freeze(result),activityEnv:Object.freeze({...result}),summary:{kind:d.kind,version:1,campaignId:d.campaignId,gmUserId:d.gmUserId,publicOrigin:d.publicOrigin,admissionLimit:100,admissionStageLimit,voice:d.voice,storageVersion:2,recovery:d.recovery,ai:'requires-private-worker-verification',companions:false}};
}

export async function readProductionProfile({file,infrastructureEnv}={}){
 const descriptor=await readProductionJson(file),built=composeProductionProfile({descriptor,infrastructureEnv});
 for(const key of Object.keys(directories))await inspectProductionPath(descriptor[key],{directory:true});
 // The authority, shared draft state and Chronicle schema must be explicitly initialized.
 for(const key of ['storeFile','engineSecretFile','draftFile','rpcSecretFile','spacesFile','chronicleFile','serviceTokenFile','hostTokenFile'])await inspectProductionPath(descriptor[key]);
 const spaces=await readProductionJson(descriptor.spacesFile,262144);
 if(spaces.campaign!==descriptor.campaignId||spaces.guildId!==descriptor.guildId||spaces.parentId!==descriptor.channelId||spaces.botId!==descriptor.applicationId||spaces.dmUserId!==descriptor.gmUserId)fail('PRODUCTION_SPACES_MISMATCH');
 return {...built,descriptor};
}

export function productionReadiness(checks){
 const required=['storage','engine','authentication','admission','ai','voice','publication','recovery'];
 const components=Object.fromEntries(required.map(name=>[name,checks?.[name]??'unchecked']));
 return {status:required.every(name=>components[name]==='ready')?'ready':'blocked',components};
}
