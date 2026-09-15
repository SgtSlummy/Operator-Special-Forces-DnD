import {win32,posix} from 'node:path';
const fail=()=>{throw new Error('REHEARSAL_GATEWAY_CONFIGURATION_INVALID');};
function localPath(value){
 if(typeof value!=='string'||value!==value.trim()||!value||/[\u0000-\u001f\u007f]/.test(value)||/^[\\/]{2}/.test(value)||/(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(value)||/(?:^|[\\/])\.\.?([\\/]|$)/.test(value)||/:/.test(value.slice(2)))fail();
 if(!/^[A-Za-z]:[\\/]/.test(value)&&!posix.isAbsolute(value))fail();
 return value;
}
const normalized=value=>localPath(value).replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
const directory=value=>(/^[A-Za-z]:/.test(value)?win32:posix).dirname(value);
const hollowKeys=['CAMPAIGN_ID','ENGINE_URL','SECRET_FILE','STORE_FILE','ACTIVITY_DATA_DIR','RUNTIME_ROOT','ART_ROOT','ROOM_ART_FILE','MATERIALS_FILE','SCENE_ART_DIR','GUILD_ID','CHANNEL_ID','GM_ID'].map(key=>'HOLLOW_LANTERN_'+key);
const raphaelKeys=['CAMPAIGN_ID','GUILD_ID','DM_IDS','PLAYER_IDS','PLAYER_ROLE_ID','DM_ROLE_ID','PUBLIC_ORIGIN','LOCAL_HOST'].map(key=>'RAPHAEL_'+key);
const disabled=['DAVY_LAUNCHERS_ON_START','DAVY_MUSIC_PROJECTION_ON_START','HOLLOW_LANTERN_PUBLISH_ON_START','HOLLOW_LANTERN_AI_ENABLED','HOLLOW_LANTERN_AUTOPLAY_ENABLED','HOLLOW_LANTERN_ENROLLMENT_ENABLED','HOLLOW_LANTERN_COMMIT_EVENTS_ENABLED','HOLLOW_LANTERN_PREPARE_SCENE_ART_ON_START','RAPHAEL_CHRONICLE_ENABLED','UNWRITTEN_COAST_ENABLED'];

/** Pure preparation: no key reads, directory creation, manifest copying, or process startup. */
export function composeRehearsalGateway({activityEnv,draftFile,rpcSecretFile,webPort}={}){
 if(!activityEnv||typeof activityEnv!=='object'||Array.isArray(activityEnv))fail();
 const campaignId=activityEnv.HOLLOW_LANTERN_CAMPAIGN_ID;
 if(typeof campaignId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(campaignId)||activityEnv.RAPHAEL_CAMPAIGN_ID!==campaignId)fail();
 for(const key of ['HOLLOW_LANTERN_GUILD_ID','HOLLOW_LANTERN_CHANNEL_ID','HOLLOW_LANTERN_GM_ID','DISCORD_APPLICATION_ID'])if(!/^[1-9]\d{16,19}$/.test(activityEnv[key]??''))fail();
 if(activityEnv.DISCORD_CLIENT_ID&&activityEnv.DISCORD_CLIENT_ID!==activityEnv.DISCORD_APPLICATION_ID)fail();
 const endpoint=activityEnv.HOLLOW_LANTERN_ENGINE_URL;let engine;
 if(typeof endpoint!=='string'||!/^http:\/\/(127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/.test(endpoint))fail();
 try{engine=new URL(endpoint);}catch{fail();}
 if(!Number.isSafeInteger(webPort)||webPort<1024||webPort>65535||webPort===Number(engine.port||80)||webPort===18796)fail();
 for(const key of ['HOLLOW_LANTERN_SECRET_FILE','HOLLOW_LANTERN_STORE_FILE','HOLLOW_LANTERN_ACTIVITY_DATA_DIR','HOLLOW_LANTERN_RUNTIME_ROOT','HOLLOW_LANTERN_ART_ROOT'])localPath(activityEnv[key]);
 localPath(draftFile);localPath(rpcSecretFile);if(normalized(draftFile)===normalized(rpcSecretFile))fail();
 const reserved=[];
 for(const [key,value]of Object.entries(activityEnv))if(/(?:FILE|DIR|ROOT)$/.test(key)&&typeof value==='string'&&value){try{reserved.push(normalized(value));}catch{/* Unrelated infrastructure values are not interpreted as file bindings. */}}
 if(activityEnv.HOLLOW_LANTERN_SPACES_FILE)reserved.push(normalized((/^[A-Za-z]:/.test(activityEnv.HOLLOW_LANTERN_SPACES_FILE)?win32:posix).join(directory(activityEnv.HOLLOW_LANTERN_SPACES_FILE),'investigation-drafts.json')));
 if([draftFile,rpcSecretFile].some(path=>reserved.includes(normalized(path))))fail();
 const env={};
 // Keep ordinary Davy infrastructure and credentials, remove inherited campaign services.
 for(const [key,value]of Object.entries(activityEnv))if(!/^(?:HOLLOW_LANTERN_|HOLLOW_ACTIVITY_|RAPHAEL_|UNWRITTEN_COAST_)/.test(key))env[key]=value;
 for(const key of [...hollowKeys,...raphaelKeys])if(Object.hasOwn(activityEnv,key))env[key]=activityEnv[key];
 for(const key of disabled)env[key]='false';
 const rpcUrl=`http://127.0.0.1:${webPort}`;
 Object.assign(env,{HOLLOW_LANTERN_ENABLED:'true',HOLLOW_LANTERN_DRAFT_FILE:draftFile,HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:rpcSecretFile,HOLLOW_LANTERN_DRAFT_RPC_URL:rpcUrl,HOLLOW_LANTERN_WEB_PORT:String(webPort)});
 const connectedActivityEnv={...env};
 const summary={version:1,campaignId,engineUrl:endpoint,nativeWebUrl:rpcUrl,draftFile,rpcSecretFile,activityDataDir:activityEnv.HOLLOW_LANTERN_ACTIVITY_DATA_DIR,campaignStore:activityEnv.HOLLOW_LANTERN_STORE_FILE,spaces:'not-configured',automaticStartup:false,chronicle:false,enrollment:false,voice:false,ai:false,commitFollower:false,pathValidation:'lexical-only; verify physical paths before activation'};
 return Object.freeze({env:Object.freeze(env),activityEnv:Object.freeze(connectedActivityEnv),summary:Object.freeze(summary)});
}
