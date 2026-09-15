import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startTable} from './table-server.mjs';
import {createCoastWeb} from './table-web.mjs';
const gm='1230264975533281312',player='123456789012345678',app='1540006061099188274',guild='1463393482306486387',origin='http://127.0.0.1:18888';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'coast-preparation-'));
 const table=await startTable({gmPort:0,playerPort:0,stateFile:join(dir,'state.json')});
 let calls=0,switchAfter=Infinity;
 const auth={config:{campaign:'the-unwritten-coast',guild,clientId:app,publicOrigin:origin},authenticate:async request=>{calls++;const owner=calls>switchAfter?player:request.headers.get('cookie')==='gm'?gm:player;return {campaign:'the-unwritten-coast',owner,role:owner===gm?'host':'player'};}};
 const client={user:{id:app},guilds:{fetch:async()=>({members:{fetch:async({user})=>({id:user,user:{bot:false}})}})}};
 const web=createCoastWeb({store:table.store,auth,client,config:{guildId:guild,applicationId:app,gmUserId:gm,members:[{ownerId:player,actorId:'mara'}]}});
 t.after(async()=>{web.close();await table.close();await rm(dir,{recursive:true,force:true});});
 return {web,table,get:(path,cookie='gm')=>web.handle(new Request(origin+path,{headers:cookie?{cookie}:{}})),revokeDuringRead:()=>{calls=0;switchAfter=2;}};
}
test('only the selected DM can load undiscovered preparation artwork',async t=>{
 const f=await fixture(t),revision=f.table.store.view().state.revision;
 assert.ok(!f.table.store.view().catalog.rooms.some(r=>r.id==='R18'));
 assert.equal((await f.get('/api/art/room/R18.png')).status,404);
 const image=await f.get('/api/art/preparation/R18.png');assert.equal(image.status,200);
 assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.match(image.headers.get('cache-control'),/no-store/);
 assert.equal((await f.get('/api/art/preparation/R18.png','player')).status,403);
 assert.equal((await f.get('/api/art/preparation/R18.png','')).status,401);
 assert.equal((await f.get('/api/art/preparation/not-a-room.png')).status,404);
 assert.equal(f.table.store.view().state.revision,revision);
 assert.ok(!f.table.store.view().catalog.rooms.some(r=>r.id==='R18'));
});
test('DM access lost while preparation image is loading prevents image delivery',async t=>{
 const f=await fixture(t);f.revokeDuringRead();const response=await f.get('/api/art/preparation/R18.png');
 assert.equal(response.status,403);assert.match(response.headers.get('content-type'),/json/);
});
