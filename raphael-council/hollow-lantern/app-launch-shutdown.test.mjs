import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createAppHost} from './app-launch.mjs';
test('opt-in non-forcing close waits for actual child exit after timeout',async()=>{
 let child,kills=0;
 const host=createAppHost({env:{HOLLOW_LANTERN_CAMPAIGN_ID:'fixture',DISCORD_CLIENT_ID:'fixture'},projectRoot:process.cwd(),forceOnTimeout:false,shutdownTimeoutMs:30,lifecycle:new EventEmitter(),inspect:async()=>({status:'ready-to-start'}),prepare:async()=>({outDir:'fixture',id:'fixture'}),probeWeb:async()=>({status:'running'}),spawnImpl:(file,args,options)=>{
  const script=`const timer=setTimeout(()=>process.exit(2),5000);process.on('message',m=>{if(m.type==='release'){clearTimeout(timer);process.exit(0);}});process.send({type:'listening',instance:process.env.HOLLOW_APP_INSTANCE,port:Number(process.env.HOLLOW_APP_PORT)});`;
  child=spawn(process.execPath,['-e',script],{env:options.env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});child.kill=()=>{kills++;return false;};return child;
 }});
 try{
  assert.equal((await host.start()).status,'ready');assert.equal((await host.close()).status,'blocked');assert.equal(kills,0);assert.equal(child.exitCode,null);
  assert.equal(await Promise.race([host.done.then(()=>true),new Promise(r=>setTimeout(()=>r(false),40))]),false);
 }finally{child?.send({type:'release'});}
 await host.done;assert.equal(child.exitCode,0);assert.equal(kills,0);
});
