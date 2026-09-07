import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GameStore } from '../game/store.mjs';
import { createChecksHandler } from './checks-adapter.mjs';
import { createCompanionHandler } from './companion-adapter.mjs';
import { checkConsequenceFields, checkDamageWarning } from './check-consequence-fields.mjs';

const owner = '123456789012345678', other = '123456789012345679';
const scope = { campaign: 'discord-save-damage', owner }, host = { ...scope, owner: 'host' };
const config = { campaignId: scope.campaign, guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [owner, other], playerRoleId: null };
const privateReason = 'HOST-ONLY-MITIGATION-REVIEW';
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
const confirm = data => controls(data).find(control => control.custom_id.endsWith(':confirm'))?.custom_id;
const nextDetail = data => controls(data).find(control => !control.disabled && control.label.startsWith('Next'))?.custom_id;

function setup(t) {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, proficiencyBonus: { value: 3 } } };
  const characters = { character: () => ({ revision: 2, snapshot }) };
  const version = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, actorOwner, x) => ({ id, owner: actorOwner, name: id, team: actorOwner ? 'party' : 'enemy', x, y: 1, size: 1, hp: id === 'scout' ? 3 : 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative: id === 'scout' ? 20 : 10, characterVersion: version, weapon: { name: 'Bow', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 60 } });
  const rolls = [20, 5, 6];
  let dice = 0, failSavedDelivery = false;
  const game = new GameStore(':memory:', { rollDie: () => { assert.ok(dice < rolls.length, 'no extra dice may be rolled'); return rolls[dice++]; } });
  t.after(() => game.close());
  game.createCampaign({ campaign: scope.campaign, title: 'Save damage', members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', owner, 1), actor('ally', other, 2), actor('foe', null, 4)], effects: [] });
  const prompt = { id: 'fire-save', reviewed: true, expectedRevision: 1, actorId: 'scout', label: 'Avoid the fire', kind: 'save', ability: 'dexterity', proficiencyMultiplier: 0, proficiencyReason: 'Reviewed: no save proficiency applies', advantage: [], disadvantage: [], adjustments: Array.from({ length: 8 }, (_, i) => ({ source: `reason-${i} ${'*@🙂'.repeat(30)} end-${i}`, value: 0 })), dc: 15, cost: 'none', consequence: { type: 'single_target_damage', dice: { count: 2, sides: 6, bonus: 2 }, damageType: 'fire', onSuccess: 'half', mitigation: { reduction: 2, resistance: false, vulnerability: false, immunity: false, reason: privateReason } } };
  const responses = [], edits = [];
  const transport = {
    async respond(_id, _token, data) { responses.push(data); },
    async edit(_app, _token, data) { if (failSavedDelivery && text(data).includes('Roll saved')) { failSavedDelivery = false; throw new Error('fixture delivery failure'); } edits.push(data); },
  };
  const handle = createChecksHandler({ game, config, transport });
  const companion = createCompanionHandler({ game, characters, config, transport });
  const interaction = (custom, overrides = {}) => ({ id: 'fixture', token: 'fixture', application_id: '423456789012345678', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: owner }, roles: [] }, data: { custom_id: custom }, ...overrides });
  return { game, responses, dice: () => dice, failDelivery: () => { failSavedDelivery = true; },
    request: changes => game.requestCheck(characters, host, { ...prompt, expectedRevision: game.load(scope.campaign).revision, ...changes }),
    click: async (custom, overrides) => {
      assert.ok(custom, 'the requested control exists');
      const previousEdits = edits.length;
      await (custom.startsWith('rpc:') ? companion : handle)(interaction(custom, overrides));
      return edits.length > previousEdits ? edits.at(-1) : responses.at(-1)?.data;
    },
  };
}

async function allPages(h, first) {
  const pages = [];
  let card = first;
  for (let count = 0; count < 40; count++) {
    pages.push(card);
    const next = nextDetail(card);
    if (!next) return pages;
    card = await h.click(next);
  }
  assert.fail('receipt pagination must terminate');
}

function assertSavedDamage(pages) {
  assert.ok(pages.length > 1, 'the complete receipt is reachable through pagination');
  const joined = pages.map(text).join('');
  for (const expected of ['Damage type: fire', 'Damage dice: 5, 6', 'Damage die sides: 6', 'Damage bonus: 2', 'Rolled damage: 13', 'Damage after save: 6', 'Damage reduction: 2', 'Damage resistance: No', 'Damage vulnerability: No', 'Damage immunity: No', 'Damage after mitigation: 4', 'HP before: 3', 'HP after: 0']) assert.ok(joined.includes(expected), `saved field is visible: ${expected}`);
  for (let i = 0; i < 8; i++) assert.ok(joined.includes(`end-${i}`));
  assert.doesNotMatch(joined, /HOST-ONLY-MITIGATION-REVIEW|"dc"|\bDC:|difficulty class|reviewReason/i);
}

test('save damage preview warns on every detail page with a stable private confirmation and no host-only values', async t => {
  const h = setup(t);
  h.request();
  const before = h.game.load(scope.campaign);
  const pages = await allPages(h, await h.click('rpk:pending'));
  assert.ok(pages.length > 1);
  const confirmation = confirm(pages[0]);
  for (const card of pages) {
    assert.match(text(card), /Damage risk: this saving throw can apply fire damage to your character/);
    assert.match(text(card), /On success: half damage/);
    assert.equal(confirm(card), confirmation);
    assert.doesNotMatch(text(card), /HOST-ONLY-MITIGATION-REVIEW|"dc"|\bDC:|difficulty class|Damage reduction|2d6|reviewReason/i);
    assert.equal(card.flags, 32768);
  }
  assert.ok(h.responses.every(response => response.type === 5 && response.data.flags === 64));
  assert.deepEqual(h.game.load(scope.campaign), before);
  assert.equal(h.dice(), 0);
});

test('saved damage survives uncertain delivery and remains complete in result and both histories without extra dice or HP changes', async t => {
  const h = setup(t);
  h.request();
  const confirmation = confirm(await h.click('rpk:pending'));
  h.failDelivery();
  assert.match(text(await h.click(confirmation)), /retry that same confirmation/);
  const saved = h.game.rollHistory(scope).receipts[0];
  assert.equal(saved.result.consequence.appliedDamage, 4, 'saved damage is recorded before the HP floor');
  assert.equal(saved.result.consequence.hpBefore, 3);
  assert.equal(saved.result.consequence.hpAfter, 0);
  assert.equal(saved.revision, h.game.load(scope.campaign).revision, 'result controls use the final saved revision');
  assert.equal(h.dice(), 3);
  const state = h.game.load(scope.campaign);
  const resultCard = await h.click(confirmation);
  const resolve = h.game.resolveCheck.bind(h.game);
  h.game.resolveCheck = () => assert.fail('paging and history must only read the saved receipt');
  assertSavedDamage(await allPages(h, resultCard));
  assertSavedDamage(await allPages(h, await h.click('rpk:history')));
  assertSavedDamage(await allPages(h, await h.click('rpc:rolls')));
  h.game.resolveCheck = resolve;
  await h.click(confirmation);
  assert.deepEqual(h.game.rollHistory(scope).receipts, [saved]);
  assert.deepEqual(h.game.load(scope.campaign), state);
  assert.equal(h.dice(), 3);
});

test('copied and foreign-channel save controls cannot confirm or reveal the saved damage pages', async t => {
  const h = setup(t);
  h.request();
  const confirmation = confirm(await h.click('rpk:pending'));
  const foreign = [{ member: { user: { id: other }, roles: [] } }, { channel_id: '323456789012345679' }];
  for (const overrides of foreign) {
    const denied = await h.click(confirmation, overrides);
    assert.doesNotMatch(text(denied), /Avoid the fire|Damage risk|Roll saved|HP before/);
  }
  assert.equal(h.dice(), 0);
  const stateBefore = h.game.load(scope.campaign);
  assert.equal(stateBefore.actors.find(actor => actor.id === 'scout').hp, 3);
  const result = await h.click(confirmation);
  const resultPage = nextDetail(result);
  const checksHistory = nextDetail(await h.click('rpk:history'));
  const companionHistory = nextDetail(await h.click('rpc:rolls'));
  const stateAfter = h.game.load(scope.campaign);
  for (const custom of [resultPage, checksHistory, companionHistory]) {
    for (const overrides of foreign) {
      const denied = await h.click(custom, overrides);
      assert.doesNotMatch(text(denied), /Avoid the fire|Damage type|Rolled damage|HP before/);
    }
  }
  assert.deepEqual(h.game.load(scope.campaign), stateAfter);
  assert.equal(h.dice(), 3);
});

test('damage display whitelists persisted values and leaves legacy checks, saves and attacks unchanged', () => {
  const consequence = { type: 'single_target_damage', damageType: 'cold', dice: [1, 2], dieSides: 8, bonus: -1, rolledTotal: 91, afterSave: 72, mitigation: { reduction: 7, resistance: true, vulnerability: true, immunity: true, reason: privateReason }, appliedDamage: 44, hpBefore: 9, hpAfter: 0, reviewReason: 'SECRET', dc: 19, rawFormula: 'PRIVATE FORMULA' };
  const fields = Object.fromEntries(checkConsequenceFields({ type: 'save', consequence }).map(field => [field.label, field.value]));
  assert.deepEqual(fields, { 'Damage type': 'cold', 'Damage dice': '1, 2', 'Damage die sides': 8, 'Damage bonus': -1, 'Rolled damage': 91, 'Damage after save': 72, 'Damage reduction': 7, 'Damage resistance': 'Yes', 'Damage vulnerability': 'Yes', 'Damage immunity': 'Yes', 'Damage after mitigation': 44, 'HP before': 9, 'HP after': 0 });
  for (const type of ['check', 'save', 'attack']) assert.deepEqual(checkConsequenceFields({ type }), []);
  assert.deepEqual(checkConsequenceFields({ type: 'attack', consequence }), []);
  assert.equal(checkDamageWarning({}), '');
  assert.match(checkDamageWarning({ consequence: { ...consequence, onSuccess: 'none' } }), /On success: no damage/);
  assert.doesNotMatch(checkDamageWarning({ consequence: { ...consequence, onSuccess: 'half' } }), /SECRET|PRIVATE|HOST-ONLY|91|19/);
});
