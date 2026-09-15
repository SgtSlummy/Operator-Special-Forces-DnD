import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DiscordAuth, guardOrigin, sessionCookie } from './discord.mjs';
import {authHttp} from './http.mjs';
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

test('token failures classify only allowlisted OAuth names and create no session',async t=>{
 const cases=[['invalid_client','application configuration'],['invalid_grant','fresh consent'],['invalid_request','exchange configuration'],['unauthorized_client','OAuth settings'],['unsupported_grant_type','exchange configuration'],['invalid_scope','requested scopes'],['access_denied','authorization was denied'],['temporarily_unavailable','temporarily unavailable'],['server_error','Try again shortly']];
 for(const [name,expected] of cases){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());let calls=0;
  const auth=new DiscordAuth({db,config,game:{},fetchImpl:async()=>{calls++;return Response.json({error:name,error_description:'PRIVATE code=secret-token PKCE verifier=DO_NOT_SHOW',access_token:'DO_NOT_SHOW'},{status:400});}});
  await assert.rejects(auth.exchange('PRIVATE-input-code',{activity:true}),error=>{assert.match(error.message,new RegExp(expected));assert.ok(error.message.includes(name));assert.doesNotMatch(error.message,/PRIVATE|DO_NOT_SHOW|secret-token|PKCE|verifier/);assert.equal(error.status,401);return true;});
  assert.equal(calls,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
 }
});
test('unknown, malformed, oversized and inherited error names remain redacted',async t=>{
 for(const body of [JSON.stringify({error:'PRIVATE-secret',error_description:'DO_NOT_SHOW'}),JSON.stringify({error:'constructor'}),JSON.stringify({error:{message:'PRIVATE'}}),'not JSON DO_NOT_SHOW',JSON.stringify({error:'invalid_client',padding:'x'.repeat(9000)}),'null']){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());const auth=new DiscordAuth({db,config,game:{},fetchImpl:async()=>new Response(body,{status:400})});
  await assert.rejects(auth.exchange('code',{activity:true}),error=>{assert.match(error.message,/Discord sign-in failed/);assert.doesNotMatch(error.message,/PRIVATE|DO_NOT_SHOW|constructor|invalid_client|padding/);return true;});
 }
});

test('known but unseated identity is denied before creating a browser session',async t=>{
 const {auth}=fixture(t);auth.game.member=()=>null;
 await assert.rejects(auth.exchange('fixture',{activity:true}),error=>error.status===403&&error.code==='campaign_not_enrolled'&&error.recovery==='account_access');
 assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
});

test('OAuth provider recovery distinguishes host configuration from expired consent',async t=>{
 for(const [code,recovery] of [['invalid_client','host_configuration'],['invalid_grant','relaunch'],['access_denied','account_access'],['temporarily_unavailable','retry']]){
  const {auth}=fixture(t);auth.fetch=async()=>Response.json({error:code,error_description:'PRIVATE'},{status:400});
  await assert.rejects(auth.exchange('fixture',{activity:true}),error=>error.code===code&&error.recovery===recovery&&!error.message.includes('PRIVATE'));
 }
});

test('strict campaign lookup preserves its receiver and distinguishes unavailable source from no seat',async t=>{
 for(const strict of [true,false]){
  for(const unavailable of [true,false]){
   const {auth}=fixture(t);let lookups=0;
   const lookup=function(scope){assert.equal(this,auth.game);assert.equal(scope.owner,owner);lookups++;if(unavailable)throw new Error('PRIVATE checksum campaign secret');return null;};
   auth.game=strict?{readMember:lookup,member:()=>assert.fail('Strict lookup must be preferred')}:{readMember:null,member:lookup};
   const response=await authHttp('activity',()=>({auth,experience:'hollow-lantern'}))(new Request(config.activityOrigin+'/api/auth/activity',{method:'POST',headers:{origin:config.activityOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:'fixture'})}));
   const body=await response.json();assert.equal(response.status,unavailable?503:403);assert.equal(body.code,unavailable?'campaign_unavailable':'campaign_not_enrolled');assert.equal(body.recovery,unavailable?'retry':'account_access');assert.doesNotMatch(JSON.stringify(body),/PRIVATE|checksum|secret/);
   assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(lookups,1);assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
  }
 }
});

const activityRequest=fields=>new Request(config.activityOrigin+'/api/auth/activity',{method:'POST',headers:{origin:config.activityOrigin,'Content-Type':'application/json'},body:JSON.stringify(fields??{code:'fixture'})});
test('verified caller receives exact campaign denial and only its bounded identity',async t=>{
 for(const code of ['campaign_not_enrolled','campaign_ineligible','gm_access_revoked']){
  const {auth}=fixture(t);const original=auth.fetch;auth.fetch=async url=>url.endsWith('/users/@me')?Response.json({id:owner,username:'caller.name_1',email:'PRIVATE',guild:'PRIVATE'}):original(url);
  if(code==='campaign_not_enrolled')auth.game.member=()=>null;
  if(code==='campaign_ineligible')auth.config={...config,playerIds:[]};
  if(code==='gm_access_revoked')auth.game.member=()=> 'host';
  const response=await authHttp('activity',()=>({auth}))(activityRequest());const body=await response.json();
  assert.equal(response.status,403);assert.equal(body.code,code);assert.equal(body.recovery,'account_access');assert.deepEqual(body.viewer,{id:owner,username:'caller.name_1'});assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
  assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
 }
});

test('Discord lookup failures distinguish identity from membership without provider payloads',async t=>{
 for(const [path,status,code,recovery,verified] of [['/users/@me',401,'discord_identity_unverified','relaunch',false],[`/members/${owner}`,404,'campaign_ineligible','account_access',true],[`/guilds/${guild}`,403,'discord_membership_unverified','retry',true],['/roles',403,'discord_membership_unverified','retry',true],['/users/@me',429,'service_unavailable','retry',false],['/roles',500,'service_unavailable','retry',true]]){
  const {auth}=fixture(t);const original=auth.fetch;auth.fetch=async url=>url.endsWith(path)?Response.json({id:'199999999999999999',error:'PRIVATE'},{status}):original(url);
  const response=await authHttp('activity',()=>({auth}))(activityRequest());const body=await response.json();
  assert.equal(response.status,['discord_identity_unverified','campaign_ineligible'].includes(code)?401:503);assert.equal(body.code,code);assert.equal(body.recovery,recovery);assert.deepEqual(body.viewer,verified?{id:owner}:undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|199999999999999999/);
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
 }
});

test('unverified identities and unsafe handles never enter error viewer',async t=>{
 for(const user of [{id:'not-an-id',username:'caller'},{id:owner,username:'@everyone PRIVATE'},{id:owner,username:'x'.repeat(33)},{id:owner,username:'é'}]){
  const {auth}=fixture(t);const original=auth.fetch;auth.fetch=async url=>url.endsWith('/users/@me')?Response.json(user):original(url);auth.game.member=()=>null;
  const response=await authHttp('activity',()=>({auth}))(activityRequest());const body=await response.json();assert.deepEqual(body.viewer,user.id===owner?{id:owner}:undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|everyone|not-an-id/);
  assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
 }
 const {auth}=fixture(t);let calls=0;auth.fetch=()=>{calls++;assert.fail('Forged body must not reach Discord');};
 const response=await authHttp('activity',()=>({auth}))(activityRequest({code:'fixture',viewer:{id:owner},owner}));assert.equal(response.status,400);assert.equal((await response.json()).viewer,undefined);assert.equal(calls,0);
});

test('valid stored session adds only caller ID on recheck failure and remains stored',async t=>{
 const {auth}=fixture(t);const success=await auth.exchange('fixture',{activity:true});auth.game.member=()=>null;
 const handle=authHttp('session',()=>({auth}));
 const response=await handle(new Request(config.activityOrigin+'/api/auth/session',{headers:{cookie:`raph_activity_session=${success.token}`}}));const body=await response.json();assert.equal(body.code,'campaign_not_enrolled');assert.deepEqual(body.viewer,{id:owner});assert.equal(auth.db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,1);
 const invalid=await handle(new Request(config.activityOrigin+'/api/auth/session',{headers:{cookie:`raph_activity_session=${'f'.repeat(64)}`}}));assert.equal((await invalid.json()).viewer,undefined);
 await assert.rejects(auth.member(owner),error=>{assert.equal(error.viewer,undefined);return true;});
});
