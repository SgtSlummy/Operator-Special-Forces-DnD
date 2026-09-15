import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Only new named containers are modified. No production mount, network, host port,
// credential, or row contents enter this rehearsal or its public summary.
const app=dirname(dirname(fileURLToPath(import.meta.url)));
const checkpoint=resolve(process.argv[2]??'C:/Users/Hermes/LocalFiles/hollow-lantern/deployment-checkpoint-20260909/online-2026-09-09T20-40-04-352Z');
const extracted=process.argv[3]?resolve(process.argv[3]):null;
const id=randomUUID(),prefix=`hollow-restore-${id.slice(0,8)}`,output=join(checkpoint,`restore-drill-${id}`);
const report={kind:'isolated-database-restore',checkpoint,startedAt:new Date().toISOString(),productionModified:false,containers:[],checks:[],status:'RUNNING'};
await mkdir(output);
function run(command,args,{input,allowFailure=false}={}){
 const result=spawnSync(command,args,{cwd:app,input,encoding:null,timeout:60000,maxBuffer:16*1024*1024,windowsHide:true});
 if(result.status!==0&&!allowFailure){const error=new Error('Restore drill subprocess failed');error.detail={command,exitCode:result.status,signal:result.signal};throw error;}
 return result;
}
const pod=(args,options)=>run('podman',args,options).stdout;
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const inspect=name=>JSON.parse(pod(['inspect',name]).toString())[0];
async function save(){await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
async function ready(name,command){for(let attempt=0;attempt<30;attempt++){if(run('podman',['exec',name,...command],{allowFailure:true}).status===0)return;await new Promise(r=>setTimeout(r,500));}throw new Error('Disposable database readiness timeout');}
function prove(name){
 const c=inspect(name);
 if(c.Name!==name||c.Config.Labels?.['hollow.restore-drill']!==id||c.HostConfig.NetworkMode!=='none'||Object.keys(c.HostConfig.PortBindings??{}).length||(c.HostConfig.Binds??[]).length)throw new Error('Disposable container isolation mismatch');
 if((c.Mounts??[]).some(m=>m.Type!=='tmpfs'))throw new Error('Unexpected persistent container mount');
 return {name,id:c.Id,image:c.Image,network:c.HostConfig.NetworkMode,hostPorts:0,hostBinds:0,mounts:(c.Mounts??[]).map(m=>({type:m.Type,destination:m.Destination}))};
}
try{
 const manifest=JSON.parse(await readFile(join(checkpoint,'manifest.json'),'utf8'));
 const extraction=extracted??JSON.parse(run(process.execPath,['hollow-lantern/deployment-preflight.mjs','--extract',checkpoint]).stdout.toString()).output;
 if(dirname(extraction)!==checkpoint||!extraction.startsWith(join(checkpoint,'restore-copy-')))throw new Error('Use the existing private checkpoint extraction');
 async function backup(label){const entry=manifest.entries.find(e=>e.label===label);if(!entry)throw new Error('Expected checkpoint entry missing');const bytes=await readFile(join(extraction,entry.file.replace('.aes','.restored')));if(sha(bytes)!==entry.sha256)throw new Error('Extracted backup checksum mismatch');return bytes;}
 const pg=await backup('Davy PostgreSQL davy_jones'),migrations=await backup('Davy PostgreSQL migration names and checksums'),rdb=await backup('Davy Redis all databases');
 const images={pg:inspect('deployment_postgres_1').Image,redis:inspect('deployment_redis_1').Image};
 for(const image of Object.values(images))if(!/^(sha256:)?[a-f0-9]{64}$/.test(image))throw new Error('Local immutable image ID required');
 const pgName=`${prefix}-pg`,redisName=`${prefix}-redis`;
 for(const [name,image,mount,extra]of [[pgName,images.pg,'/var/lib/postgresql/data',['-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=davy_jones','-e','POSTGRES_DB=davy_jones']],[redisName,images.redis,'/data',['--entrypoint','sh']]]){
  const args=['run','-d','--pull=never','--name',name,'--label',`hollow.restore-drill=${id}`,'--network','none','--memory','512m','--pids-limit','128','--security-opt','no-new-privileges','--tmpfs',`${mount}:rw,size=256m`,...extra,image];
  if(name===redisName)args.push('-c','exec sleep 3600');
  pod(args);report.containers.push(prove(name));await save();
 }
 await ready(pgName,['pg_isready','-U','davy_jones','-d','davy_jones']);
 pod(['exec','-i',pgName,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','davy_jones','-d','davy_jones'],{input:pg});
 const toc=pod(['exec','-i',pgName,'pg_restore','--list'],{input:pg}).toString();
 const expectedTables=toc.split('\n').filter(line=>/ TABLE public /.test(line)).length;
 const query=sql=>pod(['exec',pgName,'psql','-U','davy_jones','-d','davy_jones','-At','-v','ON_ERROR_STOP=1','-c',sql]).toString().trim();
 const actualTables=Number(query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"));
 if(expectedTables===0||actualTables!==expectedTables)throw new Error('PostgreSQL table structure differs from dump');
 const restoredMigrations=query('SELECT name,checksum FROM schema_migrations ORDER BY name');
 if(restoredMigrations!==migrations.toString().trim())throw new Error('Restored migration ledger differs from checkpoint');
 const invalidIndexes=Number(query('SELECT count(*) FROM pg_index WHERE NOT indisvalid'));
 if(invalidIndexes)throw new Error('Invalid restored PostgreSQL indexes');
 report.checks.push({postgres:'PASS',tables:actualTables,migrationLedgerMatches:true,invalidIndexes,archiveSha256:sha(pg)});await save();
 pod(['exec','-i',redisName,'sh','-c','cat > /data/dump.rdb'],{input:rdb});
 const rdbCheck=pod(['exec',redisName,'redis-check-rdb','/data/dump.rdb']).toString();
 if(!rdbCheck.includes('RDB looks OK'))throw new Error('Redis RDB checksum validation failed');
 pod(['exec',redisName,'redis-server','--bind','127.0.0.1','--dir','/data','--dbfilename','dump.rdb','--appendonly','no','--save','','--daemonize','yes','--logfile','/data/restore.log']);
 await ready(redisName,['redis-cli','ping']);
 const log=pod(['exec',redisName,'cat','/data/restore.log']).toString();
 if(!log.includes('DB loaded from disk'))throw new Error('Redis did not load the restored RDB');
 const persistence=pod(['exec',redisName,'redis-cli','--raw','info','persistence']).toString();
 if(!/^loading:0\r?$/m.test(persistence))throw new Error('Redis load still pending');
 const keyspace=pod(['exec',redisName,'redis-cli','--raw','info','keyspace']).toString();
 const databases=[...keyspace.matchAll(/db(\d+):keys=(\d+),expires=(\d+)/g)].map(m=>({database:Number(m[1]),keys:Number(m[2]),expires:Number(m[3])}));
 report.checks.push({redis:'PASS',rdbChecksum:true,loadedFromDisk:true,loading:false,databases,archiveSha256:sha(rdb)});
 report.status='PASS';await save();
 for(const container of report.containers){const current=prove(container.name);if(current.id!==container.id)throw new Error('Container identity changed before cleanup');pod(['rm','-f',container.id]);container.removed=true;}
 report.completedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({status:report.status,output,postgresTables:actualTables,redisDatabases:databases.length,disposableContainersRemoved:true,productionModified:false}));
}catch(error){report.status='FAIL';report.failure={message:error.message,detail:error.detail};report.failedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:'FAIL',output,message:error.message,productionModified:false}));process.exitCode=1;}
