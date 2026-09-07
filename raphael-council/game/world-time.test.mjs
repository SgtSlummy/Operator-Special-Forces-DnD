import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { GameStore } from './store.mjs';
import { initializeWorldTime, configureWorldTime, worldTimeState, previewWorldTime, advanceWorldTime, recordWorldTimeDecision, validateWorldTimePersistence } from './world-time.mjs';

const host = { campaign: 'world-time-test', owner: 'host' };
const alice = { ...host, owner: 'alice' }, bob = { ...host, owner: 'bob' }, otherHost = { ...host, owner: 'other-host' };
const party = () => ({ audience: 'party', owners: [] });
const secret = () => ({ audience: 'host', owners: [] });
const only = owner => ({ audience: 'owners', owners: [owner] });
const proof = () => ['WORLD_STORY_FRAMEWORK.md:sections-10-12', 'test-only:explicit-reviewed-calendar-anchor'];
const weapon = { name: 'Test staff', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 };
function seed() {
  return { campaign: host.campaign, title: 'Disposable world-time fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'other-host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'test-map', title: 'Test map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [
    { id: 'hero', owner: 'alice', name: 'Test hero', team: 'party', x: 1, y: 1, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 10, characterVersion: 'test-version', weapon },
    { id: 'npc', owner: null, name: 'Test NPC', team: 'opposition', x: 6, y: 6, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 1, characterVersion: 'test-npc-version', weapon },
  ], effects: [] };
}
function createStore(path = ':memory:') {
  const store = new GameStore(path, { rollDie() { throw new Error('World time must not use RNG.'); } });
  initializeWorldTime(store.db);
  if (!store.hasCampaign(host.campaign)) {
    store.createCampaign(seed());
    store.configureMission(host, { reviewed: true, tracks: [], mission: { id: 'opening', title: 'Opening', briefing: 'Three independent requests remain available.', mapId: 'test-map', resolution: 'adjudicated', outcomes: [{ id: 'done', title: 'Done', summary: 'Reviewed fixture outcome.', changes: [] }] } });
  }
  return store;
}
function fact(id, entityId, label, value, visibility = party()) { return { id, entityId, kind: 'condition', label, value, visibility, evidence: proof() }; }
function decision(id, label, effects, visibility = party()) { return { id, label, when: [], effects, summary: label, visibility, evidence: proof(), initiallyConsumed: false }; }
function clock(id, label, value, cause, order, thresholds = []) {
  return { id, label, value, status: 'active', periodTicks: 12, anchorTick: 0, creditTicks: 0, accrualPolicy: 'retain', order, when: [{ factId: cause, equals: true }], thresholds, summary: `${label}: the reviewed continuing cause advances this clock.`, visibility: party(), evidence: proof() };
}
// The named deadlines/outcomes come from the authored framework. Quarter-day
// ticks and the hearing's exact point are explicit TEST host choices, not canon.
function definition() {
  const entities = [
    { id: 'bellweather', label: 'Bellweather', kind: 'location', visibility: party() },
    { id: 'archive', label: 'Archive', kind: 'location', visibility: party() },
    { id: 'crossing', label: 'Ember Crossing', kind: 'location', visibility: party() },
    { id: 'oren', label: 'Oren', kind: 'npc', visibility: party() },
    { id: 'hidden_vault', label: 'PRIVATE VAULT ENTITY', kind: 'location', visibility: secret() },
  ];
  const facts = [
    fact('lamps', 'bellweather', 'Festival lamps supplied', true), fact('candlelight', 'bellweather', 'Festival uses ordinary candlelight', false),
    fact('mentor_office', 'archive', 'Mentor retains office', true), fact('collection_offer', 'archive', 'Ministry administration offer', false), fact('archive_access', 'archive', 'Ministry has Archive access', false),
    fact('relocation', 'crossing', 'Temporary relocation authorized', false), fact('ministry_offer', 'crossing', 'Ministry offer received', false), fact('travel_disruption', 'crossing', 'Travel disruption visible', false),
    fact('amendment_active', 'bellweather', 'PRIVATE recognition cause', true, secret()), fact('damage_active', 'crossing', 'Unrepaired beacon damage', true),
    fact('ministry_cause', 'archive', 'PRIVATE agreements cause', false, secret()), fact('division_cause', 'bellweather', 'PRIVATE grievance cause', false, secret()),
    fact('private_threshold', 'hidden_vault', 'PRIVATE THRESHOLD FACT', false, secret()), fact('alice_observation', 'archive', 'ALICE ONLY OBSERVATION', true, only('alice')),
  ];
  const opportunities = ['accord', 'archive', 'vigil'].map(id => ({ id, title: { accord: 'The Lantern Accord', archive: 'The Quiet Archive', vigil: 'The Ember Vigil' }[id], status: 'open', visibility: party(), evidence: proof() }));
  const deadline = (id, opportunityId, atTick, order, effects, summary) => ({ id, label: `${opportunityId} deadline`, opportunityId, atTick, order, when: [], effects, summary, visibility: party(), evidence: proof(), initialState: 'pending' });
  const threshold = (value, effects, summary, visibility = party()) => ({ value, effects, summary, visibility, evidence: proof(), initiallyConsumed: false });
  return {
    schemaVersion: 1, id: 'greyharbor-test-time', version: 'reviewed-v1',
    calendar: { label: 'Reviewed test calendar', unitLabel: 'reviewed quarter-day', ticksPerDay: 4, originDay: 6, originTick: 0, initialTick: 0, originLabel: 'Explicit test-only Day 6 starting point' }, maxAdvanceTicks: 120,
    adoption: { mode: 'new', reason: 'Host reviews this disposable test definition.', evidence: proof() },
    entities, facts, knowledge: [{ id: 'oren_knowledge', subjectId: 'oren', factId: 'private_threshold', status: 'believed', visibility: secret(), evidence: proof() }], opportunities,
    deadlines: [
      deadline('vigil_day8_morning', 'vigil', 9, 1, [{ type: 'fact', id: 'relocation', value: true }, { type: 'fact', id: 'ministry_offer', value: true }], 'The assembly authorizes temporary relocation and receives a Ministry offer.'),
      deadline('accord_day8_sunset', 'accord', 11, 2, [{ type: 'fact', id: 'lamps', value: false }, { type: 'fact', id: 'candlelight', value: true }], 'The lamps are withheld; the festival uses ordinary candlelight.'),
      deadline('archive_day9_hearing', 'archive', 13, 3, [{ type: 'fact', id: 'mentor_office', value: false }, { type: 'fact', id: 'collection_offer', value: true }], 'The mentor loses office; the Ministry offers to administer the collection. Evidence survives elsewhere.'),
    ],
    clocks: [
      clock('lost_names', 'Lost Names', 1, 'amendment_active', 4, [threshold(3, [{ type: 'fact', id: 'private_threshold', value: true }], 'PRIVATE THRESHOLD DEVELOPMENT', secret())]),
      clock('ministry_mandate', 'Ministry Mandate', 2, 'ministry_cause', 5, [threshold(3, [{ type: 'fact', id: 'archive_access', value: true }], 'The Ministry receives Archive access.')]),
      clock('lantern_fracture', 'Lantern Fracture', 2, 'damage_active', 6, [threshold(3, [{ type: 'fact', id: 'travel_disruption', value: true }], 'Travel disruptions become visible.')]),
      clock('reach_divided', 'Reach Divided', 1, 'division_cause', 7),
    ],
    decisions: [
      decision('settle_accord', 'Record the reviewed accepted settlement', [{ type: 'opportunity', id: 'accord', status: 'resolved' }]),
      decision('pause_names', 'Pause the reviewed recognition process', [{ type: 'clock_status', id: 'lost_names', status: 'paused' }], secret()),
      decision('resume_names', 'Resume the reviewed recognition process', [{ type: 'clock_status', id: 'lost_names', status: 'active' }], secret()),
      decision('reverse_names', 'Record a reviewed reversal', [{ type: 'clock_reverse', id: 'lost_names', steps: 1 }], secret()),
      decision('reveal_fact', 'The party receives the reviewed evidence', [{ type: 'disclose', collection: 'entities', id: 'hidden_vault', visibility: party() }, { type: 'disclose', collection: 'facts', id: 'private_threshold', visibility: party() }]),
    ],
  };
}
function revisions(store, scope = host) { const state = worldTimeState(store, scope); return { expectedGameRevision: state.gameRevision, expectedWorldRevision: state.worldRevision, expectedTimeRevision: state.timeRevision }; }
function configInput(store, content = definition()) { return { requestId: 'configure', ...revisions(store), reviewed: true, definition: content }; }
function configure(store, content) { return configureWorldTime(store, host, configInput(store, content)); }
let request = 0;
function preview(store, targetTick, scope = host) { return previewWorldTime(store, scope, { requestId: `preview-${++request}`, ...revisions(store, scope), reviewed: true, targetTick, reason: 'The host confirms this fictional interval.' }); }
function advanceInput(saved, requestId = `advance-${++request}`) { return { requestId, expectedGameRevision: saved.gameRevision, expectedWorldRevision: saved.worldRevision, expectedTimeRevision: saved.timeRevision, reviewed: true, previewId: saved.previewId }; }
function advance(store, targetTick, scope = host) { return advanceWorldTime(store, scope, advanceInput(preview(store, targetTick, scope))); }
function decide(store, decisionId, requestId = `decision-${++request}`) { return recordWorldTimeDecision(store, host, { requestId, ...revisions(store), reviewed: true, decisionId, reason: 'The host records this established test outcome.' }); }
function getFact(store, factId, scope = host) { return worldTimeState(store, scope).facts.find(fact => fact.id === factId)?.value; }
function mutateGame(store, mutation, kind = 'fixture_change') { store.transaction(() => { const game = store.load(host.campaign); mutation(game); store.record(game, kind, {}); store.save(game); }); }
const tables = ['game_campaigns', 'game_members', 'game_events', 'game_outbox', 'world_campaigns', 'world_events', 'world_time_campaigns', 'world_time_events', 'world_time_occurrences', 'world_time_previews', 'world_time_receipts'];
function snapshot(store, excluded = []) { return JSON.stringify(Object.fromEntries(tables.filter(table => !excluded.includes(table)).map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))); }
function fixture(t, content) { const store = createStore(); t.after(() => store.close()); configure(store, content); return store; }
const throwsCode = (work, code) => assert.throws(work, error => error.code === code);

test('unconfigured query identifies current caller and makes no database or fictional changes', t => {
  const store = createStore(); t.after(() => store.close()); const before = snapshot(store);
  const view = worldTimeState(store, host);
  assert.equal(view.configured, false); assert.equal(view.owner, 'host'); assert.equal(view.campaign, host.campaign); assert.equal(view.phase, 'exploration'); assert.equal(view.canAdvance, false);
  assert.equal(snapshot(store), before);
});

test('configuration rejects missing timing, ordering, invalid grants and unsupported effects atomically', t => {
  for (const corrupt of [
    value => { delete value.calendar.originLabel; },
    value => { value.deadlines[0].atTick = 0; },
    value => { value.clocks[0].periodTicks = 1; },
    value => { delete value.clocks[0].anchorTick; },
    value => { value.clocks[0].order = value.deadlines[0].order; },
    value => { value.facts[0].visibility = only('outsider'); },
    value => { value.deadlines[0].effects = [{ type: 'fact', id: 'invented', value: true }]; },
    value => { value.clocks[0].thresholds[0].effects = [{ type: 'clock_adjust', id: 'lost_names', delta: 3 }]; },
  ]) {
    const store = createStore(); t.after(() => store.close()); const value = definition(); corrupt(value); const before = snapshot(store);
    throwsCode(() => configure(store, value), 'INVALID'); assert.equal(snapshot(store), before);
  }
});

test('configuration is immutable, exact replay survives phase changes, and new configuration does not overwrite it', t => {
  const store = createStore(); t.after(() => store.close()); const input = configInput(store), receipt = configureWorldTime(store, host, input);
  mutateGame(store, game => { game.phase = 'paused'; game.resumePhase = 'exploration'; }, 'pause');
  assert.deepEqual(configureWorldTime(store, host, input), receipt);
  const changed = structuredClone(input); changed.definition.calendar.originLabel = 'Another anchor';
  throwsCode(() => configureWorldTime(store, host, changed), 'CONFLICT');
});

test('preview saves only its review record, consumes no RNG, and identical replay is immutable', t => {
  const store = fixture(t), before = snapshot(store, ['world_time_previews']);
  const input = { requestId: 'saved-preview', ...revisions(store), reviewed: true, targetTick: 13, reason: 'A deliberate test interval.' };
  const review = previewWorldTime(store, host, input);
  assert.equal(review.fromTick, 0); assert.equal(review.targetTick, 13); assert.equal(review.calendar.day, 9);
  assert.equal(snapshot(store, ['world_time_previews']), before);
  assert.deepEqual(previewWorldTime(store, host, input), review);
  throwsCode(() => previewWorldTime(store, host, { ...input, targetTick: 14 }), 'CONFLICT');
});

test('Day 6 to Day 9 processes three independent deadlines in authored order and persists facts rather than assumed agreements', t => {
  const store = fixture(t), receipt = advance(store, 13), view = worldTimeState(store, alice);
  assert.equal(receipt.fromTick, 0); assert.equal(receipt.targetTick, 13); assert.equal(view.calendar.day, 9); assert.equal(view.calendar.tickWithinDay, 1);
  assert.deepEqual(receipt.events.filter(event => event.kind === 'deadline_applied').map(event => [event.ruleId, event.tick]), [['vigil_day8_morning', 9], ['accord_day8_sunset', 11], ['archive_day9_hearing', 13]]);
  assert.equal(getFact(store, 'relocation'), true); assert.equal(getFact(store, 'ministry_offer'), true);
  assert.equal(getFact(store, 'lamps'), false); assert.equal(getFact(store, 'candlelight'), true);
  assert.equal(getFact(store, 'mentor_office'), false); assert.equal(getFact(store, 'collection_offer'), true); assert.equal(getFact(store, 'archive_access'), false);
  assert.deepEqual(view.clocks.map(clock => [clock.id, clock.value]), [['lost_names', 2], ['ministry_mandate', 2], ['lantern_fracture', 3], ['reach_divided', 1]]);
  assert.ok(view.opportunities.every(value => value.status === 'open'));
  assert.equal(store.world(host).tracks.length, 0);
});

test('deadlines do not fire early and a reviewed settlement resolves only its own opportunity without consuming fictional time', t => {
  const store = fixture(t); decide(store, 'settle_accord'); assert.equal(worldTimeState(store, host).calendar.tick, 0);
  advance(store, 8); assert.equal(getFact(store, 'relocation'), false); assert.equal(getFact(store, 'lamps'), true);
  advance(store, 9); assert.equal(getFact(store, 'relocation'), true); assert.equal(getFact(store, 'lamps'), true);
  advance(store, 13); assert.equal(getFact(store, 'lamps'), true); assert.equal(getFact(store, 'mentor_office'), false);
  const view = worldTimeState(store, alice); assert.equal(view.deadlines.find(value => value.opportunityId === 'accord').status, 'skipped');
  assert.ok(!view.events.some(value => value.kind === 'deadline_skipped'));
});

test('a long interval and several shorter intervals yield the same visible facts, clocks and causal event IDs', t => {
  const first = fixture(t), second = fixture(t); advance(first, 24);
  for (const tick of [3, 8, 9, 11, 12, 13, 17, 24]) advance(second, tick);
  const a = worldTimeState(first, alice), b = worldTimeState(second, alice);
  for (const key of ['calendar', 'facts', 'clocks', 'opportunities', 'deadlines', 'events']) assert.deepEqual(a[key], b[key], key);
});

for (const policy of ['retain', 'reset']) test(`clock ${policy} policy applies across a real pause without offline or hidden extra accrual`, t => {
  const content = definition(); content.clocks[0].accrualPolicy = policy;
  const store = fixture(t, content); advance(store, 6); decide(store, 'pause_names'); advance(store, 12); decide(store, 'resume_names'); advance(store, 18);
  assert.equal(worldTimeState(store, host).clocks[0].value, policy === 'retain' ? 2 : 1);
  if (policy === 'reset') { advance(store, 24); assert.equal(worldTimeState(store, host).clocks[0].value, 2); }
});

test('a cause that stops inside an interval prevents later accrual, and explicit same-tick order decides the supported sequence', t => {
  for (const early of [true, false]) {
    const content = definition(); content.deadlines = [content.deadlines[0]];
    content.deadlines[0].atTick = 12; content.deadlines[0].order = early ? 1 : 8;
    content.deadlines[0].effects = [{ type: 'fact', id: 'amendment_active', value: false }];
    const store = fixture(t, content); advance(store, 24);
    assert.equal(worldTimeState(store, host).clocks[0].value, early ? 1 : 2);
  }
});

test('clock thresholds are consumed once even after a reviewed reversal and a later recrossing', t => {
  const store = fixture(t); advance(store, 24); assert.equal(getFact(store, 'private_threshold'), true);
  decide(store, 'reverse_names'); advance(store, 36);
  const rows = worldTimeState(store, host).events.filter(event => event.thresholdOccurrence === 'threshold:lost_names:3');
  assert.equal(rows.length, 1);
  const occurrence = store.db.prepare('SELECT event_id FROM world_time_occurrences WHERE campaign=? AND occurrence=?').get(host.campaign, 'threshold:lost_names:3');
  assert.equal(occurrence.event_id, rows[0].id);
});

test('unknown causal facts and oversized or backwards advances fail without partially consuming a deadline', t => {
  const content = definition(); content.facts.find(value => value.id === 'amendment_active').value = null;
  const store = fixture(t, content), before = snapshot(store);
  throwsCode(() => preview(store, 13), 'REVIEW'); assert.equal(snapshot(store), before);
  for (const tick of [0, -1, 121, 10_000_001, 1.5]) { throwsCode(() => preview(store, tick), 'INVALID'); assert.equal(snapshot(store), before); }
});

test('saved preview becomes stale after another game or world change', t => {
  const store = fixture(t), review = preview(store, 13);
  mutateGame(store, () => {});
  throwsCode(() => advanceWorldTime(store, host, advanceInput(review)), 'STALE');
  assert.equal(worldTimeState(store, host).calendar.tick, 0);
  const second = preview(store, 13);
  store.transaction(() => { const world = store.world(host); delete world.configured; delete world.events; world.revision++; store.db.prepare('UPDATE world_campaigns SET revision=?,body=? WHERE campaign=?').run(world.revision, JSON.stringify(world), host.campaign); });
  throwsCode(() => advanceWorldTime(store, host, advanceInput(second)), 'STALE');
});

test('another host cannot confirm a private preview and concurrent valid previews commit only once', t => {
  const store = fixture(t), first = preview(store, 13), second = preview(store, 13, otherHost);
  throwsCode(() => advanceWorldTime(store, otherHost, advanceInput(first)), 'UNAUTHORIZED');
  advanceWorldTime(store, host, advanceInput(first));
  throwsCode(() => advanceWorldTime(store, otherHost, advanceInput(second)), 'STALE');
  assert.equal(worldTimeState(store, host).events.filter(value => value.kind === 'deadline_applied').length, 3);
});

test('whole interval rolls back if publication fails and the same preview can then commit successfully', t => {
  const store = fixture(t), review = preview(store, 13), input = advanceInput(review), before = snapshot(store), original = store.record;
  store.record = function (...args) { original.apply(this, args); throw new Error('Injected publication failure'); };
  assert.throws(() => advanceWorldTime(store, host, input), /Injected publication failure/); assert.equal(snapshot(store), before);
  store.record = original;
  assert.equal(advanceWorldTime(store, host, input).calendar.tick, 13);
});

test('identical committed request replays before new phase checks; a changed request cannot recommit an occurrence', t => {
  const store = fixture(t), review = preview(store, 13), input = advanceInput(review, 'committed'), receipt = advanceWorldTime(store, host, input);
  mutateGame(store, game => { game.phase = 'paused'; game.resumePhase = 'exploration'; }, 'pause');
  const before = snapshot(store); assert.deepEqual(advanceWorldTime(store, host, input), receipt); assert.equal(snapshot(store), before);
  throwsCode(() => advanceWorldTime(store, host, { ...input, previewId: 'different' }), 'CONFLICT');
  mutateGame(store, game => { game.phase = 'exploration'; delete game.resumePhase; }, 'resume');
  throwsCode(() => advanceWorldTime(store, host, { ...advanceInput(review, 'other-request'), ...revisions(store) }), 'CONFLICT');
  advance(store, 24);
  assert.equal(worldTimeState(store, host).events.filter(value => value.kind === 'deadline_applied').length, 3);
});

test('current host authority is required even to replay configuration, preview, advance or decision', t => {
  const store = createStore(); t.after(() => store.close()); const configuration = configInput(store); configureWorldTime(store, host, configuration);
  const previewInput = { requestId: 'private-preview', ...revisions(store), reviewed: true, targetTick: 6, reason: 'Private interval reason.' }, review = previewWorldTime(store, host, previewInput);
  const advanceRequest = advanceInput(review); advanceWorldTime(store, host, advanceRequest);
  const decisionInput = { requestId: 'private-decision', ...revisions(store), reviewed: true, decisionId: 'settle_accord', reason: 'Private settlement evidence.' }; recordWorldTimeDecision(store, host, decisionInput);
  store.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner=?").run(host.campaign, host.owner);
  const before = snapshot(store);
  for (const work of [() => configureWorldTime(store, host, configuration), () => previewWorldTime(store, host, previewInput), () => advanceWorldTime(store, host, advanceRequest), () => recordWorldTimeDecision(store, host, decisionInput)]) throwsCode(work, 'UNAUTHORIZED');
  assert.equal(snapshot(store), before);
  const view = worldTimeState(store, host); assert.equal(view.role, 'player'); assert.equal(view.canAdvance, false); assert.equal(Object.hasOwn(view, 'definition'), false); assert.equal(Object.hasOwn(view, 'receipts'), false);
});

test('player and revoked membership cannot inspect private plans or mutate world time', t => {
  const store = fixture(t), before = snapshot(store);
  throwsCode(() => preview(store, 13, alice), 'UNAUTHORIZED');
  throwsCode(() => recordWorldTimeDecision(store, alice, { requestId: 'attack-config', ...revisions(store, alice), reviewed: true, decisionId: 'reveal_fact', reason: 'I want to see it.' }), 'UNAUTHORIZED');
  assert.equal(snapshot(store), before);
  store.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, alice.owner);
  throwsCode(() => worldTimeState(store, alice), 'UNAUTHORIZED');
  throwsCode(() => worldTimeState(store, { campaign: 'other-campaign', owner: host.owner }), 'UNAUTHORIZED');
});

test('public projections omit secret entities, private source IDs, rule details and another player observation', t => {
  const store = fixture(t); advance(store, 24);
  const a = worldTimeState(store, alice), b = worldTimeState(store, bob), h = worldTimeState(store, host);
  assert.equal(getFact(store, 'alice_observation', alice), true); assert.equal(getFact(store, 'alice_observation', bob), undefined);
  for (const view of [a, b]) {
    const body = JSON.stringify(view);
    for (const token of ['PRIVATE VAULT', 'private_threshold', 'amendment_active', 'PRIVATE THRESHOLD DEVELOPMENT', 'definitionHash', 'reviewReason', 'occurrence', 'oren_knowledge']) assert.equal(body.includes(token), false, token);
    assert.equal(Object.hasOwn(view, 'definition'), false); assert.equal(Object.hasOwn(view, 'runtime'), false); assert.equal(Object.hasOwn(view, 'decisionOptions'), false);
    assert.ok(view.events.every(value => Object.keys(value).sort().join(',') === 'id,kind,summary,tick'));
  }
  assert.ok(h.events.some(value => value.summary === 'PRIVATE THRESHOLD DEVELOPMENT'));
  assert.ok(!a.clocks.find(value => value.id === 'lost_names').sourceEventId);
  const rawWorld = JSON.stringify(store.world(host));
  for (const token of ['private_threshold', 'PRIVATE', 'reviewReason', 'greyharbor-test-time', 'effects']) assert.equal(rawWorld.includes(token), false, token);
});

test('disclosure exposes the reviewed fact without granting NPC knowledge or rewriting historical events', t => {
  const store = fixture(t); advance(store, 24); const oldHostEvents = structuredClone(worldTimeState(store, host).events);
  decide(store, 'reveal_fact');
  const view = worldTimeState(store, bob);
  assert.equal(getFact(store, 'private_threshold', bob), true); assert.equal(view.knowledge.length, 0);
  assert.ok(!view.events.some(value => value.summary === 'PRIVATE THRESHOLD DEVELOPMENT'));
  assert.deepEqual(worldTimeState(store, host).events.slice(0, oldHostEvents.length), oldHostEvents);
});

test('host decision options show the same labeled effects that are committed, and queries never consume decisions', t => {
  const store = fixture(t), before = snapshot(store), option = worldTimeState(store, host).decisionOptions.find(value => value.id === 'settle_accord');
  assert.equal(option.available, true); assert.equal(option.consequences[0].label, 'The Lantern Accord'); assert.equal(option.consequences[0].before, 'open'); assert.equal(option.consequences[0].after, 'resolved');
  assert.equal(snapshot(store), before);
  const receipt = decide(store, 'settle_accord'); assert.deepEqual(receipt.events[0].changes, option.consequences);
  assert.equal(worldTimeState(store, host).decisionOptions.find(value => value.id === 'settle_accord').available, false);
  throwsCode(() => decide(store, 'settle_accord'), 'CONFLICT');
});

for (const blocked of ['paused', 'combat', 'reaction', 'concentration', 'continuation']) test(`new time mutations wait for ${blocked}, while read-only state remains available`, t => {
  const store = fixture(t), review = preview(store, 13);
  mutateGame(store, game => {
    if (blocked === 'paused' || blocked === 'combat') game.phase = blocked;
    else if (blocked === 'reaction') game.pendingReaction = { id: 'test-pending' };
    else if (blocked === 'concentration') game.pendingConcentration = { id: 'test-pending' };
    else game.continuations = [{ kind: 'test-pending' }];
  });
  const code = blocked === 'paused' ? 'PAUSED' : blocked === 'combat' ? 'PHASE' : 'PENDING', before = snapshot(store);
  throwsCode(() => preview(store, 13), code);
  throwsCode(() => advanceWorldTime(store, host, { ...advanceInput(review), ...revisions(store) }), code);
  throwsCode(() => decide(store, 'settle_accord'), code);
  assert.equal(worldTimeState(store, host).canAdvance, false); assert.equal(worldTimeState(store, alice).calendar.tick, 0); assert.equal(snapshot(store), before);
});

test('a current unresolved approved check blocks advancement; a revoked requesting host does not leave a phantom block', t => {
  const store = fixture(t), game = store.load(host.campaign);
  const check = { id: 'pending-check', owner: alice.owner, actorId: 'hero', characterVersion: 'test-version', expectedRevision: game.revision };
  store.db.prepare('INSERT INTO game_checks VALUES(?,?,?,?,?,NULL)').run(host.campaign, check.id, otherHost.owner, 'fixture-fingerprint', JSON.stringify(check));
  throwsCode(() => preview(store, 13), 'PENDING'); assert.equal(worldTimeState(store, host).canAdvance, false);
  store.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner=?").run(host.campaign, otherHost.owner);
  assert.equal(preview(store, 13).targetTick, 13);
});

test('legacy adoption preserves explicit old deadline dispositions and creates no invented catch-up', t => {
  const content = definition(); content.adoption.mode = 'legacy'; content.calendar.initialTick = 13;
  for (const deadline of content.deadlines) deadline.initialState = 'skipped';
  for (const clock of content.clocks) clock.anchorTick = 13;
  const store = fixture(t, content), view = worldTimeState(store, host);
  assert.equal(view.calendar.tick, 13); assert.equal(view.events.length, 1); assert.equal(getFact(store, 'lamps'), true); assert.equal(getFact(store, 'mentor_office'), true);
  const oldGame = store.load(host.campaign); advance(store, 24);
  assert.equal(worldTimeState(store, host).events.filter(value => value.kind === 'deadline_applied').length, 0);
  assert.deepEqual(store.load(host.campaign).actors, oldGame.actors); assert.equal(store.world(host).mission.id, 'opening');
});

test('restart retains immutable receipts, occurrence keys and fractional clock accrual without rerolling', t => {
  const root = mkdtempSync(join(tmpdir(), 'world-time-core-')), path = join(root, 'fixture.sqlite');
  let store = createStore(path);
  t.after(() => { store.close(); assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(root.includes('world-time-core-')); rmSync(root, { recursive: true, force: true }); });
  configure(store); const review = preview(store, 13), input = advanceInput(review), receipt = advanceWorldTime(store, host, input);
  const before = worldTimeState(store, alice); store.close(); store = createStore(path);
  assert.deepEqual(worldTimeState(store, alice), before); assert.deepEqual(advanceWorldTime(store, host, input), receipt);
  advance(store, 24); assert.equal(worldTimeState(store, host).clocks[0].value, 3);
  assert.equal(worldTimeState(store, host).events.filter(value => value.kind === 'deadline_applied').length, 3);
  assert.equal(validateWorldTimePersistence(store.db).receipts, 3);
});

test('semantic persistence validation is read-only and reconstructs mixed history with stale reviews and revoked historical grants', t => {
  const store = fixture(t);
  preview(store, 4, otherHost);
  advance(store, 6); decide(store, 'pause_names'); advance(store, 12); decide(store, 'resume_names'); advance(store, 24); decide(store, 'reverse_names'); advance(store, 36);
  store.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, alice.owner);
  store.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner=?").run(host.campaign, otherHost.owner);
  const before = snapshot(store), checked = validateWorldTimePersistence(store.db);
  assert.equal(checked.campaigns, 1); assert.equal(checked.receipts, 8); assert.equal(checked.previews, 5); assert.ok(checked.events > checked.receipts);
  assert.equal(snapshot(store), before);
});
