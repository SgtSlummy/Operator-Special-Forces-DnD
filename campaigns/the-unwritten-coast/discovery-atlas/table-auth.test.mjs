import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCoastAuth} from './table-auth.mjs';
import {authCookieName} from '../../../raphael-council/auth/discord.mjs';
const binding={guildId:'111111111111111111',applicationId:'333333333333333333',gmUserId:'444444444444444444',members:[{ownerId:'555555555555555555',actorId:'mara'}]};
const config={clientId:binding.applicationId,secret:'fixture-only',token:'fixture-only',publicOrigin:'https://coast.example'};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let user=binding.members[0].ownerId,revoked=false;
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname;calls.push(path);
  assert.equal(options.redirect,'error');
  if(path.endsWith('/oauth2/token'))return Response.json({access_token:'fixture-access',scope:'identify'});
  if(path.endsWith('/users/@me'))return Response.json({id:user});
  if(path.includes('/members/'))return revoked?new Response('',{status:404}):Response.json({user:{id:user,bot:false},roles:[]});
  if(path.endsWith('/roles'))return Response.json([{id:binding.guildId,permissions:'0'}]);
  if(path.endsWith('/guilds/'+binding.guildId))return Response.json({id:binding.guildId,owner_id:'777777777777777777'});
  throw Error('Unexpected OAuth route');
 };
 const auth=createCoastAuth({db,binding,config,fetchImpl});
 const login=async()=>{const {state}=auth.start();return auth.exchange('fixture-code',{state,cookieState:state});};
 const request=token=>new Request(config.publicOrigin+'/api/view',{headers:{cookie:authCookieName(auth.config,'raph_web_session')+'='+token}});
 return{db,auth,login,request,calls,setUser:value=>{user=value;},revoke:()=>{revoked=true;}};
}
test('real DiscordAuth exchange creates a Coast-scoped session with hashed storage',async t=>{
 const f=fixture(t),session=await f.login();
 assert.equal(session.scope.campaign,'the-unwritten-coast');assert.equal(session.scope.role,'player');
 assert.deepEqual(await f.auth.authenticate(f.request(session.token)),session.scope);
 const rows=f.db.prepare('SELECT * FROM browser_sessions').all();assert.equal(rows.length,1);assert.notEqual(rows[0].hash,session.token);assert.equal(rows[0].campaign,'the-unwritten-coast');
 assert.equal(f.auth.config.guild,binding.guildId);assert.match(f.auth.config.cookieNamespace,/^[a-f0-9]{24}$/);
});
test('selected DM gets host access while an unenrolled guild member gets no seat',async t=>{
 const f=fixture(t);f.setUser(binding.gmUserId);assert.equal((await f.login()).scope.role,'host');
 f.setUser('888888888888888888');await assert.rejects(f.login(),/member|seat/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM browser_sessions').get().n,1);
});
test('current membership revocation invalidates an already-issued session',async t=>{
 const f=fixture(t),session=await f.login();f.revoke();await assert.rejects(f.auth.authenticate(f.request(session.token)),/current campaign member/);
});
test('state cannot be reused and another campaign cookie is not accepted',async t=>{
 const f=fixture(t),start=f.auth.start(),session=await f.auth.exchange('fixture-code',{state:start.state,cookieState:start.state});
 await assert.rejects(f.auth.exchange('fixture-code',{state:start.state,cookieState:start.state}),/expired/);
 assert.equal(await f.auth.authenticate(new Request(config.publicOrigin+'/api/view',{headers:{cookie:'raph_web_session='+session.token}})),null);
});
test('wrong application and non-HTTPS origin fail before auth tables are created',()=>{
 const db=new DatabaseSync(':memory:');try{
  assert.throws(()=>createCoastAuth({db,binding,config:{...config,clientId:'999999999999999999'}}),/configuration/);
  assert.throws(()=>createCoastAuth({db,binding,config:{...config,publicOrigin:'http://coast.example'}}),/HTTPS/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n,0);
 }finally{db.close();}
});
