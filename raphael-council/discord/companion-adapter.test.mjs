import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GameStore, GameError } from '../game/store.mjs';
import { getCharacterInfo } from '../game/character-info.mjs';
import { createCompanionHandler, informationPages } from './companion-adapter.mjs';
import { board } from './adventure-adapter.mjs';
import { entryScreen, safeText } from './import-ui.mjs';

const owner = '123456789012345678', other = '123456789012345679';
const scope = { campaign: 'bridge', owner }, context = { guild: '223456789012345678', channel: '323456789012345678' };
const config = { campaignId: scope.campaign, guildId: context.guild, channelId: context.channel, playerIds: [owner, other], playerRoleId: null };
const controls = card => card.components.filter(component => component.type === 1).flatMap(row => row.components);
function button(card, label) { const found = controls(card).find(item => item.label === label); assert.ok(found, `Missing ${label}`); return found; }
function harness(t, mutate = () => {}) {
  const snapshot = { edition: '2024', fields: { name: { value: 'Maren' }, equipment: { value: '*Rope* @everyone [lantern] '.repeat(300), evidence: [{ raw: 'SECRET_PDF_PATH' }] }, currentHp: { value: 19 } }, unknown: [{ text: 'SECRET_UNREVIEWED_SOURCE' }] };
  const version = `approved-1-${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)}`;
  const actor = (id, ownedBy, x, initiative) => ({ id, name: id, owner: ownedBy, team: ownedBy ? 'party' : 'enemy', x, y: 1, size: 1, hp: 11, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: ownedBy === owner ? version : 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  const seed = { campaign: scope.campaign, title: 'Bridge', members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Bridge map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('maren', owner, 1, 20), actor('ally', other, 0, 15), actor('enemy', null, 4, 10), actor('SECRET', null, 10, 1)], effects: [] };
  mutate(seed);
  let rolls = 0, sheetReads = 0, sequence = 0;
  const game = new GameStore(':memory:', { rollDie: sides => { rolls++; return sides === 20 ? 14 : 6; } });
  t.after(() => game.close()); game.createCampaign(seed);
  const characters = { character(requested) { sheetReads++; assert.deepEqual(requested, scope); return { revision: 1, snapshot, runtime: { currentHp: 19 } }; } };
  const replies = [], callbacks = [], edits = [], logs = [];
  const transport = { respond: async (_id, _token, data) => { callbacks.push(data); if (data.type === 4) replies.push(data.data); }, edit: async (_app, _token, data) => { edits.push(data); replies.push(data); } };
  const handle = createCompanionHandler({ game, characters, config, transport, log: event => logs.push(event) });
  const interaction = (customId, extra = {}) => ({ id: String(++sequence), application_id: '423456789012345678', token: 'private-test-token', type: 3, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: owner }, roles: [] }, data: { custom_id: customId }, ...extra });
  return { game, characters, snapshot, handle, interaction, replies, callbacks, edits, logs, rolls: () => rolls, sheetReads: () => sheetReads };
}
async function chooseCharacter(h, actorId = 'maren') {
  await h.handle(h.interaction('rpc:characters'));
  const picker = controls(h.replies.at(-1)).find(control => control.type === 3);
  assert.ok(picker.options.some(option => option.value === actorId));
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: [actorId] } }));
  return picker;
}
async function collectPages(h) {
  const pages = [h.replies.at(-1)];
  for (let count = 0; count < 200; count++) {
    const next = button(pages.at(-1), 'Next page');
    if (next.disabled) return pages;
    await h.handle(h.interaction(next.custom_id)); pages.push(h.replies.at(-1));
  }
  assert.fail('Pagination did not terminate');
}
function savedState(game) {
  return ['game_campaigns', 'game_events', 'game_receipts', 'game_outbox'].map(table => game.db.prepare(`SELECT * FROM ${table}`).all());
}

test('companion is discoverable from the tactical board and adventure entry without removing play buttons', t => {
  const h = harness(t);
  const card = board(h.game, scope, context);
  for (const label of ['Move', 'Attack', 'End turn', 'Pause', 'Resume', 'Character details', 'More information']) assert.ok(button(card, label));
  assert.equal(button(card, 'Character details').custom_id, 'rpc:characters');
  assert.equal(button(entryScreen(), 'More information').custom_id, 'rpc:home');
  assert.ok(button(card, 'Mission & counsel'));
  assert.ok(controls(card).filter(control => control.type === 2).length <= 10);
});

test('shared character groups and notes are delivered privately without truncating long sheet values', async t => {
  const h = harness(t); const before = savedState(h.game);
  await chooseCharacter(h);
  const info = getCharacterInfo(h.game, h.characters, scope, { actorId: 'maren', expectedRevision: 1 });
  const expected = informationPages(info.groups, info.notes);
  const pages = await collectPages(h);
  assert.equal(pages.length, expected.length);
  for (let i = 0; i < pages.length; i++) {
    assert.equal(pages[i].flags, 32768);
    assert.deepEqual(pages[i].allowed_mentions, { parse: [] });
    assert.ok(pages[i].components[0].content.endsWith(safeText(expected[i].text)));
    assert.ok(pages[i].components[0].content.length < 3000);
  }
  const content = pages.map(page => page.components[0].content).join('\n');
  assert.match(content, /Current HP: 11/); assert.match(content, /Current HP .*source snapshot.*: 19/);
  assert.doesNotMatch(content, /SECRET_PDF_PATH|SECRET_UNREVIEWED_SOURCE/);
  assert.deepEqual(savedState(h.game), before); assert.equal(h.rolls(), 0);
  assert.ok(h.callbacks.every(callback => callback.type === 5 && callback.data.flags === 64));
});

test('all source characters, including whitespace and Markdown, survive pagination', () => {
  const groups = [{ title: 'Long details', fields: [{ label: 'Text', value: ' [x] @everyone \\ **word**\n'.repeat(800) }] }];
  assert.equal(informationPages(groups).map(page => page.text).join(''), `Text: ${groups[0].fields[0].value}`);
});

test('visible other characters reveal public shared fields and never read the requesting player’s sheet', async t => {
  const h = harness(t); await chooseCharacter(h, 'enemy');
  const pages = await collectPages(h), content = pages.map(page => page.components[0].content).join('\n');
  assert.match(content, /Name: enemy/); assert.match(content, /Position: E2/);
  assert.doesNotMatch(content, /Current HP|Armor class|Configured weapon|SECRET/);
  assert.equal(h.sheetReads(), 0);
});

test('menus and character details stay read-only during a pause and another character’s turn', async t => {
  for (const type of ['pause', 'end_turn']) {
    const h = harness(t);
    h.game.command(scope, { type, actorId: 'maren', requestId: type, expectedRevision: 1 });
    const before = savedState(h.game);
    await h.handle(h.interaction('rpc:home'));
    for (const label of ['Character details', 'Visible characters', 'Lingering effects', 'Checks & rolls', 'Saved map updates', 'Campaign journal', 'Distance & reach']) assert.ok(button(h.replies.at(-1), label));
    await chooseCharacter(h); const pages = await collectPages(h);
    const content = pages.map(page => page.components[0].content).join('\n');
    assert.match(content, type === 'pause' ? /Play is paused/ : /another character’s turn/);
    assert.deepEqual(savedState(h.game), before); assert.equal(h.rolls(), 0);
  }
});

test('copied selectors/pages and changed membership or visibility cannot expose character data', async t => {
  const h = harness(t); const picker = await chooseCharacter(h, 'ally'); const next = button(h.replies.at(-1), 'Next page');
  for (const request of [h.interaction(next.custom_id), h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: ['ally'] } })]) {
    request.member.user.id = other; await h.handle(request);
    assert.match(h.replies.at(-1).components[0].content, /unavailable/);
    assert.equal(h.replies.at(-1).flags, 32768);
    assert.deepEqual(h.callbacks.at(-1), { type: 5, data: { flags: 64 } });
  }
  h.game.command(scope, { type: 'move', actorId: 'maren', requestId: 'move-away-one', expectedRevision: 1, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
  h.game.command(scope, { type: 'move', actorId: 'maren', requestId: 'move-away-two', expectedRevision: h.game.view(scope).revision, path: [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }] });
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: ['ally'] } }));
  assert.match(h.replies.at(-1).components[0].content, /map changed/);
  await h.handle(h.interaction('rpc:characters'));
  assert.ok(!controls(h.replies.at(-1)).find(control => control.type === 3).options.some(option => option.value === 'ally'));
  h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(owner);
  await h.handle(h.interaction('rpc:home'));
  assert.match(h.replies.at(-1).components[0].content, /unavailable/);
});

test('visible actor and effect lists are complete beyond the board preview limits', async t => {
  const h = harness(t, seed => {
    seed.actors[0].vision = 32;
    for (let i = 0; i < 18; i++) seed.actors.push({ ...seed.actors[2], id: `visible-${i}`, name: `Visible ${i}`, x: i % 12, y: 4 + Math.floor(i / 12) });
    seed.effects = Array.from({ length: 12 }, (_, i) => ({ id: `effect-${i}`, name: `Effect ${i}`, trigger: 'enter', damage: 1, expiresAtTurn: 20, visible: true, cells: [{ x: i, y: 7 }] }));
  });
  await h.handle(h.interaction('rpc:actors')); const actors = (await collectPages(h)).map(page => page.components[0].content).join('\n');
  for (const actor of h.game.view(scope).actors) assert.ok(actors.includes(actor.name));
  await h.handle(h.interaction('rpc:effects')); const effects = (await collectPages(h)).map(page => page.components[0].content).join('\n');
  for (const effect of h.game.view(scope).effects) { assert.ok(effects.includes(effect.name)); assert.ok(effects.includes(`${String.fromCharCode(65 + effect.cells[0].x)}8`)); }
  await h.handle(h.interaction('rpc:characters')); const first = h.replies.at(-1);
  assert.equal(controls(first).find(control => control.type === 3).options.length, 10);
  await h.handle(h.interaction(button(first, 'Next page').custom_id));
  assert.ok(controls(h.replies.at(-1)).find(control => control.type === 3).options.some(option => option.value === 'visible-15'));
});

test('own saved rolls, historical map snapshots and journal are privately browsable without repeating actions', async t => {
  const h = harness(t);
  h.game.command(scope, { type: 'attack', actorId: 'maren', targetId: 'enemy', requestId: 'attack', expectedRevision: 1 });
  const before = savedState(h.game), dice = h.rolls();
  await h.handle(h.interaction('rpc:rolls'));
  const rolls = (await collectPages(h)).map(page => page.components[0].content).join('\n');
  assert.match(rolls, /Roll: 14/); assert.match(rolls, /Total: 19/); assert.match(rolls, /Damage: 9/);
  await h.handle(h.interaction('rpc:updates'));
  let frame = h.replies.at(-1); assert.ok(frame.files[0].data.length); assert.equal(frame.flags, 32768);
  assert.deepEqual(h.callbacks.at(-1), { type: 5, data: { flags: 64 } });
  assert.match(frame.components[0].content, /Saved revision 1/); assert.doesNotMatch(frame.components[0].content, /SECRET/);
  await h.handle(h.interaction(button(frame, 'Next revision').custom_id)); frame = h.replies.at(-1);
  assert.match(frame.components[0].content, /Saved revision 2/);
  await h.handle(h.interaction('rpc:journal')); const journal = (await collectPages(h)).map(page => page.components[0].content).join('\n');
  for (const entry of h.game.journal(scope, 0).entries) { assert.ok(journal.includes(safeText(entry.source))); for (const fact of entry.facts) assert.ok(journal.includes(safeText(fact))); }
  assert.deepEqual(savedState(h.game), before); assert.equal(h.rolls(), dice);
  await h.handle(h.interaction('rpc:rolls', { member: { user: { id: other }, roles: [] } }));
  assert.doesNotMatch(h.replies.at(-1).components[0].content, /Roll: 14/);
});

test('unexpected routes, selector values, channel and storage failures fail privately without raw errors', async t => {
  const h = harness(t); await h.handle(h.interaction('rpc:characters'));
  const picker = controls(h.replies.at(-1)).find(control => control.type === 3);
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: ['SECRET'] } }));
  assert.doesNotMatch(h.replies.at(-1).components[0].content, /Name: SECRET/);
  await h.handle(h.interaction('rpc:home', { channel_id: 'wrong-channel' })); assert.equal(h.replies.at(-1).flags & 64, 64);
  const original = h.game.view;
  for (const error of [new Error('SECRET STORAGE FILE'), new GameError('UNAUTHORIZED', 'SECRET membership')]) {
    h.game.view = () => { throw error; }; await h.handle(h.interaction('rpc:home'));
    assert.doesNotMatch(h.replies.at(-1).components[0].content, /SECRET/); assert.doesNotMatch(JSON.stringify(h.logs), /SECRET/);
  }
  h.game.view = original;
  assert.equal(await h.handle(h.interaction('rps:reach')), false);
  assert.equal(await h.handle(h.interaction('rpi:home')), false);
});

test('private acknowledgement happens before any game projection, sheet read or historical map rendering', async t => {
  const h = harness(t);
  const originalView = h.game.view.bind(h.game), originalCharacter = h.characters.character.bind(h.characters);
  let acknowledgementCount = 0;
  const assertAcknowledged = () => {
    assert.ok(h.callbacks.length > acknowledgementCount, 'this interaction must already be acknowledged');
    assert.deepEqual(h.callbacks.at(-1), { type: 5, data: { flags: 64 } });
  };
  h.game.view = requested => { assertAcknowledged(); return originalView(requested); };
  h.characters.character = requested => { assertAcknowledged(); return originalCharacter(requested); };
  await h.handle(h.interaction('rpc:characters'));
  const picker = controls(h.replies.at(-1)).find(control => control.type === 3);
  acknowledgementCount = h.callbacks.length;
  await h.handle(h.interaction(picker.custom_id, { data: { custom_id: picker.custom_id, values: ['maren'] } }));
  assert.ok(h.sheetReads() > 0);
  acknowledgementCount = h.callbacks.length;
  await h.handle(h.interaction('rpc:updates'));
  assert.ok(h.replies.at(-1).files[0].data.length);
  assert.ok(h.replies.every(reply => reply.flags === 32768));
});
