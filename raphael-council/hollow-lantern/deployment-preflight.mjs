import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {DatabaseSync,backup} from 'node:sqlite';
import net from 'node:net';

const app=resolve(import.meta.dirname,'..'),operator=dirname(app),davy='C:\\Users\\Hermes\\Projects\\Davy Jones';
const checkpoint='C:\\Users\\Hermes\\LocalFiles\\hollow-lantern\\deployment-checkpoint-20260909';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=(exe,args,{input,cwd=app,env=process.env}={})=>{
 const r=spawnSync(exe,args,{cwd,input,env,windowsHide:true,shell:false,maxBuffer:256*1024*1024,timeout:120000});
 if(r.status!==0)throw Object.assign(new Error('Preflight subprocess failed.'),{code:`${exe.split(/[\\/]/).at(-1)}:${r.status??'unavailable'}`});
 return r.stdout;
};
function dpapi(bytes,unprotect=false){
 const method=unprotect?'Unprotect':'Protect';
 const script=`Add-Type -AssemblyName System.Security.Cryptography.ProtectedData; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
 return Buffer.from(command('pwsh',['-NoProfile','-NonInteractive','-Command',script],{input:bytes.toString('base64')}).toString(),'base64');
}
const inside=(base,path)=>{const r=relative(base,path);return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
async function exists(path){try{return await stat(path);}catch{return null;}}
async function files(root){const result=[];if(!await exists(root))return result;for(const e of await readdir(root,{withFileTypes:true})){const path=join(root,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())result.push(...await files(path));else if(e.isFile())result.push(path);}return result;}
async function portOpen(port){return new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});const finish=value=>{s.destroy();resolve(value);};s.setTimeout(700,()=>finish(false));s.once('connect',()=>finish(true));s.once('error',()=>finish(false));});}

async function collect(withSource=false){
 if(process.platform!=='win32')throw new Error('Windows DPAPI checkpoint required.');
 await mkdir(checkpoint,{recursive:true});
 command('icacls',[checkpoint,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 const directory=join(checkpoint,`online-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(directory);
 const key=randomBytes(32);await writeFile(join(directory,'key.dpapi'),dpapi(key),{flag:'wx'});
 const report={contract:'hollow-deployment-checkpoint-v1',createdAt:new Date().toISOString(),directory,mode:'online-independent-snapshots',servicesChanged:false,discordMessagesSent:false,sourceSnapshot:withSource?'selected working source plus tracked binary diffs':'held pending service.mjs recovery',encryption:'AES-256-GCM; key wrapped with Windows CurrentUser DPAPI; operator/SYSTEM ACL',entries:[],checks:[],limitations:['Snapshots are transactionally consistent per store, not a simultaneous cross-store transaction.','Archive parsing and SQLite integrity verified; no production restore or isolated Postgres restore executed.','Object-store media bytes are outside this checkpoint unless present in selected local asset directories.']};
 async function save(label,bytes,details={}){
  const id=String(report.entries.length+1).padStart(4,'0'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const sealed=Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]),file=`${id}.aes`;
  await writeFile(join(directory,file),sealed,{flag:'wx'});
  const opened=decrypt(sealed,key);if(sha(opened)!==sha(bytes))throw new Error('Encrypted backup verification failed.');
  report.entries.push({label,file,bytes:bytes.length,sha256:sha(bytes),encryptedSha256:sha(sealed),...details});
 }
 async function checkpointFile(path){
  const s=await exists(path);if(!s?.isFile()||s.size>128*1024*1024){report.checks.push({check:'file',path,status:s?'too-large':'absent'});return;}
  if(/(?:-wal|-shm|\.lock)$/.test(path))return;
  if(/\.(?:sqlite|sqlite3|db)$/i.test(path)){
   const temp=join(directory,`sqlite-${randomBytes(8).toString('hex')}.tmp`);let source,copy;
   try{source=new DatabaseSync(path,{readOnly:true});await backup(source,temp);source.close();source=null;copy=new DatabaseSync(temp,{readOnly:true});const integrity=copy.prepare('PRAGMA integrity_check').all();copy.close();copy=null;if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw new Error('SQLite backup integrity failed.');await save(path,await readFile(temp),{kind:'sqlite-online-backup',integrity:'ok'});}finally{copy?.close();source?.close();if(await exists(temp))await unlink(temp);}
  }else{
   const bytes=await readFile(path);let verified;
   if(/campaign\.json(?:\.bak)?$/.test(path)){const envelope=JSON.parse(bytes);if(typeof envelope.body==='string'){if(sha(Buffer.from(envelope.body))!==envelope.sha256)throw new Error('Unity save checksum failed.');const state=JSON.parse(envelope.body);verified={kind:'unity-atomic-save',campaignId:state.campaignId,revision:state.revision};}}
   await save(path,bytes,verified??{kind:'file-copy'});
  }
 }
 try{
  const pg=command('podman',['exec','deployment_postgres_1','pg_dump','-U','davy_jones','-d','davy_jones','-Fc']);
  const listing=command('podman',['exec','-i','deployment_postgres_1','pg_restore','--list'],{input:pg});
  command('podman',['exec','-i','deployment_postgres_1','pg_restore','--file=/dev/null'],{input:pg});
  await save('Davy PostgreSQL davy_jones',pg,{kind:'postgres-custom-dump',archiveParse:'passed',tocSha256:sha(listing)});
  const migrations=command('podman',['exec','deployment_postgres_1','psql','-U','davy_jones','-d','davy_jones','-At','-c','SELECT name,checksum FROM schema_migrations ORDER BY name']);await save('Davy PostgreSQL migration names and checksums',migrations);
  const env=parseEnv(await readFile(join(davy,'deployment/.env'),'utf8'));if(!env.REDIS_PASSWORD||/[\r\n]/.test(env.REDIS_PASSWORD))throw new Error('Redis backup credential unavailable.');
  const rdb=command('podman',['exec','-i','deployment_redis_1','sh','-c','read -r REDISCLI_AUTH; export REDISCLI_AUTH; exec redis-cli --rdb -'],{input:`${env.REDIS_PASSWORD}\n`});
  command('podman',['exec','-i','deployment_redis_1','sh','-c','f=$(mktemp /tmp/hollow-rdb-check.XXXXXX); cat > "$f"; redis-check-rdb "$f" >/dev/null; result=$?; rm -f "$f"; exit "$result"'],{input:rdb});
  await save('Davy Redis all databases',rdb,{kind:'redis-replication-rdb',integrity:'redis-check-rdb passed'});
  const roots=[join(process.env.LOCALAPPDATA,'Raphael/game'),join(process.env.LOCALAPPDATA,'Raphael/chronicle'),join(process.env.LOCALAPPDATA,'Raphael/character-importer'),join(app,'.runtime/game'),join(app,'.runtime/character-importer'),join(app,'.runtime/hollow-lantern'),join(operator,'campaign-art/hollow-lantern'),'C:\\Users\\Hermes\\LocalFiles\\hollow-lantern\\unity-supervised-20260909'];
  if(withSource)roots.push(join(app,'hollow-lantern'),join(app,'discord/hollow-lantern'),join(app,'ai'),join(app,'packages/chronicle/dist'),join(app,'packages/obus-provider/dist'),join(davy,'src'),join(davy,'apps'),join(davy,'scripts'),join(operator,'RPG-Core/station/Assets/RpgIntegration'),join(operator,'RPG-Core/HollowLantern.Host'));
  for(const root of roots){if(!await exists(root))report.checks.push({check:'root',path:root,status:'absent'});for(const path of await files(root))await checkpointFile(path);}
  for(const name of ['deployment/.env','deployment/.env.native-gateway','deployment/compose.yaml','deployment/compose.windows-native-gateway.yaml','package.json','pnpm-lock.yaml'])await checkpointFile(join(davy,name));
  for(const repo of [davy,operator,join(operator,'RPG-Core')]){
   try{const head=command('git',['rev-parse','HEAD'],{cwd:repo}).toString().trim(),status=command('git',['status','--porcelain=v1'],{cwd:repo}).toString();await save(`${repo}: git HEAD/status metadata`,Buffer.from(JSON.stringify({repo,head,status},null,2)),{kind:'git-metadata'});if(withSource)await save(`${repo}: tracked working changes`,command('git',['diff','--binary','HEAD'],{cwd:repo}),{kind:'git-diff'});report.checks.push({check:'git',repo,head,dirtyLines:status.split('\n').filter(Boolean).length});}catch{report.checks.push({check:'git',repo,status:'unavailable'});}
  }
  const containers=JSON.parse(command('podman',['ps','--format','json']).toString()).filter(c=>String(c.Names).includes('deployment_')).map(c=>({names:c.Names,image:c.Image,id:c.Id,status:c.Status,ports:c.Ports}));report.checks.push({check:'existing-containers',containers});
  for(const port of [3010,3011,3012,3000,3001,15432,16379,18791,18792,38173,38178,7860])report.checks.push({check:'loopback-port',port,open:await portOpen(port)});
  const audio=command(process.execPath,['--input-type=module','-e',"import {inspectDiscordAudioRuntime} from './src/music/audio-runtime-readiness.js'; console.log(JSON.stringify(inspectDiscordAudioRuntime()))"],{cwd:davy});report.checks.push({check:'native-audio',...JSON.parse(audio)});
  if(await exists(join(davy,'deployment/.env.native-gateway'))){const configured=command(process.execPath,['--env-file=deployment/.env','--env-file=deployment/.env.native-gateway','scripts/start-native-gateway.js','--check'],{cwd:davy});report.checks.push({check:'native-configuration',...JSON.parse(configured)});}
  const overlay=command('python',['-m','podman_compose','-p','deployment','-f','compose.yaml','-f','compose.windows-native-gateway.yaml','config'],{cwd:join(davy,'deployment')});await save('Rendered native Compose overlay (private environment resolved)',overlay,{kind:'configuration-only'});
  const overlaySummary=command('python',['-c',"import sys,yaml,json; c=yaml.safe_load(sys.stdin.read()); print(json.dumps({'postgresPorts':c['services']['postgres'].get('ports'),'redisPorts':c['services']['redis'].get('ports'),'gatewayIncluded':'bot-gateway' in c['services'],'gatewayProfiles':c['services'].get('bot-gateway',{}).get('profiles'),'volumes':list(c.get('volumes',{}))}))"],{input:overlay});report.checks.push({check:'compose-overlay',...JSON.parse(overlaySummary)});
  report.checks.push({check:'gateway-image',imageId:command('podman',['inspect','deployment_bot-gateway_1','--format','{{.Image}}']).toString().trim(),digest:command('podman',['inspect','deployment_bot-gateway_1','--format','{{.ImageDigest}}']).toString().trim()});
  for(const file of ['packages/chronicle/dist/index.mjs','packages/obus-provider/dist/index.mjs','hollow-lantern/engine-membership.mjs'])report.checks.push({check:'runtime-file',file,exists:Boolean(await exists(join(app,file)))});
  report.completedAt=new Date().toISOString();report.status='backups-verified-deployment-not-changed';
 }catch(error){report.status='incomplete';report.failureCode=error.code??'PREFLIGHT_FAILED';}
 await writeFile(join(directory,'manifest.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({directory,status:report.status,entries:report.entries.length,bytes:report.entries.reduce((n,e)=>n+e.bytes,0),failureCode:report.failureCode}));
 if(report.status==='incomplete')process.exitCode=1;
}
function decrypt(bytes,key){const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]);}
async function verify(directory,extract=false){
 directory=resolve(directory);if(!inside(checkpoint,directory))throw new Error('Choose a checkpoint beneath the deployment checkpoint root.');
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')),key=dpapi(await readFile(join(directory,'key.dpapi')),true);
 const output=join(directory,`restore-copy-${Date.now()}`);if(extract)await mkdir(output);
 for(const entry of manifest.entries){if(!/^\d{4}\.aes$/.test(entry.file))throw new Error('Invalid manifest filename.');const sealed=await readFile(join(directory,entry.file));if(sha(sealed)!==entry.encryptedSha256)throw new Error('Encrypted backup checksum failed.');const bytes=decrypt(sealed,key);if(sha(bytes)!==entry.sha256)throw new Error('Backup checksum failed.');if(extract)await writeFile(join(output,entry.file.replace('.aes','.restored')),bytes,{flag:'wx'});}
 console.log(JSON.stringify({verified:manifest.entries.length,output:extract?output:undefined,productionDataChanged:false}));
}
const [mode,arg]=process.argv.slice(2);
if(mode==='--backup-data')await collect(arg==='--with-source');else if(['--verify','--extract'].includes(mode)&&arg)await verify(arg,mode==='--extract');else{console.error('Use --backup-data [--with-source], --verify CHECKPOINT, or --extract CHECKPOINT. Extraction only writes a new private restore-copy folder.');process.exitCode=2;}
