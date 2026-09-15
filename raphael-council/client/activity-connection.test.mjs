import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {connectActivity, connectionProblem} from './activity-connection.mjs';

function fixture(overrides = {}) {
  const controller = new AbortController(), calls = [], progress = [];
  const config = {clientId:'1540006061099188274',experience:'hollow-lantern',campaignId:'hollow-lantern-rehearsal-20260910',...overrides.config};
  const scope = {campaign:config.campaignId,owner:'1230264975533281312',role:'host'};
  const bodies = {
    '/api/auth/config':config,
    '/api/auth/activity':{access_token:'sensitive-bearer',scope,experience:config.experience,...overrides.exchange},
    '/api/auth/session':{scope,experience:config.experience,...overrides.session},
  };
  const sdk = {ready:async()=>{},commands:{authorize:async()=>({code:'sensitive-code'}),authenticate:async()=>({})}};
  const options = {signal:controller.signal,timeoutMs:200,state:()=> 'fixed-state',onProgress:value=>progress.push(value),
    createSDK:async id=>{calls.push(['sdk',id]);return sdk;},
    fetchImpl:async(path,init)=>{calls.push([path,init]);return Response.json(bodies[path]);},
  };
  return {controller,calls,progress,bodies,sdk,options};
}

test('a custom Hollow rehearsal opens the server-selected experience and checks its cookie session',async()=>{
  const f=fixture();let authenticated;
  f.sdk.commands.authenticate=async value=>{authenticated=value;};
  const result=await connectActivity(f.options);
  assert.equal(result.experience,'hollow-lantern');
  assert.equal(result.scope.campaign,'hollow-lantern-rehearsal-20260910');
  assert.deepEqual(authenticated,{access_token:'sensitive-bearer'});
  assert.deepEqual(f.calls.filter(([path])=>path.startsWith('/api')).map(([path])=>path),['/api/auth/config','/api/auth/activity','/api/auth/session']);
  assert.equal(f.calls.find(([path])=>path==='/api/auth/activity')[1].body,JSON.stringify({code:'sensitive-code'}));
  assert.equal(JSON.stringify([result,f.progress]).includes('sensitive'),false);
});

test('legacy is chosen explicitly, even when its campaign name contains Hollow Lantern',async()=>{
  const f=fixture({config:{experience:'legacy',campaignId:'operation-hollow-lantern'}});
  assert.equal((await connectActivity(f.options)).experience,'legacy');
});

test('missing or unknown configuration cannot silently open the old game',async()=>{
  for(const config of [{experience:undefined},{experience:'other'},{campaignId:''},{clientId:null}]) {
    const f=fixture({config});
    await assert.rejects(connectActivity(f.options),{code:'invalid_configuration',recovery:'host_configuration'});
    assert.equal(f.calls.some(([path])=>path==='sdk'),false);
  }
});

test('a changed campaign or experience stops before SDK authentication',async()=>{
  for(const exchange of [{experience:'legacy'},{scope:{campaign:'elsewhere',owner:'1230264975533281312',role:'host'}}]) {
    const f=fixture({exchange});let authenticated=false;f.sdk.commands.authenticate=async()=>{authenticated=true;};
    await assert.rejects(connectActivity(f.options),{code:'campaign_mismatch'});
    assert.equal(authenticated,false);
  }
});

test('an invalid client gives host repair guidance without reflecting provider data',async()=>{
  const f=fixture(),fetch=f.options.fetchImpl;
  f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({error:'sensitive-provider-payload',code:'invalid_client',recovery:'host_configuration'},{status:401}):fetch(path,init);
  const problem=await connectActivity(f.options).catch(connectionProblem);
  assert.equal(problem.recovery,'host_configuration');assert.equal(problem.code,'invalid_client');
  assert.doesNotMatch(problem.message,/sensitive|reopen|try again/i);
});

test('unseated and expired authorization get distinct recovery paths',async()=>{
  for(const [code,recovery,status] of [['account_access','account_access',403],['invalid_grant','relaunch',401],['service_unavailable','retry',503]]) {
    const f=fixture(),fetch=f.options.fetchImpl;
    f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({code,recovery},{status}):fetch(path,init);
    await assert.rejects(connectActivity(f.options),{code,recovery});
  }
});

test('authentication cannot complete if the private cookie is absent or belongs to another viewer',async()=>{
  const f=fixture({session:{scope:{campaign:'hollow-lantern-rehearsal-20260910',owner:'294709392798908417',role:'host'}}});
  await assert.rejects(connectActivity(f.options),{code:'session_mismatch'});
  const g=fixture(),fetch=g.options.fetchImpl;
  g.options.fetchImpl=async(path,init)=>path==='/api/auth/session'?Response.json({code:'session_expired',recovery:'relaunch'},{status:401}):fetch(path,init);
  await assert.rejects(connectActivity(g.options),{code:'session_expired'});
});

test('connection and campaign availability failures do not tell a seated user to change accounts',async()=>{
  for(const [code,recovery,status,message] of [
    ['origin_not_allowed','host_configuration',403,/expected game connection/],
    ['activity_origin_required','relaunch',403,/Launch Davy Jones from Discord/],
    ['campaign_unavailable','retry',503,/campaign is temporarily unavailable/],
  ]){
    const f=fixture(),fetch=f.options.fetchImpl;let authenticated=false;
    f.sdk.commands.authenticate=async()=>{authenticated=true;};
    f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({error:'sensitive-token-and-private-save',code,recovery},{status}):fetch(path,init);
    const problem=await connectActivity(f.options).catch(connectionProblem);
    assert.equal(problem.code,code);assert.equal(problem.recovery,recovery);assert.match(problem.message,message);
    assert.doesNotMatch(problem.message,/sensitive|enroll|revoked/i);
    assert.equal(authenticated,false);assert.equal(f.calls.some(([path])=>path==='/api/auth/session'),false);
  }
});

test('unknown server diagnostic names cannot inject messages through object prototypes',async()=>{
  for(const code of ['__proto__','constructor','unknown_failure']){
    const f=fixture(),fetch=f.options.fetchImpl;
    f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({error:'sensitive-provider-error',code,recovery:'retry'},{status:503}):fetch(path,init);
    const problem=await connectActivity(f.options).catch(connectionProblem);
    assert.equal(problem.recovery,'retry');assert.equal(typeof problem.message,'string');
    assert.match(problem.message,/temporarily unavailable/);assert.doesNotMatch(problem.message,/sensitive/);
  }
});

test('unmount during consent prevents its late code from being exchanged',async()=>{
  const f=fixture();let consent,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  f.sdk.commands.authorize=()=>{started();return new Promise(resolve=>{consent=resolve;});};
  const pending=connectActivity(f.options);const rejection=assert.rejects(pending,{name:'AbortError'});
  await waiting;f.controller.abort();await rejection;
  consent({code:'late-private-code'});await delay(1);
  assert.equal(f.calls.some(([path])=>path==='/api/auth/activity'),false);
});

test('human consent is not timed out while the person reads it',async()=>{
  const f=fixture();f.options.timeoutMs=10;
  f.sdk.commands.authorize=async()=>{await delay(30);return {code:'consented'};};
  assert.equal((await connectActivity(f.options)).experience,'hollow-lantern');
});

test('a stalled network request times out and is aborted',async()=>{
  const f=fixture();f.options.timeoutMs=10;let requestSignal;
  f.options.fetchImpl=async(_path,init)=>{requestSignal=init.signal;return new Promise(()=>{});};
  await assert.rejects(connectActivity(f.options),{code:'connection_timeout',recovery:'retry'});
  assert.equal(requestSignal.aborted,true);
});

test('already cancelled work never starts a network request',async()=>{
  const f=fixture();f.controller.abort();
  await assert.rejects(connectActivity(f.options),{name:'AbortError'});assert.deepEqual(f.calls,[]);
});

test('raw SDK exceptions never become visible provider messages',()=>{
  const result=connectionProblem(new Error('sensitive bearer details'));
  assert.equal(result.code,'connection_failed');assert.doesNotMatch(result.message,/sensitive|bearer/);
});

test('access failures identify only the bounded caller and explain the failed gate',async()=>{
  for(const [code,recovery,phrase] of [
    ['campaign_not_enrolled','account_access',/does not have a seat/],
    ['campaign_ineligible','account_access',/not currently eligible/],
    ['gm_access_revoked','account_access',/no longer has DM access/],
    ['discord_membership_unverified','retry',/could not verify your server access/],
  ]) {
    const f=fixture(),fetch=f.options.fetchImpl;let authenticated=false;
    f.sdk.commands.authenticate=async()=>{authenticated=true;};
    f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({code,recovery,viewer:{id:'1230264975533281312',username:'test_dm',secret:'sensitive'},error:'sensitive'},{status:403}):fetch(path,init);
    const problem=await connectActivity(f.options).catch(connectionProblem);
    assert.match(problem.message,/^Signed in as @test_dm \(1230264975533281312\)\./);
    assert.match(problem.message,phrase);assert.doesNotMatch(problem.message,/sensitive/);
    assert.equal(authenticated,false);assert.equal(f.calls.some(([path])=>path==='/api/auth/session'),false);
  }
});

test('malformed identities and identities on pre-verification failures are omitted',async()=>{
  for(const [code,viewer] of [
    ['campaign_not_enrolled',null],['campaign_not_enrolled',[]],
    ['campaign_not_enrolled',{id:123}],['campaign_not_enrolled',{id:'invalid',username:'test'}],
    ['discord_identity_unverified',{id:'1230264975533281312',username:'test'}],
    ['invalid_client',{id:'1230264975533281312',username:'test'}],
  ]) {
    const f=fixture(),fetch=f.options.fetchImpl;
    f.options.fetchImpl=async(path,init)=>path==='/api/auth/activity'?Response.json({code,recovery:'relaunch',viewer},{status:401}):fetch(path,init);
    const problem=await connectActivity(f.options).catch(connectionProblem);
    assert.doesNotMatch(problem.message,/Signed in as|1230264975533281312/);
  }
});

test('session-stage denial displays id only when username is unsafe',async()=>{
  const f=fixture(),fetch=f.options.fetchImpl;
  f.options.fetchImpl=async(path,init)=>path==='/api/auth/session'?Response.json({code:'campaign_ineligible',recovery:'account_access',viewer:{id:'1230264975533281312',username:'<script>secret</script>'}},{status:401}):fetch(path,init);
  const problem=await connectActivity(f.options).catch(connectionProblem);
  assert.match(problem.message,/^Signed in as Discord account 1230264975533281312\./);
  assert.match(problem.message,/not currently eligible/);assert.doesNotMatch(problem.message,/script|secret/);
});
