import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GameStore } from '../game/store.mjs';
import { createChecksHandler } from './checks-adapter.mjs';
import { createCompanionHandler } from './companion-adapter.mjs';

const owner = '123456789012345678', other = '123456789012345679';
const scope = { campaign: 'discord-checks', owner }, host = { ...scope, owner: 'host' };
const config = { campaignId: scope.campaign, guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [owner, other], playerRoleId: null };
const text = data => JSON.stringify(data);
function controls(data) {
  const result = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (value.type === 2 && value.custom_id) result.push(value);
      Object.values(value).forEach(visit);
    }
  };
  visit(data);
  return result;
}
const selected = (data, label) => controls(data).find(control => control.label === label)?.custom_id;
const confirm = data => controls(data).find(control => control.custom_id.endsWith(':confirm'))?.custom_id;

function setup(t) {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, wisdom: { value: 9 }, proficiencyBonus: { value: 3 } } };
  const saved = { revision: 2, snapshot }, characters = { character: () => saved };
  const version = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, actorOwner, x) => ({ id, owner: actorOwner, name: id, team: actorOwner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 100, maxHp: 100, ac: 14, speed: 30, vision: 5, initiative: id === 'scout' ? 20 : actorOwner ? 15 : 10, characterVersion: version, weapon: { name: 'Bow', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 60 } });
  let dice = 0;
  const game = new GameStore(':memory:', { rollDie: sides => { dice++; return sides === 20 ? 12 : 4; } });
  t.after(() => game.close());
  game.createCampaign({ campaign: scope.campaign, title: 'Checks', members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', owner, 1), actor('ally', other, 2), actor('foe', null, 4)], effects: [] });
  const prompt = { id: 'balance', reviewed: true, expectedRevision: 1, actorId: 'scout', label: 'Keep your balance', kind: 'check', ability: 'dexterity', proficiencyMultiplier: 2, proficiencyReason: 'Host-reviewed expertise', advantage: ['Stable handhold'], disadvantage: [], adjustments: [{ source: 'Reviewed equipment', value: 1 }], dc: 25, cost: 'action' };
  const responses = [], edits = [], order = [];
  let failSavedDelivery = false;
  const transport = {
    async respond(_id, _token, data) { responses.push(data); order.push('ack'); },
    async edit(_app, _token, data) { order.push('edit'); if (failSavedDelivery && text(data).includes('Roll saved')) { failSavedDelivery = false; throw new Error('fixture delivery failure'); } edits.push(data); },
  };
  const handle = createChecksHandler({ game, config, transport });
  const companion = createCompanionHandler({ game, characters, config, transport });
  const interaction = (custom, overrides = {}) => ({ id: 'fixture', token: 'fixture', application_id: '423456789012345678', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: owner }, roles: [] }, data: { custom_id: custom }, ...overrides });
  return { game, characters, prompt, responses, edits, order, dice: () => dice, failDelivery: () => { failSavedDelivery = true; }, handle, companion, interaction,
    request: changes => game.requestCheck(characters, host, { ...prompt, expectedRevision: game.load(scope.campaign).revision, ...changes }),
    click: async (custom, overrides) => { assert.ok(custom, 'the requested control exists'); await handle(interaction(custom, overrides)); return edits.at(-1) || responses.at(-1)?.data; },
  };
}

test('companion menu stays at ten controls and checks acknowledge privately before any projection', async t => {
  const h = setup(t);
  await h.companion(h.interaction('rpc:home'));
  assert.equal(controls(h.edits.at(-1)).length, 10);
  assert.equal(selected(h.edits.at(-1), 'Checks & rolls'), 'rpc:rolls');
  const pending = h.game.pendingChecks.bind(h.game), history = h.game.rollHistory.bind(h.game);
  h.game.pendingChecks = (...args) => { h.order.push('pending'); return pending(...args); };
  h.game.rollHistory = (...args) => { h.order.push('history'); return history(...args); };
  for (const [route, projection] of [['rpc:rolls', 'pending'], ['rpk:pending', 'pending'], ['rpk:history', 'history']]) {
    h.order.length = 0;
    await h.click(route);
    assert.deepEqual(h.order.slice(0, 2), ['ack', projection]);
    assert.equal(h.responses.at(-1).data.flags, 64);
  }
  assert.equal(h.game.load(scope.campaign).revision, 1);
  assert.equal(h.dice(), 0);
  assert.equal(await h.handle(h.interaction('rpc:012345678901234567890123:page')), false, 'legacy companion pages retain their own handler');
});

test('pending details page in full with one stable explicit action confirmation and no hidden DC', async t => {
  const h = setup(t);
  const reasons = Array.from({ length: 8 }, (_, i) => ({ source: `reason-${i} ${'*@🙂'.repeat(30)} end-${i}`, value: i - 3 }));
  h.request({ adjustments: reasons, proficiencyReason: 'reviewed-long-' + 'x'.repeat(280) });
  h.request({ id: 'other-secret', actorId: 'ally', label: 'OTHER PRIVATE CHECK' });
  const before = h.game.load(scope.campaign);
  let card = await h.click('rpk:pending');
  const confirmation = confirm(card), rendered = [];
  assert.ok(selected(card, 'Confirm roll · spend action'));
  while (true) {
    rendered.push(text(card));
    assert.equal(confirm(card), confirmation);
    const next = selected(card, 'Next detail');
    if (!next) break;
    card = await h.click(next);
  }
  const joined = rendered.join('');
  for (let i = 0; i < 8; i++) assert.match(joined, new RegExp(`end-${i}`));
  assert.doesNotMatch(joined, /OTHER PRIVATE CHECK|"dc"|\bDC:|difficulty class/i);
  assert.deepEqual(h.game.load(scope.campaign), before);
  assert.equal(h.dice(), 0);
  card = await h.click(confirmation);
  assert.match(text(card), /Roll saved/);
  assert.equal(h.game.load(scope.campaign).actionAvailable, false);
  assert.equal(h.dice(), 2);
  const receipt = h.game.rollHistory(scope).receipts[0];
  assert.deepEqual(receipt.result.dice, [12, 12]);
  assert.equal(receipt.result.total, 25);
  const resolve = h.game.resolveCheck.bind(h.game);
  h.game.resolveCheck = () => assert.fail('Paging a saved result must only read history');
  while (selected(card, 'Next detail')) card = await h.click(selected(card, 'Next detail'));
  h.game.resolveCheck = resolve;
  await h.click(confirmation);
  assert.equal(h.dice(), 2);
  assert.equal(h.game.rollHistory(scope).receipts.length, 1);
});

test('a saved roll survives uncertain Discord delivery and retries the same request once', async t => {
  const h = setup(t);
  h.request();
  const confirmation = confirm(await h.click('rpk:pending'));
  h.failDelivery();
  const failed = await h.click(confirmation);
  assert.match(text(failed), /retry that same confirmation/);
  const saved = h.game.rollHistory(scope).receipts[0];
  assert.equal(h.dice(), 2);
  await h.click(confirmation);
  assert.deepEqual(h.game.rollHistory(scope).receipts, [saved]);
  assert.equal(h.dice(), 2);
});

test('copied, foreign-channel, forged and revoked controls cannot roll or expose check details', async t => {
  const h = setup(t);
  h.request();
  const confirmation = confirm(await h.click('rpk:pending'));
  const copied = await h.click(confirmation, { member: { user: { id: other }, roles: [] } });
  assert.doesNotMatch(text(copied), /Keep your balance|Roll saved/);
  await h.click(confirmation, { channel_id: '323456789012345679' });
  const fake = h.game.createControl(scope, { guild: config.guildId, channel: config.channelId }, { kind: 'roll-history', checkId: 'balance' });
  await h.click(`rpk:${fake}:confirm`);
  assert.equal(h.dice(), 0);
  h.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(scope.campaign, owner);
  await h.click(confirmation);
  assert.equal(h.dice(), 0);
  assert.equal(h.game.load(scope.campaign).revision, 1);
});

test('paused, off-turn and stale checks are rejected by the shared engine without dice or resource changes', async t => {
  const h = setup(t);
  h.request();
  const confirmation = confirm(await h.click('rpk:pending'));
  const state = h.game.load(scope.campaign);
  state.phase = 'paused'; h.game.save(state);
  await h.click(confirmation);
  assert.match(text(h.edits.at(-1)), /paused/);
  assert.equal(h.dice(), 0);
  state.phase = 'combat'; state.activeIndex = 1; h.game.save(state);
  await h.click(confirmation);
  assert.match(text(h.edits.at(-1)), /your turn/);
  assert.equal(h.dice(), 0);
  state.activeIndex = 0; state.revision++; h.game.save(state);
  await h.click(confirmation);
  assert.match(text(h.edits.at(-1)), /scene changed/);
  assert.equal(h.dice(), 0);
  assert.equal(h.game.load(scope.campaign).actionAvailable, true);
});

test('complete saved history reaches older checks, saves and attack breakdowns without other owners', async t => {
  const h = setup(t);
  h.request({ id: 'other-roll', actorId: 'ally', label: 'OTHER PRIVATE ROLL', cost: 'none' });
  h.game.resolveCheck({ ...scope, owner: other }, { checkId: 'other-roll', requestId: 'other-result' });
  for (let i = 0; i < 25; i++) {
    h.request({ id: `check-${i}`, label: `History check ${i}`, kind: i % 2 ? 'save' : 'check', proficiencyMultiplier: 1, cost: 'none', advantage: ['Stable handhold'], disadvantage: ['Strong wind'] });
    h.game.resolveCheck(scope, { checkId: `check-${i}`, requestId: `roll-${i}` });
  }
  const attack = h.game.command(scope, { type: 'attack', actorId: 'scout', targetId: 'foe', expectedRevision: h.game.load(scope.campaign).revision, requestId: 'attack-result' });
  assert.equal(attack.result.type, 'attack');
  let card = await h.click('rpk:history');
  h.request({ id: 'interleaved', label: 'Arrived while paging', cost: 'none' });
  h.game.resolveCheck(scope, { checkId: 'interleaved', requestId: 'interleaved-result' });
  const rollsBefore = h.dice(), stateBefore = h.game.load(scope.campaign);
  const rendered = [];
  for (let page = 0; page < 100; page++) {
    rendered.push(text(card));
    const next = selected(card, 'Next detail') || selected(card, 'Older rolls');
    if (!next) break;
    card = await h.click(next);
  }
  const joined = rendered.join('');
  for (let i = 0; i < 25; i++) assert.match(joined, new RegExp(`History check ${i}`));
  assert.equal((joined.match(/attack-result/g) || []).length, 1);
  assert.doesNotMatch(joined, /Arrived while paging/);
  assert.match(joined, /Damage dice: 4/);
  assert.match(joined, /Damage modifier: \+3/);
  assert.match(joined, /Weapon: Bow/);
  assert.match(joined, /Stable handhold/);
  assert.match(joined, /Strong wind/);
  assert.match(joined, /Discarded dice/);
  assert.match(joined, /Character version/);
  assert.doesNotMatch(joined, /OTHER PRIVATE ROLL|"dc"|\bDC:|difficulty class/i);
  assert.deepEqual(h.game.load(scope.campaign), stateBefore);
  assert.equal(h.dice(), rollsBefore);
});
