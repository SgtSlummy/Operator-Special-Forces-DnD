import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createWorldTimeHandler, WORLD_TIME_ENTRY } from './world-time-adapter.mjs';
import { createWorldHandler } from './world-adapter.mjs';

const host = '111111111111111111', player = '222222222222222222', other = '333333333333333333';
const campaign = 'discord_world_time', scope = owner => ({ campaign, owner });
const config = { campaignId: campaign, guildId: '444444444444444444', channelId: '555555555555555555', playerIds: [host, player, other], playerRoleId: null };
const visibility = { audience: 'party', owners: [] }, hidden = { audience: 'host', owners: [] };
const weapon = { name: 'Fixture blade', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y: 2, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative, characterVersion: 'fixture-v1', weapon });
const common = view => ({ expectedGameRevision: view.gameRevision, expectedWorldRevision: view.worldRevision, expectedTimeRevision: view.timeRevision, reviewed: true });
function definition(long = false) {
  return {
    schemaVersion: 1, id: 'time-test', version: 'v1',
    calendar: { label: 'Reviewed test calendar', unitLabel: 'reviewed quarter-day', ticksPerDay: 4, originDay: 6, originTick: 0, initialTick: 0, originLabel: 'Host-selected test anchor' },
    maxAdvanceTicks: 120, adoption: { mode: 'new', reason: 'HOST_ONLY_ADOPTION', evidence: ['test:review'] },
    entities: [{ id: 'village', label: 'Village', kind: 'location', visibility }, { id: 'vault', label: 'HOST_ONLY_VAULT', kind: 'location', visibility: hidden }],
    facts: [
      { id: 'lamps', entityId: 'village', kind: 'condition', label: 'Festival lamps', value: true, visibility, evidence: ['test:review'] },
      { id: 'secret', entityId: 'vault', kind: 'condition', label: 'HOST_ONLY_FACT', value: 'HOST_ONLY_VALUE', visibility: hidden, evidence: ['test:secret'] },
      ...(long ? Array.from({ length: 25 }, (_, i) => ({ id: `detail_${i}`, entityId: 'village', kind: 'condition', label: `Disclosed detail ${i}`, value: `MARKER_${i} ${'reviewed words '.repeat(24)}`, visibility, evidence: ['test:long'] })) : []),
    ],
    knowledge: [{ id: 'village_knows', subjectId: 'village', factId: 'lamps', status: 'known', visibility, evidence: ['test:knowledge'] }],
    opportunities: [{ id: 'accord', title: 'Village accord', status: 'open', visibility, evidence: ['test:review'] }],
    deadlines: [{ id: 'lamps_due', label: 'Lamp deadline', opportunityId: 'accord', atTick: 11, order: 1, when: [], effects: [{ type: 'fact', id: 'lamps', value: false }], summary: 'The lamps are withheld.', visibility, evidence: ['test:review'], initialState: 'pending' }],
    clocks: [{ id: 'lost_names', label: 'Lost Names', value: 1, status: 'active', periodTicks: 12, anchorTick: 0, creditTicks: 0, accrualPolicy: 'retain', order: 2, when: [{ factId: 'lamps', equals: true }], thresholds: [], summary: 'The reviewed clock advances.', visibility, evidence: ['test:clock'] }],
    decisions: [{ id: 'settle', label: 'Reviewed settlement', when: [], effects: [{ type: 'opportunity', id: 'accord', status: 'resolved' }], summary: 'The settlement is recorded.', visibility, evidence: ['test:review'], initiallyConsumed: false }],
  };
}
function setup(t, { configured = true, long = false, mission = true } = {}) {
  const game = new GameStore(':memory:', { rollDie() { assert.fail('World-time controls must not roll dice'); } });
  t.after(() => game.close());
  const seed = { campaign, title: 'Fictional Discord world time', members: [{ owner: host, role: 'host' }, { owner: player, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Fixture map', width: 10, height: 10, blocked: [], difficult: [] }, actors: [actor('hero', player, 2, 30), actor('ally', other, 5, 20), actor('guard', null, 8, 10)], effects: [] };
  game.createCampaign(seed);
  if (mission) game.configureMission(scope(host), { reviewed: true, tracks: [], mission: { id: 'opening', title: 'Opening', briefing: 'Fixture briefing', mapId: seed.map.id, resolution: 'adjudicated', outcomes: [{ id: 'done', title: 'Done', summary: 'Fixture done', changes: [] }] } });
  if (configured) game.configureWorldTime(scope(host), { ...common(game.worldTime(scope(host))), requestId: 'time_config', definition: definition(long) });
  const responses = [], edits = [], logs = [], calls = [];
  for (const method of ['previewWorldTime', 'advanceWorldTime', 'recordWorldTimeDecision']) {
    const original = game[method].bind(game);
    game[method] = (scope, input) => {
      const result = original(scope, input);
      calls.push({ method, input: structuredClone(input), result: structuredClone(result) });
      return result;
    };
  }
  let serial = 0, failEdit = false;
  const transport = {
    async respond(id, token, payload) { responses.push({ id, token, ...payload }); },
    async edit(applicationId, token, data) { if (failEdit) { failEdit = false; throw new Error('Private transport failure'); } edits.push({ applicationId, token, ...data }); },
  };
  const handler = createWorldTimeHandler({ game, config, transport, log: entry => logs.push(entry) });
  const missionHandler = createWorldHandler({ game, config, transport, log: entry => logs.push(entry) });
  return {
    game, calls, logs, responses, edits,
    loseNextEdit() { failEdit = true; },
    async dispatch(customId, { owner = host, type = 3, components, guild = config.guildId, channel = config.channelId, route = 'time' } = {}) {
      const beforeEdits = edits.length, beforeResponses = responses.length;
      const handled = await (route === 'mission' ? missionHandler : handler)({ id: String(++serial), application_id: '666666666666666666', token: `fixture-${serial}`, type, guild_id: guild, channel_id: channel, member: { user: { id: owner, bot: false }, roles: [] }, data: { custom_id: customId, ...(components ? { components } : {}) } });
      return { handled, responses: responses.slice(beforeResponses), edits: edits.slice(beforeEdits), data: edits.at(-1) && edits.length > beforeEdits ? edits.at(-1) : responses.at(-1)?.data };
    },
  };
}
const buttons = data => data.components.filter(component => component.type === 1).flatMap(row => row.components);
function find(data, label) { const result = buttons(data).find(button => button.label === label); assert.ok(result, `Missing button ${label}`); return result; }
const body = data => data.components.filter(component => component.type === 10).map(component => component.content).join('\n');
const fields = values => Object.entries(values).map(([custom_id, value]) => ({ type: 18, label: custom_id, component: { type: 4, custom_id, value } }));
function privateDelivery(result) {
  assert.equal(result.responses[0].type, 5);
  assert.equal(result.responses[0].data.flags, 64);
  assert.equal(result.data.flags, 32768);
  assert.deepEqual(result.data.allowed_mentions, { parse: [] });
  assert.ok(result.data.components[0].content.length <= 3000);
}
async function form(context, label, { owner = host } = {}) {
  const home = await context.dispatch(WORLD_TIME_ENTRY.custom_id, { owner });
  const modal = await context.dispatch(find(home.data, label).custom_id, { owner });
  assert.equal(modal.responses[0].type, 9, 'modal is the first acknowledgement');
  assert.equal(modal.responses.length, 1);
  return modal.responses[0].data;
}
async function advancePreview(context, increment = '11', reason = 'Private host time reason') {
  const modal = await form(context, 'Review time advance');
  return context.dispatch(modal.custom_id, { type: 5, components: fields({ increment, reason }) });
}
async function allPages(context, first, owner = player) {
  let result = first, collected = '', count = 0;
  for (;;) {
    privateDelivery(result);
    collected += `${body(result.data)}\n`;
    const next = find(result.data, 'Next page');
    if (next.disabled) return { text: collected, count: count + 1 };
    assert.ok(++count < 100, 'pagination must end');
    result = await context.dispatch(next.custom_id, { owner });
  }
}

test('player world-time pages retain all disclosed records without controls or hidden host data', async t => {
  const context = setup(t, { long: true });
  const before = context.game.worldTime(scope(player));
  const first = await context.dispatch(WORLD_TIME_ENTRY.custom_id, { owner: player });
  assert.equal(first.handled, true);
  assert.ok(!buttons(first.data).some(button => /advance|decision/i.test(button.label)));
  const read = await allPages(context, first);
  assert.ok(read.count > 4);
  for (let i = 0; i < 25; i++) assert.ok(read.text.includes(`MARKER\\_${i}`), `Disclosed row ${i}`);
  for (const text of ['Reviewed test calendar', 'Festival lamps', 'Village accord', 'Lamp deadline', 'Lost Names', 'Disclosed knowledge', 'Recorded timeline']) assert.ok(read.text.includes(text), text);
  assert.doesNotMatch(read.text, /HOST_ONLY|Private host|definitionHash|adoption/);
  assert.deepEqual(context.game.worldTime(scope(player)), before);
  assert.deepEqual(context.calls, []);
});

test('unconfigured calendars have no invented time or mutation controls', async t => {
  const context = setup(t, { configured: false });
  const result = await context.dispatch(WORLD_TIME_ENTRY.custom_id);
  privateDelivery(result);
  assert.match(body(result.data), /no installed reviewed calendar/);
  assert.ok(!buttons(result.data).some(button => /advance|decision/i.test(button.label)));
  assert.deepEqual(context.calls, []);
});

test('host reviews exact time units and consequences then confirms and replays the pinned preview', async t => {
  const context = setup(t), before = context.game.worldTime(scope(host));
  const preview = await advancePreview(context);
  privateDelivery(preview);
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].method, 'previewWorldTime');
  assert.equal(context.calls[0].input.targetTick, 11);
  assert.equal(context.game.worldTime(scope(host)).calendar.tick, before.calendar.tick);
  const previewPages = await allPages(context, preview, host);
  assert.match(previewPages.text, /The lamps are withheld/);
  assert.match(previewPages.text, /Private host time reason/);
  const confirmation = find(preview.data, 'Confirm this time advance').custom_id;
  const saved = await context.dispatch(confirmation);
  privateDelivery(saved);
  assert.match(body(saved.data), /World change saved/);
  const advanced = context.game.worldTime(scope(host));
  assert.equal(advanced.calendar.tick, 11);
  assert.equal(advanced.facts.find(fact => fact.id === 'lamps').value, false);
  assert.equal(context.calls[1].input.previewId, context.calls[0].result.previewId);
  const replay = await context.dispatch(confirmation);
  assert.match(body(replay.data), /World change saved/);
  assert.deepEqual(context.calls[2].input, context.calls[1].input);
  assert.deepEqual(context.calls[2].result, context.calls[1].result);
  assert.deepEqual(context.game.worldTime(scope(host)), advanced);
  const publicPages = await allPages(context, await context.dispatch(WORLD_TIME_ENTRY.custom_id, { owner: player }));
  assert.match(publicPages.text, /The lamps are withheld/);
  assert.doesNotMatch(publicPages.text, /Private host time reason|test:review|HOST_ONLY/);
});

test('installed decision uses selected consequences, required reason and explicit replayable confirmation', async t => {
  const context = setup(t), home = await context.dispatch(WORLD_TIME_ENTRY.custom_id);
  const choice = await context.dispatch(find(home.data, 'Reviewed world decisions').custom_id);
  assert.match(body(choice.data), /Reviewed settlement/);
  const choicePages = await allPages(context, choice, host);
  assert.match(choicePages.text, /open → resolved/);
  const modal = await context.dispatch(find(choice.data, 'Review this decision').custom_id);
  assert.equal(modal.responses[0].type, 9);
  const review = await context.dispatch(modal.data.custom_id, { type: 5, components: fields({ reason: 'Reviewed fictional settlement reason' }) });
  assert.equal(context.calls.length, 0, 'selection and reason do not mutate world state');
  const confirm = find(review.data, 'Confirm this decision').custom_id;
  await context.dispatch(confirm);
  assert.equal(context.calls[0].method, 'recordWorldTimeDecision');
  assert.equal(context.calls[0].input.decisionId, 'settle');
  assert.equal(context.calls[0].input.reason, 'Reviewed fictional settlement reason');
  const settled = context.game.worldTime(scope(host));
  assert.equal(settled.opportunities.find(option => option.id === 'accord').status, 'resolved');
  await context.dispatch(confirm);
  assert.deepEqual(context.calls[1].input, context.calls[0].input);
  assert.deepEqual(context.calls[1].result, context.calls[0].result);
  assert.deepEqual(context.game.worldTime(scope(host)), settled);
  const afterHome = await context.dispatch(WORLD_TIME_ENTRY.custom_id);
  const consumed = await context.dispatch(find(afterHome.data, 'Reviewed world decisions').custom_id);
  assert.equal(find(consumed.data, 'Review this decision').disabled, true);
});

test('copied controls, wrong channels and revoked host membership cannot confirm world changes', async t => {
  const context = setup(t), preview = await advancePreview(context);
  const confirmation = find(preview.data, 'Confirm this time advance').custom_id;
  const before = context.game.worldTime(scope(host));
  for (const options of [{ owner: player }, { owner: other }, { channel: '999999999999999999' }]) {
    const result = await context.dispatch(confirmation, options);
    assert.doesNotMatch(body(result.data), /World change saved|Private host time reason/);
    assert.equal(context.calls.length, 1);
  }
  context.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, host);
  const revoked = await context.dispatch(confirmation);
  assert.doesNotMatch(body(revoked.data), /World change saved|Private host time reason/);
  assert.equal(context.calls.length, 1);
  assert.equal(context.game.worldTime(scope(player)).calendar.tick, before.calendar.tick);
});

test('stale forms and paused confirmations reject before advancing time', async t => {
  const context = setup(t), modal = await form(context, 'Review time advance');
  const preview = await advancePreview(context, '1');
  await context.dispatch(find(preview.data, 'Confirm this time advance').custom_id);
  const staleForm = await context.dispatch(modal.custom_id, { type: 5, components: fields({ increment: '11', reason: 'Old form should not apply' }) });
  assert.match(body(staleForm.data), /current calendar|changed|current/i);
  assert.equal(context.calls.filter(call => call.method === 'previewWorldTime').length, 1);
  const next = await advancePreview(context, '2');
  const confirmation = find(next.data, 'Confirm this time advance').custom_id;
  const state = context.game.view(scope(player));
  context.game.command(scope(player), { requestId: 'pause_time_fixture', expectedRevision: state.revision, actorId: 'hero', type: 'pause' });
  const paused = await context.dispatch(confirmation);
  assert.doesNotMatch(body(paused.data), /World change saved/);
  assert.equal(context.game.worldTime(scope(host)).calendar.tick, 1);
  const reading = await context.dispatch(WORLD_TIME_ENTRY.custom_id, { owner: player });
  privateDelivery(reading);
  assert.match(body(reading.data), /Paused/);
});

test('malformed, duplicate and empty form fields cannot make a preview', async t => {
  const context = setup(t), modal = await form(context, 'Review time advance');
  const variants = [fields({ increment: '1.5', reason: 'Invalid fraction' }), fields({ increment: '-1', reason: 'Invalid negative' }), fields({ increment: '0', reason: 'Invalid zero' }), fields({ increment: '1', reason: '' }), [...fields({ increment: '1', reason: 'Duplicate' }), ...fields({ reason: 'Again' })], fields({ increment: '1', reason: 'Unsafe extra', targetTick: '120' })];
  for (const components of variants) {
    const result = await context.dispatch(modal.custom_id, { type: 5, components });
    assert.doesNotMatch(body(result.data), /Confirm world change/);
  }
  assert.deepEqual(context.calls, []);
  assert.equal(context.game.worldTime(scope(host)).calendar.tick, 0);
});

test('lost confirmation delivery offers the same request for safe recovery', async t => {
  const context = setup(t), preview = await advancePreview(context);
  const confirmation = find(preview.data, 'Confirm this time advance').custom_id;
  context.loseNextEdit();
  const lost = await context.dispatch(confirmation);
  assert.equal(find(lost.data, 'Retry same confirmation').custom_id, confirmation);
  const committed = context.game.worldTime(scope(host));
  assert.equal(committed.calendar.tick, 11);
  const recovered = await context.dispatch(find(lost.data, 'Retry same confirmation').custom_id);
  assert.match(body(recovered.data), /World change saved/);
  assert.deepEqual(context.calls[2].result, context.calls[1].result);
  assert.deepEqual(context.game.worldTime(scope(host)), committed);
});

test('internal and state-validation failures never expose their private message or logs', async t => {
  const context = setup(t);
  for (const code of [undefined, 'STATE']) {
    context.game.worldTime = () => { throw Object.assign(new Error('SECRET_INTERNAL_CAMPAIGN_DATA'), code ? { code } : {}); };
    const result = await context.dispatch(WORLD_TIME_ENTRY.custom_id, { owner: player });
    privateDelivery(result);
    assert.doesNotMatch(JSON.stringify(result.data), /SECRET_INTERNAL_CAMPAIGN_DATA/);
  }
  assert.doesNotMatch(JSON.stringify(context.logs), /SECRET_INTERNAL_CAMPAIGN_DATA/);
  assert.deepEqual(context.calls, []);
});

test('Mission desk exposes the working World time entry within the existing button limit', async t => {
  const context = setup(t);
  const mission = await context.dispatch('rpw:home', { owner: player, route: 'mission' });
  privateDelivery(mission);
  assert.equal(buttons(mission.data).length, 10);
  for (const label of ['Tactical table', 'Ask · surroundings', 'Ask · readiness', 'Ask · mission', 'Saved counsel', 'Record party debrief', 'Full mission record', 'Mission council', 'Next scene']) find(mission.data, label);
  const entry = find(mission.data, 'World time');
  assert.equal(entry.custom_id, WORLD_TIME_ENTRY.custom_id);
  const opened = await context.dispatch(entry.custom_id, { owner: player });
  privateDelivery(opened);
  assert.match(body(opened.data), /Reviewed test calendar/);
  assert.deepEqual(context.calls, []);
});

test('Mission desk also exposes World time before a mission or calendar is installed', async t => {
  const context = setup(t, { configured: false, mission: false });
  const mission = await context.dispatch('rpw:home', { owner: player, route: 'mission' });
  privateDelivery(mission);
  const opened = await context.dispatch(find(mission.data, 'World time').custom_id, { owner: player });
  privateDelivery(opened);
  assert.match(body(opened.data), /no installed reviewed calendar/);
  assert.deepEqual(context.calls, []);
});

test('unrelated interaction prefixes are left for their owning handler', async t => {
  const context = setup(t);
  const result = await context.dispatch('rpw:home');
  assert.equal(result.handled, false);
  assert.equal(result.responses.length, 0);
  assert.equal(result.edits.length, 0);
});
