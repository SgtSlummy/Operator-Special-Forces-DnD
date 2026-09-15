import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCampaign, entryProblem} from './connection.mjs';
import * as entry from './connection.mjs';

test('entry requests explicitly select the second campaign without browser-global state',async()=>{
 const selected='second-table',calls=[];
 const result=await inspectCampaign({campaignId:selected,signal:new AbortController().signal,fetchImpl:async path=>{
  const url=new URL(path,'https://table.example');calls.push(path);assert.equal(url.searchParams.get('campaignId'),selected);
  return Response.json(url.pathname.endsWith('/config')?{experience:'hollow-lantern',campaignId:selected,clientId:'1540006061099188274'}:url.pathname.endsWith('/session')?{experience:'hollow-lantern',scope:{campaign:selected,owner:'1230264975533281312',role:'player'}}:{campaignId:selected,revision:7});
 }});assert.deepEqual(result,{status:'ready',signedIn:true,revision:7});assert.equal(calls.length,3);
});
test('entry navigation and catalog selection preserve one validated campaign',()=>{
 const descriptor={campaignId:'second-table',guildId:'guild-b',channelId:'channel-b'},seen=[];
 const catalog={defaultCampaignId:'first-table',get:id=>{seen.push(id);return id==='second-table'?descriptor:id==='first-table'?{campaignId:id}:undefined;}};
 assert.equal(entry.selectEntryCampaign('second-table',catalog),descriptor);assert.equal(entry.selectEntryCampaign(undefined,catalog).campaignId,'first-table');
 for(const selected of [['second-table'],['first-table','second-table'],'','../private','unknown'])assert.throws(()=>entry.selectEntryCampaign(selected,catalog));
 for(const path of ['/','/hollow-lantern','/api/auth/discord/start','/api/auth/logout'])assert.equal(entry.campaignPath(path,'second-table'),`${path}?campaignId=second-table`);
 assert.throws(()=>entry.campaignPath('/hollow-lantern','../private'));assert.throws(()=>entry.campaignPath('https://other.example','second-table'));
 assert.deepEqual(seen,['second-table','first-table','unknown']);
});
import {authHttp} from '../../auth/http.mjs';
import {AuthError} from '../../auth/discord.mjs';

const campaignId = 'hollow-lantern-rehearsal-fixture';
const configuration = {experience:'hollow-lantern', campaignId, clientId:'1540006061099188274'};
const session = {experience:'hollow-lantern', scope:{campaign:campaignId, owner:'1230264975533281312', role:'host'}};
function fixture(overrides = {}) {
  const calls = [];
  const responses = {
    '/api/auth/config': configuration,
    '/api/auth/session': session,
    '/api/hollow-lantern/view': {campaignId, revision:42, viewToken:'private-token', actor:{inventory:['private-item']}},
    ...overrides,
  };
  return {calls, options:{campaignId, signal:new AbortController().signal, fetchImpl:async (path, options) => {
    calls.push({path, options});
    const url=new URL(path,'https://table.example');assert.equal(url.searchParams.get('campaignId'),campaignId);
    const value = responses[url.pathname];
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  }}};
}

test('app opening verifies the selected campaign and live table using read-only requests', async () => {
  const f = fixture();
  assert.deepEqual(await inspectCampaign(f.options), {status:'ready', signedIn:true, revision:42});
  assert.deepEqual(f.calls.map(c=>new URL(c.path,'https://table.example').pathname), ['/api/auth/config','/api/auth/session','/api/hollow-lantern/view']);
  for (const c of f.calls) {assert.equal(c.options.method, undefined);assert.equal(c.options.cache,'no-store');assert.equal(c.options.credentials,'include');}
});
test('signed-out users never request a private table or start OAuth automatically', async () => {
  const f = fixture({'/api/auth/session':Response.json({error:'expired'}, {status:401})});
  assert.deepEqual(await inspectCampaign(f.options), {status:'sign_in', signedIn:false});
  assert.equal(f.calls.length, 2);
});

test('the actual auth handler no-session response offers sign-in without a private request',async()=>{
 const response=await authHttp('session',()=>({experience:'hollow-lantern',auth:{config:{campaign:campaignId},authenticate:async()=>null}}))(new Request('http://127.0.0.1/api/auth/session'));
 assert.equal(response.status,200);
 const f=fixture({'/api/auth/session':response});
 assert.deepEqual(await inspectCampaign(f.options),{status:'sign_in',signedIn:false});
 assert.deepEqual(f.calls.map(c=>new URL(c.path,'https://table.example').pathname),['/api/auth/config','/api/auth/session']);
});
test('revoked accounts receive enrollment guidance', async () => {
  const f = fixture({'/api/auth/session':Response.json({}, {status:403})});
  assert.equal((await inspectCampaign(f.options)).status, 'account_access');assert.equal(f.calls.length,2);
});
test('campaign or client configuration mismatch never loads another campaign', async () => {
  for (const config of [{...configuration,campaignId:'other'},{...configuration,experience:'legacy'},{...configuration,clientId:null}]) {
    const f=fixture({'/api/auth/config':config});assert.equal((await inspectCampaign(f.options)).status,'host_configuration');assert.equal(f.calls.length,1);
  }
});
test('session identity and membership must match before the table is requested', async () => {
  for (const changed of [{...session,experience:'legacy'},{...session,scope:{...session.scope,campaign:'other'}},{...session,scope:{...session.scope,owner:'wrong'}},{...session,scope:{...session.scope,role:'visitor'}}]) {
    const f=fixture({'/api/auth/session':changed});assert.equal((await inspectCampaign(f.options)).status,'host_configuration');assert.equal(f.calls.length,2);
  }
});
test('unavailable engine does not claim the game is ready or leak its error', async () => {
  const f = fixture({'/api/hollow-lantern/view':Response.json({error:'secret internal path'}, {status:503})});
  assert.deepEqual(await inspectCampaign(f.options), {status:'retry', signedIn:true});
});
test('access revoked between sign-in and projection clears readiness', async () => {
  for (const status of [401,403]) {
    const f = fixture({'/api/hollow-lantern/view':Response.json({}, {status})});
    assert.deepEqual(await inspectCampaign(f.options),{status:status===401?'sign_in':'account_access',signedIn:status!==401});
  }
});
test('only a matching campaign with a committed revision is ready', async () => {
  for (const table of [{campaignId:'other',revision:42},{campaignId,revision:-1},{campaignId,revision:1.1},{campaignId,revision:'42'}]) {
    const f=fixture({'/api/hollow-lantern/view':table});assert.equal((await inspectCampaign(f.options)).status,'host_configuration');
  }
});
test('malformed and network failures offer retry without exposing provider data', async () => {
  for (const value of [new Response('private invalid HTML'),new Error('private provider data')]) {
    const f=fixture({'/api/auth/config':value});const result=await inspectCampaign(f.options);
    assert.ok(['host_configuration','retry'].includes(result.status));assert.equal(JSON.stringify(result).includes('private'),false);
  }
});
test('host errors remain distinct from retryable outages', async () => {
  const f=fixture({'/api/auth/config':Response.json({recovery:'host_configuration'},{status:503})});assert.equal((await inspectCampaign(f.options)).status,'host_configuration');
  assert.equal(entryProblem('https://evil.example/secret'),'retry');
});
test('cancellation does not publish a stale connection result', async () => {
  const controller=new AbortController(),f=fixture();controller.abort();
  await assert.rejects(inspectCampaign({...f.options,signal:controller.signal}),{name:'AbortError'});assert.equal(f.calls.length,0);
});
test('a stalled host request is bounded', async () => {
  const keepAlive=setTimeout(()=>{},1000);
  try {
    const f=fixture();const result=await inspectCampaign({...f.options,timeoutMs:20,fetchImpl:(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
    assert.deepEqual(result,{status:'retry',signedIn:false});
  } finally {clearTimeout(keepAlive);}
});

function platform(experience, exchange = async()=>({token:'fixture-session'})) {
  return {experience,auth:{config:{publicOrigin:'https://table.example',campaign:campaignId},exchange}};
}
test('browser OAuth returns Hollow Lantern to its actual table and preserves legacy routing', async () => {
  for (const [experience,target] of [['hollow-lantern','/hollow-lantern'],['legacy','/play']]) {
    const response=await authHttp('callback',()=>platform(experience))(new Request('https://table.example/api/auth/discord/callback?code=fixture&state=fixture'));
    assert.equal(response.status,302);assert.equal(response.headers.get('Location'),`https://table.example${target}`);assert.match(response.headers.get('Set-Cookie'),/HttpOnly/);
  }
});
test('browser OAuth failures return a bounded recovery screen without provider details', async () => {
  const failure=new AuthError('private provider detail',503,'invalid_client');
  const response=await authHttp('callback',()=>platform('hollow-lantern',async()=>{throw failure;}))(new Request('https://table.example/api/auth/discord/callback?code=private-code'));
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/?connection=host_configuration');assert.equal(await response.text(),'');assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('Activity failures retain JSON recovery for the existing embedded client', async () => {
  const response=await authHttp('session',()=>{throw new Error('private exception');})(new Request('https://table.example/api/auth/session'));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Authentication service unavailable.',code:'service_unavailable',recovery:'retry'});
});
test('Hollow configuration initialization failures also return the browser to recovery', async t => {
  const original=process.env.RAPHAEL_CAMPAIGN_ID;
  t.after(()=>{if(original===undefined)delete process.env.RAPHAEL_CAMPAIGN_ID;else process.env.RAPHAEL_CAMPAIGN_ID=original;});
  process.env.RAPHAEL_CAMPAIGN_ID='operation-hollow-lantern';
  for(const action of ['start','callback']) {
    const response=await authHttp(action,()=>{throw new Error('private configuration path');})(new Request(`https://table.example/api/auth/discord/${action}`));
    assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/?connection=retry');assert.equal(await response.text(),'');
  }
});
