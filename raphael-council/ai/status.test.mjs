import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GameAi } from './service.mjs';

const scope = { campaign: 'status-fixture', owner: 'current-player', role: 'player' };
const authorize = async candidate => candidate?.campaign === scope.campaign && candidate?.owner === scope.owner ? 'player' : null;
const runtimeState = async candidate => {
  assert.equal(candidate.campaign, scope.campaign);
  return { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true,
    bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
    sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 30000,
    effectivePolicy: { enabled: true, mode: 'local-free', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false },
    queuedCount: 0, dispatchedCount: 0 };
};

test('Obus free fallback support never masquerades as a ready external provider', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const ai = new GameAi({ db, authorize, transport: { runtimeState, capabilities: async () => ({ route_ready: true, verified_free_route_fallback: true, generic_remote_routes: false, remote_routes: true }) } });
    const status = await ai.status(scope);
    assert.equal(status.router, 'obus');
    assert.equal(status.ready, true);
    assert.equal(status.freeFallbackSupported, true);
    assert.equal(status.genericRemoteRoutes, false);
    assert.equal(status.remoteAvailable, false);
    assert.equal(status.remoteReadiness, 'unknown');
  } finally { db.close(); }
});

test('Obus endpoint outage reports unavailable without probing any other provider', async () => {
  const db = new DatabaseSync(':memory:'); let calls = 0;
  try {
    const ai = new GameAi({ db, authorize, transport: { runtimeState, capabilities: async () => { calls++; throw new Error('offline'); } } });
    const status = await ai.status(scope);
    assert.equal(status.ready, false); assert.equal(status.remoteAvailable, false); assert.equal(calls, 1);
  } finally { db.close(); }
});
