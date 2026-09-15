import {loadHollowLanternMaterials} from './terrain-materials.mjs';
import {selectSceneArt} from './scene-art.mjs';
import {createActivityDraftBoundary,isActivityDraftAction} from './activity-drafts.mjs';
import {createRemoteDraftStore,createRemoteAdmission} from './draft-store-rpc.mjs';
import {createCampaignCatalog,createCampaignRegistry} from './campaign-registry.mjs';
import {readFile} from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DiscordAuth,AuthError,guardOrigin,authConfig} from '../auth/discord.mjs';
import {createEngineMembership} from './engine-membership.mjs';
import {createEngineClient,EngineError} from './engine-client.mjs';
import {createGameService} from './service.mjs';
import {renderTacticalMap,renderIllustratedOverview} from '../discord/hollow-lantern/renderers.mjs';

export const usesHollowAuthority=(env=process.env)=>Boolean(env.HOLLOW_LANTERN_CAMPAIGNS_FILE)||env.RAPHAEL_CAMPAIGN_ID==='operation-hollow-lantern'||Boolean(env.HOLLOW_LANTERN_CAMPAIGN_ID&&env.RAPHAEL_CAMPAIGN_ID===env.HOLLOW_LANTERN_CAMPAIGN_ID);
const local=path=>{if(!isAbsolute(path??'')||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(path))throw new Error('Dedicated local Activity paths required');return path;};
const platformKey=Symbol.for('hollow.activity.platform'),runtimeKey=Symbol.for('hollow.activity.runtime');
export function getHollowPlatform(env=process.env,selectedCampaign=undefined){
 if(env.HOLLOW_LANTERN_CAMPAIGNS_FILE)return getActivityCampaignRegistry(env).platform(selectedCampaign);
 if(selectedCampaign!==undefined&&selectedCampaign!==(env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern'))throw new AuthError('Unknown campaign.',404);
 const binding=legacyBinding(env);if(globalThis[platformKey]&&globalThis[platformKey].binding!==binding)throw Error('Activity configuration changed; reconstruct the server runtime.');
 if(!usesHollowAuthority(env))throw new Error('Hollow Activity authority is not configured');
 if(!globalThis[platformKey]){
  const config=authConfig(env),campaignId=env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern';
  if(config.campaign!==campaignId||config.guild!==env.HOLLOW_LANTERN_GUILD_ID||!config.dmIds.includes(env.HOLLOW_LANTERN_GM_ID))throw new Error('Activity Discord campaign bindings mismatch');
  const membership=createEngineMembership({file:local(env.HOLLOW_LANTERN_STORE_FILE),campaignId,channelId:env.HOLLOW_LANTERN_CHANNEL_ID});
  const directory=local(env.HOLLOW_LANTERN_ACTIVITY_DATA_DIR);mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(join(directory,'oauth.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  globalThis[platformKey]={binding,experience:'hollow-lantern',db,auth:new DiscordAuth({db,game:membership,config,...(config.admissionEnabled?{verifyMember:async scope=>{await createActivityAdmission(env).status(scope);return true;}}:{})}),membership};
 }return globalThis[platformKey];
}
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Cookie'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const cookieKey=request=>createHash('sha256').update(request.headers.get('cookie')??'').digest('hex');
async function input(request){const reader=request.body?.getReader();if(!reader)throw new AuthError('Action details required',400);let size=0;const chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192)throw new AuthError('Action too large',413);chunks.push(Buffer.from(value));}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString());}

/** Only authenticated Discord identity enters scopes. Views are bound to that
 * browser session, character, audience, map level and committed engine revision. */
export function createActivityRuntime({auth,client,gmUserId,renderAssets={},draftStore,admission,onCommit=async()=>{},now=Date.now}){
 const controls=new Map(),submitted=new Set();
 const authorize=async scope=>{try{const current=await auth.member(scope.userId);if(current?.campaign!==client.campaignId||!current.role)return false;if(scope.audience==='gm')return current.role==='host'&&scope.userId===gmUserId;const p=await client.project({ownerId:scope.userId,actorId:scope.actorId,audience:'private',mapLevel:scope.mapLevel});return p.characterId===scope.actorId&&(scope.userId===gmUserId&&current.role==='host'||p.characters?.some(c=>c.characterId===scope.actorId&&c.ownerId===scope.userId));}catch(error){if((error instanceof AuthError||error instanceof EngineError)&&error.status===503)throw error;return false;}};
 const service=createGameService({client,authorize});
 // The owning runtime supplies storage; this runtime never opens a second writer.
 async function identity(request){const s=await auth.authenticate(request);if(!s||s.campaign!==client.campaignId||!s.role)throw new AuthError('Sign in to the current campaign.',401);return s;}
 async function boundScope(request){const s=await identity(request),u=new URL(request.url);let actorId=u.searchParams.get('actorId')??'';if(s.actorId){if(actorId&&actorId!==s.actorId)throw new AuthError('This session belongs to one character.',403);actorId=s.actorId;}const mapLevel=u.searchParams.get('level')??'tactical';if(!['tactical','dungeon','regional'].includes(mapLevel))throw new AuthError('Choose a supported map.',400);
  if(!actorId&&s.role!=='host'){const roster=await client.project({ownerId:gmUserId,audience:'gm',mapLevel:'regional'}),owned=(roster.characters??[]).filter(c=>c.ownerId===s.owner);if(owned.length!==1)throw new AuthError('Choose one enrolled character.',403);actorId=owned[0].characterId;}
  const scope={campaignId:s.campaign,userId:s.owner,actorId:actorId||undefined,audience:actorId?'player':'gm',mapLevel,gmController:s.role==='host'};if(!await authorize(scope))throw new AuthError('This character is not available to you.',403);return scope;}
 const nearbyAvailable=(view,scope)=>{
  const map=view.map;if(scope.mapLevel!=='tactical'||!map?.viewerCharacterId)return false;
  const own=map.tokens?.find(t=>t.characterId===map.viewerCharacterId);
  return Boolean(own&&Number.isInteger(own.x)&&Number.isInteger(own.y)&&own.x>=0&&own.y>=0&&own.x<(map.width??25)&&own.y<(map.height??25)&&map.cells?.some(c=>c.x===own.x&&c.y===own.y&&c.visibility==='visible'));
 };
 const matches=(entry,scope,request)=>entry&&entry.expires>now()&&entry.cookie===cookieKey(request)&&entry.userId===scope.userId&&entry.actorId===(scope.actorId??'')&&entry.audience===scope.audience&&entry.mapLevel===scope.mapLevel;
 async function handle(operation,request){let scope,actionData,dispatched=false;try{
  if(request.method==='POST')guardOrigin(request,auth.config);
  if(operation==='admission'){if(!admission)return json({error:'Admission is not enabled.'},404);const s=await identity(request);const admissionScope={campaignId:s.campaign,userId:s.owner};if(request.method==='GET')return json(await admission.status(admissionScope));if(request.method==='POST')return json(await admission.join(admissionScope,await input(request)));return json({error:'Method not allowed'},405);}
  const session=await identity(request);if(session.role==='prospective')throw new AuthError('Complete character admission before opening the game.',403);
  scope=await boundScope(request);
  // Recheck this request's live session at every asynchronous draft boundary.
  const drafts=createActivityDraftBoundary({draftStore,service,gmUserId,onCommit,authorize:async candidate=>{
   const sessionMatches=session=>session.owner===candidate.userId&&session.campaign===candidate.campaignId&&session.role==='player'&&(!session.actorId||session.actorId===candidate.actorId);
   if(!sessionMatches(await identity(request))||!await authorize(candidate))return false;
   return sessionMatches(await identity(request));
  }});
  if(operation==='draft'&&request.method==='GET')return json({draft:await drafts.get(scope)});
  if(operation==='draft-save'&&request.method==='POST'){
   const data=await input(request);
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['viewToken','actionId','input','expectedDraftVersion'].includes(k)))throw new AuthError('Invalid draft details.',400);
   const entry=controls.get(data.viewToken);if(!matches(entry,scope,request))throw new AuthError('Refresh this character before saving an intention.',409);
   const draft=await drafts.save(scope,{entry,actionId:data.actionId,input:data.input,expectedDraftVersion:data.expectedDraftVersion});
   return json({draft});
  }
  if(operation==='draft-try'&&request.method==='POST'){
   const data=await input(request);
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['draftId','version'].includes(k)))throw new AuthError('Choose the saved intention to attempt.',400);
   return json(await drafts.tryDraft(scope,{draftId:data.draftId,version:data.version}));
  }
    if(operation==='resolve'&&request.method==='POST'){
      const data=await input(request);
      if(!data||Array.isArray(data)||Object.keys(data).some(k=>!['commandId','expectedRevision'].includes(k))||typeof data.commandId!=='string'||!/^[a-f0-9-]{36}$/.test(data.commandId)||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||data.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new AuthError('A saved command identity and original revision are required.',400);
      const resolution=await service.resolve({...scope,commandId:data.commandId,expectedRevision:data.expectedRevision});
      return json({resolution});
    }
  if(operation==='receipt'&&request.method==='POST'){const data=await input(request);if(!data||Object.keys(data).some(k=>k!=='commandId')||!/^[a-f0-9-]{36}$/.test(data.commandId??''))throw new AuthError('Invalid receipt identity.',400);const receipt=await client.receipt({ownerId:scope.userId,actorId:scope.actorId,commandId:data.commandId});if(!await authorize(scope))throw new AuthError('Your access changed.',403);return json({receipt});}
  if(operation==='view'&&request.method==='GET'){
   const view=await service.project(scope);for(const [id,e]of controls)if(e.expires<=now())controls.delete(id);if(controls.size>=256)controls.delete(controls.keys().next().value);
   const viewToken=randomBytes(24).toString('hex');controls.set(viewToken,{...scope,actorId:scope.actorId??'',cookie:cookieKey(request),revision:view.revision,actions:structuredClone(view.actions??[]),expires:now()+15*60000});
   if(!await authorize(scope))throw new AuthError('Your access changed.',403);
   return json({...view,draftEnabled:drafts.enabled(scope),mapDetailAvailable:nearbyAvailable(view,scope),illustrations:{scene:Boolean(selectSceneArt(view,renderAssets)),portrait:Boolean(scope.actorId&&renderAssets.portraits?.[scope.actorId])},viewToken,selectedActor:scope.actorId??'',viewer:scope.audience});
  }
  if(operation==='illustration'&&request.method==='GET'){
   const url=new URL(request.url),kind=url.searchParams.get('kind');
   if(!['scene','portrait'].includes(kind)||[...url.searchParams.keys()].some(k=>!['actorId','level','viewToken','kind'].includes(k)))throw new AuthError('Choose an available illustration.',400);
   const entry=controls.get(url.searchParams.get('viewToken'));if(!matches(entry,scope,request))throw new AuthError('Refresh the current character view.',409);
   const view=await service.project(scope);if(view.revision!==entry.revision)throw new AuthError('The scene changed. Refresh your view.',409);
   const source=kind==='scene'?selectSceneArt(view,renderAssets):scope.actorId&&view.actor?renderAssets.portraits?.[scope.actorId]:undefined;
   if(typeof source!=='string'||!isAbsolute(source)||source.startsWith('\\\\')||source.startsWith('//'))throw new AuthError('No approved illustration available.',404);
   let bytes;try{const raw=await readFile(source);if(raw.length>12*1024*1024)throw Error();const image=await loadImage(raw);if(image.width*image.height>16777216)throw Error();const canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);bytes=canvas.toBuffer('image/png');}catch{throw new AuthError('No approved illustration available.',404);}
   const after=await service.project(scope);if(after.revision!==entry.revision||after.sceneId!==view.sceneId||(kind==='scene'&&selectSceneArt(after,renderAssets)!==source)||!await authorize(scope))throw new AuthError('Your view changed. Refresh the table.',409);
   return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}});
  }
  if(operation==='map'&&request.method==='GET'){
   const url=new URL(request.url),detail=url.searchParams.get('detail')??'full';
   if(!['full','nearby'].includes(detail)||[...url.searchParams.keys()].some(k=>!['actorId','level','viewToken','detail'].includes(k)))throw new AuthError('Choose Full map or Nearby detail.',400);
   const entry=controls.get(url.searchParams.get('viewToken'));if(!matches(entry,scope,request))throw new AuthError('Refresh the current character view.',409);
   const view=await service.project(scope);if(view.revision!==entry.revision)throw new AuthError('The map changed. Refresh your view.',409);if(!view.map)throw new AuthError('No map available.',404);
   if(detail==='nearby'&&!nearbyAvailable(view,scope))throw new AuthError('Nearby detail needs a tactical map with your visible character. Open a character map first.',400);
   const bytes=scope.mapLevel==='tactical'?await renderTacticalMap(view.map,{detail:detail==='nearby',title:view.title,portraits:renderAssets.portraits,terrainTextures:renderAssets.terrainTextures,terrainTexturesByScene:renderAssets.terrainTexturesByScene}):await renderIllustratedOverview({...view.map,title:view.title},{roomVignettes:renderAssets.dungeonVignettes});
   const after=await service.project(scope);if(after.revision!==entry.revision||!await authorize(scope))throw new AuthError('Your view changed. Refresh the table.',409);
   return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}});
  }
  if(operation==='action'&&request.method==='POST'){
   const data=await input(request);actionData=data;if(!data||Object.keys(data).some(k=>!['viewToken','revision','commandId','action','payload'].includes(k))||!/^[a-f0-9-]{36}$/.test(data.commandId??''))throw new AuthError('Invalid action.',400);
   const entry=controls.get(data.viewToken);if(!matches(entry,scope,request)||entry.revision!==data.revision)throw new AuthError('Refresh this character before acting.',409);
   if(drafts.enabled(scope)){
    const current=await service.project(scope);
    if([...(entry.actions??[]),...(current.actions??[])].some(action=>action.id===data.action&&isActivityDraftAction(action)))throw new AuthError('Save and review this intention before attempting it.',409);
   }
   const receipt=await service.command({...scope,action:data.action,payload:data.payload,expectedRevision:data.revision,commandId:data.commandId},{onDispatch:()=>{dispatched=true;submitted.add(data.commandId);}});
   try{if(!receipt.replayed)await onCommit({scope,receipt});}catch{/* Presentation cannot undo a committed receipt. */}
   if(!await authorize(scope))throw new AuthError('Your access changed. Reopen your panel to recover the result.',403);
   return json({receipt});
  }return json({error:'Unavailable route'},404);
 }catch(error){
   let rejection;
   const identifiable=actionData&&/^[a-f0-9-]{36}$/.test(actionData.commandId??'')&&Number.isSafeInteger(actionData.revision)&&actionData.revision>=0;
   const validation=error instanceof AuthError&&[400,409].includes(error.status)||error instanceof EngineError&&['INVALID_INPUT','UNAVAILABLE_ACTION','STALE_REVISION'].includes(error.code);
   if(operation==='action'&&scope&&identifiable&&validation&&!dispatched&&!submitted.has(actionData.commandId)&&typeof client.receipt==='function'){
    try{await client.receipt({ownerId:scope.userId,actorId:scope.actorId??'',commandId:actionData.commandId});}catch(lookup){
     if(lookup.code==='RECEIPT_NOT_FOUND'){
      let allowed;try{allowed=await authorize(scope);}catch{return json({error:'Current access could not be verified. Recover the original action before trying another action.'},503);}
      if(allowed&&!submitted.has(actionData.commandId))rejection={contract:'hollow-action-rejection-v1',campaignId:client.campaignId,commandId:actionData.commandId,actorId:scope.actorId??'',expectedRevision:actionData.revision,submitted:false};
     }
    }
   }
   return json({error:error instanceof AuthError||error instanceof EngineError?error.message:'The Activity could not complete this request. Refresh to check the current state.',...(rejection?{rejection}:{})},error.status??400);}}
 return {handle,service};
}
import { loadHollowLanternRoomArt } from './room-art.mjs';
export function createActivityDraftStore(env=process.env,campaignId=env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern'){
 const url=env.HOLLOW_LANTERN_DRAFT_RPC_URL,file=env.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE;
 if(url===undefined&&file===undefined)return undefined;
 if(typeof url!=='string'||!url||typeof file!=='string'||!file)throw Error('Configure both the shared draft address and credential file.');
 let secret,engineSecret;
 try{
  if(/^[\\/]{2}/.test(file))throw Error();
  const credentialPath=local(realpathSync(local(file))),info=statSync(credentialPath);
  if(/^[\\/]{2}/.test(credentialPath)||!info.isFile()||info.size>4096)throw Error();
  secret=readFileSync(credentialPath,'utf8').trim();
  if(env.HOLLOW_LANTERN_SECRET_FILE)engineSecret=readFileSync(local(env.HOLLOW_LANTERN_SECRET_FILE),'utf8').trim();
 }catch{throw Error('The shared draft credential could not be read from local storage.');}
 if(Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>512||/[\s\u0000-\u001f\u007f]/u.test(secret)||[engineSecret,env.DISCORD_TOKEN,env.DISCORD_BOT_TOKEN,env.DISCORD_CLIENT_SECRET].filter(Boolean).includes(secret))throw Error('A dedicated shared draft credential of 32 to 512 bytes is required.');
 return createRemoteDraftStore({baseUrl:url,secret,campaignId});
}
export function createActivityAdmission(env){
 createActivityDraftStore(env);
 return createRemoteAdmission({baseUrl:env.HOLLOW_LANTERN_DRAFT_RPC_URL,secret:readFileSync(local(env.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE),'utf8').trim(),campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID});
}
function buildActivityRuntime(env,auth){
 const client=createEngineClient({baseUrl:env.HOLLOW_LANTERN_ENGINE_URL,campaignId:env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern',channelId:env.HOLLOW_LANTERN_CHANNEL_ID,secret:readFileSync(local(env.HOLLOW_LANTERN_SECRET_FILE),'utf8').trim()});
 const draftStore=createActivityDraftStore(env,client.campaignId);
 const admission=auth.config.admissionEnabled===true?createActivityAdmission(env):undefined;
 const root=local(env.HOLLOW_LANTERN_ART_ROOT);return createActivityRuntime({auth,client,gmUserId:env.HOLLOW_LANTERN_GM_ID,draftStore,admission,renderAssets:{saltglassShoreArrival:join(root,'saltglass-shore-arrival-v1.png'),saltglassShoreRescued:join(root,'saltglass-shore-rescued-v1.png'),dungeonVignettes:env.HOLLOW_LANTERN_ROOM_ART_FILE?loadHollowLanternRoomArt(env.HOLLOW_LANTERN_ROOM_ART_FILE):{},terrainTexturesByScene:env.HOLLOW_LANTERN_MATERIALS_FILE?loadHollowLanternMaterials(env.HOLLOW_LANTERN_MATERIALS_FILE):{},sceneArts:{briefing:join(root,'scenes','briefing-sd.png'),'coastal-road':join(root,'scenes','coastal-road-sd.png'),'signal-dungeon':join(root,'scenes','signal-house-sd.png'),rescue:join(root,'scenes','rescue-sd.png'),'harbor-shop':join(root,'scenes','harbor-shop-sd.png'),debrief:join(root,'scenes','debrief-sd.png')},portraits:Object.fromEntries(['fighter','rogue','cleric','sentinel'].map((id,i)=>[`lantern-${id}`,join(root,['mara.png','kestrel.png','ash.png','sentinel-sd.png'][i])])),terrainTextures:{floor:join(root,'stone-floor-sd.png')}}});
}
const legacyBinding=env=>createHash('sha256').update(JSON.stringify([authConfig(env),Object.entries(env).filter(([key])=>key.startsWith('HOLLOW_LANTERN_')).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
const registryKey=Symbol.for('hollow.activity.campaign-registry');
export function getActivityCampaignRegistry(env=process.env){
 const source=readFileSync(local(env.HOLLOW_LANTERN_CAMPAIGNS_FILE),'utf8');if(Buffer.byteLength(source)>131072)throw Error('Campaign catalog too large.');
 const document=JSON.parse(source);if(!document||Object.keys(document).some(key=>!['defaultCampaignId','campaigns'].includes(key)))throw Error('Invalid campaign catalog.');
 const catalog=createCampaignCatalog(document.campaigns,{defaultCampaignId:document.defaultCampaignId}),shared=authConfig(env);
 const fingerprint=createHash('sha256').update(JSON.stringify([source,shared])).digest('hex');
 if(globalThis[registryKey]){if(globalThis[registryKey].fingerprint!==fingerprint)throw Error('Activity configuration changed; reconstruct the server runtime.');return globalThis[registryKey].registry;}
 const registry=createCampaignRegistry({catalog,createPlatform:entry=>{
  const config={...shared,...(shared.admissionEnabled?{admissionEnabled:entry.campaignId===env.HOLLOW_LANTERN_CAMPAIGN_ID,admissionChannel:entry.channelId}:{}),campaign:entry.campaignId,guild:entry.guildId,dmIds:[entry.gmUserId],cookieNamespace:createHash('sha256').update(entry.campaignId).digest('hex').slice(0,24)};
  const membership=createEngineMembership({file:entry.storeFile,campaignId:entry.campaignId,channelId:entry.channelId});
  mkdirSync(entry.activityDataDir,{recursive:true});const db=new DatabaseSync(join(entry.activityDataDir,'oauth.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  return {experience:'hollow-lantern',db,auth:new DiscordAuth({db,game:membership,config,...(config.admissionEnabled?{verifyMember:async scope=>{await createActivityAdmission({...env,HOLLOW_LANTERN_CAMPAIGN_ID:entry.campaignId,HOLLOW_LANTERN_DRAFT_RPC_URL:entry.draftRpcUrl,HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:entry.draftRpcSecretFile}).status(scope);return true;}}:{})}),membership};
 },createRuntime:(entry,{auth})=>buildActivityRuntime({HOLLOW_LANTERN_CAMPAIGN_ID:entry.campaignId,HOLLOW_LANTERN_CHANNEL_ID:entry.channelId,HOLLOW_LANTERN_GM_ID:entry.gmUserId,HOLLOW_LANTERN_ENGINE_URL:entry.engineUrl,HOLLOW_LANTERN_SECRET_FILE:entry.secretFile,HOLLOW_LANTERN_ART_ROOT:entry.artRoot,HOLLOW_LANTERN_MATERIALS_FILE:entry.materialsFile,HOLLOW_LANTERN_DRAFT_RPC_URL:entry.draftRpcUrl,HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE:entry.draftRpcSecretFile},auth)});
 globalThis[registryKey]={fingerprint,registry};return registry;
}
function selectedCampaign(request,catalog){const values=new URL(request.url).searchParams.getAll('campaignId');if(values.length>1||values.length===1&&!values[0])throw new AuthError('Choose one campaign.',400);return catalog.get(values[0]).campaignId;}
export function selectActivityCampaign(request,env=process.env){
 if(env.HOLLOW_LANTERN_CAMPAIGNS_FILE)return selectedCampaign(request,getActivityCampaignRegistry(env).catalog);
 const id=env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern';return selectedCampaign(request,{get(value=id){if(value!==id)throw new AuthError('Unknown campaign.',404);return {campaignId:id};}});
}
export function getActivityRuntime(env=process.env,campaignId=undefined){
 if(env.HOLLOW_LANTERN_CAMPAIGNS_FILE)return getActivityCampaignRegistry(env).runtime(campaignId);
 const {auth}=getHollowPlatform(env,campaignId);if(!globalThis[runtimeKey])globalThis[runtimeKey]=buildActivityRuntime(env,auth);return globalThis[runtimeKey];
}
export const activityHttp=(operation,{env=process.env,registry:providedRegistry}={})=>async request=>{try{
 const registry=providedRegistry??(env.HOLLOW_LANTERN_CAMPAIGNS_FILE?getActivityCampaignRegistry(env):null);
 let runtime;
 if(registry)runtime=await registry.authenticatedRuntime(selectedCampaign(request,registry.catalog),request);
 else{const id=selectActivityCampaign(request,env),{auth}=getHollowPlatform(env,id),session=await auth.authenticate(request);if(!session||session.campaign!==id||!session.role)throw new AuthError('Sign in to the selected campaign.',401);const member=await auth.member(session.owner);if(!member||member.campaign!==id||member.role!==session.role)throw new AuthError('Current campaign membership is required.',403);runtime=getActivityRuntime(env,id);}
 const url=new URL(request.url);url.searchParams.delete('campaignId');return await runtime.handle(operation,new Request(url,request));
 }catch(error){return json({error:error instanceof AuthError?error.message:'The Unity Activity connection is not configured.'},error instanceof AuthError?error.status:503);}};
