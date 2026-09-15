import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityRuntime,usesHollowAuthority} from './activity-runtime.mjs';
const origin='https://123456789012345678.discordsays.com';
function fixture(renderAssets={}){let member=true,revision=1;const calls=[];const auth={config:{activityOrigin:origin},authenticate:async()=>member?{campaign:'hollow',owner:'dm',role:'host'}:null,member:async()=>member?{campaign:'hollow',owner:'dm',role:'host'}:null};const client={campaignId:'hollow',project:async scope=>({projectionVersion:2,campaignId:'hollow',revision,audience:scope.audience,characterId:scope.actorId,currentSceneId:'briefing',characters:scope.actorId?[{characterId:scope.actorId,ownerId:'owner',displayName:'Actor',characterType:'player'}]:[],pendingActions:[],decisionOpen:false}),command:async request=>{calls.push(request);return {revision:++revision,commandId:request.commandId,replayed:false};},receipt:async request=>({revision,commandId:request.commandId,replayed:true})};const runtime=createActivityRuntime({auth,client,gmUserId:'dm',renderAssets});return {runtime,calls,revoke:()=>member=false,advance:()=>revision++,client};}
const req=(operation,{actor='one',cookie='session=a',body}={})=>new Request(`${origin}/api/hollow-lantern/${operation}?actorId=${actor}`,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('copied session and wrong-character tokens cannot dispatch an engine command',async()=>{const f=fixture();const view=await(await f.runtime.handle('view',req('view'))).json();for(const options of [{cookie:'session=b'},{actor:'two'}]){const r=await f.runtime.handle('action',req('action',{...options,body:{viewToken:view.viewToken,revision:1,commandId:'11111111-1111-4111-8111-111111111111',action:'move',payload:{}}}));assert.equal(r.status,409);}assert.equal(f.calls.length,0);});
test('revoked membership refuses view and receipt; owner identity cannot be submitted',async()=>{const f=fixture();const view=await(await f.runtime.handle('view',req('view'))).json();const forged=await f.runtime.handle('action',req('action',{body:{ownerId:'other',viewToken:view.viewToken,revision:1,commandId:'11111111-1111-4111-8111-111111111111'}}));assert.equal(forged.status,400);f.revoke();assert.equal((await f.runtime.handle('view',req('view'))).status,401);assert.equal((await f.runtime.handle('receipt',req('receipt',{body:{commandId:'11111111-1111-4111-8111-111111111111'}}))).status,401);});
test('receipt recovery reads original receipt without an engine mutation or old view token',async()=>{const f=fixture();const response=await f.runtime.handle('receipt',req('receipt',{body:{commandId:'11111111-1111-4111-8111-111111111111'}}));assert.equal(response.status,200);assert.equal((await response.json()).receipt.replayed,true);assert.equal(f.calls.length,0);});
test('GM checkpoint flows through the existing intent validator into Unity',async()=>{const f=fixture();const view=await(await f.runtime.handle('view',req('view',{actor:''}))).json();assert(view.actions.some(a=>a.id==='checkpoint'));const response=await f.runtime.handle('action',req('action',{actor:'',body:{viewToken:view.viewToken,revision:1,commandId:'11111111-1111-4111-8111-111111111111',action:'checkpoint',payload:{}}}));assert.equal(response.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'checkpoint');assert.equal(f.calls[0].ownerId,'dm');});
test('Hollow campaign cannot reach the legacy gameplay runtime',async()=>{assert(usesHollowAuthority({RAPHAEL_CAMPAIGN_ID:'operation-hollow-lantern'}));const previous=process.env.RAPHAEL_CAMPAIGN_ID;process.env.RAPHAEL_CAMPAIGN_ID='operation-hollow-lantern';try{const {getGameServices}=await import('../game/runtime.mjs');assert.throws(()=>getGameServices(),/Unity table/);}finally{if(previous===undefined)delete process.env.RAPHAEL_CAMPAIGN_ID;else process.env.RAPHAEL_CAMPAIGN_ID=previous;}});
test('an old map token cannot render a newer revision',async()=>{const f=fixture();const response=await f.runtime.handle('view',req('view'));assert.equal(response.status,200);const view=await response.json();f.advance();const request=new Request(`${origin}/api/hollow-lantern/map?actorId=one&viewToken=${view.viewToken}`,{headers:{Cookie:'session=a'}});assert.equal((await f.runtime.handle('map',request)).status,409);});
test('current non-GM owner cannot request the GM audience',async()=>{const auth={config:{activityOrigin:origin},authenticate:async()=>({campaign:'hollow',owner:'player',role:'player'}),member:async()=>({campaign:'hollow',owner:'player',role:'player'})};const client={campaignId:'hollow',command:async()=>assert.fail('No mutation'),project:async()=>({characters:[]})};const runtime=createActivityRuntime({auth,client,gmUserId:'dm'});assert.equal((await runtime.handle('view',req('view',{actor:''}))).status,403);});

import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
test('illustrations require original scope, reject paths and stale views, and deliver approved PNG only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hollow-art-'));try{
 const file=join(dir,'approved.png');await writeFile(file,createCanvas(3,3).toBuffer('image/png'));
 const f=fixture({sceneArts:{briefing:file},portraits:{one:file}});
 const view=await(await f.runtime.handle('view',req('view'))).json();assert.deepEqual(view.illustrations,{scene:true,portrait:true});
 const image=(extra='',actor='one',cookie='session=a')=>new Request(`${origin}/api/hollow-lantern/illustration?actorId=${actor}&viewToken=${view.viewToken}&kind=scene${extra}`,{headers:{Cookie:cookie}});
 const good=await f.runtime.handle('illustration',image());assert.equal(good.status,200);assert.equal(good.headers.get('content-type'),'image/png');assert.match(good.headers.get('cache-control'),/no-store/);assert((await good.arrayBuffer()).byteLength>0);
 assert.equal((await f.runtime.handle('illustration',image('&path=secret'))).status,400);
 assert.equal((await f.runtime.handle('illustration',image('','two'))).status,409);
 assert.equal((await f.runtime.handle('illustration',image('','one','session=b'))).status,409);
 f.advance();assert.equal((await f.runtime.handle('illustration',image())).status,409);
 f.revoke();assert.equal((await f.runtime.handle('illustration',image())).status,401);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing approved illustration fails without exposing a file path',async()=>{
 const f=fixture({sceneArts:{briefing:join(tmpdir(),'absent-hollow.png')}}),view=await(await f.runtime.handle('view',req('view'))).json();
 const response=await f.runtime.handle('illustration',new Request(`${origin}/api/hollow-lantern/illustration?actorId=one&viewToken=${view.viewToken}&kind=scene`,{headers:{Cookie:'session=a'}}));assert.equal(response.status,404);assert(!JSON.stringify(await response.json()).includes(tmpdir()));
});

test('a changed revision after illustration decode cannot deliver old bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hollow-late-art-'));try{
 const file=join(dir,'scene.png');await writeFile(file,createCanvas(2,2).toBuffer('image/png'));
 const f=fixture({sceneArts:{briefing:file}}),view=await(await f.runtime.handle('view',req('view'))).json();
 const original=f.client.project;let reads=0;f.client.project=async scope=>{if(++reads===5)f.advance();return original(scope);};
 const response=await f.runtime.handle('illustration',new Request(`${origin}/api/hollow-lantern/illustration?actorId=one&viewToken=${view.viewToken}&kind=scene`,{headers:{Cookie:'session=a'}}));assert.equal(response.status,409);assert.match(response.headers.get('content-type'),/json/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

const rejectedId='33333333-3333-4333-8333-333333333333';
const missingReceipt=async()=>{throw Object.assign(Error('No receipt'),{code:'RECEIPT_NOT_FOUND'});};
test('stale-token and invalid form are recoverable only with scoped no-receipt proof',async()=>{
 for(const kind of ['stale','form']){const f=fixture();f.client.receipt=missingReceipt;const view=await(await f.runtime.handle('view',req('view',{actor:''}))).json();
 const response=await f.runtime.handle('action',req('action',{actor:'',body:{viewToken:kind==='stale'?'expired':view.viewToken,revision:1,commandId:rejectedId,action:'enroll:fighter',payload:{}}}));
 assert.equal(response.status,kind==='stale'?409:400);assert.deepEqual((await response.json()).rejection,{contract:'hollow-action-rejection-v1',campaignId:'hollow',commandId:rejectedId,actorId:'',expectedRevision:1,submitted:false});assert.equal(f.calls.length,0);
 }
});
test('receipt outage or existing command never attests a stale-token rejection',async()=>{
 for(const lookup of [async()=>{throw Error('network');},async()=>({success:true,commandId:rejectedId})]){const f=fixture();f.client.receipt=lookup;const response=await f.runtime.handle('action',req('action',{actor:'',body:{viewToken:'expired',revision:1,commandId:rejectedId,action:'checkpoint',payload:{}}}));assert.equal((await response.json()).rejection,undefined);}
});
test('command transport failure and subsequent stale-token request retain uncertain identity',async()=>{
 const f=fixture();f.client.receipt=missingReceipt;let sends=0;f.client.command=async()=>{sends++;throw Error('response lost after possible commit');};const view=await(await f.runtime.handle('view',req('view',{actor:''}))).json();
 const body={viewToken:view.viewToken,revision:1,commandId:rejectedId,action:'checkpoint',payload:{}};
 assert.equal((await(await f.runtime.handle('action',req('action',{actor:'',body}))).json()).rejection,undefined);assert.equal(sends,1);
 assert.equal((await(await f.runtime.handle('action',req('action',{actor:'',body:{...body,viewToken:'expired'}}))).json()).rejection,undefined);assert.equal(sends,1);
});

test('a corrected fresh action works after an attested invalid form rejection',async()=>{
 const f=fixture();f.client.receipt=missingReceipt;const view=await(await f.runtime.handle('view',req('view',{actor:''}))).json();const body={viewToken:view.viewToken,revision:1,commandId:rejectedId,action:'checkpoint',payload:{unexpected:'invalid'}};
 assert((await(await f.runtime.handle('action',req('action',{actor:'',body}))).json()).rejection);
 const corrected=await f.runtime.handle('action',req('action',{actor:'',body:{...body,commandId:'44444444-4444-4444-8444-444444444444',payload:{}}}));assert.equal(corrected.status,200);assert.equal(f.calls.length,1);
});

function mapFixture(){const f=fixture(),original=f.client.project;f.client.project=async scope=>({...await original(scope),map:{id:'briefing',width:25,height:25,level:scope.mapLevel,cells:[{x:12,y:12,terrain:'floor',visibility:'visible'}],tokens:scope.actorId?[{characterId:scope.actorId,displayName:'Actor',x:12,y:12}]:[]}});return f;}
const mapRequest=(token,extra='',actor='one',cookie='session=a')=>new Request(`${origin}/api/hollow-lantern/map?actorId=${actor}&viewToken=${token}${extra}`,{headers:{Cookie:cookie}});
test('Activity nearby is a scoped read-only PNG alternative with full-map round trip',async()=>{
 const f=mapFixture(),view=await(await f.runtime.handle('view',req('view'))).json();assert.equal(view.mapDetailAvailable,true);
 const full=await f.runtime.handle('map',mapRequest(view.viewToken));const fullBytes=Buffer.from(await full.arrayBuffer());assert.equal((await loadImage(fullBytes)).width,880);
 const nearby=await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby'));assert.equal(nearby.status,200);assert.equal((await loadImage(Buffer.from(await nearby.arrayBuffer()))).width,656);assert.match(nearby.headers.get('cache-control'),/no-store/);
 const again=await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=full'));assert.deepEqual(Buffer.from(await again.arrayBuffer()),fullBytes);assert.equal(f.calls.length,0);
 for(const extra of ['&detail=bad','&detail=','&detail=nearby&x=1'])assert.equal((await f.runtime.handle('map',mapRequest(view.viewToken,extra))).status,400);
 assert.equal((await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby','two'))).status,409);
 assert.equal((await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby','one','session=b'))).status,409);
 f.advance();assert.equal((await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby'))).status,409);f.revoke();assert.equal((await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby'))).status,401);
});
test('Nearby availability excludes unselected GM, non-tactical and unseen own token',async()=>{
 for(const scenario of ['gm','regional','unseen']){
  const f=mapFixture(),actor=scenario==='gm'?'':'one',level=scenario==='regional'?'&level=regional':'';
  if(scenario==='unseen'){const original=f.client.project;f.client.project=async scope=>{const p=await original(scope);p.map.cells=[];return p;};}
  const request=new Request(`${origin}/api/hollow-lantern/view?actorId=${actor}${level}`,{headers:{Cookie:'session=a'}});const view=await(await f.runtime.handle('view',request)).json();assert.equal(view.mapDetailAvailable,false);
  const response=await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby'+level,actor));assert.equal(response.status,400);assert.match((await response.json()).error,/visible character/);assert.equal(f.calls.length,0);
 }
});
test('Nearby bytes are withheld if revision or access changes during rendering',async()=>{
 for(const change of ['revision','access']){const f=mapFixture(),view=await(await f.runtime.handle('view',req('view'))).json(),original=f.client.project;let reads=0;
 f.client.project=async scope=>{if(++reads===5){if(change==='revision')f.advance();else f.revoke();}return original(scope);};
 const response=await f.runtime.handle('map',mapRequest(view.viewToken,'&detail=nearby'));assert.equal(response.status,409);assert.match(response.headers.get('content-type'),/json/);assert.equal(f.calls.length,0);
 }
});
