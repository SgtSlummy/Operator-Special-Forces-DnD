import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedAuthRedirect,createActivityEdge} from './activity-edge.mjs';
const publicOrigin='https://table.example.test',clientId='1540006061099188274';
const campaign='hollow-lantern-rehearsal-20260910',nonce='a'.repeat(64);
const stateFor=id=>`hl.${Buffer.from(id).toString('base64url')}.${nonce}`;
const state=stateFor(campaign);
const start=`/api/auth/discord/start?campaignId=${campaign}`;
const callback=`/api/auth/discord/callback?code=sample&state=${state}`;
const authorize=(value=state)=>{const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:publicOrigin+'/api/auth/discord/callback',scope:'identify',state:value});return url.href;};
const allowed=(route,location,status=302)=>allowedAuthRedirect({route,location,status,publicOrigin,clientId});
test('campaign OAuth start requires the selected campaign and canonical Discord destination',()=>{
 assert.equal(allowed(start,authorize()),true);
 // Existing single-campaign hosts issue opaque hex state even when the entry link selects a campaign.
 assert.equal(allowed(start,authorize(nonce)),true);
 for(const value of [nonce.slice(1),stateFor('another-campaign'),state+'.extra','hl.bad.'+nonce])assert.equal(allowed(start,authorize(value)),false,value);
 for(const altered of [authorize().replace('discord.com','discord.com.evil.test'),authorize()+'&scope=identify',authorize()+'&prompt=consent',authorize().replace('identify','email')])assert.equal(allowed(start,altered),false);
 assert.equal(allowed(start+'&campaignId='+campaign,authorize()),false);
 assert.equal(allowed('/api/auth/discord/start?campaignId=bad%2Fpath',authorize()),false);
});
test('callback returns only to the campaign encoded in its state',()=>{
 const location=publicOrigin+'/hollow-lantern?campaignId='+campaign;
 assert.equal(allowed(callback,location),true);
 for(const dest of [publicOrigin+'/hollow-lantern',publicOrigin+'/hollow-lantern?campaignId=another',location+'&campaignId='+campaign,location+'&next=/admin',location+'#secret','https://evil.test/hollow-lantern?campaignId='+campaign])assert.equal(allowed(callback,dest),false,dest);
 assert.equal(allowed(callback+'&state='+state,location),false);
 assert.equal(allowed(callback+'&campaignId=another',location),false);
 assert.equal(allowed('/api/auth/discord/callback?campaignId='+campaign,location),false);
 assert.equal(allowed(callback.replace(state,'hl.bad.'+nonce),location),false);
});
test('campaign sign-in recovery preserves campaign without allowing arbitrary redirect parameters',()=>{
 for(const route of [start,callback]){
  assert.equal(allowed(route,publicOrigin+'/?connection=recovery&campaignId='+campaign,303),true);
  for(const query of ['connection=recovery','connection=recovery&campaignId=another','connection=unknown&campaignId='+campaign,'connection=recovery&campaignId='+campaign+'&next=https://evil.test','connection=recovery&connection=retry'])assert.equal(allowed(route,publicOrigin+'/?'+query,303),false);
 }
});
test('legacy non-campaign OAuth remains bounded',()=>{
 assert.equal(allowed('/api/auth/discord/start',authorize(nonce)),true);
 assert.equal(allowed('/api/auth/discord/start',authorize()),false);
 assert.equal(allowed('/api/auth/discord/callback?state='+nonce,publicOrigin+'/hollow-lantern'),true);
 assert.equal(allowed('/api/auth/discord/callback?state='+nonce,publicOrigin+'/?connection=retry',303),true);
});
test('running edge forwards campaign OAuth and secure cookies but blocks unrelated routes and redirects',async()=>{
 let destination=authorize(),calls=0;
 const edge=createActivityEdge({port:0,publicOrigin,clientId,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:destination,'set-cookie':'raph_oauth_state=sample; Path=/api/auth; HttpOnly; Secure; SameSite=Lax'}});}});
 await edge.start();const base='http://127.0.0.1:'+edge.server.address().port;
 try{
  let response=await fetch(base+start,{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),destination);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure/);
  destination=authorize(stateFor('another'));response=await fetch(base+start,{redirect:'manual'});assert.equal(response.status,502);assert.equal(response.headers.get('set-cookie'),null);
  const before=calls;for(const route of ['/api/admin','/_internal/draft-store','/api/commands']){response=await fetch(base+route);assert.equal(response.status,404);}assert.equal(calls,before);
 }finally{await edge.close();}
});
