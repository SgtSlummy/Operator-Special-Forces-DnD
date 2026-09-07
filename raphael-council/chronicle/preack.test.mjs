import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { ChronicleStore } from './store.mjs';
import { createChronicleRuntime } from '../discord/chronicle-runtime.mjs';

function setup(t) {
  const calls = [], store = new ChronicleStore(':memory:');
  const config = { campaignId: 'campaign', guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', chronicleDir: tmpdir(), dmIds: ['host'], playerIds: [] };
  const transport = { respond: async (...args) => calls.push(['respond', ...args]), edit: async (...args) => calls.push(['edit', ...args]),
    followup: async (...args) => calls.push(['followup', ...args]), send: async () => ({ id: 'message' }),
    member: async owner => ({ user: { id: owner, username: owner }, roles: [], permissions: '0' }) };
  const runtime = createChronicleRuntime({ config, store, transport, client: {}, provider: { write: async () => 'Local draft.' },
    makeVoice: () => ({ start: async () => {}, stop: async () => {}, status: () => 'disconnected' }) });
  t.after(() => runtime.close());
  const interaction = (action = 'start') => ({ type: 2, id: `interaction-${action}`, token: 'fixture-token', application_id: 'app', guild_id: 'guild', channel_id: 'chat',
    member: { user: { id: 'host', username: 'Host' }, roles: [], permissions: '0' },
    data: { name: 'session', options: [{ name: action, options: action === 'start' ? [{ name: 'title', value: 'Session' }, { name: 'mode', value: 'human' }] : [] }] } });
  return { runtime, calls, interaction };
}

test('Davy pre-deferred session command edits its existing private reply without acknowledging twice', async t => {
  const f = setup(t);
  assert.equal(await f.runtime.handle(f.interaction(), { acknowledged: true }), true);
  assert.equal(f.calls.filter(call => call[0] === 'respond').length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'edit').length, 1);
  assert.equal(f.runtime.store.current('campaign').title, 'Session');
});

test('standalone session command still defers once before editing its private result', async t => {
  const f = setup(t);
  await f.runtime.handle(f.interaction());
  const acknowledgments = f.calls.filter(call => call[0] === 'respond');
  assert.equal(acknowledgments.length, 1);
  assert.deepEqual(acknowledgments[0][3], { type: 5, data: { flags: 64 } });
  assert.equal(f.calls.filter(call => call[0] === 'edit').length, 1);
});

test('pre-acknowledged unauthorized commands remain denied and use the existing private reply', async t => {
  const f = setup(t), interaction = f.interaction();
  interaction.member.user.id = 'intruder';
  await f.runtime.handle(interaction, { acknowledged: true });
  assert.equal(f.runtime.store.current('campaign'), null);
  assert.equal(f.calls.filter(call => call[0] === 'respond').length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'edit').length, 1);
  assert.match(f.calls[0][3].content, /current campaign members/);
});

test('chronicle leaves unrelated commands to the existing Davy dispatcher', async t => {
  const f = setup(t), interaction = f.interaction();
  interaction.data.name = 'music';
  assert.equal(await f.runtime.handle(interaction, { acknowledged: true }), false);
  assert.equal(f.calls.length, 0);
});
