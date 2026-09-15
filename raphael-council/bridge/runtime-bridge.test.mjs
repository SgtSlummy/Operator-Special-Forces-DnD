import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeBridge, filterRuntimeProjection, signBridgeBody, verifyBridgeSignature, RuntimeBridgeError, RPG_CORE_BRIDGE_CONTRACT } from './runtime-bridge.mjs';

const SECRET = 'bridge-secret-that-is-long-enough-for-tests-123456';
const ENV = { RAPHAEL_GAME_BRIDGE_SECRET: SECRET, DISCORD_TOKEN: 'different-secret' };
const projection = { campaignId: 'camp', revision: 7, currentSceneId: 'shore', phase: 'combat', round: 2, activeActorId: 'hero', characters: [{ characterId: 'hero', ownerId: 'alice', displayName: 'Hero', genderId: 'hidden', primaryHealth: 8, primaryHealthMaximum: 10, secondaryHealth: 3, secondaryHealthMaximum: 3, position: { x: 1, y: 2 }, passiveAbilityIds: ['darkvision'], skillRanks: { stealth: 2 }, actionBarBindings: { 1: 'strike' }, equipmentBonuses: { armor: 1 }, currency: 5 }], map: { id: 'shore', width: 25, height: 25, cells: [{ x: 1, y: 2, terrain: 'grass' }] } };

test('bridge signatures verify and expire', () => {
  const body = { commandId: 'one', expectedRevision: 4 };
  const signature = signBridgeBody(body, SECRET, 1000);
  assert.equal(verifyBridgeSignature(body, SECRET, 1000, signature, 1000), true);
  assert.equal(verifyBridgeSignature(body, SECRET, 1000, signature, 40001), false);
});

test('public projection omits private character state', () => {
  const publicView = filterRuntimeProjection(projection, 'public');
  assert.equal(publicView.characters[0].ownerId, undefined);
  assert.equal(publicView.characters[0].genderId, undefined);
  assert.equal(publicView.characters[0].passiveAbilityIds, undefined);
  assert.deepEqual(filterRuntimeProjection(projection, 'private').characters[0].passiveAbilityIds, ['darkvision']);
});

test('bridge sends authenticated typed commands and validates receipts', async () => {
  const calls = [];
  const bridge = createRuntimeBridge({ baseUrl: 'http://127.0.0.1:4000', campaignId: 'camp', channelId: 'channel', env: ENV, now: () => 1000, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    assert.equal(body.contract, RPG_CORE_BRIDGE_CONTRACT);
    assert.equal(body.ownerId, 'alice');
    assert.equal(body.expectedRevision, 7);
    assert.equal(options.headers['x-rpg-core-signature'], signBridgeBody(body, SECRET, 1000));
    return Response.json({ contract: RPG_CORE_BRIDGE_CONTRACT, campaignId: 'camp', commandId: 'cmd-1', revision: 8, success: true });
  } });
  const result = await bridge.command({ commandId: 'cmd-1', ownerId: 'alice', actorId: 'hero', expectedRevision: 7, type: 'attack', payload: { targetId: 'guard' } });
  assert.equal(result.revision, 8);
  assert.equal(calls[0].url, 'http://127.0.0.1:4000/api/rpg/command');
});

test('bridge refuses a Discord token as its runtime secret', () => {
  assert.throws(() => createRuntimeBridge({ baseUrl: 'http://localhost', campaignId: 'camp', channelId: 'channel', env: { RAPHAEL_GAME_BRIDGE_SECRET: 'x'.repeat(40), DISCORD_TOKEN: 'x'.repeat(40) }, fetchImpl: async () => Response.json({}) }), error => error instanceof RuntimeBridgeError && error.code === 'BRIDGE_SECRET_REUSED');
});
