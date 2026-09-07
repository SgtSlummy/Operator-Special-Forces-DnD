import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { createChronicleAdapter } from '../discord/chronicle-adapter.mjs';

const config = { campaignId: 'retry-campaign', guildId: 'guild', channelId: 'play', journalChannelId: 'journal', dmIds: ['host'], dmRoleId: 'dm', playerIds: ['player'], playerRoleId: 'players' };
const privateFailure = 'PRIVATE_PROVIDER_TOKEN_AND_TRANSCRIPT_DO_NOT_PERSIST';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-delivery-retry-')), path = join(directory, 'chronicle.sqlite');
  let now = 1000000, store = new ChronicleStore(path, { now: () => now });
  const session = store.start({ campaign: config.campaignId, title: 'Delivery retries', mode: 'human', minutes: 10, host: 'host', channel: config.journalChannelId, sourceChannel: config.channelId, requestId: 'start' });
  for (const row of store.pending()) store.delivered(row.id, 'fixture-start');
  const calls = [], logs = []; let fail = () => false;
  const service = { delivery: async row => {
    if (row.body.renderFailure) throw new Error(privateFailure);
    return row.body.parts.map(content => ({ content }));
  } };
  const transport = { send: async (channel, payload) => {
    calls.push({ channel, ...payload });
    const failure = fail(payload);
    if (failure) throw Object.assign(new Error(privateFailure), failure === 'uncertain' ? {} : { status: 429 });
    return { id: `receipt-${calls.length}` };
  } };
  const makeAdapter = () => createChronicleAdapter({ store, service, config, transport, log: value => logs.push(value) });
  let adapter = makeAdapter();
  t.after(async () => { try { await adapter.close(); store.close(); } finally { rmSync(directory, { recursive: true, force: true }); } });
  return {
    session, calls, logs,
    get store() { return store; }, get adapter() { return adapter; },
    get now() { return now; }, set now(value) { now = value; },
    set fail(fn) { fail = fn; },
    enqueue: (id, parts, extra = {}) => store.enqueue(session.id, id, { parts, ...extra }),
    async reopen() { await adapter.close(); store.close(); store = new ChronicleStore(path, { now: () => now }); adapter = makeAdapter(); },
  };
}

async function exhaust(f) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await f.adapter.flush();
    const next = f.store.deliveryState(f.session.id).nextAttemptAt;
    if (attempt < 4) { assert.equal(typeof next, 'number'); f.now = next; }
  }
  assert.equal(f.store.deliveryState(f.session.id).failed, 1);
}

test('partial multipart delivery resumes after restart without resending saved parts', async t => {
  const f = fixture(t); f.enqueue('multipart', ['first', 'second', 'third']); f.fail = payload => payload.content === 'second';
  await f.adapter.flush();
  assert.deepEqual(f.calls.map(call => call.content), ['first', 'second']);
  const next = f.store.deliveryState(f.session.id).nextAttemptAt;
  assert.equal(next, f.now + 60000);
  await f.reopen();
  await f.adapter.flush();
  assert.equal(f.calls.length, 2, 'A restart must retain the delivery backoff.');
  f.now = next; f.fail = () => false;
  await f.adapter.flush();
  assert.deepEqual(f.calls.map(call => call.content), ['first', 'second', 'second', 'third']);
  assert.equal(f.calls[1].nonce, f.calls[2].nonce, 'A repeated part uses the original Discord deduplication nonce.');
  assert.ok(f.calls.every(call => call.enforce_nonce === true));
  assert.equal(f.store.pending().length, 0);
  await f.adapter.flush(); assert.equal(f.calls.length, 4);
});

test('failed delivery backoff and five-attempt cap persist across restarts without raw errors', async t => {
  const f = fixture(t); f.enqueue('unavailable', ['safe public recap']); f.fail = () => true;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await f.adapter.flush();
    assert.equal(f.calls.length, attempt);
    const state = f.store.deliveryState(f.session.id);
    assert.equal(JSON.stringify({ state, logs: f.logs, pending: f.store.pending() }).includes(privateFailure), false);
    if (attempt < 5) {
      const next = f.now + 60000 * 2 ** (attempt - 1);
      assert.equal(state.retrying, 1); assert.equal(state.failed, 0); assert.equal(state.nextAttemptAt, next);
      await f.reopen(); f.now = next - 1; await f.adapter.flush();
      assert.equal(f.calls.length, attempt, 'A retry cannot run before its persisted deadline.');
      f.now = next;
    } else {
      assert.equal(state.failed, 1); assert.equal(state.retrying, 0); assert.equal(state.nextAttemptAt, null);
      assert.equal(f.store.readyDeliveries().length, 0);
    }
  }
  await f.reopen(); f.now += 7 * 24 * 60 * 60000; await f.adapter.flush();
  assert.equal(f.calls.length, 5, 'Restart and elapsed time cannot reset an exhausted delivery.');
});

test('GM retry is idempotent and preserves already delivered multipart receipts', async t => {
  const f = fixture(t); f.enqueue('gm-retry', ['saved part', 'blocked part']); f.fail = payload => payload.content === 'blocked part';
  await exhaust(f);
  assert.equal(f.calls.filter(call => call.content === 'saved part').length, 1);
  f.store.retryDeliveries(f.session.id, 'retry-request-1');
  assert.equal(f.store.deliveryState(f.session.id).failed, 0);
  assert.equal(f.store.readyDeliveries().length, 1);
  await f.adapter.flush();
  const state = f.store.deliveryState(f.session.id);
  assert.equal(state.retrying, 1); assert.equal(state.nextAttemptAt, f.now + 60000);
  await f.reopen();
  f.store.retryDeliveries(f.session.id, 'retry-request-1');
  assert.deepEqual(f.store.deliveryState(f.session.id), state, 'Replaying the GM request cannot erase a new failure or delay.');
  await f.adapter.flush(); assert.equal(f.calls.length, 7);
  f.now = state.nextAttemptAt; f.fail = () => false;
  await f.adapter.flush();
  assert.equal(f.calls.filter(call => call.content === 'saved part').length, 1);
  assert.equal(f.calls.filter(call => call.content === 'blocked part').length, 7);
  assert.equal(f.store.pending().length, 0);
  f.store.retryDeliveries(f.session.id, 'retry-request-2'); await f.adapter.flush();
  assert.equal(f.calls.length, 8, 'Delivered rows remain delivered after a later GM retry.');
});

test('one failed send does not starve a later delivery in the same flush', async t => {
  const f = fixture(t); f.enqueue('first-fails', ['fails']); f.enqueue('second-succeeds', ['succeeds']); f.fail = payload => payload.content === 'fails';
  await assert.doesNotReject(f.adapter.flush());
  assert.deepEqual(f.calls.map(call => call.content), ['fails', 'succeeds']);
  assert.deepEqual(f.store.pending().map(row => row.id), ['first-fails']);
  assert.equal(f.store.deliveryState(f.session.id).retrying, 1);
});

test('an uncertain Discord send is retained for review without retrying after restart or GM retry', async t => {
  const f = fixture(t); f.enqueue('uncertain', ['confirmed part', 'possibly accepted part']);
  f.fail = payload => payload.content === 'possibly accepted part' ? 'uncertain' : false;
  await f.adapter.flush();
  const receipts = f.store.db.prepare('SELECT part,receipt FROM delivery_parts WHERE id=? ORDER BY part').all('uncertain');
  assert.equal(receipts.length, 1); assert.equal(receipts[0].part, 0);
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
  assert.equal(f.store.readyDeliveries().length, 0);
  await f.reopen(); f.now += 7 * 24 * 60 * 60000; f.fail = () => false;
  f.store.retryDeliveries(f.session.id, 'gm-cannot-replay-uncertain');
  await f.adapter.flush();
  assert.deepEqual(f.calls.map(call => call.content), ['confirmed part', 'possibly accepted part']);
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
  assert.deepEqual(f.store.db.prepare('SELECT part,receipt FROM delivery_parts WHERE id=? ORDER BY part').all('uncertain'), receipts);
  assert.equal(JSON.stringify({ state: f.store.deliveryState(f.session.id), logs: f.logs }).includes(privateFailure), false);
});

test('a crash after the durable sending marker cannot resend an unknown Discord outcome', async t => {
  const f = fixture(t); f.enqueue('crashed-send', ['possibly accepted before process loss']);
  f.store.deliverySending('crashed-send');
  await f.reopen();
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
  assert.equal(f.store.readyDeliveries().length, 0);
  f.now += 7 * 24 * 60 * 60000;
  f.store.retryDeliveries(f.session.id, 'gm-retry-after-crash');
  await f.adapter.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
  assert.deepEqual(f.store.pending().map(row => row.id), ['crashed-send']);
});

test('failure saving a confirmed send receipt keeps uncertainty and rolls back the partial database write', async t => {
  const f = fixture(t); f.enqueue('receipt-storage-fails', ['accepted by Discord']);
  const clear = f.store.clearDeliveryUncertain;
  f.store.clearDeliveryUncertain = () => { throw new Error(privateFailure); };
  try { await f.adapter.flush(); } finally { f.store.clearDeliveryUncertain = clear; }
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM delivery_parts WHERE id=?').get('receipt-storage-fails').count, 0);
  await f.reopen(); f.now += 7 * 24 * 60 * 60000;
  f.store.retryDeliveries(f.session.id, 'gm-retry-receipt-failure'); await f.adapter.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.deliveryState(f.session.id).uncertain, 1);
});

test('a failed payload renderer is deferred without starving later deliveries', async t => {
  const f = fixture(t); f.enqueue('render-fails', [], { renderFailure: true }); f.enqueue('render-succeeds', ['healthy']);
  await assert.doesNotReject(f.adapter.flush());
  assert.deepEqual(f.calls.map(call => call.content), ['healthy']);
  assert.deepEqual(f.store.pending().map(row => row.id), ['render-fails']);
  assert.equal(f.store.deliveryState(f.session.id).nextAttemptAt, f.now + 60000);
  assert.equal(JSON.stringify(f.logs).includes(privateFailure), false);
});
