import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoastActivity} from './table-activity.mjs';

const origin='https://coast.test';
function fixture(){
 const config={guildId:'1463393482306486387',applicationId:'1540006061099188274',gmUserId:'1230264975533281312',members:[]};
 const view={state:{revision:0,currentRoomId:'R02'},catalog:{rooms:[{id:'R01'},{id:'R02'}]}};
 const calls=[];
 const runtime=createCoastActivity({config,origin,
  store:{view:()=>structuredClone(view),execute:()=>{throw Error('Rendering must not mutate the campaign.');}},
  auth:{authenticate:async()=>({campaign:'the-unwritten-coast',owner:config.gmUserId,role:'host'})},
  client:{user:{id:config.applicationId},guilds:{fetch:async()=>({members:{fetch:async({user})=>({id:user,user:{bot:false}})}})}},
  render:{architecture:async(visible,options)=>{calls.push(options);return '<svg xmlns="http://www.w3.org/2000/svg"/>';}}
 });
 const request=path=>new Request(origin+path,{headers:{cookie:'session=isolated-test'}});
 return {runtime,calls,request};
}

test('architecture defaults follow the requested room and current room',async()=>{
 const {runtime,calls,request}=fixture();
 try{
  const {viewToken}=await (await runtime.handle('view',request('/api/view'))).json();
  for(const [query,roomId,layer]of [['&room=R01','R01','r01-cutaway'],['&room=R02','R02','r02-cutaway'],['','R02','r02-cutaway'],['&room=R02&layer=r02-floor-slice','R02','r02-floor-slice']]){
   const response=await runtime.handle('architecture',request('/api/architecture?viewToken='+viewToken+query));
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');
   assert.deepEqual(calls.at(-1),{roomId,layer});
  }
 }finally{runtime.close();}
});

test('default layer selection does not expose an undiscovered room or accept an unbound view',async()=>{
 const {runtime,calls,request}=fixture();
 try{
  const {viewToken}=await (await runtime.handle('view',request('/api/view'))).json();
  assert.equal((await runtime.handle('architecture',request('/api/architecture?room=R18&viewToken='+viewToken))).status,404);
  assert.equal((await runtime.handle('architecture',request('/api/architecture?room=R02'))).status,409);
  assert.equal(calls.length,0);
 }finally{runtime.close();}
});
