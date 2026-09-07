import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runGameHost } from './cli.mjs';

function fixture() {
  const child = new EventEmitter(), signals = new EventEmitter(), calls = [], reports = [];
  child.pid = 12345;
  child.kill = signal => { calls.push(['kill', signal]); queueMicrotask(() => child.emit('exit', 0)); return true; };
  return { child, signals, calls, reports, options: {
    signals, onExit: code => calls.push(['exit', code]), report: message => reports.push(message),
    spawnImpl(command, args, options) { calls.push(['spawn', command, args, options]); return child; },
    async openAiServices({ env, signal }) { calls.push(['open', env, signal]); return { status: () => ({ state: 'running' }), async close() { calls.push(['close']); } }; }
  } };
}

test('integrated build launches the web build without opening private AI resources', async () => {
  const f = fixture(), host = await runGameHost({ ...f.options, argv: ['build'] });
  assert.equal(f.calls[0][0], 'spawn'); assert.ok(!f.calls.some(call => call[0] === 'open'));
  assert.equal(f.calls[0][2][1], 'build');
  assert.equal(f.calls[0][3].windowsHide, true);
  f.child.emit('exit', 0); await host.done;
});

test('integrated start passes the canonical environment and closes owned AI services', async () => {
  const f = fixture(), env = { RAPHAEL_MEMBERSHIP_CAMPAIGNS: 'harbor' };
  const host = await runGameHost({ ...f.options, argv: ['start', '--port', '3015'], env });
  const opened = f.calls.find(call => call[0] === 'open');
  assert.equal(opened[1], env);
  const spawned = f.calls.find(call => call[0] === 'spawn');
  assert.deepEqual(spawned[2].slice(1), ['start', '--port', '3015']);
  await host.close();
  assert.equal(f.calls.filter(call => call[0] === 'close').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'spawn').length, 1);
});

test('unavailable Obus host authorization starts manual play and emits no private details', async () => {
  const f = fixture(); let closed = 0;
  const host = await runGameHost({ ...f.options, argv: ['dev'], openAiServices: async () => ({ status: () => ({ state: 'unavailable', lastError: 'PRIVATE_FIXTURE' }), async close() { closed++; } }) });
  assert.ok(f.calls.some(call => call[0] === 'spawn'));
  assert.equal(f.reports.length, 1); assert.match(f.reports[0], /manual play/);
  assert.ok(!f.reports[0].includes('PRIVATE_FIXTURE'));
  await host.close(); assert.equal(closed, 1);
});

test('invalid commands never construct the supervisor or any service', async () => {
  let created = 0;
  for (const argv of [['restart-everything'], [12], 'start']) {
    await assert.rejects(runGameHost({ argv, createSupervisor() { created++; } }));
  }
  assert.equal(created, 0);
});
