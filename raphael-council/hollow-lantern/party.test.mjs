import test from 'node:test';
import assert from 'node:assert/strict';
import { createParty, playerEvidence, hasPendingRuling } from './party.mjs';
const actors = [{ actorId: 'fighter', ownerId: 'ai-fighter' }, { actorId: 'rogue', ownerId: 'ai-rogue' }, { actorId: 'cleric', ownerId: 'ai-cleric' }];
function projection(actor, revision = 1) {
  return { projectionVersion: 2, campaignId: 'fixture-party', audience: 'private', characterId: actor.actorId, revision, decisionOpen: true, phase: 'exploration', currentSceneId: 'briefing',
    characters: [{ characterId: actor.actorId, ownerId: actor.ownerId, displayName: actor.actorId, primaryHealth: 20, primaryHealthMaximum: 20, level: 3, classId: actor.actorId, scores: {}, resources: {}, abilities: [], position: { x: 1, y: 1 } }], inventory: { items: [], currency: 2 },
    availableMovement: [{ x: 2, y: 1, costFeet: 5 }], discoveries: [`secret-${actor.actorId}`], pendingActions: [], publicEvents: [], gmNotes: 'NEVER_MODEL_GM_SECRET', map: { width: 25, height: 25, cells: [{ x: 1, y: 1, terrain: 'floor', visibility: 'visible' }], tokens: [] } };
}
function setup({ stopAfterFirst = false, malicious = false } = {}) {
  let revision = 1, open = true; const jobs = [], commits = [], sessions = [], intents = [];
  const client = { campaignId: 'fixture-party', project: async ({ actorId }) => projection(actors.find(a => a.actorId === actorId), revision), command: async c => { commits.push(c); revision++; if (stopAfterFirst) open = false; return { revision }; } };
  const party = createParty({ client, campaignId: client.campaignId, actors, authorizeAI: async s => actors.some(a => a.actorId === s.actorId && a.ownerId === s.userId), getGate: async () => ({ decisionOpen: open, hasPendingRulings: false }), provisionSession: async s => sessions.push(s), onIntent: i => intents.push(i),
    transport: { generate: async job => { jobs.push(job); return { text: JSON.stringify({ actionId: malicious ? 'gm_scene' : job.evidence.availableActions[0].id, fields: {}, reason: 'I choose a visible square.' }), sources: [], trace: [{ destination: 'local' }] }; } } });
  return { party, jobs, commits, sessions, intents };
}
test('player evidence excludes GM records and contains no retrieval question', () => {
  const { evidence } = playerEvidence(projection(actors[0]));
  assert.equal(evidence.question, ''); assert.doesNotMatch(JSON.stringify(evidence), /NEVER_MODEL_GM_SECRET|secret-rogue|secret-cleric/);
});
test('three independent local sessions plan privately and replan after other commits', async () => {
  const s = setup(); s.party.start(); const result = await s.party.onDecisionOpened({ opportunityId: 'one' });
  assert.equal(result.committed.length, 3); assert.equal(s.jobs.length, 5); assert.equal(new Set(s.sessions.map(x => x.session)).size, 3);
  for (const job of s.jobs) {
    assert.equal(job.maxTokens, 2000);
    assert.equal(job.scope.role, 'player'); assert.equal(job.policy.mode, 'local'); assert.equal(job.policy.tools, false); assert.equal(job.policy.auto_memory, false);
    const self = actors.find(a => a.ownerId === job.scope.owner); assert.equal(job.evidence.character.id, self.actorId);
    for (const other of actors.filter(a => a !== self)) assert.doesNotMatch(JSON.stringify(job.evidence), new RegExp(`secret-${other.actorId}`));
  }
  assert.deepEqual(s.commits.map(c => c.expectedRevision), [1, 2, 3]); assert.equal((await s.party.onDecisionOpened({ opportunityId: 'one' })).status, 'already-handled'); s.party.close();
});
test('reasoning allowance remains bounded and refuses oversized requests before model work', async () => {
  const s = setup(); s.party.start();
  await assert.rejects(s.party.onDecisionOpened({maxTokens:2001}), /exceeds its bounds/);
  assert.equal(s.jobs.length, 0); assert.equal(s.commits.length, 0);
  s.party.close();
});
test('DM closing decision gate stops remaining commits without reopening it', async () => {
  const s = setup({ stopAfterFirst: true }); s.party.start(); const result = await s.party.onDecisionOpened();
  assert.equal(result.committed.length, 1); assert.equal(s.commits.some(c => c.type.startsWith('gm_')), false); s.party.close();
});
test('unavailable model actions are refused; start never auto-runs', async () => {
  const s = setup({ malicious: true }); s.party.start(); assert.equal(s.jobs.length, 0);
  const result = await s.party.onDecisionOpened(); assert.equal(result.status, 'stopped'); assert.equal(s.commits.length, 0); s.party.close();
  assert.equal((await s.party.onDecisionOpened()).status, 'closed');
});
test('mechanical reaction allows only its named reactor, while actual rulings pause', async () => {
  assert.equal(hasPendingRuling({ pendingActions: [{ kind: 'reaction' }] }), false);
  assert.equal(hasPendingRuling({ pendingActions: [{ kind: 'tactical-mind' }] }), true);
  const calls = [], jobs = [];
  const client = { campaignId: 'fixture-party', project: async ({ actorId }) => ({ ...projection(actors.find(a => a.actorId === actorId)), phase: 'combat', activeActorId: 'fighter', pendingActions: [{ id: 'r1', kind: 'reaction', reactors: ['rogue'] }] }), command: async c => { calls.push(c); return { revision: 2 }; } };
  const party = createParty({ client, campaignId: client.campaignId, actors, authorizeAI: async () => true, getGate: async () => ({ decisionOpen: true, hasPendingRulings: false }), provisionSession: async () => {}, transport: { generate: async job => { jobs.push(job); return { text: JSON.stringify({ actionId: job.evidence.availableActions[0].id, fields: {}, reason: 'Take my available reaction.' }), sources: [], trace: [{ destination: 'local' }] }; } } });
  party.start(); const result = await party.onDecisionOpened(); assert.equal(result.committed.length, 1); assert.equal(jobs.length, 1); assert.equal(jobs[0].scope.owner, 'ai-rogue'); assert.equal(calls[0].type, 'reaction'); party.close();
});

test('human-owned fighter is skipped, its AI session revoked, and reassignment gets fresh memory',async()=>{
 let revision=1,eligible=actors.map(a=>a.actorId);const jobs=[],revoked=[],commits=[];
 const client={campaignId:'fixture-party',project:async({actorId})=>projection(actors.find(a=>a.actorId===actorId),revision),command:async c=>{commits.push(c.actorId);return {revision:++revision};}};
 const party=createParty({client,campaignId:client.campaignId,actors,authorizeAI:async()=>true,getGate:async()=>({decisionOpen:true,eligibleActorIds:[...eligible]}),provisionSession:async()=>{},revokeSession:async x=>revoked.push(x),transport:{generate:async job=>{jobs.push(job);return {text:JSON.stringify({actionId:job.evidence.availableActions[0].id,fields:{},reason:'Visible choice'}),sources:[],trace:[{destination:'local'}]};}}});
 party.start();await party.onDecisionOpened({opportunityId:'before'});const oldSession=jobs.find(j=>j.scope.owner==='ai-fighter').session;eligible=['rogue','cleric'];await party.syncOwnership();assert.ok(!party.getPrivateIntents().some(i=>i.actorId==='fighter'));assert.equal(revoked[0].session,oldSession);
 const start=commits.length;const result=await party.onDecisionOpened({opportunityId:'human-fighter'});assert.equal(result.status,'complete');assert.deepEqual(commits.slice(start),['rogue','cleric']);assert.equal(revoked.length,1);
 eligible=['fighter','rogue','cleric'];const beforeJobs=jobs.length;await party.onDecisionOpened({opportunityId:'reassigned'});const fresh=jobs.slice(beforeJobs).find(j=>j.scope.owner==='ai-fighter');assert.notEqual(fresh.session,oldSession);assert.doesNotMatch(JSON.stringify(fresh.evidence),/eligibleActorIds|GM_SECRET/);party.close();
});
test('unknown roster failure is not treated as a harmless human-owned seat',async()=>{const s=setup();s.party.start();s.party.close();const party=createParty({client:{campaignId:'fixture-party',project:async()=>{},command:async()=>{}},campaignId:'fixture-party',actors,authorizeAI:async()=>true,getGate:async()=>({decisionOpen:true,eligibleActorIds:['invented']}),provisionSession:async()=>{}});party.start();await assert.rejects(party.onDecisionOpened(),/Invalid authoritative AI roster/);party.close();});


test('private evidence retains own position discoveries and visible objects beyond recent history',()=>{
 const p=projection(actors[0]);p.discoveries=['route:coastal-road','briefing-ledger'];p.privateHistory=Array.from({length:30},(_,i)=>({revision:i+1,text:'Recent private history '+i}));
 p.objects=[{id:'briefing-table',label:'Mission briefing table',kind:'table',x:1,y:1,gmNotes:'OBJECT SECRET',items:[{itemId:'UNEXPOSED INVENTORY'}]},{id:'hidden-object',label:'HIDDEN LABEL',x:20,y:20}];
 p.mission={briefed:true,technicianRescued:false,signalRestored:false,complete:false,convoyOutcome:'undisclosed',canScout:false,routesTravelled:['GM ROUTE'],repairMinute:900,hiddenFuture:'HIDDEN FUTURE'};
 const {evidence}=playerEvidence(p);assert.deepEqual(evidence.character.position,{x:1,y:1});assert.deepEqual(evidence.discoveries,p.discoveries);assert.deepEqual(evidence.map.objects,[{id:'briefing-table',label:'Mission briefing table',kind:'table',position:{x:1,y:1}}]);assert.equal(evidence.mission.briefed,true);
 assert.doesNotMatch(JSON.stringify(evidence),/OBJECT SECRET|UNEXPOSED INVENTORY|hidden-object|HIDDEN LABEL|GM ROUTE|repairMinute|HIDDEN FUTURE/);assert.match(evidence.campaignPremise,/missing convoy/);assert.ok(Buffer.byteLength(JSON.stringify(evidence))<=23000);
});
test('GM/public projections and oversized persistent knowledge fail closed rather than drop discoveries',()=>{
 const p=projection(actors[0]);assert.throws(()=>playerEvidence({...p,audience:'gm'}),{code:'AI_PRIVATE_VIEW_REQUIRED'});assert.throws(()=>playerEvidence({...p,audience:'public'}),{code:'AI_PRIVATE_VIEW_REQUIRED'});p.discoveries=['x'.repeat(24000)];assert.throws(()=>playerEvidence(p),{code:'AI_EVIDENCE_TOO_LARGE'});
});
test('remaining turn resources belong only to the viewing actor and reflect committed action use',()=>{
 const p=projection(actors[0]);p.phase='combat';p.round=2;p.activeActorId='fighter';p.characters[0].resources={action:false,bonusAction:true,reaction:true,movementFeet:20};
 p.characters.push({...projection(actors[1]).characters[0],resources:{spellSlots1:987654}});
 const {evidence}=playerEvidence(p);assert.deepEqual(evidence.character.resources,{action:false,bonusAction:true,reaction:true,movementFeet:20});assert.deepEqual(evidence.turn,{phase:'combat',round:2,yourTurn:true});
 assert.doesNotMatch(JSON.stringify(evidence),/987654/);evidence.character.resources.action=true;assert.equal(p.characters[0].resources.action,false);
});
