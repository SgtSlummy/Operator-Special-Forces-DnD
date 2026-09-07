import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWebHostSupervisor } from './supervisor.mjs';

function fixture(options = {}) {
  const signals = new EventEmitter(), child = new EventEmitter(), events = [], reports = [];
  child.pid = 1234; child.kill = signal => { events.push(['kill', signal]); queueMicrotask(() => child.emit('exit', null)); return true; };
  const supervisor = createWebHostSupervisor({ signals, env: { FIXTURE: 'yes' },
    openHostServices: async () => { events.push('services'); return { close: async () => { events.push('close-services'); } }; },
    spawnImpl: (...args) => { events.push(['spawn', ...args]); queueMicrotask(() => child.emit('spawn')); return child; },
    report: message => reports.push(message), onExit: code => events.push(['exit', code]), shutdownTimeoutMs: 50, ...options,
  });
  return { supervisor, signals, child, events, reports };
}

test('build runs the existing CLI without opening private stores, host credentials or authority', async () => {
  const f = fixture({ mode: 'build', args: ['--fixture'] });
  assert.equal(f.events.length, 0);
  await f.supervisor.start();
  const spawn = f.events.find(Array.isArray);
  assert.equal(spawn[1], process.execPath);
  assert.match(spawn[2][0], /vinext[\\/]dist[\\/]cli\.js$/);
  assert.deepEqual(spawn[2].slice(1), ['build', '--fixture']);
  assert.equal(spawn[3].windowsHide, true); assert.equal(spawn[3].stdio, 'inherit');
  assert.deepEqual(spawn[3].env, { FIXTURE: 'yes', RAPHAEL_LOCAL_HOST: '1' });
  f.child.emit('exit', 0); assert.equal((await f.supervisor.done).exitCode, 0);
  assert.equal(f.events.includes('services'), false); assert.equal(f.events.includes('close-services'), false);
});

test('one explicit host start owns one web child and one set of private services', async () => {
  const f = fixture();
  const first = f.supervisor.start(); assert.equal(f.supervisor.start(), first);
  await first;
  assert.equal(f.events[0], 'services'); assert.equal(f.events.filter(Array.isArray).length, 1);
  assert.equal(f.supervisor.status().state, 'running'); assert.equal(f.supervisor.status().pid, 1234);
  assert.equal(f.supervisor.status().readiness, 'unverified'); assert.equal(f.supervisor.status().quiesced, false);
  const closing = f.supervisor.close(); assert.equal(f.supervisor.close(), closing);
  assert.equal((await closing).exitCode, 0);
  assert.deepEqual(f.events.slice(-3), [['kill', 'SIGTERM'], 'close-services', ['exit', 0]]);
});

test('signal shutdown removes only its own hooks and never touches an external process', async () => {
  const f = fixture(); let foreign = 0; const hook = () => foreign++;
  f.signals.on('SIGINT', hook); f.signals.on('SIGTERM', hook);
  await f.supervisor.start(); f.signals.emit('SIGINT'); f.signals.emit('SIGTERM');
  await f.supervisor.done;
  assert.equal(foreign, 2);
  assert.deepEqual(f.signals.listeners('SIGINT'), [hook]); assert.deepEqual(f.signals.listeners('SIGTERM'), [hook]);
  assert.equal(f.events.filter(e => e[0] === 'kill').length, 1);
});

test('shutdown during private preparation drains preparation and never launches a web process', async () => {
  let release; const events = [];
  const f = fixture({ openHostServices: () => new Promise(resolve => { release = () => resolve({ close: async () => events.push('closed') }); }) });
  const starting = f.supervisor.start(); await new Promise(resolve => setTimeout(resolve, 0));
  const cancelled = assert.rejects(starting, /cancelled/);
  const closing = f.supervisor.close(); release(); await cancelled; await closing;
  assert.deepEqual(events, ['closed']); assert.equal(f.events.some(e => e[0] === 'spawn'), false);
});

test('preparation failure cannot leave a web host running or private details in output', async () => {
  const f = fixture({ openHostServices: async () => { throw new Error('private token and path'); } });
  await assert.rejects(f.supervisor.start());
  assert.equal((await f.supervisor.done).exitCode, 1);
  assert.equal(f.events.some(e => e[0] === 'spawn'), false);
  assert.ok(f.reports.every(message => !message.includes('private token and path')));
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
});

test('failed child startup closes private authority exactly once', async () => {
  const f = fixture(); await f.supervisor.start();
  f.child.emit('error', new Error('private path')); f.child.emit('exit', 1);
  assert.equal((await f.supervisor.done).exitCode, 1);
  assert.equal(f.events.filter(e => e === 'close-services').length, 1);
  assert.equal(f.events.some(e => e[0] === 'kill'), false);
  assert.ok(f.reports.every(message => !message.includes('private path')));
});

test('unexpected web exit preserves the failure code after closing owned authority', async () => {
  const f = fixture(); await f.supervisor.start(); f.child.emit('exit', 7);
  assert.equal((await f.supervisor.done).exitCode, 7);
  assert.deepEqual(f.events.slice(-2), ['close-services', ['exit', 7]]);
});

test('an unresponsive owned child is reported without killing unrelated PIDs or abandoning private cleanup', async () => {
  const f = fixture(); f.child.kill = signal => { f.events.push(['kill', signal]); return false; };
  await f.supervisor.start();
  let done = false; void f.supervisor.done.then(() => { done = true; });
  const incomplete = await f.supervisor.close();
  assert.equal(incomplete.exitCode, 1); assert.equal(incomplete.state, 'shutdown-incomplete');
  assert.equal(incomplete.quiesced, false); assert.equal(incomplete.childRunning, true);
  assert.equal(done, false); assert.equal(f.events.some(e => e[0] === 'exit'), false);
  assert.equal(f.child.listenerCount('exit'), 1); assert.equal(f.child.listenerCount('error'), 1);
  assert.equal(f.events.filter(e => e[0] === 'kill').length, 1);
  assert.ok(f.events.includes('close-services'));
  assert.ok(f.reports.some(message => message.includes('deadline')));
  f.child.kill = signal => { f.events.push(['kill', signal]); queueMicrotask(() => f.child.emit('exit', null)); return true; };
  assert.equal((await f.supervisor.close()).quiesced, true);
  assert.equal((await f.supervisor.done).state, 'closed');
  assert.equal(f.events.filter(e => e === 'close-services').length, 1);
  assert.equal(f.events.filter(e => e[0] === 'exit').length, 1);
});

test('close before start remains inert and rejects later activation', async () => {
  const f = fixture(); await f.supervisor.close();
  await assert.rejects(f.supervisor.start(), /already closed/);
  assert.deepEqual(f.events, [['exit', 0]]);
});

test('private cleanup failure retains ownership and supports a fresh safe retry', async () => {
  let attempts = 0, done = false;
  const f = fixture({ openHostServices: async () => ({ close: async () => { if (++attempts === 1) throw new Error('private details'); } }) });
  void f.supervisor.done.then(() => { done = true; });
  await f.supervisor.start(); await f.supervisor.close();
  assert.equal(f.supervisor.status().exitCode, 1);
  assert.equal(f.supervisor.status().state, 'shutdown-incomplete');
  assert.equal(f.supervisor.status().servicesPending, true); assert.equal(done, false);
  assert.equal(f.signals.listenerCount('SIGINT'), 0); assert.equal(f.child.listenerCount('error'), 1);
  assert.ok(f.reports.some(message => message.includes('could not fully close')));
  assert.ok(f.reports.every(message => !message.includes('private details')));
  assert.equal((await f.supervisor.close()).state, 'closed'); assert.equal(attempts, 2);
  assert.equal((await f.supervisor.done).quiesced, true);
  assert.equal(f.child.listenerCount('error'), 0); assert.equal(f.events.filter(e => e[0] === 'kill').length, 1);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const turn = () => new Promise(resolve => setImmediate(resolve));

test('a failed kill retains the child error observer and a late exit completes cleanup', async () => {
  const f = fixture(); f.child.kill = () => { throw new Error('private OS error'); };
  let done = false; void f.supervisor.done.then(() => { done = true; });
  await f.supervisor.start();
  assert.equal((await f.supervisor.close()).state, 'shutdown-incomplete');
  assert.equal(done, false); assert.equal(f.supervisor.status().childRunning, true);
  f.child.emit('error', new Error('private process error'));
  f.child.emit('error', new Error('private process error again'));
  assert.equal(f.supervisor.status().quiesced, false);
  f.child.emit('exit', 1);
  assert.equal((await f.supervisor.done).state, 'closed');
  assert.equal(f.events.filter(e => e === 'close-services').length, 1);
  assert.ok(f.reports.every(message => !message.includes('private OS') && !message.includes('private process')));
});

test('startup timeout aborts preparation but late owned services are still cleaned without spawning', async () => {
  const preparation = deferred(), entered = deferred(); let signal, cleanup = 0;
  const f = fixture({ startupTimeoutMs: 50, openHostServices: options => {
    signal = options.signal; entered.resolve(); return preparation.promise;
  } });
  const starting = assert.rejects(f.supervisor.start(), /deadline/); await entered.promise;
  await starting; assert.equal(signal.aborted, true);
  assert.equal((await f.supervisor.close()).state, 'shutdown-incomplete');
  assert.equal(f.supervisor.status().startupPending, true);
  preparation.resolve({ close: async () => { cleanup++; } });
  assert.equal((await f.supervisor.done).quiesced, true); assert.equal(cleanup, 1);
  assert.equal(f.events.some(e => e[0] === 'spawn'), false);
});

test('close bounds uncooperative preparation and safely observes a late rejected opener', async () => {
  const preparation = deferred(), entered = deferred(); let signal, finished = false;
  const f = fixture({ openHostServices: options => { signal = options.signal; entered.resolve(); return preparation.promise; } });
  const starting = assert.rejects(f.supervisor.start(), /cancelled/); await entered.promise;
  void f.supervisor.done.then(() => { finished = true; });
  const closing = f.supervisor.close(); assert.equal(signal.aborted, true);
  const result = await closing; await starting;
  assert.equal(result.state, 'shutdown-incomplete'); assert.equal(result.startupPending, true); assert.equal(finished, false);
  preparation.reject(new Error('private cancelled configuration'));
  assert.equal((await f.supervisor.done).quiesced, true);
  assert.equal(f.events.some(e => e[0] === 'spawn'), false);
});

test('timed-out service cleanup is cancelled and observed without overlapping duplicate calls', async () => {
  const cleanup = deferred(); let calls = 0, signal, finished = false;
  const f = fixture({ openHostServices: async () => ({ close: options => {
    calls++; signal = options.signal; return cleanup.promise;
  } }) });
  void f.supervisor.done.then(() => { finished = true; });
  await f.supervisor.start();
  assert.equal((await f.supervisor.close()).state, 'shutdown-incomplete');
  assert.equal(signal.aborted, true); assert.equal(finished, false);
  assert.equal(f.supervisor.status().servicesClosing, true);
  assert.equal((await f.supervisor.close()).state, 'shutdown-incomplete'); assert.equal(calls, 1);
  cleanup.resolve(); assert.equal((await f.supervisor.done).state, 'closed');
  assert.equal(calls, 1); assert.equal(f.events.filter(e => e[0] === 'exit').length, 1);
});

test('cooperatively cancelled cleanup can be retried with a new un-aborted signal', async () => {
  const received = []; let attempts = 0;
  const f = fixture({ openHostServices: async () => ({ close: ({ signal }) => {
    received.push(signal);
    if (++attempts > 1) return Promise.resolve();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } }) });
  await f.supervisor.start(); await f.supervisor.close(); await turn();
  assert.equal(f.supervisor.status().state, 'shutdown-incomplete'); assert.equal(received[0].aborted, true);
  assert.equal((await f.supervisor.close()).quiesced, true);
  assert.equal(attempts, 2); assert.notEqual(received[0], received[1]); assert.equal(received[1].aborted, false);
});

test('partial signal-hook installation failure removes only supervisor hooks and never opens services', async () => {
  const signals = new EventEmitter(), foreign = () => {};
  signals.on('SIGINT', foreign);
  const on = signals.on;
  signals.on = function (name, handler) { if (name === 'SIGTERM') throw new Error('private hook error'); return on.call(this, name, handler); };
  const f = fixture({ signals });
  await assert.rejects(f.supervisor.start()); await f.supervisor.done;
  assert.deepEqual(signals.listeners('SIGINT'), [foreign]); assert.equal(f.events.includes('services'), false);
});
