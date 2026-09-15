import {readFileSync} from 'node:fs';
import {lstat,realpath,readdir,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {resolve,dirname,isAbsolute,join,relative,parse} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const protectedPath=value=>{if(!isAbsolute(value??'')||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(value))throw new Error('A canonical local configuration path is required.');return value;};
/** Read protected configuration in process; never put credentials in arguments. */
export function activityEnvironment({baseFile,nativeFile,campaignFile,inherited=process.env,read=path=>parseEnv(readFileSync(path,'utf8'))}){
 const base=read(protectedPath(baseFile)),native={...read(protectedPath(nativeFile))};
 const draftPair=['HOLLOW_LANTERN_DRAFT_RPC_URL','HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE'];
 if(campaignFile){
  const campaign=read(protectedPath(campaignFile));
  if(draftPair.some(key=>Object.hasOwn(campaign,key))&&!draftPair.every(key=>typeof campaign[key]==='string'&&campaign[key].trim()))throw new Error('Supply the complete draft RPC binding together.');
  // An explicit campaign never borrows another campaign's draft owner or key.
  for(const key of draftPair)native[key]='';
  // A rehearsal binding cannot replace the application's Discord credentials.
  if(['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_APPLICATION_ID'].some(key=>Object.hasOwn(campaign,key)))throw new Error('Campaign bindings cannot replace application credentials.');
  const binding=['HOLLOW_LANTERN_CAMPAIGN_ID','HOLLOW_LANTERN_ENGINE_URL','HOLLOW_LANTERN_SECRET_FILE','HOLLOW_LANTERN_STORE_FILE','HOLLOW_LANTERN_ACTIVITY_DATA_DIR'];
  if(binding.some(key=>!campaign[key]?.trim()))throw new Error('Supply the complete campaign and private Activity store binding together.');
  for(const key of [...binding,...draftPair,'HOLLOW_LANTERN_ART_ROOT','HOLLOW_LANTERN_ROOM_ART_FILE','HOLLOW_LANTERN_MATERIALS_FILE','HOLLOW_LANTERN_CHANNEL_ID','HOLLOW_LANTERN_GUILD_ID','HOLLOW_LANTERN_GM_ID','RAPHAEL_PLAYER_IDS','RAPHAEL_PLAYER_ROLE_ID','RAPHAEL_DM_ROLE_ID'])if(Object.hasOwn(campaign,key))native[key]=campaign[key];
 }
 const env={...inherited,...base,...native};
 if(campaignFile&&draftPair.every(key=>native[key]===''))for(const key of draftPair)delete env[key];
 if(draftPair.some(key=>Boolean(env[key]))){
  if(!draftPair.every(key=>typeof env[key]==='string'&&env[key].trim()))throw new Error('Supply the complete draft RPC binding together.');
  const endpoint=env.HOLLOW_LANTERN_DRAFT_RPC_URL;
  if(!/^http:\/\/127\.0\.0\.1(?::\d{1,5})?\/?$/.test(endpoint))throw new Error('The draft owner must use its private literal loopback root endpoint.');
  try{new URL(endpoint);}catch{throw new Error('The draft owner endpoint is invalid.');}
  const path=env.HOLLOW_LANTERN_DRAFT_RPC_SECRET_FILE;protectedPath(path);
  if(path!==path.trim()||path.includes('\0')||/^[\\/]{2}/.test(path)||/(?:^|[\\/])\.\.?([\\/]|$)/.test(path)||/:/.test(path.slice(2)))throw new Error('The draft key requires a canonical local file path.');
  // Runtime validates the physical regular file and key bytes; merging reads no key.
 }
 env.RAPHAEL_LOCAL_HOST='1';env.NODE_ENV='production';
 env.DISCORD_CLIENT_ID=native.DISCORD_CLIENT_ID||base.DISCORD_CLIENT_ID||base.DISCORD_APPLICATION_ID;
 env.RAPHAEL_CAMPAIGN_ID=native.HOLLOW_LANTERN_CAMPAIGN_ID||'operation-hollow-lantern';
 env.HOLLOW_LANTERN_CAMPAIGN_ID=env.RAPHAEL_CAMPAIGN_ID;
 env.RAPHAEL_GUILD_ID=native.HOLLOW_LANTERN_GUILD_ID;
 env.RAPHAEL_DM_IDS=native.HOLLOW_LANTERN_GM_ID;
 // Eligibility comes only from this campaign's explicit host configuration.
 for(const key of ['RAPHAEL_PLAYER_IDS','RAPHAEL_PLAYER_ROLE_ID','RAPHAEL_DM_ROLE_ID','RAPHAEL_PUBLIC_ORIGIN'])env[key]=native[key]||'';
 const required=['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','HOLLOW_LANTERN_ENGINE_URL','HOLLOW_LANTERN_SECRET_FILE','HOLLOW_LANTERN_STORE_FILE','HOLLOW_LANTERN_ACTIVITY_DATA_DIR','HOLLOW_LANTERN_ART_ROOT','HOLLOW_LANTERN_CHANNEL_ID','HOLLOW_LANTERN_GUILD_ID','HOLLOW_LANTERN_GM_ID'];
 if(required.some(key=>!env[key]?.trim()))throw new Error('The protected Activity configuration is incomplete.');
 for(const key of ['HOLLOW_LANTERN_SECRET_FILE','HOLLOW_LANTERN_STORE_FILE','HOLLOW_LANTERN_ACTIVITY_DATA_DIR','HOLLOW_LANTERN_ART_ROOT'])protectedPath(env[key]);
 if(env.HOLLOW_LANTERN_MATERIALS_FILE){protectedPath(env.HOLLOW_LANTERN_MATERIALS_FILE);if(/^[\\/]{2}/.test(env.HOLLOW_LANTERN_MATERIALS_FILE))throw new Error('Materials require a local file path.');}
 if(env.HOLLOW_LANTERN_ROOM_ART_FILE){protectedPath(env.HOLLOW_LANTERN_ROOM_ART_FILE);if(/^[\\/]{2}/.test(env.HOLLOW_LANTERN_ROOM_ART_FILE))throw new Error('Room artwork requires a local file path.');}
 const engine=new URL(env.HOLLOW_LANTERN_ENGINE_URL);
 if(engine.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(engine.hostname)||engine.username||engine.password||engine.search||engine.hash||!['','/'].includes(engine.pathname))throw new Error('The engine must use its private loopback root endpoint.');
 for(const key of ['DISCORD_CLIENT_ID','HOLLOW_LANTERN_CHANNEL_ID','HOLLOW_LANTERN_GUILD_ID','HOLLOW_LANTERN_GM_ID'])if(!/^\d{17,20}$/.test(env[key]))throw new Error('The Activity Discord bindings are invalid.');
 return env;
}

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const modulePackage=JSON.stringify({private:true,type:'module'})+'\n';
/** Selection is local operator metadata, never credentials or a fallback on error. */
export async function selectedActivityCampaign({projectRoot=root,explicitFile}={}){
 const validatePath=value=>{
  if(typeof value!=='string'||!value||value!==value.trim()||value.includes('\0')||/^[\\/]{2}/.test(value)||/(?:^|[\\/])\.\.?([\\/]|$)/.test(value)||/:/.test(value.slice(2)))throw new Error('Activity selection requires a canonical local file path.');
  return protectedPath(value);
 };
 const inspectFile=async(path,limit,optional=false)=>{
  validatePath(path);
  try{
   await localDirectory(dirname(path));
   const info=await lstat(path);
   if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1||info.size>limit)throw new Error('Activity selection requires a bounded regular file without links.');
   if((await realpath(path)).toLowerCase()!==resolve(path).toLowerCase())throw new Error('Activity selection path is not canonical.');
  }catch(error){if(optional&&error.code==='ENOENT')return false;throw error;}
  return true;
 };
 // An explicit override never consults a stale or malformed saved selection.
 if(explicitFile!==undefined){await inspectFile(explicitFile,65536);return explicitFile;}
 validatePath(projectRoot);
 const pointer=join(projectRoot,'.runtime','hollow-lantern','activity-selection.json');
 try{
  if(!await inspectFile(pointer,4096,true))return undefined;
  const selection=JSON.parse(await readFile(pointer,'utf8'));
  if(!selection||Array.isArray(selection)||selection.version!==1||Object.keys(selection).sort().join(',')!=='campaignFile,version')throw new Error('Invalid selection schema.');
  await inspectFile(selection.campaignFile,65536);
  return selection.campaignFile;
 }catch{throw new Error('Saved Activity campaign selection is invalid. Repair activity-selection.json before starting; no default campaign was substituted.');}
}
async function localDirectory(path,create=false){
 protectedPath(path);const canonical=resolve(path);let cursor=parse(canonical).root;
 for(const part of relative(cursor,canonical).split(/[\\/]/).filter(Boolean)){
  cursor=join(cursor,part);let stat;try{stat=await lstat(cursor);}catch(error){if(error.code!=='ENOENT'||!create)throw error;await mkdir(cursor);stat=await lstat(cursor);}
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Activity release directories must be real local directories.');
 }
 if((await realpath(canonical)).toLowerCase()!==canonical.toLowerCase())throw new Error('Activity release path is not canonical.');return canonical;
}
async function inventory(directory){
 const files=[];let total=0;
 async function walk(path,prefix=''){
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+entry.name,file=join(path,entry.name),stat=await lstat(file);
   if(stat.isSymbolicLink())throw new Error('Build links are not permitted.');
   if(stat.isDirectory()){await walk(file,name+'/');continue;}
   if(!stat.isFile()||stat.nlink!==1)throw new Error('Build artifacts must be regular unlinked files.');
   // Vinext's build-only secret is unnecessary for ordinary production requests.
   if(name==='server/vinext-server.json')continue;
   if(/(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|pfx|p12))$/i.test(name))throw new Error('Protected configuration is not a deployable build artifact.');
   if(files.length>=10000||(total+=stat.size)>512*1024*1024)throw new Error('Activity build exceeds the bounded snapshot limit.');
   const bytes=await readFile(file);files.push({path:name,size:bytes.length,sha256:digest(bytes)});
  }
 }
 await walk(directory);return files;
}
async function validateRelease(directory,manifest){
 for(const name of ['package.json']){const stat=await lstat(join(directory,name));if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw new Error('Release metadata must be a regular unlinked file.');}
 try{await lstat(join(directory,'dist/server/vinext-server.json'));throw new Error('Build-only secrets must not enter a release.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await localDirectory(directory);const actual=await inventory(join(directory,'dist'));
 if(JSON.stringify(actual)!==JSON.stringify(manifest.files)||await readFile(join(directory,'package.json'),'utf8')!==modulePackage)throw new Error('Immutable Activity snapshot integrity failed.');
 const paths=new Set(actual.map(f=>f.path));
 if(!paths.has('server/index.js')&&!paths.has('server/entry.js'))throw new Error('Activity server entry is missing.');
 if(!actual.some(f=>f.path.startsWith('client/')))throw new Error('Activity client assets are missing.');
 // Static and literal dynamic relative imports must remain inside this snapshot.
 for(const file of actual.filter(f=>/\.(?:m?js)$/.test(f.path))){
  const text=await readFile(join(directory,'dist',file.path),'utf8');
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"`])(\.[^'"`]+)\1/g)){
   if(match[2].includes('${'))continue;const target=resolve(directory,'dist',dirname(file.path),match[2].split('?')[0]);const local=relative(join(directory,'dist'),target).replaceAll('\\','/');
   if(local.startsWith('../')||isAbsolute(local)||!paths.has(local))throw new Error('Build references a missing or external relative module.');
  }
 }
 return manifest;
}
/** Copy only the completed build; never promote a source tree that changed mid-copy. */
export async function prepareActivityRelease({projectRoot=root}={}){
 projectRoot=await localDirectory(projectRoot);const source=await localDirectory(join(projectRoot,'dist'));
 const files=await inventory(source);const id=digest(JSON.stringify({version:1,files,package:modulePackage}));
 const releases=await localDirectory(join(projectRoot,'.runtime','hollow-lantern','activity-builds'),true),target=join(releases,id);
 const manifest={version:1,id,files,excluded:['server/vinext-server.json'],package:modulePackage};
 let exists=false;try{await lstat(target);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists){await localDirectory(target);const stat=await lstat(join(target,'release.json'));if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw new Error('Release manifest must be a regular file.');const stored=JSON.parse(await readFile(join(target,'release.json'),'utf8'));if(JSON.stringify(stored)!==JSON.stringify(manifest))throw new Error('Release identity collision.');await validateRelease(target,manifest);return {id,directory:target,outDir:join(target,'dist')};}
 const staging=join(releases,'.staging-'+randomUUID());await mkdir(staging);
 try{
  for(const file of files){const bytes=await readFile(join(source,file.path));if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw new Error('Build changed during snapshot.');const destination=join(staging,'dist',file.path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx',mode:0o600});}
  await writeFile(join(staging,'package.json'),modulePackage,{flag:'wx',mode:0o600});
  await validateRelease(staging,manifest);
  if(JSON.stringify(await inventory(source))!==JSON.stringify(files))throw new Error('Build changed before snapshot promotion.');
  await writeFile(join(staging,'release.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
  await rename(staging,target);return {id,directory:target,outDir:join(target,'dist')};
 }catch(error){await writeFile(join(staging,'failed.json'),JSON.stringify({error:error.message}),{flag:'wx',mode:0o600}).catch(()=>{});throw error;}
}
export async function launchActivity({baseFile,nativeFile,campaignFile,check=false}={}){
 const env=activityEnvironment({baseFile,nativeFile,campaignFile});
 const release=await prepareActivityRelease();
 if(check){process.stdout.write(`Activity configuration and immutable release ${release.id} validated. No service started.\n`);return release;}
 // Preserve the application cwd for existing local-data conventions; only the
 // Vinext server and asset roots point at the immutable release.
 const server=pathToFileURL(resolve(root,'node_modules/vinext/dist/server/prod-server.js')).href;
 const code=`import {startProdServer} from ${JSON.stringify(server)};await startProdServer({outDir:${JSON.stringify(release.outDir)},host:'127.0.0.1',port:18796});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:root,env,stdio:'inherit',windowsHide:true});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 child.once('error',()=>{process.stderr.write('Activity server could not start.\n');process.exitCode=1;});
 child.once('exit',code=>{process.exitCode=code??1;});return child;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.some(arg=>!['--check'].includes(arg)))throw new Error('Use protected environment file path variables.');
 await launchActivity({baseFile:process.env.HOLLOW_ACTIVITY_BASE_ENV_FILE,nativeFile:process.env.HOLLOW_ACTIVITY_NATIVE_ENV_FILE,campaignFile:process.env.HOLLOW_ACTIVITY_CAMPAIGN_ENV_FILE,check:args.includes('--check')});
 }catch{process.stderr.write('Activity launch refused: verify protected file paths, required bindings, and production build. No credentials were logged.\n');process.exitCode=1;}
}
