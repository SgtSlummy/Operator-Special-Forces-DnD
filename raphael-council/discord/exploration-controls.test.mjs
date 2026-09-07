import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../game/store.mjs';
import { createAdventureHandler } from './adventure-adapter.mjs';

const owner = '123456789012345678', other = '123456789012345679', host = '123456789012345680';
const config = { campaignId: 'exploration-ui', guildId: '223456789012345678', channelId: '323456789012345678', playerIds: [owner, other, host], playerRoleId: null };
function fixture(t) {
  let sequence = 0;
  const game = new GameStore(':memory:', { rollDie: () => { throw new Error('Exploration must not roll dice.'); } });
  t.after(() => game.close());
  const actor = (id, ownedBy, x, y, initiative) => ({ id, name: id, owner: ownedBy, team: ownedBy ? 'party' : 'enemy', x, y, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 8, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: config.campaignId, title: 'Exploration fixture', members: [{ owner: host, role: 'host' }, { owner, role: 'player' }, { owner: other, role: 'player' }], map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('first', owner, 1, 1, 20), actor('second', owner, 1, 3, 15), actor('other', other, 0, 1, 10), actor('npc', null, 4, 4, 5)], effects: [] });
  // Isolated client fixture: core configure/adjudication transitions have their own tests.
  const seed = game.load(config.campaignId); seed.phase = 'exploration'; game.save(seed);
  const responses = [], edits = [], transport = { respond: async (_id, _token, p) => responses.push(p), edit: async (_app, _token, p) => edits.push(p) };
  const handle = createAdventureHandler({ game, config, transport });
  const scope = id => ({ campaign: config.campaignId, owner: id });
  const interaction = (custom_id, { type = 3, user = owner, components, channel = config.channelId } = {}) => ({ id: String(++sequence), application_id: '423456789012345678', token: 'fixture', type, guild_id: config.guildId, channel_id: channel, member: { user: { id: user }, roles: [] }, data: { custom_id, ...(components ? { components } : {}) } });
  const open = async (user = owner) => { await handle(interaction('rpg:home', { user })); return edits.at(-1); };
  return { game, handle, responses, edits, scope, interaction, open };
}
const buttons = card => card.components.filter(c => c.type === 1).flatMap(c => c.components);
function button(card, label) { const b = buttons(card).find(c => c.label === label); assert.ok(b, label); return b; }
async function movePreview(f, character = 'second', destination = 'C4') {
  const card = await f.open();
  await f.handle(f.interaction(button(card, 'Move').custom_id));
  const modal = f.responses.at(-1); assert.equal(modal.type, 9);
  assert.ok(modal.data.components.some(c => c.component?.custom_id === 'moving_actor'));
  await f.handle(f.interaction(modal.data.custom_id, { type: 5, components: [{ type: 18, component: { type: 4, custom_id: 'focus', value: destination } }, { type: 18, component: { type: 4, custom_id: 'moving_actor', value: character } }] }));
  return f.edits.at(-1);
}
test('Discord exploration card offers movement and pause without an imaginary active combat turn', async t => {
  const f = fixture(t), before = f.game.view(f.scope(owner)), card = await f.open();
  assert.equal(buttons(card).length, 10); assert.equal(button(card, 'Move').disabled, false); assert.equal(button(card, 'Pause').disabled, false);
  assert.equal(button(card, 'Attack').disabled, true); assert.equal(button(card, 'End turn').disabled, true);
  assert.match(card.components[0].content, /Exploration · movement outside initiative/);
  assert.doesNotMatch(card.components[0].content, /Another actor.*acting|Round \d|Turn \d|Movement: null/);
  assert.deepEqual(f.game.view(f.scope(owner)), before);
});
test('Discord exploration chooses a second owned actor, confirms once and preserves combat time and resources', async t => {
  const f = fixture(t), before = f.game.load(config.campaignId), card = await movePreview(f);
  assert.match(card.components[0].content, /Move second to C4/); assert.match(card.components[0].content, /No combat movement or action is spent/);
  assert.equal(f.game.view(f.scope(owner)).revision, before.revision);
  const confirm = button(card, 'Confirm action').custom_id;
  await f.handle(f.interaction(confirm));
  const after = f.game.load(config.campaignId);
  assert.equal(after.actors.find(a => a.id === 'second').x, 2); assert.equal(after.actors.find(a => a.id === 'first').x, 1);
  for (const key of ['turn', 'round', 'movementRemaining', 'actionAvailable']) assert.equal(after[key], before[key]);
  assert.doesNotMatch(f.edits.at(-1).components[0].content, /null feet remain/);
  await f.handle(f.interaction(confirm)); assert.equal(f.game.view(f.scope(owner)).revision, after.revision);
  assert.equal(f.game.receipts(f.scope(owner)).length, 1);
});
test('another player cannot choose or confirm someone else’s exploration character', async t => {
  const f = fixture(t), before = f.game.view(f.scope(owner));
  await movePreview(f, 'other');
  assert.match(f.responses.at(-1).data.components[0].content, /living character you control/);
  assert.deepEqual(f.game.view(f.scope(owner)), before);
  const card = await movePreview(f), confirm = button(card, 'Confirm action').custom_id;
  await f.handle(f.interaction(confirm, { user: other }));
  await f.handle(f.interaction(confirm, { channel: '999' }));
  assert.deepEqual(f.game.view(f.scope(owner)), before);
});
test('paused exploration disables movement; only the host resumes the same phase', async t => {
  const f = fixture(t), before = f.game.load(config.campaignId);
  let card = await f.open();
  await f.handle(f.interaction(button(card, 'Pause').custom_id));
  await f.handle(f.interaction(button(f.responses.at(-1).data, 'Confirm action').custom_id));
  card = f.edits.at(-1); assert.match(card.components[0].content, /Paused · exploration/);
  assert.equal(button(card, 'Move').disabled, true); assert.equal(button(card, 'Resume').disabled, true);
  await f.handle(f.interaction(button(card, 'Resume').custom_id)); assert.equal(f.game.view(f.scope(owner)).phase, 'paused');
  card = await f.open(host); assert.equal(button(card, 'Resume').disabled, false);
  await f.handle(f.interaction(button(card, 'Resume').custom_id, { user: host }));
  await f.handle(f.interaction(button(f.responses.at(-1).data, 'Confirm action').custom_id, { user: host }));
  const after = f.game.load(config.campaignId); assert.equal(after.phase, 'exploration');
  assert.equal(after.turn, before.turn); assert.equal(after.round, before.round);
});
test('a saved exploration movement preview becomes stale after a pause', async t => {
  const f = fixture(t), card = await movePreview(f), confirm = button(card, 'Confirm action').custom_id;
  f.game.command(f.scope(owner), { type: 'pause', actorId: 'first', requestId: 'pause-after-preview', expectedRevision: f.game.view(f.scope(owner)).revision });
  const paused = f.game.view(f.scope(owner));
  await f.handle(f.interaction(confirm));
  assert.deepEqual(f.game.view(f.scope(owner)), paused); assert.equal(paused.actors.find(a => a.id === 'second').x, 1);
});
