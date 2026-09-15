import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCoastAuth} from './table-auth.mjs';
import {createCoastWeb} from './table-web.mjs';
import {openTableStore} from './table-store.mjs';
import {openingState} from './live-setup.mjs';
import {CATALOG} from './catalog.mjs';
const origin='https://coast.example',owner='555555555555555555';
const binding={guildId:'111111111111111111',applicationId:'333333333333333333',gmUserId:'444444444444444444',members:[{ownerId:owner,actorId:'mara'}]};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'coast-web-')),db=new DatabaseSync(':memory:');
 const store=await openTableStore({catalog:CATALOG,stateFile:join(dir,'state.json'),seed:openingState});let revoked=false;
 const fetchImpl=async(url)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/oauth2/token'))return Response.json({access_token:'fixture-only',scope:'identify'});
  if(path.endsWith('/users/@me'))return Response.json({id:owner});
  if(path.includes('/members/'))return revoked?new Response('',{status:404}):Response.json({user:{id:owner,bot:false},roles:[]});
  if(path.endsWith('/roles'))return Response.json([{id:binding.guildId,permissions:'0'}]);
  return Response.json({id:binding.guildId,owner_id:'777777777777777777'});
 };
 const auth=createCoastAuth({db,binding,config:{clientId:binding.applicationId,secret:'fixture',token:'fixture',publicOrigin:origin},fetchImpl});
 const client={user:{id:binding.applicationId},guilds:{fetch:async()=>({members:{fetch:async({user})=>({id:user,user:{bot:false}})}})}};
 const web=createCoastWeb({store,auth,client,config:binding});
 t.after(async()=>{web.close();await store.close();db.close();await rm(dir,{recursive:true,force:true});});
 const get=(path,cookie)=>web.handle(new Request(origin+path,{headers:cookie?{cookie}:{}}));
 const login=async()=>{
  const start=await get('/api/auth/discord/start'),destination=new URL(start.headers.get('location'));
  assert.equal(start.status,302);const stateCookie=start.headers.getSetCookie()[0].split(';')[0];
  const callback=await get('/api/auth/discord/callback?code=fixture&state='+encodeURIComponent(destination.searchParams.get('state')),stateCookie);
  assert.equal(callback.status,302);assert.equal(new URL(callback.headers.get('location')).pathname,'/play');
  const cookie=callback.headers.getSetCookie().find(value=>value.startsWith('raph_web_session_')).split(';')[0];return cookie;
 };
 return{web,get,login,store,revoke:()=>{revoked=true;}};
}
test('OAuth HTTP callback opens Coast and authenticated artwork honors discoveries',async t=>{
 const f=await fixture(t);assert.equal((await f.get('/api/art/room/f-deck.png')).status,401);
 const cookie=await f.login(),view=await(await f.get('/api/view',cookie)).json();assert.equal(view.identity.actorId,'mara');assert.equal(view.preview,false);
 const image=await f.get('/api/art/room/f-deck.png',cookie);assert.equal(image.status,200);assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal((await f.get('/api/art/room/R18.png',cookie)).status,404);assert.equal((await f.get('/art/f-deck.png',cookie)).status,404);
 assert.equal((await f.get('/api/art/table/sentinel.png',cookie)).status,404);
 f.revoke();assert.ok([401,403].includes((await f.get('/api/art/room/f-deck.png',cookie)).status));
});
test('static page is allowlisted and another origin cannot access the host',async t=>{
 const f=await fixture(t),page=await f.get('/play');assert.equal(page.status,200);assert.match(await page.text(),/table-app.mjs/);
 assert.equal((await f.get('/table-auth.mjs')).status,404);assert.equal((await f.get('/live/state.json')).status,404);
 assert.equal((await f.web.handle(new Request('https://elsewhere.example/api/view'))).status,403);
});
