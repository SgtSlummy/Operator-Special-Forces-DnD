import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { ChronicleCommands } from './commands.mjs';

const host = { campaign: 'campaign-a', owner: 'host-a', role: 'host' };
const player = { campaign: 'campaign-a', owner: 'player-b', role: 'player' };
const input = (requestId, extra = {}) => ({ requestId, sessionId: 'session-a', expectedRevision: 7, type: 'voice-join', channel: 'voice-a', ...extra });
const rejects = (code, status) => error => error.code === code && error.status === status;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-commands-'));
  const path = join(directory, 'chronicle.sqlite');
  const stores = new Set(); let at = 1000;
  const connect = () => { const store = new ChronicleStore(path); stores.add(store); return { store, queue: new ChronicleCommands(store, { now: () => at, leaseMs: 100 }) }; };
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { connect, advance: value => { at += value; }, close: store => { store.close(); stores.delete(store); } };
}

test('durable duplicate receipts cover all input and trusted scope, independently of key order', t => {
  const f = fixture(t), { queue } = f.connect();
  const first = queue.enqueue(host, input('replay'));
  assert.equal(first.status, 'queued');
  assert.deepEqual(queue.enqueue({ role: 'host', owner: 'host-a', campaign: 'campaign-a' }, {
    channel: 'voice-a', type: 'voice-join', expectedRevision: 7, sessionId: 'session-a', requestId: 'replay',
  }), first);
  assert.throws(() => queue.enqueue(host, input('replay', { expectedRevision: 8 })), rejects('REQUEST_CONFLICT', 409));
  assert.throws(() => queue.enqueue(player, input('replay')), rejects('REQUEST_CONFLICT', 409));
  assert.throws(() => queue.enqueue({ ...host, role: 'player' }, input('replay')), rejects('REQUEST_CONFLICT', 409));
  assert.throws(() => queue.enqueue(host, input('replay', { channel: 'voice-b' })), rejects('REQUEST_CONFLICT', 409));
  const claim = queue.claim('worker-a', { campaign: host.campaign });
  const done = queue.complete(claim, { result: { connected: true } });
  assert.equal(done.status, 'done');
  assert.deepEqual(queue.enqueue(host, input('replay')), done);
  assert.equal(queue.list(host).length, 1);
});

test('two database connections claim distinct work and only persisted trusted fields reach workers', t => {
  const f = fixture(t), a = f.connect(), b = f.connect();
  a.queue.enqueue(host, input('a'));
  b.queue.enqueue(player, input('b'));
  const first = a.queue.claim('worker-a', { campaign: host.campaign });
  const second = b.queue.claim('worker-b', { campaign: host.campaign });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.scope, host); assert.deepEqual(first.input, input('a'));
  assert.deepEqual(second.scope, player); assert.deepEqual(second.input, input('b'));
  assert.equal(first.attempts, 1); assert.equal(second.attempts, 1);
  assert.equal(b.queue.claim('worker-b', { campaign: host.campaign }), null);
  assert.equal(a.queue.claim('worker-c', { campaign: 'another-campaign' }), null);
  assert.equal(a.queue.list(host).length, 1); assert.equal(a.queue.list(player).length, 1);
  assert.deepEqual(a.queue.list({ ...host, campaign: 'another-campaign' }), []);
  assert.equal('scope' in a.queue.list(host)[0], false);
  assert.equal('input' in a.queue.list(host)[0], false);
  assert.equal('leaseToken' in a.queue.list(host)[0], false);
});

test('restart preserves queued work and reclaims an expired lease with a new token', t => {
  const f = fixture(t), a = f.connect();
  a.queue.enqueue(host, input('restart'));
  const abandoned = a.queue.claim('old-process', { campaign: host.campaign });
  f.close(a.store);
  const b = f.connect();
  assert.equal(b.queue.claim('new-process', { campaign: host.campaign }), null);
  f.advance(100);
  const reclaimed = b.queue.claim('new-process', { campaign: host.campaign });
  assert.equal(reclaimed.id, abandoned.id); assert.equal(reclaimed.attempts, 2);
  assert.notEqual(reclaimed.leaseToken, abandoned.leaseToken);
  assert.throws(() => b.queue.complete(abandoned, { result: { connected: false } }), rejects('STALE_LEASE', 409));
  assert.throws(() => b.queue.renew(abandoned), rejects('STALE_LEASE', 409));
  b.queue.complete(reclaimed, { result: { connected: true } });
  assert.deepEqual(b.queue.list(host)[0].result, { connected: true });
});

test('renew extends a live lease and expiry fences completion even before another worker claims', t => {
  const f = fixture(t), { queue } = f.connect();
  queue.enqueue(host, input('renew'));
  const original = queue.claim('worker-a', { campaign: host.campaign });
  f.advance(90);
  const renewed = queue.renew(original);
  assert.equal(renewed.leaseToken, original.leaseToken);
  assert.equal(renewed.leaseUntil, original.leaseUntil + 90);
  f.advance(10);
  assert.equal(queue.claim('worker-b', { campaign: host.campaign }), null);
  f.advance(90);
  assert.throws(() => queue.complete(renewed, { result: true }), rejects('STALE_LEASE', 409));
  assert.throws(() => queue.renew(renewed), rejects('STALE_LEASE', 409));
  const next = queue.claim('worker-b', { campaign: host.campaign });
  queue.complete(next, { result: true });
  assert.throws(() => queue.complete(next, { result: false }), rejects('STALE_LEASE', 409));
});

test('three crashed attempts produce a durable failure and never dispatch a fourth time', t => {
  const f = fixture(t), { queue } = f.connect();
  queue.enqueue(host, input('crashed'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const claim = queue.claim(`worker-${attempt}`, { campaign: host.campaign });
    assert.equal(claim.attempts, attempt); f.advance(100);
  }
  assert.equal(queue.claim('worker-four', { campaign: host.campaign }), null);
  const [failure] = queue.list(host);
  assert.equal(failure.status, 'failed'); assert.equal(failure.error.code, 'WORKER_EXHAUSTED');
  assert.equal(failure.attempts, 3);
  assert.deepEqual(queue.enqueue(host, input('crashed')), failure);
});

test('pending queue capacity is bounded per owner and campaign while replay remains available', t => {
  const f = fixture(t), { queue } = f.connect();
  for (let owner = 0; owner < 5; owner++) {
    const scope = { ...host, owner: `owner-${owner}` };
    for (let i = 0; i < 20; i++) queue.enqueue(scope, input(`owner-${owner}-${i}`));
  }
  assert.throws(() => queue.enqueue({ ...host, owner: 'owner-0' }, input('owner-full')), rejects('QUEUE_FULL', 429));
  assert.throws(() => queue.enqueue(host, input('campaign-full')), rejects('QUEUE_FULL', 429));
  assert.equal(queue.enqueue({ ...host, owner: 'owner-0' }, input('owner-0-0')).status, 'queued');
  assert.equal(queue.enqueue({ ...host, campaign: 'other' }, input('other-campaign')).status, 'queued');
  const claimed = queue.claim('worker', { campaign: host.campaign });
  queue.complete(claimed, { result: null });
  assert.equal(queue.enqueue(host, input('capacity-freed')).status, 'queued');
});

test('list returns the caller latest twenty receipts and completed errors contain no raw secrets', t => {
  const f = fixture(t), { queue } = f.connect();
  const secret = 'Authorization: Bearer super-secret-token';
  for (let i = 0; i < 22; i++) {
    queue.enqueue(host, input(`done-${i}`));
    const claim = queue.claim('worker', { campaign: host.campaign });
    queue.complete(claim, { error: { code: i === 21 ? 'FORBIDDEN' : secret, status: 403, message: secret, stack: secret, details: secret } });
    f.advance(1);
  }
  const latest = queue.list(host);
  assert.equal(latest.length, 20); assert.equal(latest[0].requestId, 'done-21'); assert.equal(latest.at(-1).requestId, 'done-2');
  assert.equal(latest[0].error.code, 'FORBIDDEN'); assert.equal(latest[1].error.code, 'COMMAND_FAILED');
  assert.equal(JSON.stringify(latest).includes(secret), false);
  assert.deepEqual(queue.list(player), []);
  const rows = queue.db.prepare('SELECT error_json FROM chronicle_commands').all();
  assert.equal(JSON.stringify(rows).includes(secret), false);
});

test('read-only replay detects conflicts before an HTTP revision check without creating work', t => {
  const f = fixture(t), { queue } = f.connect();
  assert.equal(queue.replay(host, input('missing')), null);
  assert.deepEqual(queue.list(host), []);
  const original = queue.enqueue(host, input('existing'));
  // A caller may return this receipt before consulting its now-newer session revision.
  assert.deepEqual(queue.replay(host, input('existing')), original);
  assert.throws(() => queue.replay(host, input('existing', { channel: 'different' })), rejects('REQUEST_CONFLICT', 409));
  assert.throws(() => queue.replay(player, input('existing')), rejects('REQUEST_CONFLICT', 409));
  assert.equal(queue.list(host).length, 1);
});

test('enqueue shares an outer transaction without committing it and rolls back atomically', t => {
  const f = fixture(t), a = f.connect(), b = f.connect();
  a.store.db.exec('BEGIN IMMEDIATE');
  a.queue.enqueue(host, input('rollback'));
  assert.equal(a.store.db.isTransaction, true);
  assert.equal(a.queue.list(host).length, 1);
  assert.deepEqual(b.queue.list(host), []);
  a.store.db.exec('ROLLBACK');
  assert.equal(a.queue.replay(host, input('rollback')), null);
  a.store.db.exec('BEGIN IMMEDIATE');
  const original = a.queue.enqueue(host, input('commit'));
  assert.throws(() => a.queue.enqueue(host, input('commit', { channel: 'different' })), rejects('REQUEST_CONFLICT', 409));
  assert.equal(a.store.db.isTransaction, true);
  a.store.db.exec('COMMIT');
  assert.deepEqual(b.queue.replay(host, input('commit')), original);
});

test('session start alone permits a null session ID and preserves it across restart', t => {
  const f = fixture(t), a = f.connect();
  const start = input('new-session', { type: 'start', sessionId: null, expectedRevision: 0, title: 'Harbor rescue', mode: 'human', minutes: 10 });
  const receipt = a.queue.enqueue(host, start);
  assert.equal(receipt.sessionId, null);
  assert.throws(() => a.queue.enqueue(host, input('invalid-null', { sessionId: null })), rejects('INVALID_COMMAND', 400));
  assert.throws(() => a.queue.enqueue(host, { ...start, requestId: 'empty', sessionId: '' }), rejects('INVALID_COMMAND', 400));
  f.close(a.store);
  const b = f.connect();
  assert.deepEqual(b.queue.replay(host, start), receipt);
  const claim = b.queue.claim('worker', { campaign: host.campaign });
  assert.equal(claim.sessionId, null); assert.equal(claim.input.sessionId, null);
  const complete = b.queue.complete(claim, { result: { sessionId: 'created-session' } });
  assert.equal(complete.sessionId, null);
  assert.deepEqual(b.queue.enqueue(host, start), complete);
});

test('invalid and oversized input never enqueue and the shared store remains usable', t => {
  const f = fixture(t), { store, queue } = f.connect();
  assert.throws(() => queue.enqueue(host, input('bad', { expectedRevision: -1 })), rejects('INVALID_COMMAND', 400));
  assert.throws(() => queue.enqueue(host, input('bad', { payload: 'x'.repeat(32769) })), rejects('INVALID_COMMAND', 400));
  assert.throws(() => queue.enqueue(host, input('bad', { hidden: undefined })), rejects('INVALID_COMMAND', 400));
  assert.throws(() => queue.enqueue(host, input('bad', { payload: Number.NaN })), rejects('INVALID_COMMAND', 400));
  assert.throws(() => queue.enqueue({ ...host, role: 'unknown' }, input('bad')), rejects('INVALID_COMMAND', 400));
  assert.deepEqual(queue.list(host), []);
  assert.equal(queue.db, store.db);
  assert.equal(store.db.prepare('SELECT 1 AS usable').get().usable, 1);
});
