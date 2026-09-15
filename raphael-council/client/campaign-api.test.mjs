import test from 'node:test';
import assert from 'node:assert/strict';
import {apiPath} from './api.mjs';

const page={hostname:'localhost',search:'?campaignId=second-table'};

test('campaign selection follows auth, views, media and gameplay requests',()=>{
  for(const path of ['/api/auth/config','/api/auth/start','/api/auth/session','/api/auth/logout','/api/hollow-lantern/view','/api/hollow-lantern/map','/api/hollow-lantern/illustration','/api/hollow-lantern/action','/api/hollow-lantern/receipt']){
    assert.equal(apiPath(path,page),`${path}?campaignId=second-table`);
  }
  assert.equal(apiPath('/api/hollow-lantern/view?actorId=fighter&level=tactical',page),'/api/hollow-lantern/view?actorId=fighter&level=tactical&campaignId=second-table');
});

test('saved command campaign wins over the campaign currently open in the browser',()=>{
  const saved='/api/hollow-lantern/receipt?actorId=fighter&campaignId=original-table';
  assert.equal(apiPath(saved,page),saved);
});

test('Discord proxy forwarding retains the selected campaign',()=>{
  assert.equal(apiPath('/api/auth/session',{...page,hostname:'123456.discordsays.com'}),'/.proxy/api/auth/session?campaignId=second-table');
});

test('invalid or ambiguous campaign selectors fail before a request is sent',()=>{
  for(const search of ['?campaignId=','?campaignId=../private','?campaignId=one&campaignId=two','?campaignId='+ 'a'.repeat(65)]){
    assert.throws(()=>apiPath('/api/hollow-lantern/view',{...page,search}),TypeError);
  }
  for(const path of ['/api/auth/session?campaignId=','/api/hollow-lantern/receipt?campaignId=one&campaignId=two','/api/hollow-lantern/receipt?campaignId=bad%2Fpath']){
    assert.throws(()=>apiPath(path,page),TypeError);
  }
});

test('legacy and unrelated requests retain their existing paths',()=>{
  assert.equal(apiPath('/api/hollow-lantern/view',{hostname:'localhost',search:''}),'/api/hollow-lantern/view');
  assert.equal(apiPath('/api/game/state',page),'/api/game/state');
  assert.equal(apiPath('/api/authentication',page),'/api/authentication');
  assert.equal(apiPath('/api/auth/session',{hostname:'123456.discordsays.com',search:''}),'/.proxy/api/auth/session');
  assert.equal(apiPath('/api/hollow-lantern/view?level=tactical#details',page),'/api/hollow-lantern/view?level=tactical&campaignId=second-table#details');
});
