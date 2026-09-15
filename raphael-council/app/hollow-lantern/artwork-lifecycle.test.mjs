import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkIdentity,artworkLoaded,artworkFailed} from './artwork-lifecycle.mjs';

const view={campaignId:'rehearsal',viewer:'player',audience:'player',selectedActor:'mara',sceneId:'briefing',revision:0,viewToken:'first'};
test('token renewal preserves image identity only within the same authorized view', () => {
  const original=artworkIdentity(view,'tactical','portrait');
  assert.equal(artworkIdentity({...view,viewToken:'renewed'},'tactical','portrait'),original);
  for(const [field,value] of Object.entries({campaignId:'other',viewer:'gm',audience:'gm',selectedActor:'kestrel',sceneId:'dungeon',revision:1})) {
    assert.notEqual(artworkIdentity({...view,[field]:value},'tactical','portrait'),original,`${field} must invalidate old pixels`);
  }
  assert.notEqual(artworkIdentity(view,'regional','portrait'),original);
  assert.notEqual(artworkIdentity(view,'tactical','scene'),original);
});

test('identity cannot collide through punctuation in identifiers', () => {
  assert.notEqual(artworkIdentity({...view,campaignId:'a:b',selectedActor:'c'},'tactical','scene'),
    artworkIdentity({...view,campaignId:'a',selectedActor:'b:c'},'tactical','scene'));
});

test('a successful retry restores an image hidden after a failed request', () => {
  const image={hidden:false};
  artworkFailed({currentTarget:image});assert.equal(image.hidden,true);
  artworkLoaded({currentTarget:image});assert.equal(image.hidden,false);
  artworkFailed({currentTarget:image});assert.equal(image.hidden,true);
});
