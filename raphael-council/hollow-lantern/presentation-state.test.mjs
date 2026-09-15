import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPresentationState } from './presentation-state.mjs';
const scope = { campaignId: 'test-hollow', guildId: '1463393482306486387', channelId: '1546676505780944979', applicationId: '1540006061099188274' };
const id = '1548888888888888888';
async function fixture(t) { const root = await mkdtemp(join(tmpdir(), 'hollow-presentation-')); t.after(() => rm(root, { recursive: true, force: true })); return { ...scope, file: join(root, 'state.json') }; }
test('confirmed IDs survive restart and are verified against fetched Discord records', async t => {
 const options = await fixture(t), state = await createPresentationState(options);
 const operationId = await state.beginSend('command');
 await state.completeSend('command', { operationId, id });
 const reopened = await createPresentationState(options);
 assert.equal(reopened.read().registeredCommandId, id);
 const record = { id, application_id: scope.applicationId, guild_id: scope.guildId, name: 'hollow-lantern', type: 1 };
 assert.deepEqual(await reopened.verifyExisting('command', async () => record), record);
 await assert.rejects(reopened.beginSend('command'), { code: 'PRESENTATION_ALREADY_REGISTERED' });
});
test('ambiguous delivery survives restart and only verified recovery clears it', async t => {
 const options = await fixture(t), state = await createPresentationState(options);
 await state.beginSend('lobby');
 const reopened = await createPresentationState(options);
 await assert.rejects(reopened.beginSend('lobby'), { code: 'PRESENTATION_DELIVERY_UNCERTAIN' });
 await assert.rejects(reopened.recover('lobby', { id, verify: async () => true }), { code: 'PRESENTATION_OWNER_MISMATCH' });
 await assert.rejects(reopened.recover('lobby', { id, verify: async () => ({ id, channel_id: scope.channelId, author: { id: '1540006061099188000' } }) }), { code: 'PRESENTATION_OWNER_MISMATCH' });
 assert.ok(reopened.read().pending.lobby);
 await reopened.recover('lobby', { id, verify: async () => ({ id, channel_id: scope.channelId, author: { id: scope.applicationId } }) });
 assert.equal(reopened.read().lobbyMessageId, id); assert.deepEqual(reopened.read().pending, {});
});
test('wrong campaign, corrupt state, copied operation and concurrent sends fail closed', async t => {
 const options = await fixture(t), state = await createPresentationState(options);
 const results = await Promise.allSettled([state.beginSend('lobby'), state.beginSend('lobby')]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 await assert.rejects(state.completeSend('lobby', { operationId: 'copied', id }), { code: 'PRESENTATION_OPERATION_MISMATCH' });
 await assert.rejects(createPresentationState({ ...options, campaignId: 'foreign' }), { code: 'PRESENTATION_SCOPE_MISMATCH' });
 const before = await readFile(options.file, 'utf8'); assert.ok(JSON.parse(before).pending.lobby);
 await writeFile(options.file, '{broken'); await assert.rejects(createPresentationState(options), SyntaxError);
 assert.equal(await readFile(options.file, 'utf8'), '{broken');
});
test('recovery rejects foreign command, channel and webhook messages', async t => {
 const state = await createPresentationState(await fixture(t));
 await assert.rejects(state.recover('command', { id, verify: async () => ({ id, application_id: scope.applicationId, guild_id: scope.guildId, name: 'music', type: 1 }) }), { code: 'PRESENTATION_OWNER_MISMATCH' });
 for (const record of [{ id, channel_id: '1548888888888888000', author: { id: scope.applicationId } }, { id, channel_id: scope.channelId, author: { id: scope.applicationId }, webhook_id: id }]) {
  await assert.rejects(state.recover('lobby', { id, verify: async () => record }), { code: 'PRESENTATION_OWNER_MISMATCH' });
 }
 assert.equal(state.read().lobbyMessageId, null);
});
