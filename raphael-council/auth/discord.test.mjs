import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DiscordAuth, guardOrigin, sessionCookie } from './discord.mjs';
const owner='100000000000000001', guild='100000000000000002', clientId='100000000000000003';
const config={clientId,secret:'fixture',token:'fixture',guild,campaign:'a',publicOrigin:'https://game.example',activityOrigin:`https://${clientId}.discordsays.com`,playerIds:[owner],dmIds:[]};
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); let revoked = false;
  const auth=new DiscordAuth({db,config,game:{member:()=> 'player'},fetchImpl:async url=> {
    if(url.endsWith('/oauth2/token')) return Response.json({access_token:'access',scope:'identify'});
    if(url.endsWith('/users/@me')) return Response.json({id:owner});
    if(url.endsWith(`/members/${owner}`)) return revoked ? new Response('',{status:404}):Response.json({roles:[]});
    if(url.endsWith('/roles')) return Response.json([]); return Response.json({owner_id:'other'});
  }});
  return {auth,revoke:()=>{revoked=true;}};
}
test('browser OAuth state is one-use and sessions recheck membership', async t=>{
  const {auth,revoke}=fixture(t); const {state}=auth.start();
  await assert.rejects(auth.exchange('code',{state,cookieState:'bad'}));
  const r=await auth.exchange('code',{state,cookieState:state});
  await assert.rejects(auth.exchange('code',{state,cookieState:state}));
  const req=new Request('https://game.example/api/game',{headers:{cookie:`raph_web_session=${r.token}`}});
  assert.equal((await auth.authenticate(req)).owner,owner); revoke(); await assert.rejects(auth.authenticate(req));
});
test('Activity and browser share identity with distinct cookies; logout invalidates server session', async t=>{
  const {auth}=fixture(t); const r=await auth.exchange('code',{activity:true});
  assert.match(sessionCookie(config,r.token,true),/SameSite=None; Partitioned/); assert.match(sessionCookie(config,r.token),/SameSite=Lax/);
  const req=new Request('https://game.example/api/game',{headers:{cookie:`raph_activity_session=${r.token}`}});
  assert.equal((await auth.authenticate(req)).campaign,'a'); auth.logout(req); await assert.rejects(auth.authenticate(req));
});
test('origin boundary rejects arbitrary origins including forged proxy context',()=>{
  assert.throws(()=>guardOrigin(new Request('http://localhost:3000/api/game',{headers:{origin:'https://evil.example','x-forwarded-host':'game.example'}}),config));
  assert.equal(guardOrigin(new Request('http://localhost:3000/api/game',{headers:{origin:config.activityOrigin}}),config),config.activityOrigin);
});
