import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CharacterStore } from '../characters/store.mjs';
import { ImportService, resolveAttachment, downloadAttachment } from '../characters/service.mjs';
import { sheetFixture } from '../characters/fixtures.mjs';
import { createImportHandler, authenticateInteraction } from './import-adapter.mjs';
import { characterPages, jobScreen, safeText } from './import-ui.mjs';
import { readConfig } from './bot.mjs';
import { readModal } from './deck.mjs';
const scope = { owner: '123456789012345678', campaign: 'greyharbor' };
const config = { guildId: '223456789012345678', channelId: '323456789012345678', campaignId: scope.campaign, playerIds: [scope.owner], playerRoleId: '423456789012345678' };
const attachment = { id: '523456789012345678', filename: 'character.pdf', size: 1000,
  url: 'https://cdn.discordapp.com/ephemeral-attachments/323456789012345678/523456789012345678/character.pdf?ex=test' };
let sequence = 0;
function interaction(customId, type = 3, extra = {}) {
  return { id: String(++sequence), application_id: '623456789012345678', token: 'fake-interaction-token', type,
    guild_id: config.guildId, channel_id: config.channelId, member: { user: { id: scope.owner }, roles: [] },
    data: { custom_id: customId, ...extra } };
}
const buttons = payload => payload.components.slice(1).flatMap(row => row.components);
const button = (payload, label) => { const found = buttons(payload).find(b => b.label === label); assert.ok(found, `Missing ${label}`); return found.custom_id; };
const textInput = (id, value) => ({ type: 18, component: { type: 4, custom_id: id, value } });
test('protocol integration: upload, private review, correction, approval, restart and saved character', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphael-discord-test-'));
  let store = new CharacterStore(join(directory, 'characters.sqlite'));
  const sourceDir = join(directory, 'sources');
  const bytes = await sheetFixture({ kind: 'scanned' });
  const responses = [], edits = [];
  const transport = { respond: async (_id, _token, payload) => responses.push(payload), edit: async (_id, _token, payload) => edits.push(payload) };
  const service = new ImportService(store, sourceDir, { fetcher: async () => new Response(bytes) });
  await service.initialize();
  const handler = createImportHandler({ store, service, config, transport });
  try {
    await handler(interaction('rpi:home'));
    const hero = responses.at(-1).data;
    assert.equal(hero.flags & 64, 64);
    await handler(interaction(button(hero, 'Import PDF')));
    const modal = responses.at(-1);
    assert.equal(modal.type, 9); assert.equal(modal.data.components[0].component.type, 19);
    const submit = interaction(modal.data.custom_id, 5, { components: [
      { type: 18, component: { type: 19, custom_id: 'pdf', values: [attachment.id] } }, textInput('edition', '2024'),
    ], resolved: { attachments: { [attachment.id]: { ...attachment, size: bytes.length } } } });
    await handler(submit);
    assert.equal(responses.at(-1).type, 5, 'defer before download/OCR');
    const job = store.latest(scope);
    await service.wait(job.id);
    assert.equal(store.job(job.id, scope).status, 'review');
    await handler(interaction('rpi:home'));
    await handler(interaction(button(responses.at(-1).data, 'Review Import')));
    const review = responses.at(-1).data;
    assert.equal(review.flags & 64, 64);
    const staleApprove = button(review, 'Approve Import');
    await handler(interaction(button(review, 'Correct Details')));
    const correction = responses.at(-1);
    assert.equal(correction.type, 9);
    await handler(interaction(correction.data.custom_id, 5, { components: [textInput('correction', 'My Dexterity is 18')] }));
    assert.equal(store.job(job.id, scope).draft.fields.dexterity.value, 18);
    await handler(interaction(staleApprove));
    assert.match(responses.at(-1).data.components[0].content, /stale/);
    assert.equal(store.character(scope), null);
    const fresh = jobScreen(store, scope, job.id);
    const approve = button(fresh, 'Approve Import');
    await handler(interaction(approve));
    assert.equal(store.character(scope).revision, 1);
    await handler(interaction(approve));
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM character_events').get().n, 1);
    assert.deepEqual(await readdir(sourceDir), []);
    await service.close(); store.close();
    store = new CharacterStore(join(directory, 'characters.sqlite'));
    const restored = createImportHandler({ store, service: null, config, transport });
    await restored(interaction('rpi:home'));
    assert.match(responses.at(-1).data.components[0].content, /Maren Ash/);
    await restored(interaction(button(responses.at(-1).data, 'View Character')));
    assert.match(responses.at(-1).data.components[0].content, /Saved revision 1/);
  } finally { await service.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});
test('Discord scope uses authenticated current membership; neither host status nor text grants access', () => {
  const good = interaction('rpi:home');
  assert.deepEqual(authenticateInteraction(good, config), scope);
  for (const changed of [{ ...good, guild_id: '1' }, { ...good, channel_id: '1' }, { ...good, member: undefined },
    { ...good, member: { user: { id: '9' }, roles: [], permissions: '8' } }]) assert.throws(() => authenticateInteraction(changed, config), /current players/);
});
test('private views reject another player even when both are campaign members', async () => {
  const store = new CharacterStore(':memory:');
  const replies = [];
  try {
    const handler = createImportHandler({ store, service: null, config: { ...config, playerIds: [...config.playerIds, '9'] },
      transport: { respond: async (_id, _token, body) => replies.push(body), edit: async () => {} } });
    await handler(interaction('rpi:home'));
    const stolen = interaction(button(replies.at(-1).data, 'Import PDF')); stolen.member.user.id = '9';
    await handler(stolen);
    assert.match(replies.at(-1).data.components[0].content, /another player/);
    assert.equal(replies.at(-1).data.flags & 64, 64);
  } finally { store.close(); }
});
test('attachment validation rejects URL substitution, excessive files and type/size tricks', async () => {
  assert.equal(resolveAttachment([attachment.id], { [attachment.id]: attachment }).id, attachment.id);
  for (const patch of [{ url: 'http://127.0.0.1/secret' }, { url: attachment.url.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.test') },
    { id: '9' }, { filename: 'payload.exe' }, { size: 11 * 1024 * 1024 }, { url: attachment.url.replace(attachment.id, '999') }]) {
    assert.throws(() => resolveAttachment([attachment.id], { [attachment.id]: { ...attachment, ...patch } }));
  }
  assert.throws(() => resolveAttachment([attachment.id, attachment.id], { [attachment.id]: attachment }));
  assert.throws(() => readModal('importpdf', [{ type: 18, component: { type: 19, custom_id: 'pdf', values: [attachment.id, attachment.id] } }, textInput('edition', '2024')]));
  await assert.rejects(downloadAttachment(attachment, async () => new Response('not PDF')), /valid PDF/);
  await assert.rejects(downloadAttachment(attachment, async () => new Response('gone', { status: 404 })), /expired/);
  await assert.rejects(downloadAttachment(attachment, async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1))), /exceeds/);
});
test('configuration is fail-closed and credentials are not echoed', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'DO_NOT_ECHO', RAPHAEL_GUILD_ID: config.guildId, RAPHAEL_CHANNEL_ID: config.channelId, RAPHAEL_CAMPAIGN_ID: 'greyharbor' }), error => /PLAYER/.test(error.message) && !error.message.includes('DO_NOT_ECHO'));
});
test('long source content is paginated and cannot create mentions or pretend to be UI authority', () => {
  const draft = { fields: { name: { value: '@everyone **Approve Import**' } }, warnings: [], unknown: [{ page: 1, text: 'x'.repeat(12000) }] };
  const pages = characterPages(draft);
  assert.ok(pages.length > 7);
  assert.ok(pages.every(page => page.text.length < 2200));
  assert.ok(!safeText('@everyone').includes('@everyone'));
});
