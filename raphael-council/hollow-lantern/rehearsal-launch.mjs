import net from 'node:net';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appEnvironment} from './app-launch.mjs';
import {readRehearsalBinding} from './rehearsal-binding.mjs';
const fail=()=>{throw Error('REHEARSAL_LAUNCH_INVALID');};
const port=value=>{if(!Number.isInteger(value)||value<1024||value>65535)fail();return value;};
export function composeRehearsalLaunchEnvironment({env,dbPort=15432,redisPort=16379,healthPort=3010,appPort=18796}={}){
 const ports={dbPort:port(dbPort),redisPort:port(redisPort),healthPort:port(healthPort),appPort:port(appPort),webPort:port(Number(env?.HOLLOW_LANTERN_WEB_PORT))};
 if(new Set(Object.values(ports)).size!==5)fail();
 const remap=(value,protocols,nextPort)=>{try{const url=new URL(value);if(!protocols.includes(url.protocol)||!url.hostname||url.hash)fail();url.hostname='127.0.0.1';url.port=String(nextPort);return url.href;}catch{fail();}};
 return {env:{...env,DATABASE_URL:remap(env.DATABASE_URL,['postgres:','postgresql:'],dbPort),REDIS_URL:remap(env.REDIS_URL,['redis:','rediss:'],redisPort),SERVICE_HOST:'127.0.0.1',GATEWAY_HEALTH_PORT:String(healthPort)},ports,summary:{host:'127.0.0.1',ports}};
}
export async function resolveRehearsalCommand({env,commandName='hollow-lantern',fetchImpl=fetch}={}){
 try{
  const applicationId=env.DISCORD_APPLICATION_ID,guildId=env.HOLLOW_LANTERN_GUILD_ID,token=env.DISCORD_TOKEN;
  if(![applicationId,guildId].every(value=>/^\d{17,20}$/.test(value))||typeof token!=='string'||!token||/[\r\n]/.test(token)||!/^[-a-z0-9]{1,32}$/.test(commandName))throw Error();
  const response=await fetchImpl(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,{method:'GET',headers:{Authorization:`Bot ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body)throw Error();
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536)throw Error();chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const commands=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(commands))throw Error();
  const matches=commands.filter(command=>command?.name===commandName&&command.type===1&&command.application_id===applicationId&&command.guild_id===guildId&&/^\d{17,20}$/.test(command.id));
  if(matches.length!==1)throw Error();return matches[0].id;
 }catch{throw Error('REHEARSAL_COMMAND_UNAVAILABLE');}
}
export function isRehearsalPortOccupied(portNumber){return new Promise(resolveResult=>{
 const socket=net.createConnection({host:'127.0.0.1',port:port(portNumber)});const finish=result=>{socket.destroy();resolveResult(result);};
 socket.setTimeout(1500,()=>finish(true));socket.once('connect',()=>finish(true));socket.once('error',error=>finish(error.code!=='ECONNREFUSED'));
});}
export async function prepareRehearsalLaunch({bindingFile,davyRoot=resolve(import.meta.dirname,'../../../Davy Jones'),dbPort=15432,redisPort=16379,healthPort=3010,appPort=18796,loadEnvironment=appEnvironment,loadBinding=readRehearsalBinding,probePort=isRehearsalPortOccupied,fetchImpl=fetch,commandName='hollow-lantern'}={}){
 if(typeof davyRoot!=='string'||!isAbsolute(davyRoot)||/^[\\/]{2}/.test(davyRoot)||/(?:^|[\\/])OneDrive(?: - [^\\/]+)?(?:[\\/]|$)/i.test(davyRoot))fail();
 const selected=await loadEnvironment();const built=await loadBinding({file:bindingFile,activityEnv:selected});
 const composed=composeRehearsalLaunchEnvironment({env:built.env,dbPort,redisPort,healthPort,appPort});
 for(const number of [composed.ports.healthPort,composed.ports.appPort,composed.ports.webPort])if(await probePort(number))throw Error('REHEARSAL_PORT_OCCUPIED');
 const commandId=await resolveRehearsalCommand({env:composed.env,commandName,fetchImpl});
 return {status:'preflight-passed',env:{...composed.env,HOLLOW_LANTERN_COMMAND_ID:commandId},activityEnv:{...built.activityEnv,HOLLOW_LANTERN_COMMAND_ID:commandId},summary:{...built.summary,...composed.summary,commandId,status:'preflight-passed'},ports:composed.ports,davyRoot:resolve(davyRoot)};
}
export const checkRehearsalLaunch=prepareRehearsalLaunch;
export async function runRehearsalCli({args=process.argv.slice(2),prepare=prepareRehearsalLaunch,createSupervisor,write=console.log,lifecycle=process,input=process.stdin}={}){
 const options={},seen=new Set();let mode='check';const names={'--binding':'bindingFile','--davy-root':'davyRoot','--database-port':'dbPort','--redis-port':'redisPort','--health-port':'healthPort','--app-port':'appPort'};
 for(let index=0;index<args.length;index++){
  const arg=args[index];if(seen.has(arg))fail();seen.add(arg);
  if(arg==='--start'||arg==='--check'){if(seen.has(arg==='--start'?'--check':'--start'))fail();mode=arg.slice(2);continue;}
  const key=names[arg],value=args[++index];if(!key||!value||value.startsWith('--'))fail();options[key]=key.endsWith('Port')?port(/^\d+$/.test(value)?Number(value):NaN):value;
 }
 if(!options.bindingFile)fail();options.bindingFile=resolve(options.bindingFile);if(options.davyRoot)options.davyRoot=resolve(options.davyRoot);const prepared=await prepare(options);
 if(mode==='check'){write(JSON.stringify(prepared.summary));return {status:'preflight-passed',exitCode:0};}
 const factory=createSupervisor??(await import('./rehearsal-supervisor.mjs')).createRehearsalSupervisor;
 const supervisor=factory({prepared,projectRoot:resolve(import.meta.dirname,'..')});let stopping=false,pending='';
 const stop=()=>{if(stopping)return;stopping=true;void supervisor.close().then(report=>{if(report.status==='blocked')write('Shutdown is still waiting for this rehearsal to close.');}).catch(()=>write('Shutdown needs attention; existing processes were left in place.'));};
 const data=chunk=>{pending+=String(chunk);if(pending.length>1024)pending=pending.slice(-1024);const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(line.trim().toLowerCase()==='stop')stop();};
 lifecycle.on('SIGINT',stop);lifecycle.on('SIGTERM',stop);input?.on('data',data);
 try{
  const report=await supervisor.start();
  if(report.status==='ready')write(`Open ${report.url??`http://127.0.0.1:${prepared.ports.appPort}`}\nType stop and press Enter to close this rehearsal.`);
  else{write('The rehearsal could not start. Waiting for owned processes to close.');await supervisor.close();}
  return await supervisor.done;
 }finally{lifecycle.removeListener('SIGINT',stop);lifecycle.removeListener('SIGTERM',stop);input?.removeListener('data',data);input?.pause?.();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=(await runRehearsalCli()).exitCode;}catch(error){console.error(error.message==='REHEARSAL_PORT_OCCUPIED'?'A required local port is already in use. The running services were left in place.':'Rehearsal setup needs attention. Check the saved binding and local configuration.');process.exitCode=1;}
}
