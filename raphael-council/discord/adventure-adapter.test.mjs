import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createAdventureHandler } from './adventure-adapter.mjs';
import { BoardDelivery } from './board-delivery.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const owner = '123456789012345678', other = '123456789012345679';
const config = { campaignId: 'bridge', guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [owner, other], playerRoleId: null };
const scope = { campaign: 'bridge', owner };
function harness({ file = ':memory:', deliveryOptions } = {}) {
  let dice = 0, sequence = 0;
  const game = new GameStore(file, { rollDie: sides => { dice++; return sides === 20 ? 14 : 6; } });
  const actor = (id, ownedBy, x, initiative) => ({ id, name: id, owner: ownedBy, team: ownedBy ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: 'bridge', title: 'Bridge', members: [{ owner: 'host', role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('maren', owner, 1, 20), actor('ally', other, 0, 15), actor('enemy', null, 4, 10), actor('SECRET', null, 10, 1)], effects: [] });
  const responses = [], edits = [];
  const transport = { respond: async (_id, _token, payload) => responses.push(payload), edit: async (_app, _token, payload) => edits.push(payload) };
  const delivery = deliveryOptions ? new BoardDelivery({ game, transport, ...deliveryOptions }) : undefined;
  const handle = createAdventureHandler({ game, config, transport, delivery });
  const interaction = (customId, type = 3, extra = {}) => ({ id: String(++sequence), application_id: '423456789012345678', token: 'fixture', type, guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: owner }, roles: [] }, data: { custom_id: customId }, ...extra });
  return { game, handle, responses, edits, interaction, transport, delivery, dice: () => dice };
}
const hostSecret = 'fixture-host-secret-never-a-real-discord-token';
const move = game => game.command(scope, { type: 'move', actorId: 'maren', requestId: `move-${game.view(scope).revision}`, expectedRevision: game.view(scope).revision, path: [{ x: 2, y: 1 }] });

test('private map updates persist encrypted response credentials and retry after restart without repeating play', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-discord-map-')), 'game.sqlite');
  let time = 1000;
  const options = { secret: hostSecret, now: () => time, authorize: async () => true };
  const h = harness({ file, deliveryOptions: options });
  let restored;
  try {
    await h.handle(h.interaction('rpg:home'));
    const saved = h.game.db.prepare('SELECT * FROM game_board_delivery').get();
    assert.ok(!saved.credential.includes('fixture')); assert.equal(saved.revision, 1);
    const action = move(h.game); const state = h.game.view(scope);
    h.transport.edit = async () => { throw new Error('Ambiguous network delivery'); };
    await h.delivery.tick();
    assert.equal(h.game.db.prepare('SELECT revision FROM game_board_delivery').get().revision, 1);
    assert.deepEqual(h.game.view(scope), state);
    h.game.close(); restored = new GameStore(file);
    time += 3000;
    const sent = [];
    const worker = new BoardDelivery({ game: restored, ...options, transport: { edit: async (app, token, payload) => sent.push({ app, token, payload }) } });
    await worker.tick();
    assert.equal(sent.length, 1); assert.equal(sent[0].token, 'fixture'); assert.equal(sent[0].payload.flags, 32768);
    assert.ok(!JSON.stringify(sent[0].payload.components).includes('SECRET'));
    assert.equal(restored.db.prepare('SELECT revision FROM game_board_delivery').get().revision, action.revision);
    assert.equal(restored.receipts(scope).length, 1); assert.deepEqual(restored.view(scope), state);
    await worker.tick(); assert.equal(sent.length, 1);
  } finally { restored?.close(); h.game.close(); }
});

test('automatic updates stop on lost membership, expiry or replacement by a newer private card', async () => {
  let allowed = true, time = 1000;
  const h = harness({ deliveryOptions: { secret: hostSecret, now: () => time, authorize: async () => allowed } });
  try {
    await h.handle(h.interaction('rpg:home')); move(h.game); allowed = false;
    await h.delivery.tick(); assert.equal(h.edits.length, 1);
    assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_board_delivery').get().n, 0);
    allowed = true; await h.handle(h.interaction('rpg:home'));
    time += 14 * 60000; await h.delivery.tick();
    assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_board_delivery').get().n, 0);
    await h.handle(h.interaction('rpg:home'));
    h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(owner);
    h.game.db.prepare('UPDATE game_board_delivery SET revision=0').run();
    const count = h.edits.length; await h.delivery.tick(); assert.equal(h.edits.length, count);
    assert.equal(h.game.db.prepare('SELECT COUNT(*) AS n FROM game_board_delivery').get().n, 0);
  } finally { h.game.close(); }
});

test('concurrent workers claim one response and a replaced watch cannot send late', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const options = { secret: hostSecret, authorize: async () => { await gate; return true; } };
  const h = harness({ deliveryOptions: options });
  try {
    await h.handle(h.interaction('rpg:home')); move(h.game);
    const task = h.delivery.tick();
    const second = new BoardDelivery({ game: h.game, transport: h.transport, ...options });
    await second.tick(); assert.equal(h.edits.length, 1);
    await h.handle(h.interaction('rpg:home')); // Replaces the watch while old authorization is in flight.
    release(); await task;
    assert.equal(h.edits.length, 2);
    assert.equal(h.game.db.prepare('SELECT revision FROM game_board_delivery').get().revision, h.game.view(scope).revision);
  } finally { release(); h.game.close(); }
});

test('another player receives movement on their own private board without owner statistics', async () => {
  const h = harness({ deliveryOptions: { secret: hostSecret, authorize: async () => true } });
  try {
    await h.handle(h.interaction('rpg:home', 3, { token: 'other-private-response', member: { user: { id: other }, roles: [] } }));
    const deliveries = [];
    h.transport.edit = async (_app, token, payload) => deliveries.push({ token, payload });
    move(h.game); await h.delivery.tick();
    assert.equal(deliveries.length, 1); assert.equal(deliveries[0].token, 'other-private-response');
    const text = deliveries[0].payload.components[0].content;
    assert.match(text, /maren \[maren\] · C2/);
    assert.doesNotMatch(text, /maren \[maren\] · C2 · HP/);
    assert.doesNotMatch(text, /SECRET/);
    assert.equal(h.game.receipts(scope).length, 1);
  } finally { h.game.close(); }
});
function button(card, label) {
  const found = card.components.filter(c => c.type === 1).flatMap(c => c.components).find(c => c.label === label);
  assert.ok(found, label); return found.custom_id;
}
async function proposal(h, kind, text) {
  await h.handle(h.interaction('rpg:home'));
  await h.handle(h.interaction(button(h.edits.at(-1), kind)));
  const modal = h.responses.at(-1); assert.equal(modal.type, 9);
  await h.handle(h.interaction(modal.data.custom_id, 5, { data: { custom_id: modal.data.custom_id, components: [{ type: 18, component: { type: 4, custom_id: 'focus', value: text } }] } }));
  return button(h.edits.at(-1), 'Confirm action');
}
test('private board is available without mutation and hides unseen actors', async () => {
  const h = harness();
  try { await h.handle(h.interaction('rpg:home')); assert.equal(h.responses[0].type, 5); assert.equal(h.responses[0].data.flags, 64); assert.ok(h.edits[0].files[0].data.length); assert.ok(!h.edits[0].components[0].content.includes('SECRET')); assert.ok(h.edits[0].components.flatMap(row => row.components || []).some(button => button.custom_id === `campaign:open:${scope.campaign}`)); assert.equal(h.game.view(scope).revision, 1); }
  finally { h.game.close(); }
});
test('movement modal previews before committing and repeated confirmation moves once', async () => {
  const h = harness();
  try { const confirm = await proposal(h, 'Move', 'C2'); assert.equal(h.game.view(scope).revision, 1); await h.handle(h.interaction(confirm)); const revision = h.game.view(scope).revision; assert.equal(h.game.view(scope).actors.find(a => a.id === 'maren').x, 2); await h.handle(h.interaction(confirm)); assert.equal(h.game.view(scope).revision, revision); assert.equal(h.game.receipts(scope).length, 1); }
  finally { h.game.close(); }
});
test('attack confirmation reuses the saved roll and delivery displays its breakdown', async () => {
  const h = harness();
  try { const confirm = await proposal(h, 'Attack', 'enemy'); assert.equal(h.dice(), 0); await h.handle(h.interaction(confirm)); assert.equal(h.dice(), 2); assert.match(h.edits.at(-1).components[0].content, /19/); await h.handle(h.interaction(confirm)); assert.equal(h.dice(), 2); assert.equal(h.game.receipts(scope)[0].result.damage, 9); }
  finally { h.game.close(); }
});
test('another member cannot submit or confirm stolen controls', async () => {
  const h = harness();
  try { const confirm = await proposal(h, 'Attack', 'enemy'); await h.handle(h.interaction(confirm, 3, { member: { user: { id: other }, roles: [] } })); assert.equal(h.dice(), 0); assert.equal(h.game.view(scope).revision, 1); }
  finally { h.game.close(); }
});
test('membership, channel and stale revisions are enforced server-side', async () => {
  const h = harness();
  try { const confirm = await proposal(h, 'Attack', 'enemy'); await h.handle(h.interaction(confirm, 3, { channel_id: '999' })); assert.equal(h.dice(), 0); h.game.command(scope, { type: 'end_turn', actorId: 'maren', requestId: 'browser-action', expectedRevision: 1 }); await h.handle(h.interaction(confirm)); assert.equal(h.dice(), 0); h.game.db.prepare('DELETE FROM game_members WHERE owner=?').run(owner); await h.handle(h.interaction('rpg:home')); assert.equal(h.responses.at(-1).type, 4); }
  finally { h.game.close(); }
});
