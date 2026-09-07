import test from 'node:test';
import assert from 'node:assert/strict';
import { ChronicleStore } from './store.mjs';
import { createChronicleAdapter } from '../discord/chronicle-adapter.mjs';

const config = { campaignId: 'consent-campaign', guildId: 'guild', channelId: 'play', journalChannelId: 'journal', dmIds: [], dmRoleId: 'dm', playerIds: ['player'], playerRoleId: 'players' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function packet(id, action, values, owner = 'player') {
  return { id, token: id, application_id: 'app', type: 2, guild_id: config.guildId, channel_id: config.channelId,
    member: { user: { id: owner, username: owner }, roles: owner === 'host' ? ['dm'] : ['players'], permissions: '0' },
    data: { name: 'session', options: [{ name: action, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] } };
}
function fixture(t, service = {}) {
  const store = new ChronicleStore(':memory:');
  const session = store.start({ campaign: config.campaignId, title: 'Consent fixture', mode: 'human', minutes: 10, host: 'host', channel: config.journalChannelId, sourceChannel: config.channelId, requestId: 'start' });
  const edits = [], revoked = [], responses = [], stopped = [];
  const members = new Map(['host', 'player'].map(owner => [owner, {
    user: { id: owner, username: owner }, roles: owner === 'host' ? ['dm'] : ['players'], permissions: '0',
  }]));
  const transport = {
    member: async owner => members.get(owner),
    respond: async (id, token, value) => { responses.push({ id, token, ...value }); },
    edit: async (_app, token, value) => { edits.push({ token, ...value }); },
    followup: async () => {}, send: async () => ({ id: 'message' }),
  };
  const adapter = createChronicleAdapter({ store, service, config, transport, voice: { revoke: user => revoked.push(user), stop: async () => { stopped.push(true); }, status: () => 'disconnected' } });
  t.after(async () => { await adapter.close(); store.close(); });
  return { store, session, adapter, edits, revoked, responses, stopped, members };
}

test('Discord consent withdrawal completes while a summary is still blocked', async t => {
  const entered = deferred(), release = deferred(); let summaryFinished = false;
  const f = fixture(t, { summarize: async () => { entered.resolve(); await release.promise; summaryFinished = true; return { seq: 10 }; } });
  await f.adapter.handle(packet('capture-on', 'consent', { enabled: true, external: true }));
  const summary = f.adapter.handle(packet('slow-summary', 'summary', {}, 'host'));
  await entered.promise;
  let timer;
  try {
    const withdrawal = f.adapter.handle(packet('capture-off', 'consent', { enabled: false, external: false }));
    await Promise.race([withdrawal, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Consent was blocked by summary work.')), 1000); })]);
    assert.equal(summaryFinished, false);
    assert.equal(f.store.privacy(f.session.id, 'player').capture, false);
    assert.equal(f.store.privacy(f.session.id, 'player').external, false);
    assert.deepEqual(f.revoked, ['player']);
  } finally { clearTimeout(timer); release.resolve(); await summary; }
});

test('a queued pause is denied privately when the host role is revoked before execution', async t => {
  const entered = deferred(), release = deferred();
  const f = fixture(t, { summarize: async () => { entered.resolve(); await release.promise; return { seq: 10 }; } });
  const revision = f.store.revision(f.session.id);
  const summary = f.adapter.handle(packet('blocking-summary', 'summary', {}, 'host'));
  await entered.promise;
  const pause = f.adapter.handle(packet('queued-pause', 'pause', {}, 'host'));
  try {
    await Promise.resolve();
    assert.equal(f.edits.some(value => value.token === 'queued-pause'), false, 'Pause must still be waiting behind the summary.');
    f.members.get('host').roles = ['players'];
    release.resolve(); await Promise.all([summary, pause]);
    assert.equal(f.store.get(f.session.id).status, 'active');
    assert.equal(f.store.revision(f.session.id), revision);
    assert.deepEqual(f.stopped, []);
    const acknowledgement = f.responses.find(value => value.token === 'queued-pause');
    assert.equal(acknowledgement.type, 5); assert.equal(acknowledgement.data.flags, 64);
    const denial = f.edits.find(value => value.token === 'queued-pause');
    assert.match(denial.content, /current campaign role no longer permits/);
    assert.deepEqual(denial.allowed_mentions, { parse: [] });
  } finally { release.resolve(); await Promise.all([summary, pause]); }
});

test('Discord capture and external consent are independent and external permission defaults off', async t => {
  const f = fixture(t);
  await f.adapter.handle(packet('capture-only', 'consent', { enabled: true }));
  assert.deepEqual([f.store.privacy(f.session.id, 'player').capture, f.store.privacy(f.session.id, 'player').external], [true, false]);
  await f.adapter.handle(packet('external-on', 'consent', { enabled: true, external: true }));
  assert.deepEqual([f.store.privacy(f.session.id, 'player').capture, f.store.privacy(f.session.id, 'player').external], [true, true]);
  await f.adapter.handle(packet('external-off', 'consent', { enabled: true, external: false }));
  assert.deepEqual([f.store.privacy(f.session.id, 'player').capture, f.store.privacy(f.session.id, 'player').external], [true, false]);
  assert.deepEqual(f.revoked, []);
});

test('replaying an old Discord enable receipt cannot undo newer consent withdrawal', async t => {
  const f = fixture(t), enable = packet('old-enable', 'consent', { enabled: true, external: true });
  await f.adapter.handle(enable);
  await f.adapter.handle(packet('new-withdrawal', 'consent', { enabled: false, external: false }));
  const before = f.store.privacy(f.session.id, 'player'), revision = f.store.revision(f.session.id);
  await f.adapter.handle(enable);
  assert.deepEqual(f.store.privacy(f.session.id, 'player'), before);
  assert.equal(before.capture, false); assert.equal(before.external, false);
  assert.equal(f.store.revision(f.session.id), revision);
});

test('neither speaker nor host correction can restore a deleted Discord transcript', t => {
  const f = fixture(t);
  f.store.consent(f.session.id, 'player', true);
  const entry = f.store.record(f.session.id, 'discord:deleted-message', { user: 'player', speaker: 'Player', text: 'Withdraw this statement.' });
  f.store.reviseMessage(f.session.id, 'deleted-message', { deleted: true, requestId: 'deletion' });
  const revision = f.store.revision(f.session.id);
  assert.throws(() => f.store.correct(f.session.id, entry.seq, 'Restored by player.', 'player', false, 'restore-player'), /correct your own transcript/);
  assert.throws(() => f.store.correct(f.session.id, entry.seq, 'Restored by host.', 'host', true, 'restore-host'), /correct your own transcript/);
  assert.equal(f.store.revision(f.session.id), revision);
  assert.equal(f.store.entries(f.session.id).filter(e => e.kind === 'correction' && e.target === entry.seq).at(-1).deleted, true);
});
