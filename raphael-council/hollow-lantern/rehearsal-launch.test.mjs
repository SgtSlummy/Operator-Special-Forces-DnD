import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createRehearsalSupervisor} from './rehearsal-supervisor.mjs';
test('CLI passes project root accepted by real supervisor without spawning children',async()=>{
 let constructed=false;
 const prepared=await checkRehearsalLaunch({bindingFile:'fixture',commandName:'hollow',loadEnvironment:async()=>env,loadBinding:async()=>({env,activityEnv:env,summary:{campaignId:'fixture'}}),probePort:async()=>false,fetchImpl:async()=>new Response(JSON.stringify([command]))});
 const result=await runRehearsalCli({args:['--start','--binding','fixture'],prepare:async()=>prepared,write:()=>{},createSupervisor:options=>{
  const real=createRehearsalSupervisor({...options,forkImpl:()=>{throw Error('Must not spawn');}});constructed=true;
  return {...real,start:async()=>{await real.close();return {status:'stopped'};}};
 }});
 assert.equal(constructed,true);assert.equal(result.exitCode,0);
});
import {resolve} from 'node:path';
test('CLI split stdin stop requests owned close once and removes handlers after observed done',async()=>{
 const input=new EventEmitter(),lifecycle=new EventEmitter();let closeCount=0,finish;
 const done=new Promise(resolve=>{finish=resolve;});
 const flight=runRehearsalCli({args:['--start','--binding','fixture'],input,lifecycle,write:()=>{},prepare:async()=>({ports:{appPort:18796}}),createSupervisor:()=>({start:async()=>{queueMicrotask(()=>{input.emit('data','st');input.emit('data','op\n');lifecycle.emit('SIGINT');});return {status:'ready'};},close:async()=>{closeCount++;finish({status:'stopped',exitCode:0});return {status:'stopped'};},done})});
 assert.equal((await flight).exitCode,0);assert.equal(closeCount,1);assert.equal(input.listenerCount('data'),0);assert.equal(lifecycle.listenerCount('SIGINT'),0);
});
import assert from 'node:assert/strict';
import {composeRehearsalLaunchEnvironment,resolveRehearsalCommand,checkRehearsalLaunch,runRehearsalCli} from './rehearsal-launch.mjs';
test('CLI defaults check, start is explicit, invalid options never prepare',async()=>{
 let starts=0,prepares=0,seen;const prepare=async options=>{prepares++;seen=options;return {status:'preflight-passed',summary:{campaignId:'test'},ports:{appPort:18796}};};
 const createSupervisor=()=>({start:async()=>{starts++;return {status:'ready'};},close:async()=>({status:'stopped'}),done:Promise.resolve({status:'stopped',exitCode:0})});
 const output=[];const write=value=>output.push(value);
 await runRehearsalCli({args:['--binding','binding.json'],prepare,createSupervisor,write});assert.equal(starts,0);assert.equal(seen.bindingFile,resolve('binding.json'));
 await runRehearsalCli({args:['--start','--binding','binding.json','--database-port','15432'],prepare,createSupervisor,write});assert.equal(starts,1);assert.equal(seen.dbPort,15432);
 for(const args of [['--start','--check','--binding','x'],['--binding'],['--binding','x','--unknown'],['--binding','x','--database-port','0'],['--binding','x','--binding','y']])await assert.rejects(runRehearsalCli({args,prepare,createSupervisor,write}),/REHEARSAL_LAUNCH_INVALID/);
 assert.equal(prepares,2);assert.equal(JSON.stringify(output).includes('private-token'),false);
});
const env={DATABASE_URL:'postgresql://user:p%40ss@postgres:5432/game?sslmode=disable',REDIS_URL:'redis://:redispass@redis:6379/2',DISCORD_TOKEN:'private-token',DISCORD_APPLICATION_ID:'111111111111111111',HOLLOW_LANTERN_GUILD_ID:'222222222222222222',HOLLOW_LANTERN_WEB_PORT:'18812'};
const command={id:'333333333333333333',name:'hollow',type:1,application_id:env.DISCORD_APPLICATION_ID,guild_id:env.HOLLOW_LANTERN_GUILD_ID};
test('explicit infrastructure remap preserves credentials and input without leaking summary',()=>{
 const result=composeRehearsalLaunchEnvironment({env});
 assert.equal(result.env.DATABASE_URL,'postgresql://user:p%40ss@127.0.0.1:15432/game?sslmode=disable');
 assert.equal(result.env.REDIS_URL,'redis://:redispass@127.0.0.1:16379/2');
 assert.equal(result.env.SERVICE_HOST,'127.0.0.1');assert.equal(result.env.GATEWAY_HEALTH_PORT,'3010');
 assert.equal(env.DATABASE_URL.includes('@postgres:'),true);assert.equal(JSON.stringify(result.summary).includes('pass'),false);
 for(const option of [{dbPort:18812},{healthPort:18796},{redisPort:0}])assert.throws(()=>composeRehearsalLaunchEnvironment({env,...option}),/REHEARSAL_LAUNCH_INVALID/);
 assert.throws(()=>composeRehearsalLaunchEnvironment({env:{...env,DATABASE_URL:'https://secret.example/'}}),/REHEARSAL_LAUNCH_INVALID/);
});
test('command resolver only reads exact bound existing guild command',async()=>{
 let request;const id=await resolveRehearsalCommand({env,commandName:'hollow',fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify([command]));}});
 assert.equal(id,command.id);assert.match(request.url,/applications\/111111111111111111\/guilds\/222222222222222222\/commands$/);
 assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers.Authorization,'Bot private-token');
 for(const data of [[],[command,command],[{...command,type:2}],[{...command,guild_id:'444444444444444444'}],[{...command,application_id:'444444444444444444'}]])await assert.rejects(resolveRehearsalCommand({env,commandName:'hollow',fetchImpl:async()=>new Response(JSON.stringify(data))}),/REHEARSAL_COMMAND_UNAVAILABLE/);
 await assert.rejects(resolveRehearsalCommand({env,commandName:'hollow',fetchImpl:async()=>new Response('x'.repeat(65537))}),/REHEARSAL_COMMAND_UNAVAILABLE/);
});
test('check refuses occupied ports and never asserts running or creates services',async()=>{
 const options={bindingFile:'binding.json',commandName:'hollow',loadEnvironment:async()=>env,loadBinding:async()=>({env,activityEnv:env,summary:{campaignId:'rehearsal'}}),probePort:async()=>false,fetchImpl:async()=>new Response(JSON.stringify([command]))};
 const result=await checkRehearsalLaunch(options);assert.equal(result.status,'preflight-passed');assert.equal(result.env.HOLLOW_LANTERN_COMMAND_ID,command.id);assert.equal(result.activityEnv.HOLLOW_LANTERN_COMMAND_ID,command.id);assert.equal(Object.hasOwn(result.env,'HOLLOW_COMMAND_ID'),false);assert.equal(Object.hasOwn(result.activityEnv,'HOLLOW_COMMAND_ID'),false);
 let reads=0;await assert.rejects(checkRehearsalLaunch({...options,probePort:async()=>true,fetchImpl:async()=>{reads++;}}),/REHEARSAL_PORT_OCCUPIED/);assert.equal(reads,0);
});
