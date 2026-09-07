import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createCompanionHandler } from './companion-adapter.mjs';

const owner = '123456789012345678', other = '123456789012345679';
const scope = { campaign: 'history', owner }, host = { campaign: 'history', owner: 'host' };
const config = { campaignId: 'history', guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [owner, other], playerRoleId: null };
const weapon = { name: 'Sword', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const actor = { team: 'party', name: 'Hero', owner, x: 1, y: 1, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 20, characterVersion: 'approved', weapon };
const seed = campaign => ({ campaign, title: 'History fixture', members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [{ ...actor, id: 'hero' }, { ...actor, id: 'enemy', team: 'enemy', name: 'Enemy', owner: null, x: 2, initiative: 10 }], effects: [] });
const text = card => card.components.filter(component => component.type === 10).map(component => component.content).join('\n');
const buttons = card => card.components.filter(component => component.type === 1).flatMap(row => row.components);
const button = (card, label) => { const found = buttons(card).find(item => item.label === label); assert.ok(found, `Missing ${label}`); return found; };

function session(game, settings = config, player = owner) {
  const callbacks = [], edits = [];
  const handle = createCompanionHandler({ game, characters: { character() { assert.fail('History must not read a character sheet'); } }, config: settings, transport: {
    respond: async (_id, _token, value) => callbacks.push(value),
    edit: async (_application, _token, value) => edits.push(value),
  } });
  let sequence = 0;
  return { callbacks, edits, async click(customId) {
    const acknowledged = callbacks.length, delivered = edits.length;
    assert.equal(await handle({ id: String(++sequence), application_id: '423456789012345678', token: 'private-history-test-token', type: 3, guild_id: settings.guildId, channel_id: settings.channelId, member: { user: { id: player }, roles: [] }, data: { custom_id: customId } }), true);
    assert.deepEqual(callbacks[acknowledged], { type: 5, data: { flags: 64 } });
    assert.equal(edits.length, delivered + 1);
    assert.equal(edits.at(-1).flags, 32768);
    assert.deepEqual(edits.at(-1).allowed_mentions, { parse: [] });
    return edits.at(-1);
  } };
}
function setup(t) {
  let rolls = 0;
  const game = new GameStore(':memory:', { rollDie: sides => { rolls++; return sides === 20 ? 15 : 1; } });
  t.after(() => game.close()); game.createCampaign(seed('history'));
  const command = (who, type, extra = {}) => game.command(who, { type, actorId: who.owner === owner ? 'hero' : 'enemy', requestId: `action-${game.view(who).revision}-${type}`, expectedRevision: game.view(who).revision, ...extra });
  return { game, command, ui: session(game), rollCount: () => rolls };
}
async function collect(ui, card) {
  let result = '';
  for (let page = 0; page < 100; page++) {
    result += `${text(card)}\n`;
    const next = button(card, 'Next page');
    if (next.disabled) return result;
    card = await ui.click(next.custom_id);
  }
  assert.fail('Receipt text pagination did not terminate');
}
// These are formatter fixtures for already-saved receipts. Real combat execution
// and durable filtering are exercised separately below; no check engine is mocked.
function saveFixture(game, revision, result, who = owner) {
  const receipt = { requestId: `fixture-${who}-${revision}`, revision, result };
  game.db.prepare('INSERT INTO game_receipts VALUES(?,?,?,?,?)').run('history', who, receipt.requestId, `fixture-${revision}`, JSON.stringify(receipt));
  return receipt;
}
function receipt(type, extra = {}) {
  return { type, actorId: 'hero', label: 'Notice the ambush', ability: 'wisdom', mode: 'advantage', advantage: ['Lookout'], disadvantage: [], dice: [4, 18], keptIndex: 1, discardedDice: [4], modifiers: [{ source: 'Wisdom', value: 3 }, { source: 'Perception proficiency', value: 2 }], total: 23, success: true, characterVersion: 'approved-7', rulesVersion: 'reviewed-2024', ...extra };
}

test('a real saved attack survives 48 later non-roll actions and browsing spends nothing during a pause or another turn', async t => {
  const { game, command, ui, rollCount } = setup(t);
  command(scope, 'attack', { targetId: 'enemy' });
  command(scope, 'end_turn');
  for (let n = 0; n < 24; n++) { command(scope, 'pause'); command(host, 'resume'); }
  command(scope, 'pause');
  assert.equal(game.receipts(scope, 20).filter(item => item.result.type === 'attack').length, 0);
  assert.equal(game.rollHistory(scope).receipts.length, 1);
  const before = structuredClone(game.load('history')), saved = game.rollHistory(scope), diceBefore = rollCount();
  const card = await ui.click('rpc:rolls'), output = await collect(ui, card);
  assert.match(output, /Saved attack/); assert.match(output, /Roll: 15/); assert.match(output, /Kept die: 15/);
  assert.match(output, /proficiency: 2/); assert.match(output, /Total: 17/); assert.match(output, /Damage dice: 1/);
  assert.equal(button(card, 'Older rolls').disabled, true); assert.equal(button(card, 'Newer rolls').disabled, true);
  assert.deepEqual(game.load('history'), before); assert.deepEqual(game.rollHistory(scope), saved); assert.equal(rollCount(), diceBefore);
});

test('attack, check and save groups retain raw dice, sources and long text across Older/Newer cursors', async t => {
  const { game, command, ui, rollCount } = setup(t);
  for (let n = 0; n < 20; n++) { command(scope, 'pause'); command(host, 'resume'); }
  for (let n = 2; n <= 26; n++) saveFixture(game, n, receipt(n % 2 ? 'check' : 'save', { label: `Roll label ${n}` }));
  game.db.prepare("DELETE FROM game_receipts WHERE request='fixture-123456789012345678-26'").run();
  saveFixture(game, 26, { type: 'attack', actorId: 'hero', targetId: 'enemy', weapon: 'Legacy bow', dice: [20], total: 24, hit: true, critical: true, damageDice: [3, 4], damageModifier: 2, damage: 9 });
  game.db.prepare("DELETE FROM game_receipts WHERE request='fixture-123456789012345678-25'").run();
  saveFixture(game, 25, receipt('check', { dice: [12, 12], keptIndex: 1, discardedDice: [12], modifiers: [{ source: `Guide ${'long source '.repeat(110)}END OF SOURCE`, value: 4 }], total: 16 }));
  game.db.prepare("DELETE FROM game_receipts WHERE request='fixture-123456789012345678-24'").run();
  saveFixture(game, 24, receipt('save', { mode: 'disadvantage', advantage: [], disadvantage: ['Poison'], dice: [5, 19], keptIndex: 0, discardedDice: [19], total: 10, success: false }));
  saveFixture(game, 27, receipt('check', { label: 'OTHER PLAYER SECRET' }), other);
  const before = structuredClone(game.load('history')), diceBefore = rollCount(), first = await ui.click('rpc:rolls');
  assert.equal(button(first, 'Newer rolls').disabled, true); assert.equal(button(first, 'Older rolls').disabled, false);
  const firstText = await collect(ui, first);
  assert.match(firstText, /20 saved rolls in this group/); assert.match(firstText, /Legacy bow/); assert.match(firstText, /Damage: 9/);
  assert.match(firstText, /Saved check/); assert.match(firstText, /Roll: 12, 12/); assert.match(firstText, /Kept die: 12/); assert.match(firstText, /Discarded dice: 12/); assert.match(firstText, /END OF SOURCE/);
  assert.match(firstText, /Saved save/); assert.match(firstText, /Disadvantage sources: Poison/); assert.match(firstText, /Kept die: 5/); assert.match(firstText, /Discarded dice: 19/); assert.match(firstText, /Result: Failure/);
  assert.doesNotMatch(firstText, /OTHER PLAYER SECRET/); assert.doesNotMatch(firstText, /undefined/);
  const old = await ui.click(button(first, 'Older rolls').custom_id), oldText = await collect(ui, old);
  assert.match(oldText, /5 saved rolls in this group/); assert.match(oldText, /revision 2/); assert.equal(button(old, 'Older rolls').disabled, true);
  assert.equal(button(old, 'Newer rolls').disabled, false);
  const newer = await ui.click(button(old, 'Newer rolls').custom_id);
  assert.equal(await collect(ui, newer), firstText);
  assert.deepEqual(game.load('history'), before); assert.equal(rollCount(), diceBefore);
});

test('text pages and cursor controls remain valid as new rolls arrive and tactical revision changes', async t => {
  const { game, command, ui } = setup(t);
  for (let n = 0; n < 15; n++) { command(scope, 'pause'); command(host, 'resume'); }
  for (let n = 2; n <= 26; n++) saveFixture(game, n, receipt('check', { label: `Original ${n}` }));
  const first = await ui.click('rpc:rolls');
  command(scope, 'pause');
  saveFixture(game, game.view(scope).revision, receipt('save', { label: 'NEW ARRIVAL' }));
  const before = structuredClone(game.load('history'));
  const next = await ui.click(button(first, 'Next page').custom_id);
  assert.match(text(next), /Original 25/); assert.doesNotMatch(text(next), /NEW ARRIVAL|tactical map changed/);
  const old = await ui.click(button(first, 'Older rolls').custom_id), back = await ui.click(button(old, 'Newer rolls').custom_id);
  assert.match(text(back), /Original 26/); assert.doesNotMatch(text(back), /NEW ARRIVAL/);
  assert.match(text(await ui.click('rpc:rolls')), /NEW ARRIVAL/);
  assert.deepEqual(game.load('history'), before);
});

test('copied or expired history controls cannot reveal another owner, campaign, guild or channel', async t => {
  const { game, command, ui } = setup(t);
  command(scope, 'attack', { targetId: 'enemy' });
  const first = await ui.click('rpc:rolls');
  // Even disabled text buttons have owner-bound records; use a separate bound
  // roll cursor so the test also exercises an enabled control's dispatch path.
  const id = game.createControl(scope, { guild: config.guildId, channel: config.channelId }, { kind: 'rolls', page: 0 });
  const copied = `rpc:${id}:page`, before = structuredClone(game.load('history'));
  const otherSession = session(game, config, other);
  assert.doesNotMatch(text(await otherSession.click('rpc:rolls')), /Saved attack/);
  for (const unauthorized of [otherSession, session(game, { ...config, guildId: '223456789012345679' }), session(game, { ...config, channelId: '323456789012345679' })]) {
    const card = await unauthorized.click(copied);
    assert.match(text(card), /unavailable to your current player/); assert.doesNotMatch(text(card), /Sword|Saved attack/);
  }
  game.createCampaign(seed('other-campaign'));
  const foreign = await session(game, { ...config, campaignId: 'other-campaign' }).click(copied);
  assert.match(text(foreign), /unavailable to your current player/); assert.doesNotMatch(text(foreign), /Sword|Saved attack/);
  game.db.prepare('UPDATE game_controls SET expires=? WHERE id=?').run(0, id);
  assert.match(text(await ui.click(copied)), /unavailable to your current player/);
  assert.deepEqual(game.load('history'), before); assert.match(text(first), /Your saved rolls/);
});
