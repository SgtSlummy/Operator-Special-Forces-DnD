import test from 'node:test';import assert from 'node:assert/strict';
import {fixtureAuthorize} from './fixture-web.mjs';
test('disposable fixture seats are exact and cannot gain GM or peer scope',()=>{
 for(const role of ['fighter','rogue','cleric']){
 const scope={campaignId:'fixture-hollow-ui',userId:`ai-${role}`,actorId:`lantern-${role}`,audience:'player'};
 assert.equal(fixtureAuthorize(scope),true);assert.equal(fixtureAuthorize({...scope,audience:'gm'}),false);assert.equal(fixtureAuthorize({...scope,campaignId:'operation-hollow-lantern'}),false);assert.equal(fixtureAuthorize({...scope,actorId:'lantern-sentinel'}),false);
 }
 assert.equal(fixtureAuthorize({campaignId:'fixture-hollow-ui',userId:'unregistered',audience:'player'}),false);
});
