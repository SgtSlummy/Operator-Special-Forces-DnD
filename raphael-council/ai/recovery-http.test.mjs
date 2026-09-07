import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { GameAi } from './service.mjs';
import { createGameHttp } from '../game/http.mjs';

// Real AI receipts and HTTP boundaries, with a deterministic authorized game
// projection. Tactical transitions themselves are covered by game tests.
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const scopes = new Map([
    ['player', { campaign: 'recovery-table', owner: 'player-one' }],
    ['other', { campaign: 'recovery-table', owner: 'player-two' }],
    ['foreign', { campaign: 'other-table', owner: 'player-one' }],
  ]);
  const members = new Set([...scopes.values()].map(s => JSON.stringify(s)));
  let revision = 8, calls = 0, available = true;
  const transport = {
    async capabilities() { if (!available) throw new Error('Test transport offline.'); return { route_ready: true, remote_routes: false }; },
    async runtimeState(scope, session) {
      if (!available) throw new Error('Test transport offline.');
      assert.ok(['recovery-table', 'other-table'].includes(scope.campaign)); assert.equal(typeof session, 'string');
      return { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true,
        bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
        sessionPolicyRevision: 1, leaseExpiresAtMs: Date.now() + 30000,
        effectivePolicy: { enabled: true, mode: 'local', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false },
        queuedCount: 0, dispatchedCount: 0 };
    },
    async generate({ scope, evidence, policy }) {
      assert.equal(policy.mode, 'local'); assert.equal(policy.codex, false); assert.equal(policy.exportable, false);
      calls += 1;
      return { text: `Saved answer for ${scope.owner} at ${evidence.sourceRevision}.`, sources: [{ ref: 'visible-map', revision: evidence.sourceRevision }], model: 'test-fixture' };
    },
  };
  const game = {
    member(scope) { if (!members.has(JSON.stringify({ campaign: scope.campaign, owner: scope.owner }))) throw new Error('Membership revoked.'); return 'player'; },
    view(scope) { this.member(scope); return { campaign: scope.campaign, revision, actors: [{ id: 'hero', controlled: true }] }; },
    world(scope) { this.member(scope); return { configured: false }; },
  };
  const ai = new GameAi({ db, transport, authorize: scope => game.member(scope) });
  const http = createGameHttp(async () => ({ game, ai, auth: { async authenticate(request) { return scopes.get(request.headers.get('authorization')); } }, access: { async authenticateAccess() { return null; } } }));
  const request = (who = 'player', body, search = '') => new Request(`http://localhost/api/game/ai${search}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: who, origin: 'http://localhost', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ai, http, request, scopes, members, calls: () => calls, advance: () => { revision += 1; }, offline: () => { available = false; } };
}

const ask = (requestId = 'scene-answer') => ({ requestId, expectedRevision: 8, task: 'narration', query: 'Describe what I can see.' });

test('completed AI reply is recoverable in full after revision advances, without another generation', async t => {
  const f = fixture(t), input = ask();
  const first = await f.http.aiAsk(f.request('player', input));
  assert.equal(first.status, 200);
  const saved = (await first.json()).result;
  assert.equal(saved.sourceRevision, 8);
  assert.equal(f.calls(), 1);
  f.advance();
  const retry = await f.http.aiAsk(f.request('player', input));
  assert.equal(retry.status, 409);
  const staleNew = await f.http.aiAsk(f.request('player', ask('new-stale-request')));
  assert.equal(staleNew.status, 409);
  f.offline();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await f.http.aiStatus(f.request());
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.ready, false);
    assert.deepEqual(state.jobs, [saved]);
    assert.deepEqual(state.jobs[0].sources, [{ ref: 'visible-map', revision: 8 }]);
  }
  assert.equal(f.calls(), 1, 'history retrieval and stale submissions never generate again');
});

test('reusing a saved request ID with changed content cannot replace the stored reply', async t => {
  const f = fixture(t);
  const response = await f.http.aiAsk(f.request('player', ask()));
  const saved = (await response.json()).result;
  const conflict = await f.http.aiAsk(f.request('player', { ...ask(), query: 'A different question.' }));
  assert.notEqual(conflict.status, 200);
  assert.deepEqual((await (await f.http.aiStatus(f.request())).json()).jobs, [saved]);
  assert.equal(f.calls(), 1);
});

test('saved responses remain private to the authenticated owner and campaign', async t => {
  const f = fixture(t);
  await f.http.aiAsk(f.request('player', ask()));
  for (const who of ['other', 'foreign']) {
    const response = await f.http.aiStatus(f.request(who, undefined, '?owner=player-one&campaign=recovery-table'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).jobs, []);
  }
  f.scopes.delete('player');
  const revoked = await f.http.aiStatus(f.request());
  assert.equal(revoked.status, 401);
  assert.doesNotMatch(await revoked.text(), /Saved answer|visible-map/);
  assert.equal(f.calls(), 1);
});

test('membership is rechecked before saved AI records are returned', async t => {
  const f = fixture(t);
  await f.http.aiAsk(f.request('player', ask()));
  f.members.delete(JSON.stringify(f.scopes.get('player')));
  const revoked = await f.http.aiStatus(f.request());
  assert.ok(revoked.status >= 400);
  assert.doesNotMatch(await revoked.text(), /Saved answer|visible-map/);
  assert.equal(f.calls(), 1);
});

test('authenticated history retains the latest 20 full responses, including results older than five', async t => {
  const f = fixture(t);
  for (let index = 0; index < 21; index += 1) {
    const response = await f.http.aiAsk(f.request('player', ask(`answer-${index}`)));
    assert.equal(response.status, 200);
  }
  const state = await (await f.http.aiStatus(f.request())).json();
  assert.equal(state.jobs.length, 20);
  assert.equal(state.jobs[0].requestId, 'answer-20');
  assert.equal(state.jobs[19].requestId, 'answer-1');
  assert.ok(state.jobs.every(job => job.text === 'Saved answer for player-one at 8.' && job.sourceRevision === 8 && job.sources[0].ref === 'visible-map'));
  assert.equal(f.calls(), 21);
});
