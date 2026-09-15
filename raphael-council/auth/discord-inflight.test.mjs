import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DiscordAuth} from './discord.mjs';

const owner='100000000000000001',other='100000000000000004',guild='100000000000000002';
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  let release,calls=0,failure=0;const gate=new Promise(resolve=>{release=resolve;});
  const auth=new DiscordAuth({db,config:{guild,campaign:'probe',token:'fixture',playerIds:[owner,other],dmIds:[]},game:{readMember:()=> 'player'},fetchImpl:async url=>{
    calls++;await gate;
    if(failure)return new Response('',{status:failure});
    if(url.includes('/members/'))return Response.json({roles:[]});
    if(url.endsWith('/roles'))return Response.json([]);
    return Response.json({owner_id:'different'});
  }});
  return {auth,release:()=>release(),calls:()=>calls,fail:status=>{failure=status;}};
}

test('overlapping same-owner checks share pending work but clone results and never cache settlement',async t=>{
  const f=fixture(t),pending=[f.auth.member(owner),f.auth.member(owner),f.auth.member(owner)];
  assert.equal(f.calls(),1);f.release();const results=await Promise.all(pending);
  assert.equal(f.calls(),3);assert.notEqual(results[0],results[1]);results[0].role='altered';assert.equal(results[1].role,'player');
  await f.auth.member(owner);assert.equal(f.calls(),6);
  f.fail(404);await assert.rejects(f.auth.member(owner),e=>e.status===401&&e.code==='campaign_ineligible');assert.equal(f.calls(),7);
});

test('different owners do not share authorization work',async t=>{
  const f=fixture(t),first=f.auth.member(owner),second=f.auth.member(other);assert.equal(f.calls(),2);f.release();
  const results=await Promise.all([first,second]);assert.equal(f.calls(),6);assert.deepEqual(results.map(x=>x.owner),[owner,other]);
});

test('failure clears pending work and each caller receives its own error',async t=>{
  const f=fixture(t);f.fail(429);const settled=Promise.allSettled([f.auth.member(owner),f.auth.member(owner)]);f.release();
  const [a,b]=await settled;assert.equal(f.calls(),1);assert.equal(a.reason.status,503);assert.notEqual(a.reason,b.reason);
  f.fail(0);assert.equal((await f.auth.member(owner)).role,'player');assert.equal(f.calls(),4);
});

test('replaced configuration does not join the previous pending check',async t=>{
  const f=fixture(t),first=f.auth.member(owner);f.auth.config={...f.auth.config};const second=f.auth.member(owner);
  assert.equal(f.calls(),2);f.release();await Promise.all([first,second]);assert.equal(f.calls(),6);
});

test('configuration mutations start fresh work and preserve each check snapshot',async t=>{
  const f=fixture(t),first=f.auth.member(owner);f.auth.config.campaign='new';const second=f.auth.member(owner);
  assert.equal(f.calls(),2);f.release();const results=await Promise.all([first,second]);assert.deepEqual(results.map(x=>x.campaign),['probe','new']);
});
