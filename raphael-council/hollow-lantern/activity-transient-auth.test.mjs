import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {AuthError} from '../auth/discord.mjs';
import {createActivityRuntime} from './activity-runtime.mjs';

const origin='https://123456789012345678.discordsays.com',commandId='77777777-7777-4777-8777-777777777777';
const request=(operation,body,query='')=>new Request(origin+'/api/hollow-lantern/'+operation+query,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'synthetic=fixture'},...(body?{body:JSON.stringify(body)}:{})});
function fixture(renderAssets={}) {
  let checks=0,failAt=0,status=503,allFail=false,sends=0,revision=1,committed;
  const auth={config:{activityOrigin:origin},member:async()=>{checks++;if(allFail||checks===failAt)throw new AuthError('Membership temporarily unavailable.',status);return {campaign:'hollow',owner:'dm',role:'host'};}};
  auth.authenticate=()=>auth.member();
  const client={campaignId:'hollow',project:async scope=>({projectionVersion:2,campaignId:'hollow',revision,audience:scope.audience,currentSceneId:'briefing',characters:[],pendingActions:[],decisionOpen:false}),
    command:async input=>{sends++;committed={commandId:input.commandId,revision:++revision,replayed:false};return committed;},
    receipt:async()=>{if(committed)return {...committed,replayed:true};throw Object.assign(new Error('No receipt'),{code:'RECEIPT_NOT_FOUND'});}};
  const runtime=createActivityRuntime({auth,client,gmUserId:'dm',renderAssets});
  return {runtime,client,sends:()=>sends,failOn:(n,s=503)=>{checks=0;failAt=n;status=s;allFail=false;},failAll:()=>{allFail=true;}};
}

test('temporary authorization failures remain 503 at every view gate',async()=>{
  for(let gate=1;gate<=4;gate++){
    const f=fixture();f.failOn(gate);const response=await f.runtime.handle('view',request('view'));
    assert.equal(response.status,503,`gate ${gate}`);assert.equal((await response.json()).rejection,undefined);
  }
});

test('illustration pre-render and post-render authorization outages remain 503',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'hollow-auth-art-')),file=join(dir,'fixture.png');
  t.after(async()=>{await unlink(file);await rmdir(dir);});await writeFile(file,createCanvas(2,2).toBuffer('image/png'));
  for(let gate=1;gate<=5;gate++){
    const f=fixture({sceneArts:{briefing:file}}),view=await(await f.runtime.handle('view',request('view'))).json();
    f.failOn(gate);const response=await f.runtime.handle('illustration',request('illustration',undefined,'?kind=scene&viewToken='+view.viewToken));
    assert.equal(response.status,503,`gate ${gate}`);
  }
});

test('genuine authentication and authorization denials remain denied',async()=>{
  for(const [gate,status]of [[1,401],[2,403],[3,403],[4,403]]){
    const f=fixture();f.failOn(gate,status);assert.equal((await f.runtime.handle('view',request('view'))).status,status);
  }
});

test('uncertain authorization cannot attest that a stale action is safe to replace',async()=>{
  const f=fixture();f.failOn(3);
  const response=await f.runtime.handle('action',request('action',{viewToken:'stale',revision:1,commandId,action:'checkpoint',payload:{}}));
  assert.equal(response.status,503);assert.equal((await response.json()).rejection,undefined);assert.equal(f.sends(),0);
});

test('post-commit authorization outage retains original receipt without a second mutation',async()=>{
  const f=fixture(),view=await(await f.runtime.handle('view',request('view'))).json(),send=f.client.command;
  f.client.command=async input=>{const receipt=await send(input);f.failAll();return receipt;};
  const response=await f.runtime.handle('action',request('action',{viewToken:view.viewToken,revision:1,commandId,action:'checkpoint',payload:{}}));
  assert.equal(response.status,503);assert.equal((await response.json()).rejection,undefined);assert.equal(f.sends(),1);
  f.failOn(0);const recovered=await f.runtime.handle('receipt',request('receipt',{commandId}));
  assert.equal(recovered.status,200);assert.deepEqual((await recovered.json()).receipt,{commandId,revision:2,replayed:true});assert.equal(f.sends(),1);
});

test('receipt authorization outage never returns a result or rejection attestation',async()=>{
  for(let gate=1;gate<=3;gate++){
    const f=fixture();f.client.receipt=async()=>({commandId,revision:1,replayed:true});f.failOn(gate);
    const response=await f.runtime.handle('receipt',request('receipt',{commandId}));assert.equal(response.status,503);
    const body=await response.json();assert.equal(body.receipt,undefined);assert.equal(body.rejection,undefined);
  }
});
