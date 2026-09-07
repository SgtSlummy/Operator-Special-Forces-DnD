import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createConcentrationHandler } from './concentration-adapter.mjs';
import { createReactionsHandler } from './reactions-adapter.mjs';
import { safeText } from './import-ui.mjs';

const host = { campaign: 'concentration-discord', owner: '111111111111111111' };
const first = { ...host, owner: '222222222222222222' }, second = { ...host, owner: '333333333333333333' };
const config = { campaignId: host.campaign, guildId: '444444444444444444', channelId: '555555555555555555', playerIds: [host.owner, first.owner, second.owner] };
const controls = card => card.components.filter(component => component.type === 1).flatMap(row => row.components);
const text = card => card.components.filter(component => component.type === 10).map(component => component.content).join('\n');
const control = (card, label) => { const value = controls(card).find(button => button.label === label); assert.ok(value, `Missing ${label}: ${text(card)}`); return value.custom_id; };
const actor = (id, owner, x, y, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y, initiative, size: 1, hp: 40, maxHp: 40, ac: 14, speed: 30, vision: 12, characterVersion: 'fixture-v1',
  weapon: { name: `${id} blade`, abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 },
  combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } },
  ...(owner ? { combatReview: { constitutionProficiencyReason: 'Reviewed fighter save proficiency.' } } : {}) });
const effect = (id, name = id, cells = [{ x: 8, y: 8 }], damage = 0) => ({ id, name, trigger: 'enter', damage, expiresAtTurn: 99, visible: true, cells });
function setup(t, { pending = true, effects = [], actors = [], die = 12 } = {}) {
  let dice = 0, loseDelivery = false, afterAck = null;
  const game = new GameStore(':memory:', { rollDie: () => { dice++; return die; } });
  t.after(() => game.close());
  game.createCampaign({ campaign: host.campaign, title: 'Discord concentration', members: [{ owner: host.owner, role: 'host' }, { owner: first.owner, role: 'player' }, { owner: second.owner, role: 'player' }],
    map: { id: 'map', title: 'Concentration fixture', width: 12, height: 12, blocked: [], difficult: [] },
    effects: [effect('hazard', 'Hot stones', [{ x: 2, y: 1 }], 4), effect('bound-glow', 'Reviewed light'), effect('unrelated', 'Unrelated mist'), ...effects],
    actors: [actor('hero', first.owner, 1, 1, 30), actor('ally', second.owner, 1, 4, 20), actor('sentry', null, 10, 10, 10), ...actors] });
  const start = (actorId = 'hero', effectIds = ['bound-glow'], requestId = 'fixture-start') => game.resolveConcentration(host, {
    action: 'start', actorId, characterVersion: 'fixture-v1', requestId, expectedRevision: game.view(host).revision,
    sourceLabel: 'Private lantern ward', effectIds, reviewed: true, reason: 'Reviewed the ongoing source, casting costs and bound effects.' });
  const move = () => game.command(first, { type: 'move', actorId: 'hero', requestId: 'fixture-move', expectedRevision: game.view(first).revision, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
  if (pending) { start(); move(); }
  const messages = [], callbacks = [], logs = [];
  const transport = { respond: async (...args) => { callbacks.push(args[2]); if (args[2].type === 4) messages.push(args[2].data); if (args[2].type === 5 && afterAck) { const run = afterAck; afterAck = null; run(); } },
    edit: async (...args) => { if (loseDelivery) { loseDelivery = false; throw new Error('Lost private delivery'); } messages.push(args[2]); } };
  const handle = createConcentrationHandler({ game, config, transport, log: value => logs.push(value) });
  const reactions = createReactionsHandler({ game, config, transport });
  const interaction = (custom_id, scope = first, overrides = {}) => ({ id: 'interaction', application_id: 'application', token: 'token', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner, bot: false }, roles: [] }, data: { custom_id }, ...overrides });
  const snapshot = () => ({ state: game.load(host.campaign), events: game.events(host), receipts: game.db.prepare('SELECT * FROM game_receipts ORDER BY body').all(), dice });
  return { game, handle, reactions, interaction, messages, callbacks, logs, snapshot, start, move, dice: () => dice, lose: () => { loseDelivery = true; }, afterAck: callback => { afterAck = callback; } };
}
function bounded(card) {
  assert.ok(controls(card).length <= 10);
  assert.ok(card.components.filter(component => component.type === 10).every(component => component.content.length <= 2925));
  assert.deepEqual(card.allowed_mentions, { parse: [] });
  assert.ok(controls(card).every(button => button.custom_id.length <= 100));
}
async function details(f, scope = first) {
  let full = '', count = 0;
  for (;;) {
    const card = f.messages.at(-1); bounded(card); full += text(card); count++;
    const next = controls(card).find(button => button.label === 'Next detail');
    if (!next) return { full, count };
    assert.ok(count < 100); await f.handle(f.interaction(next.custom_id, scope));
  }
}
async function form(f, label, scope = host) {
  await f.handle(f.interaction(control(f.messages.at(-1), label), scope));
  const response = f.callbacks.at(-1); assert.equal(response.type, 9); return response.data.custom_id;
}
async function submit(f, id, values, scope = host) {
  await f.handle(f.interaction(id, scope, { type: 5, data: { custom_id: id, components: Object.entries(values).map(([custom_id, value]) => ({ type: 18, component: { type: 4, custom_id, value } })) } }));
}

test('roll submenu exposes concentration and the adapter leaves all other routes alone', async t => {
  const f = setup(t), before = f.snapshot();
  await f.reactions(f.interaction('rpc:rolls'));
  assert.equal(control(f.messages.at(-1), 'Concentration'), 'rpf:home');
  assert.equal(await f.handle(f.interaction('rpk:home')), false);
  assert.equal(await f.handle(f.interaction('rpr:home')), false);
  assert.equal(await f.handle(f.interaction(`rpc:${'a'.repeat(24)}:page`)), false);
  assert.deepEqual(f.snapshot(), before);
});

test('owner sees the pinned save while other players receive only a generic wait without game mutation', async t => {
  const f = setup(t), before = f.snapshot();
  await f.handle(f.interaction('rpf:home'));
  assert.deepEqual(f.callbacks[0], { type: 5, data: { flags: 64 } });
  const own = f.messages.at(-1); bounded(own);
  assert.match(text(own), /Private lantern ward/); assert.match(text(own), /Damage taken: 4/); assert.match(text(own), /Constitution save DC: 10/);
  assert.ok(control(own, 'Roll concentration save')); assert.ok(control(own, 'End concentration'));
  await f.handle(f.interaction('rpf:home', second)); const other = f.messages.at(-1); bounded(other);
  assert.match(text(other), /remain private/); assert.doesNotMatch(text(other), /Private lantern ward|Damage taken|hero|Constitution save DC/);
  assert.equal(controls(other).some(button => button.label === 'Roll concentration save'), false);
  await f.handle(f.interaction('rpf:home', host));
  assert.equal(controls(f.messages.at(-1)).some(button => button.label === 'Roll concentration save'), false);
  assert.deepEqual(f.snapshot(), before);
});

test('lost delivery retries the same saved save, resumes movement once, and history never rerolls', async t => {
  const f = setup(t);
  await f.handle(f.interaction('rpf:home')); const id = control(f.messages.at(-1), 'Roll concentration save');
  f.lose(); await f.handle(f.interaction(id)); assert.equal(control(f.messages.at(-1), 'Retry same confirmation'), id);
  const saved = f.snapshot(), hero = saved.state.actors.find(value => value.id === 'hero');
  assert.equal(f.dice(), 1); assert.equal(hero.hp, 36); assert.equal(hero.x, 3); assert.equal(saved.state.movementRemaining, 20); assert.equal(saved.state.pendingConcentration, undefined);
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), saved);
  await f.handle(f.interaction('rpf:results')); const history = await details(f);
  assert.match(history.full, /Private lantern ward/); assert.match(history.full, /Concentration maintained/); assert.match(history.full, /Save total: 16/);
  assert.match(history.full, /Dice rolled: 12/); assert.match(history.full, /Save modifier: 4/);
  await f.handle(f.interaction('rpf:results', second)); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|Save total|Dice rolled/);
  await f.handle(f.interaction('rpf:results', host)); assert.match(text(f.messages.at(-1)), /Private lantern ward/); assert.doesNotMatch(text(f.messages.at(-1)), /Save total|Dice rolled|Concentration maintained/);
  assert.deepEqual(f.snapshot(), saved); f.messages.forEach(bounded);
});

test('voluntary end removes only bound effects, spends no dice, and continues already paid movement', async t => {
  const f = setup(t); await f.handle(f.interaction('rpf:home')); const id = control(f.messages.at(-1), 'End concentration');
  await f.handle(f.interaction(id)); const saved = f.snapshot(), hero = saved.state.actors.find(value => value.id === 'hero');
  assert.equal(hero.x, 3); assert.equal(hero.hp, 36); assert.equal(hero.concentration, undefined); assert.equal(f.dice(), 0);
  assert.deepEqual(saved.state.effects.map(value => value.id), ['hazard', 'unrelated']); assert.equal(saved.state.actionAvailable, true); assert.equal(saved.state.movementRemaining, 20);
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), saved);
});

test('failed save is saved privately and removes its exact bound effects once', async t => {
  const f = setup(t, { die: 1 }); await f.handle(f.interaction('rpf:home')); const id = control(f.messages.at(-1), 'Roll concentration save');
  await f.handle(f.interaction(id)); const saved = f.snapshot(); assert.equal(f.dice(), 1);
  assert.equal(saved.state.actors.find(value => value.id === 'hero').concentration, undefined);
  assert.deepEqual(saved.state.effects.map(value => value.id), ['hazard', 'unrelated']);
  await f.handle(f.interaction('rpf:results')); const { full } = await details(f); assert.match(full, /Concentration ended/); assert.ok(full.includes(safeText('bound-glow')));
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), saved);
});

test('copied, foreign-context and malformed controls cannot resolve or disclose another save', async t => {
  const f = setup(t); await f.handle(f.interaction('rpf:home')); const id = control(f.messages.at(-1), 'Roll concentration save'), before = f.snapshot();
  for (const [scope, overrides] of [[second, {}], [host, {}], [first, { channel_id: '666666666666666666' }], [first, { guild_id: '777777777777777777' }], [first, { type: 5 }]]) {
    await f.handle(f.interaction(id, scope, overrides)); assert.deepEqual(f.snapshot(), before); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|Save total|Damage taken/);
  }
  await f.handle(f.interaction('rpf:invalid:resolve')); assert.deepEqual(f.snapshot(), before);
});

test('paused controls cannot act and server enforcement rejects forged clicks and stale choices', async t => {
  const f = setup(t); await f.handle(f.interaction('rpf:home')); const staleId = control(f.messages.at(-1), 'Roll concentration save');
  f.game.command(host, { type: 'pause', actorId: 'hero', requestId: 'pause-fixture', expectedRevision: f.game.view(host).revision });
  await f.handle(f.interaction('rpf:home')); const card = f.messages.at(-1), paused = f.snapshot();
  assert.match(text(card), /Play is paused/);
  for (const [label, input] of [['Roll concentration save', { action: 'resolve', pendingId: f.game.concentration(first).pending.id }], ['End concentration', { action: 'end', actorId: 'hero' }]]) {
    assert.equal(controls(card).some(value => value.label === label && !value.disabled), false);
    const forged = f.game.createControl(first, { guild: config.guildId, channel: config.channelId }, { kind: 'concentration-decision', input: { ...input, expectedRevision: paused.state.revision } });
    await f.handle(f.interaction(`rpf:${forged}:resolve`)); assert.deepEqual(f.snapshot(), paused);
  }
  f.game.command(host, { type: 'resume', actorId: 'hero', requestId: 'resume-fixture', expectedRevision: f.game.view(host).revision });
  const resumed = f.snapshot(); await f.handle(f.interaction(staleId)); assert.deepEqual(f.snapshot(), resumed);
});

test('membership is checked after acknowledgement and saved replay retains current authority', async t => {
  const f = setup(t); await f.handle(f.interaction('rpf:home')); const id = control(f.messages.at(-1), 'Roll concentration save');
  await f.handle(f.interaction(id)); const saved = f.snapshot();
  f.afterAck(() => f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, first.owner));
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), saved); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|decision saved|Save total/);
  await f.handle(f.interaction('rpf:results')); assert.deepEqual(f.snapshot(), saved); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|Save total/);
});

test('host reviews an exact source through a scoped modal and stable confirmation without casting', async t => {
  const f = setup(t, { pending: false }), before = f.snapshot();
  await f.handle(f.interaction('rpf:register', first)); assert.deepEqual(f.snapshot(), before); assert.match(text(f.messages.at(-1)), /Only the host/);
  await f.handle(f.interaction('rpf:register', host)); assert.match(text(f.messages.at(-1)), /does not cast a spell/);
  const id = await form(f, 'Review source for character');
  await submit(f, id, { sourceLabel: 'Reviewed moon ward', effectIds: 'bound-glow', reason: 'Source and costs reviewed against the approved character.' });
  const confirmation = control(f.messages.at(-1), 'Confirm reviewed source'); assert.match(text(f.messages.at(-1)), /Reviewed moon ward/); assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction(confirmation, first)); assert.deepEqual(f.snapshot(), before);
  f.lose(); await f.handle(f.interaction(confirmation, host)); assert.equal(control(f.messages.at(-1), 'Retry same confirmation'), confirmation);
  const saved = f.snapshot(), focus = saved.state.actors.find(value => value.id === 'hero').concentration;
  assert.equal(focus.sourceLabel, 'Reviewed moon ward'); assert.deepEqual(focus.effects.map(value => value.id), ['bound-glow']);
  assert.equal(saved.state.actionAvailable, true); assert.equal(saved.state.movementRemaining, before.state.movementRemaining); assert.equal(f.dice(), 0);
  await f.handle(f.interaction(confirmation, host)); assert.deepEqual(f.snapshot(), saved);
});

test('registration rejects copied modals, unlisted effects, duplicates and stale reviewed forms', async t => {
  const f = setup(t, { pending: false }); await f.handle(f.interaction('rpf:register', host)); const id = await form(f, 'Review source for character'), before = f.snapshot();
  const values = { sourceLabel: 'Reviewed ward', effectIds: 'bound-glow', reason: 'Reviewed source and costs.' };
  await submit(f, id, values, first); assert.deepEqual(f.snapshot(), before);
  for (const effectIds of ['missing-effect', 'bound-glow,bound-glow']) { await submit(f, id, { ...values, effectIds }); assert.deepEqual(f.snapshot(), before); assert.equal(controls(f.messages.at(-1)).some(value => value.label === 'Confirm reviewed source'), false); }
  f.game.command(host, { type: 'pause', actorId: 'hero', requestId: 'stale-form', expectedRevision: f.game.view(host).revision });
  const changed = f.snapshot(); await submit(f, id, values); assert.deepEqual(f.snapshot(), changed); assert.equal(controls(f.messages.at(-1)).some(value => value.label === 'Confirm reviewed source'), false);
});

test('host registration paginates every long effect and each eligible character without changing state', async t => {
  const effects = Array.from({ length: 60 }, (_, index) => effect(`visible-${index}`, `${'*_@everyone '.repeat(8)} END-${index}`));
  const f = setup(t, { pending: false, effects, actors: [actor('second-hero', first.owner, 5, 5, 0)] }), before = f.snapshot();
  await f.handle(f.interaction('rpf:register', host)); const { full, count } = await details(f, host);
  assert.ok(count > 2); for (let index = 0; index < effects.length; index++) assert.ok(full.includes(safeText(`END-${index}`)));
  assert.ok(full.includes(safeText('@everyone')));
  await f.handle(f.interaction('rpf:register', host));
  const names = [];
  for (;;) { const card = f.messages.at(-1); names.push(text(card)); const next = controls(card).find(value => value.label === 'Next character'); if (!next) break; await f.handle(f.interaction(next.custom_id, host)); }
  assert.equal(names.length, 4); for (const name of ['hero', 'ally', 'sentry', 'second-hero']) assert.ok(names.some(value => value.includes(safeText(name))));
  await f.handle(f.interaction('rpf:actors', first)); const firstCard = f.messages.at(-1); assert.doesNotMatch(text(firstCard), /ally|sentry/);
  await f.handle(f.interaction(control(firstCard, 'Next character'), first)); assert.ok(text(f.messages.at(-1)).includes(safeText('second-hero')));
  assert.deepEqual(f.snapshot(), before); f.messages.forEach(bounded);
});

test('recovery is host-reviewed only after eligibility is lost and cannot decide for a valid player', async t => {
  const f = setup(t), initial = f.snapshot(); await f.handle(f.interaction('rpf:home', host));
  assert.equal(controls(f.messages.at(-1)).some(value => value.label === 'Review recovery'), false); assert.deepEqual(f.snapshot(), initial);
  const state = f.game.load(host.campaign); state.actors.find(value => value.id === 'hero').characterVersion = 'fixture-v2'; f.game.save(state);
  await f.handle(f.interaction('rpf:home', first)); assert.equal(controls(f.messages.at(-1)).some(value => value.label === 'Roll concentration save'), false);
  await f.handle(f.interaction('rpf:home', host)); const id = await form(f, 'Review recovery');
  await submit(f, id, { reason: 'Character version changed; the pinned save is no longer eligible.' }); const confirmation = control(f.messages.at(-1), 'Confirm reviewed recovery'), before = f.snapshot();
  await f.handle(f.interaction(confirmation, first)); assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction(confirmation, host)); const saved = f.snapshot(); assert.equal(saved.state.pendingConcentration, undefined); assert.equal(f.dice(), 0);
  await f.handle(f.interaction(confirmation, host)); assert.deepEqual(f.snapshot(), saved);
});

test('host resolves its NPC save while players cannot see its private dice or use copied controls', async t => {
  const f = setup(t, { pending: false, actors: [actor('npc', null, 2, 2, 40)] });
  f.start('npc');
  f.game.command(host, { type: 'move', actorId: 'npc', requestId: 'npc-move', expectedRevision: f.game.view(host).revision, path: [{ x: 2, y: 1 }, { x: 2, y: 2 }] });
  await f.handle(f.interaction('rpf:home', host)); const id = control(f.messages.at(-1), 'Roll concentration save'), before = f.snapshot();
  await f.handle(f.interaction(id, first)); assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction('rpf:home', first)); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|Damage taken|Constitution save DC/);
  await f.handle(f.interaction(id, host)); const saved = f.snapshot(), npc = saved.state.actors.find(value => value.id === 'npc');
  assert.equal(npc.hp, 36); assert.equal(npc.y, 2); assert.equal(f.dice(), 1);
  await f.handle(f.interaction('rpf:results', host)); const { full } = await details(f, host); assert.match(full, /Save total: 16/);
  await f.handle(f.interaction('rpf:results', first)); assert.doesNotMatch(text(f.messages.at(-1)), /Private lantern ward|Save total|Dice rolled/);
  await f.handle(f.interaction(id, host)); assert.deepEqual(f.snapshot(), saved);
});

test('saved result pagination preserves every receipt and scope without repeating registrations', async t => {
  const f = setup(t, { pending: false });
  for (let index = 0; index < 12; index++) f.game.resolveConcentration(host, {
    action: 'start', actorId: 'hero', characterVersion: 'fixture-v1', requestId: `history-${index}`, expectedRevision: f.game.view(host).revision,
    sourceLabel: `Reviewed source ${'*_@everyone '.repeat(6)} END-${index}`, effectIds: [], reviewed: true, reason: 'Reviewed source and costs before registration.' });
  const before = f.snapshot(); await f.handle(f.interaction('rpf:results', host)); const { full, count } = await details(f, host);
  assert.ok(count > 1); for (let index = 0; index < 12; index++) assert.ok(full.includes(safeText(`END-${index}`)));
  assert.ok(full.includes(safeText('@everyone'))); assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction('rpf:results', first)); assert.doesNotMatch(text(f.messages.at(-1)), /Reviewed source|END-/); assert.deepEqual(f.snapshot(), before);
});

test('an owner can end their active concentration outside their turn without spending the current actors resources', async t => {
  const f = setup(t, { pending: false }); f.start('ally'); const before = f.snapshot();
  await f.handle(f.interaction('rpf:actors', second)); const id = control(f.messages.at(-1), 'End concentration');
  await f.handle(f.interaction(id, second)); const saved = f.snapshot();
  assert.equal(saved.state.actors.find(value => value.id === 'ally').concentration, undefined);
  for (const key of ['activeIndex', 'round', 'turn', 'actionAvailable', 'movementRemaining']) assert.equal(saved.state[key], before.state[key]);
  assert.equal(f.dice(), 0); await f.handle(f.interaction(id, second)); assert.deepEqual(f.snapshot(), saved);
});
