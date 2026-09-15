import test from 'node:test';
import assert from 'node:assert/strict';
import {authHttp} from './http.mjs';
import {AuthError} from './discord.mjs';
import {DatabaseSync} from 'node:sqlite';
import {DiscordAuth} from './discord.mjs';
import {createHash} from 'node:crypto';
import {sessionCookie} from './discord.mjs';

test('campaign OAuth callbacks select their own state store and isolated cookies',async t=>{
 const apps=new Map(),providerCalls=[];
 for(const campaign of ['table-a','table-b']){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const config={campaign,clientId:'100000000000000003',secret:'fixture-secret',publicOrigin:'https://game.example',activityOrigin:'https://100000000000000003.discordsays.com',cookieNamespace:createHash('sha256').update(campaign).digest('hex').slice(0,24)};
  const auth=new DiscordAuth({db,game:{},config,fetchImpl:async(url)=>{providerCalls.push(url);return Response.json({access_token:'fixture-access',scope:'identify'});}});
  auth.discord=async()=>({id:'100000000000000001'});auth.member=async owner=>({campaign,owner,role:'host'});apps.set(campaign,{auth,experience:'hollow-lantern'});
 }
 const getServices=req=>{const id=new URL(req.url).searchParams.get('campaignId');if(!apps.has(id))throw new AuthError('Unknown campaign',404);return apps.get(id);};
 const starts={};for(const id of apps.keys()){
  const response=await authHttp('start',getServices)(new Request(`https://game.example/api/auth/discord/start?campaignId=${id}`));assert.equal(response.status,302);
  starts[id]={state:new URL(response.headers.get('location')).searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0]};
  assert.match(starts[id].state,/^hl\./);assert.match(starts[id].cookie,/^raph_oauth_state_[a-f0-9]{24}=/);
 }
 assert.notEqual(starts['table-a'].cookie.split('=')[0],starts['table-b'].cookie.split('=')[0]);
 const b=starts['table-b'];
 const wrong=await authHttp('callback',getServices)(new Request(`https://game.example/api/auth/discord/callback?code=fixture&state=${b.state}&campaignId=table-a`,{headers:{cookie:b.cookie}}));assert.notEqual(wrong.status,302);assert.equal(providerCalls.length,0);
 const cross=await authHttp('callback',getServices)(new Request(`https://game.example/api/auth/discord/callback?code=fixture&state=${b.state}`,{headers:{cookie:starts['table-a'].cookie}}));assert.notEqual(cross.status,302);assert.equal(providerCalls.length,0);
 const response=await authHttp('callback',getServices)(new Request(`https://game.example/api/auth/discord/callback?code=fixture&state=${b.state}`,{headers:{cookie:b.cookie}}));assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://game.example/hollow-lantern?campaignId=table-b');
 const session=response.headers.getSetCookie().find(c=>c.startsWith('raph_web_session_')).split(';')[0];
 const scope=await apps.get('table-b').auth.authenticate(new Request('https://game.example/api/auth/session',{headers:{cookie:session}}));assert.equal(scope.campaign,'table-b');
 assert.equal(await apps.get('table-a').auth.authenticate(new Request('https://game.example/api/auth/session',{headers:{cookie:session}})),null);
 const ownSession=await authHttp('session',getServices)(new Request('https://game.example/api/auth/session?campaignId=table-b',{headers:{cookie:session}}));assert.equal((await ownSession.json()).scope.campaign,'table-b');
 const foreignSession=await authHttp('session',getServices)(new Request('https://game.example/api/auth/session?campaignId=table-a',{headers:{cookie:session}}));assert.equal((await foreignSession.json()).scope,null);
 const activityOrigin=apps.get('table-b').auth.config.activityOrigin;
 const activity=await authHttp('activity',getServices)(new Request(activityOrigin+'/api/auth/activity?campaignId=table-b',{method:'POST',headers:{origin:activityOrigin,'Content-Type':'application/json'},body:JSON.stringify({code:'fixture'})}));assert.equal(activity.status,200);
 const activityCookie=activity.headers.get('set-cookie').split(';')[0];assert.match(activityCookie,/^raph_activity_session_[a-f0-9]{24}=/);
 assert.equal((await apps.get('table-b').auth.authenticate(new Request(activityOrigin,{headers:{cookie:activityCookie}}))).campaign,'table-b');assert.equal(await apps.get('table-a').auth.authenticate(new Request(activityOrigin,{headers:{cookie:activityCookie}})),null);
 const beforeMalformed=providerCalls.length;
 for(const state of ['hl.bad','hl.dGFibGUtYg.'+'0'.repeat(63),'hl.dGFibGUtYg.'+'0'.repeat(64)+'&state=duplicate']){const bad=await authHttp('callback',getServices)(new Request('https://game.example/api/auth/discord/callback?code=fixture&state='+state,{headers:{cookie:b.cookie}}));assert.notEqual(bad.status,302);}assert.equal(providerCalls.length,beforeMalformed);
 const cookieA=sessionCookie(apps.get('table-a').auth.config,'a'.repeat(64));assert.match(cookieA,/raph_web_session_[a-f0-9]{24}=/);
 const logout=await authHttp('logout',getServices)(new Request('https://game.example/api/auth/logout?campaignId=table-b',{method:'POST',headers:{origin:'https://game.example',cookie:session}}));assert.equal(logout.status,200);
 await assert.rejects(apps.get('table-b').auth.authenticate(new Request('https://game.example/api/auth/session',{headers:{cookie:session}})));
 for(const query of ['campaignId=table-a&campaignId=table-b','campaignId=unknown'])assert.notEqual((await authHttp('config',getServices)(new Request('https://game.example/api/auth/config?'+query))).status,200);
});
const origin='https://100000000000000003.discordsays.com';
const request=(body)=>new Request(`${origin}/api/auth/activity`,{method:body?'POST':'GET',headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('server composition selects experience independently of campaign names on every auth surface',async()=>{
 for(const [experience,campaign] of [['hollow-lantern','rehearsal-custom'],['legacy','operation-hollow-lantern']]){
  const scope={campaign,owner:'owner',role:'host'};
  const getServices=()=>({experience,auth:{config:{clientId:'100000000000000003',campaign,activityOrigin:origin},authenticate:async()=>scope,exchange:async()=>({scope,token:'a'.repeat(64),accessToken:'fixture-token'})}});
  assert.deepEqual(await(await authHttp('config',getServices)(request())).json(),{clientId:'100000000000000003',experience,campaignId:campaign});
  assert.deepEqual(await(await authHttp('session',getServices)(request())).json(),{scope,experience});
  const exchange=await authHttp('activity',getServices)(request({code:'fixture'}));
  assert.deepEqual(await exchange.json(),{scope,experience,access_token:'fixture-token'});
  assert.match(exchange.headers.get('Set-Cookie'),/HttpOnly/);
  assert.equal((await authHttp('activity',getServices)(request({code:'fixture',experience:'hollow-lantern'}))).status,400);
 }
});
test('auth HTTP recovery is bounded and provider/internal details are not reflected',async()=>{
 for(const [error,code,recovery,status] of [[new AuthError('Host configuration needed',401,'invalid_client'),'invalid_client','host_configuration',401],[new AuthError('Consent expired',401,'invalid_grant'),'invalid_grant','relaunch',401],[new AuthError('No seat',403),'account_access','account_access',403],[new Error('PRIVATE token=secret'),'service_unavailable','retry',503]]){
  const response=await authHttp('config',()=>{throw error;})(request());const value=await response.json();
  assert.equal(response.status,status);assert.equal(value.code,code);assert.equal(value.recovery,recovery);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|secret/);
 }
 assert.equal(new AuthError('Bounded',401,'PRIVATE').code,'session_expired');
});

test('rejected and public origins cannot exchange a code or create a session',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let exchanges=0;
 const auth=new DiscordAuth({db,game:{},config:{activityOrigin:origin,publicOrigin:'https://game.example'},fetchImpl:async()=>assert.fail('No provider request')});
 auth.exchange=async()=>{exchanges++;assert.fail('Origin guard must precede exchange');};
 const handle=authHttp('activity',()=>({auth,experience:'hollow-lantern'}));
 for(const [submitted,code,recovery] of [[null,'origin_not_allowed','host_configuration'],['https://discord.com','origin_not_allowed','host_configuration'],['https://game.example','activity_origin_required','relaunch']]){
  const headers={'Content-Type':'application/json'};if(submitted)headers.origin=submitted;
  const response=await handle(new Request(origin+'/api/auth/activity',{method:'POST',headers,body:JSON.stringify({code:'PRIVATE'})}));
  const value=await response.json();assert.equal(response.status,403);assert.equal(value.code,code);assert.equal(value.recovery,recovery);assert.equal(response.headers.get('Set-Cookie'),null);assert.doesNotMatch(JSON.stringify(value),/PRIVATE/);
 }
 assert.equal(exchanges,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM browser_sessions').get().n,0);
});

test('HTTP ignores an arbitrary error viewer without verified provenance',async()=>{
 const error=new AuthError('No seat',403,'campaign_not_enrolled');error.viewer={id:'100000000000000001',username:'forged',secret:'PRIVATE'};
 const response=await authHttp('session',()=>({auth:{config:{},authenticate:async()=>{throw error;}}}))(request());const body=await response.json();assert.equal(body.code,'campaign_not_enrolled');assert.equal(body.viewer,undefined);assert.doesNotMatch(JSON.stringify(body),/forged|PRIVATE/);
});
