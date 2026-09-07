import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ChronicleStore } from './store.mjs';
import { ChronicleCommands } from './commands.mjs';
import { createChronicleDispatcher } from './dispatch.mjs';

const scope = { campaign: 'c', owner: 'host', role: 'host' };
const actionId = requestId => `web:${createHash('sha256').update(`host:${requestId}`).digest('hex')}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Timed out waiting for the test operation.');
}
function fixture(t, { authorize = () => true, member, leaseMs = 100, renewEveryMs = 10000, dmIds = ['host'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-dispatch-'));
  const path = join(dir, 'chronicle.sqlite');
  let at = 0;
  const effects = [], logs = [], dispatchers = [];
  let store = new ChronicleStore(path, { now: () => at });
  let queue = new ChronicleCommands(store, { now: () => at, leaseMs });
  const config = { campaignId: 'c', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', dmIds, dmRoleId: 'dm', playerIds: ['player'], playerRoleId: 'player' };
  const voice = {
    async start(id, owner, options) { effects.push(['voice', id, owner]); if (options?.authorize) assert.equal(await options.authorize(), true); },
    async stop(options) { effects.push(['stop', options ?? null]); },
  };
  const service = {
    async summarize(id) { effects.push(['summary', id]); },
    async end(id) { effects.push(['end', id]); store.save({ ...store.get(id), status: 'ended', ended: at }); },
  };
  const transport = { async member(owner) { return member ? member(owner) : { user: { id: owner, username: owner }, roles: ['dm'], permissions: '0' }; } };
  const f = {
    effects, logs, voice, service, config,
    get store() { return store; }, get queue() { return queue; },
    time(value) { at = value; },
    start(requestId = 'session-origin') { return store.start({ campaign: 'c', title: 'Harbor session', mode: 'human', minutes: 10, host: 'host', channel: 'journal', sourceChannel: 'chat', requestId }); },
    input(type, session, extra = {}) { return { requestId: `${type}-request`, sessionId: session?.id ?? null, expectedRevision: session ? store.revision(session.id) : 0, type, ...extra }; },
    dispatcher() {
      const dispatcher = createChronicleDispatcher({ store, queue, service, voice, config, transport, authorize, renewEveryMs, log: value => logs.push(value) });
      dispatchers.push(dispatcher); return dispatcher;
    },
    reopen() {
      store.close(); store = new ChronicleStore(path, { now: () => at });
      queue = new ChronicleCommands(store, { now: () => at, leaseMs });
    },
  };
  t.after(async () => {
    for (const dispatcher of dispatchers) await dispatcher.close();
    store.close(); rmSync(dir, { recursive: true, force: true });
  });
  return f;
}

test('a queued start with no session creates one session and replays its saved receipt', async t => {
  const f = fixture(t), input = f.input('start', null, { title: 'First harbor mission', mode: 'human', minutes: 10 });
  f.queue.enqueue(scope, input);
  const dispatcher = f.dispatcher();
  await dispatcher.tick();
  const receipt = f.queue.replay(scope, input);
  assert.equal(receipt.status, 'done');
  assert.equal(f.store.current('c').title, 'First harbor mission');
  assert.equal(receipt.result.sessionId, f.store.current('c').id);
  assert.deepEqual(f.queue.enqueue(scope, input), receipt);
  await dispatcher.tick();
  assert.equal(f.store.all().length, 1);
  assert.deepEqual(f.effects, []);
});

test('dispatch rejects game membership removed after a command was queued', async t => {
  let allowed = true;
  const f = fixture(t, { authorize: () => allowed }), session = f.start();
  const input = f.input('pause', session);
  f.queue.enqueue(scope, input); allowed = false;
  await f.dispatcher().tick();
  assert.equal(f.queue.replay(scope, input).status, 'failed');
  assert.equal(f.queue.replay(scope, input).error.code, 'FORBIDDEN');
  assert.equal(f.store.get(session.id).status, 'active');
  assert.deepEqual(f.effects, []);
});

test('dispatch fetches current Discord roles rather than trusting the queued host role', async t => {
  let roles = ['dm'];
  const owners = [];
  const f = fixture(t, { dmIds: [], member: owner => { owners.push(owner); return { user: { id: owner, username: owner }, roles, permissions: '0' }; } });
  const session = f.start(), input = f.input('voice', session);
  f.queue.enqueue(scope, input); roles = [];
  await f.dispatcher().tick();
  assert.deepEqual(owners, ['host']);
  assert.equal(f.queue.replay(scope, input).status, 'failed');
  assert.deepEqual(f.effects, []);
});

test('game authorization is rechecked after the asynchronous Discord membership lookup', async t => {
  let allowed = true;
  const f = fixture(t, { authorize: () => allowed, member: owner => {
    allowed = false;
    return { user: { id: owner, username: owner }, roles: ['dm'], permissions: '0' };
  } });
  const session = f.start(), input = f.input('pause', session);
  f.queue.enqueue(scope, input);
  await f.dispatcher().tick();
  assert.equal(f.queue.replay(scope, input).status, 'failed');
  assert.equal(f.store.get(session.id).status, 'active');
  assert.deepEqual(f.effects, []);
});

test('a stale queued revision spends no effects and changes no session state', async t => {
  const f = fixture(t), session = f.start(), input = f.input('pause', session);
  f.queue.enqueue(scope, input);
  f.store.append(session.id, 'later-note', 'note', { text: 'A newer action.' });
  const revision = f.store.revision(session.id);
  await f.dispatcher().tick();
  const receipt = f.queue.replay(scope, input);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.error.code, 'STALE_REVISION');
  assert.equal(f.store.revision(session.id), revision);
  assert.equal(f.store.get(session.id).status, 'active');
  assert.deepEqual(f.effects, []);
});

test('long commands renew the lease and cannot be reclaimed while that lease remains live', async t => {
  const f = fixture(t, { renewEveryMs: 5 }), session = f.start(), input = f.input('summary', session);
  const pending = deferred(); let entered = false, renewedAt = -1, at = 0;
  f.service.summarize = async id => { entered = true; f.effects.push(['summary', id]); await pending.promise; };
  const renew = f.queue.renew.bind(f.queue);
  f.queue.renew = claim => { const value = renew(claim); renewedAt = at; return value; };
  f.queue.enqueue(scope, input);
  const running = f.dispatcher().tick();
  await until(() => entered);
  at = 80; f.time(at); await until(() => renewedAt === 80);
  at = 160; f.time(at); await until(() => renewedAt === 160);
  assert.equal(f.queue.claim('competing-worker', { campaign: 'c' }), null);
  pending.resolve(); await running;
  assert.equal(f.queue.replay(scope, input).status, 'done');
  assert.deepEqual(f.effects, [['summary', session.id]]);
});

test('a worker that loses its lease cannot publish success over a newer worker receipt', async t => {
  const f = fixture(t), session = f.start(), input = f.input('summary', session);
  const pending = deferred(); let entered = false;
  f.service.summarize = async () => { entered = true; await pending.promise; };
  f.queue.enqueue(scope, input);
  const running = f.dispatcher().tick();
  await until(() => entered);
  f.time(101);
  const replacement = f.queue.claim('replacement-worker', { campaign: 'c' });
  assert.ok(replacement);
  f.queue.complete(replacement, { result: { message: 'Replacement owns this result.' } });
  pending.resolve(); await running;
  assert.deepEqual(f.queue.replay(scope, input).result, { message: 'Replacement owns this result.' });
  assert.equal(f.store.entries(session.id).filter(entry => entry.kind === 'command-receipt').length, 0);
  assert.deepEqual(f.logs, [{ outcome: 'chronicle_command_lease_lost' }]);
});

test('restart reconciles a committed start after its worker died before acknowledgement', async t => {
  const f = fixture(t), input = f.input('start', null, { title: 'First harbor mission', mode: 'human', minutes: 10 });
  f.queue.enqueue(scope, input); f.queue.claim('dead-worker', { campaign: 'c' });
  const original = f.start(actionId(input.requestId));
  f.time(101); f.reopen();
  await f.dispatcher().tick();
  assert.equal(f.queue.replay(scope, input).status, 'done');
  assert.equal(f.queue.replay(scope, input).result.sessionId, original.id);
  assert.equal(f.store.all().length, 1);
  assert.deepEqual(f.effects, []);
});

test('restart reconciliation of an old pause cannot stop voice after a newer resume', async t => {
  const f = fixture(t), session = f.start(), input = f.input('pause', session);
  f.queue.enqueue(scope, input); f.queue.claim('dead-worker', { campaign: 'c' });
  f.store.control(session.id, 'pause', actionId(input.requestId));
  f.store.control(session.id, 'resume', 'newer-resume');
  f.time(101); f.reopen();
  await f.dispatcher().tick();
  assert.equal(f.queue.replay(scope, input).status, 'done');
  assert.equal(f.store.get(session.id).status, 'active');
  assert.equal(f.store.entries(session.id).filter(entry => entry.source === `control:${actionId(input.requestId)}`).length, 1);
  assert.deepEqual(f.effects, [], 'reconciliation must not replay global voice.stop');
});

test('restart reconciliation of an old end cannot stop a newer session voice connection', async t => {
  const f = fixture(t), old = f.start(), input = f.input('end', old);
  f.queue.enqueue(scope, input); f.queue.claim('dead-worker', { campaign: 'c' });
  f.store.save({ ...f.store.get(old.id), status: 'ended', ended: 1 });
  const next = f.start('new-session');
  f.time(101); f.reopen();
  await f.dispatcher().tick();
  assert.equal(f.queue.replay(scope, input).status, 'done');
  assert.equal(f.queue.replay(scope, input).result.sessionId, old.id);
  assert.equal(f.store.current('c').id, next.id);
  assert.deepEqual(f.effects, [], 'old end must not touch the new voice connection');
});

test('shutdown drains a running command and prevents claiming another command', async t => {
  const f = fixture(t), session = f.start(), input = f.input('summary', session);
  const pending = deferred(); let entered = false, closed = false;
  f.service.summarize = async () => { entered = true; await pending.promise; };
  f.queue.enqueue(scope, input);
  const dispatcher = f.dispatcher(), running = dispatcher.tick();
  await until(() => entered);
  const closing = dispatcher.close().then(() => { closed = true; });
  await delay(5); assert.equal(closed, false);
  pending.resolve(); await Promise.all([running, closing]);
  const next = f.input('pause', f.store.get(session.id));
  f.queue.enqueue(scope, next);
  await dispatcher.tick();
  assert.equal(f.queue.replay(scope, next).status, 'queued');
});
