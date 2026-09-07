import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createReactionsHandler } from './reactions-adapter.mjs';
import { createCompanionHandler } from './companion-adapter.mjs';
import { safeText } from './import-ui.mjs';

const host = { campaign: 'reaction-discord', owner: '111111111111111111' };
const first = { ...host, owner: '222222222222222222' }, second = { ...host, owner: '333333333333333333' };
const config = { campaignId: host.campaign, guildId: '444444444444444444', channelId: '555555555555555555', playerIds: [host.owner, first.owner, second.owner] };
const controls = card => card.components.filter(component => component.type === 1).flatMap(row => row.components);
const text = card => card.components.filter(component => component.type === 10).map(component => component.content).join('\n');
const control = (card, label) => { const value = controls(card).find(button => button.label === label); assert.ok(value, `Missing ${label}`); return value.custom_id; };
function setup(t) {
  let dice = 0, loseDelivery = false, afterAck = null;
  const game = new GameStore(':memory:', { rollDie: sides => { dice++; return sides === 20 ? 12 : 4; } });
  t.after(() => game.close());
  const actor = (id, owner, team, x, y, initiative) => ({ id, name: id, owner, team, x, y, initiative, size: 1, hp: 40, maxHp: 40, ac: 14, speed: 30, vision: 12, characterVersion: 'fixture-v1',
    weapon: { name: `${id} blade`, abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 }, combatCapabilities: { attackKind: 'melee', meleeReachFeet: 5 } });
  game.createCampaign({ campaign: host.campaign, title: 'Discord reactions', members: [{ owner: host.owner, role: 'host' }, { owner: first.owner, role: 'player' }, { owner: second.owner, role: 'player' }],
    map: { id: 'map', title: 'Reaction fixture', width: 12, height: 12, blocked: [], difficult: [] }, effects: [],
    actors: [actor('mover', null, 'opposition', 2, 2, 30), actor('reactor-one', first.owner, 'party', 1, 2, 20), actor('reactor-two', second.owner, 'party', 2, 1, 10)] });
  game.command(host, { type: 'move', actorId: 'mover', requestId: 'move-to-reaction', expectedRevision: game.view(host).revision, path: [{ x: 3, y: 3 }] });
  const messages = [], callbacks = [];
  const transport = { respond: async (...args) => { callbacks.push(args[2]); if (args[2].type === 4) messages.push(args[2].data); if (args[2].type === 5 && afterAck) { const run = afterAck; afterAck = null; run(); } },
    edit: async (...args) => { if (loseDelivery) { loseDelivery = false; throw new Error('Lost private delivery'); } messages.push(args[2]); } };
  const handle = createReactionsHandler({ game, config, transport });
  const companion = createCompanionHandler({ game, characters: null, config, transport });
  const interaction = (custom_id, scope = first, overrides = {}) => ({ id: 'interaction', application_id: 'application', token: 'token', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner, bot: false }, roles: [] }, data: { custom_id }, ...overrides });
  const snapshot = () => ({ state: game.load(host.campaign), events: game.events(host), receipts: game.db.prepare('SELECT * FROM game_receipts ORDER BY body').all(), dice });
  return { game, handle, companion, interaction, messages, callbacks, snapshot, dice: () => dice, lose: () => { loseDelivery = true; }, afterAck: callback => { afterAck = callback; } };
}
function bounded(card) {
  assert.ok(controls(card).length <= 10);
  assert.ok(card.components.filter(component => component.type === 10).every(component => component.content.length <= 2925));
  assert.deepEqual(card.allowed_mentions, { parse: [] });
  assert.ok(controls(card).every(button => button.custom_id.length <= 100));
}
async function declare(f, scope, label = 'Declare opportunity attack') {
  await f.handle(f.interaction('rpr:home', scope));
  const id = control(f.messages.at(-1), label);
  await f.handle(f.interaction(id, scope));
  return id;
}

test('companion keeps all10 entries and its roll submenu exposes reactions without capturing old bound routes', async t => {
  const f = setup(t), before = f.snapshot();
  await f.companion(f.interaction('rpc:home')); const menu = f.messages.at(-1);
  assert.equal(controls(menu).length, 10); assert.match(text(menu), /opportunity reactions/);
  await f.handle(f.interaction(control(menu, 'Checks & rolls')));
  assert.equal(control(f.messages.at(-1), 'Opportunity reactions'), 'rpr:home');
  assert.equal(control(f.messages.at(-1), 'Checks & rolls'), 'rpk:home');
  assert.equal(await f.handle(f.interaction(`rpc:${'a'.repeat(24)}:page`)), false);
  assert.equal(await f.handle(f.interaction('rpk:history')), false);
  assert.deepEqual(f.snapshot(), before); f.messages.forEach(bounded);
});

test('private reaction previews reveal only owned offers and spend no time, reaction or dice', async t => {
  const f = setup(t), before = f.snapshot();
  await f.handle(f.interaction('rpr:home'));
  assert.deepEqual(f.callbacks[0], { type: 5, data: { flags: 64 } });
  const card = f.messages.at(-1); assert.match(text(card), /reactor\\-one|reactor-one/); assert.doesNotMatch(text(card), /reactor-two blade/);
  assert.ok(controls(card).some(button => button.label === 'Declare opportunity attack'));
  assert.ok(controls(card).some(button => button.label === 'Decline this opportunity'));
  assert.equal(controls(card).some(button => button.label === 'Recheck pending reactions'), false);
  assert.deepEqual(f.snapshot(), before); bounded(card);
});

test('lost delivery retries a bound declaration once and private result pages never repeat the attack', async t => {
  const f = setup(t);
  await f.handle(f.interaction('rpr:home')); const id = control(f.messages.at(-1), 'Declare opportunity attack');
  f.lose(); await f.handle(f.interaction(id)); const saved = f.snapshot(); assert.equal(f.dice(), 0);
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), saved);
  await declare(f, second, 'Decline this opportunity'); assert.equal(f.dice(), 2);
  const completed = f.snapshot(); await f.handle(f.interaction('rpr:results'));
  let full = '';
  for (let i = 0; i < 20; i++) {
    const card = f.messages.at(-1); bounded(card); full += text(card);
    const next = controls(card).find(button => button.label === 'Next detail'); if (!next) break;
    await f.handle(f.interaction(next.custom_id));
  }
  assert.match(full, /Saved declaration|Saved request/); assert.match(full, /Damage/); assert.match(full, /Attack total/); assert.match(full, /Character version/);
  assert.doesNotMatch(full, /reactor-two blade/); assert.deepEqual(f.snapshot(), completed);
});

test('copied, foreign-channel and stale controls cannot commit decisions or disclose another offer', async t => {
  const f = setup(t);
  await f.handle(f.interaction('rpr:home')); const id = control(f.messages.at(-1), 'Declare opportunity attack'), before = f.snapshot();
  await f.handle(f.interaction(id, second)); assert.deepEqual(f.snapshot(), before); assert.doesNotMatch(text(f.messages.at(-1)), /reactor-one blade/);
  await f.handle(f.interaction(id, first, { channel_id: '666666666666666666' })); assert.deepEqual(f.snapshot(), before);
  await declare(f, second, 'Decline this opportunity'); const changed = f.snapshot();
  await f.handle(f.interaction(id)); assert.deepEqual(f.snapshot(), changed); assert.equal(f.dice(), 0);
});

test('membership is rechecked after acknowledgement and paused controls are disabled and core-enforced', async t => {
  const f = setup(t);
  f.game.command(host, { type: 'pause', actorId: 'mover', requestId: 'pause-reactions', expectedRevision: f.game.view(host).revision });
  await f.handle(f.interaction('rpr:home')); const card = f.messages.at(-1), before = f.snapshot();
  assert.equal(controls(card).find(button => button.label === 'Declare opportunity attack').disabled, true);
  await f.handle(f.interaction(control(card, 'Declare opportunity attack'))); assert.deepEqual(f.snapshot(), before);
  f.afterAck(() => f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(host.campaign, first.owner));
  await f.handle(f.interaction('rpr:home')); assert.doesNotMatch(text(f.messages.at(-1)), /reactor-one blade/); assert.deepEqual(f.snapshot(), before);
});

test('controller explicitly arranges declared reactions and confirms once; copied order controls fail', async t => {
  const f = setup(t); await declare(f, first); await declare(f, second);
  assert.equal(f.dice(), 0);
  await f.handle(f.interaction('rpr:home', host)); await f.handle(f.interaction(control(f.messages.at(-1), 'Choose reaction order'), host));
  await f.handle(f.interaction(control(f.messages.at(-1), 'Next candidate'), host));
  await f.handle(f.interaction(control(f.messages.at(-1), 'Place next in order'), host));
  await f.handle(f.interaction(control(f.messages.at(-1), 'Place next in order'), host));
  const id = control(f.messages.at(-1), 'Confirm reaction order'), before = f.snapshot();
  assert.equal(f.dice(), 0); await f.handle(f.interaction(id, first)); assert.deepEqual(f.snapshot(), before);
  await f.handle(f.interaction(id, host)); assert.equal(f.dice(), 4); const saved = f.snapshot();
  await f.handle(f.interaction(id, host)); assert.deepEqual(f.snapshot(), saved);
  const firstAttack = f.game.reactions(first).recentResults[0], secondAttack = f.game.reactions(second).recentResults[0];
  assert.ok(secondAttack.revision < firstAttack.revision); f.messages.forEach(bounded);
});

test('long ordered labels paginate completely and keep one stable confirmation across detail pages', async t => {
  const f = setup(t), initial = f.game.reactions(host), before = f.snapshot();
  const labels = Array.from({ length: 16 }, (_, index) => `Choice ${index + 1} ${'*_@everyone 🕯️ '.repeat(12)} END-${index + 1}`);
  f.game.reactions = () => ({ revision: initial.revision, recentResults: [], pending: { id: 'presentation-fixture', stage: 'order', kind: 'opportunity_attack', paused: false, canOrder: true, canRefresh: true, offers: [], orderChoices: labels.map((label, index) => ({ optionId: `option-${index}`, label })) } });
  await f.handle(f.interaction('rpr:home', host)); await f.handle(f.interaction(control(f.messages.at(-1), 'Choose reaction order'), host));
  for (let i = 0; i < labels.length; i++) { bounded(f.messages.at(-1)); await f.handle(f.interaction(control(f.messages.at(-1), 'Place next in order'), host)); }
  let full = '', pages = 0; const confirmation = control(f.messages.at(-1), 'Confirm reaction order');
  for (;;) {
    const card = f.messages.at(-1); bounded(card); full += text(card); pages++;
    assert.equal(control(card, 'Confirm reaction order'), confirmation);
    const next = controls(card).find(button => button.label === 'Next detail'); if (!next) break;
    assert.ok(pages < 100); await f.handle(f.interaction(next.custom_id, host));
  }
  assert.ok(pages > 3); for (let i = 0; i < labels.length; i++) assert.ok(full.includes(safeText(`END-${i + 1}`)));
  assert.ok(full.includes(safeText('@everyone'))); assert.deepEqual(f.snapshot(), before);
});

test('controller refresh is explicit, repeat-safe, and does not auto-decline valid reactors', async t => {
  const f = setup(t); await f.handle(f.interaction('rpr:home', host));
  const id = control(f.messages.at(-1), 'Recheck pending reactions'); await f.handle(f.interaction(id, host));
  const saved = f.snapshot(); assert.equal(f.game.reactions(first).pending.offers.length, 1); assert.equal(f.game.reactions(second).pending.offers.length, 1); assert.equal(f.dice(), 0);
  await f.handle(f.interaction(id, host)); assert.deepEqual(f.snapshot(), saved);
});
