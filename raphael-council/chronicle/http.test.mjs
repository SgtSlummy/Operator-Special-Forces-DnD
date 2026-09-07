import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChronicleStore } from './store.mjs';
import { ChronicleCommands } from './commands.mjs';
import { createChronicleHttp } from './http.mjs';
import { createChronicleDispatcher } from './dispatch.mjs';

const campaign = 'campaign-a';
const surfaces = {
  host: { token: 'browser-host', origin: 'https://game.example.test', path: '/api/game/chronicle' },
  player: { token: 'browser-player', origin: 'https://game.example.test', path: '/api/game/chronicle' },
  activity: { token: 'activity-player', origin: 'https://123.discordsays.com', path: '/.proxy/api/game/chronicle' },
  other: { token: 'activity-other', origin: 'https://123.discordsays.com', path: '/.proxy/api/game/chronicle' },
};
function fixture(t, { start = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-http-')), path = join(directory, 'chronicle.sqlite');
  let store = new ChronicleStore(path, { now: () => 10000 });
  const members = new Map([['gm', 'host'], ['player-one', 'player'], ['player-two', 'player']]);
  const identities = new Map([
    ['browser-host', { campaign, owner: 'gm' }],
    // Auth-supplied roles are deliberately untrusted: game membership must replace this host claim.
    ['browser-player', { campaign, owner: 'player-one', role: 'host' }],
    ['activity-player', { campaign, owner: 'player-one', role: 'host' }],
    ['activity-other', { campaign, owner: 'player-two' }],
  ]);
  const game = { member(scope) {
    if (scope.campaign !== campaign || !members.has(scope.owner)) throw Object.assign(new Error('Membership revoked.'), { status: 403, code: 'UNAUTHORIZED' });
    return members.get(scope.owner);
  } };
  const auth = { config: {}, authenticate: async request => identities.get(request.headers.get('cookie')?.replace('fixture_session=', '')) ?? null };
  const access = { authenticateAccess: async () => null };
  const handlers = createChronicleHttp({ getServices: async () => ({ game, auth, access }), getStore: requested => {
    assert.equal(requested, campaign); return store;
  }, enabled: () => true });
  if (start) store.start({ campaign, title: 'Harbor rescue', mode: 'human', minutes: 10, host: 'gm', channel: 'chronicle-channel', sourceChannel: 'game-chat', requestId: 'initial-session' });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return store; }, members,
    get queue() { return new ChronicleCommands(store); },
    scope: owner => ({ campaign, owner, role: members.get(owner) }),
    session: () => store.current(campaign),
    action: (type, requestId, extra = {}) => ({ type, requestId, sessionId: store.current(campaign)?.id ?? null, expectedRevision: store.current(campaign) ? store.revision(store.current(campaign).id) : 0, ...extra }),
    restart: () => { store.close(); store = new ChronicleStore(path, { now: () => 10000 }); },
    async call(surface, input, { query = '', cookie } = {}) {
      const spec = surfaces[surface], method = input === undefined ? 'GET' : 'POST';
      const request = new Request(`${spec.origin}${spec.path}${query}`, { method,
        headers: { cookie: cookie ?? `fixture_session=${spec.token}`, ...(input === undefined ? {} : { origin: spec.origin, 'content-type': 'application/json' }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      const response = await handlers[method === 'GET' ? 'get' : 'post'](request);
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

test('ended session can start a second session through the real Activity HTTP and bot dispatcher', async t => {
  const f = fixture(t), ended = f.session();
  f.store.save({ ...ended, status: 'ended' });
  const options = { cookie: 'fixture_session=browser-host' };
  const snapshot = await f.call('activity', undefined, options);
  assert.equal(snapshot.body.session.id, ended.id);
  assert.equal(snapshot.body.session.status, 'ended');
  const input = f.action('start', 'second-session', { title: 'Second session', mode: 'human', minutes: 10 });
  const stale = await f.call('activity', { ...input, requestId: 'bad-start', sessionId: ended.id, expectedRevision: snapshot.body.session.revision }, options);
  assert.equal(stale.status, 409);
  assert.equal(input.sessionId, null); assert.equal(input.expectedRevision, 0);
  const response = await f.call('activity', input, options);
  assert.equal(response.status, 200); assert.equal(response.body.command.status, 'queued');
  const config = { campaignId: ended.campaign, guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', dmIds: ['gm'], playerIds: [] };
  const dispatcher = createChronicleDispatcher({ store: f.store, config, queue: f.queue, service: {}, voice: {},
    authorize: scope => f.members.get(scope.owner) === 'host', transport: { member: async owner => ({ user: { id: owner }, roles: [], permissions: '0' }) } });
  await dispatcher.tick(); await dispatcher.close();
  assert.equal(f.queue.list(f.scope('gm'))[0].status, 'done');
  assert.notEqual(f.session().id, ended.id); assert.equal(f.session().title, 'Second session');
});

for (const status of ['active', 'paused', 'ending', 'ended']) test(`only the current GM can retry known failed deliveries for a ${status} session`, async t => {
  const f = fixture(t), session = f.session();
  f.store.save({ ...session, status });
  const known = f.store.pending()[0].id;
  for (let attempt = 0; attempt < 5; attempt++) f.store.deferDelivery(known);
  const other = f.store.append(session.id, 'uncertain-event', 'note', { text: 'Needs review.' });
  f.store.deliverySending(`event:${other.seq}`);
  const input = { type: 'retry-delivery', requestId: `retry-${status}`, sessionId: session.id, expectedRevision: f.store.revision(session.id) };
  assert.equal((await f.call('activity', input)).status, 403);
  const options = { cookie: 'fixture_session=browser-host' };
  assert.equal((await f.call('activity', input, options)).status, 200);
  const config = { campaignId: session.campaign, guildId: 'guild', channelId: 'chat', journalChannelId: 'journal', dmIds: ['gm'], playerIds: [] };
  const dispatcher = createChronicleDispatcher({ store: f.store, config, queue: f.queue, service: {}, voice: {},
    authorize: scope => f.members.get(scope.owner) === 'host', transport: { member: async owner => ({ user: { id: owner }, roles: [], permissions: '0' }) } });
  await dispatcher.tick(); await dispatcher.close();
  assert.equal(f.queue.list(f.scope('gm'))[0].status, 'done');
  assert.equal(f.store.deliveryState(session.id).failed, 0);
  assert.equal(f.store.deliveryState(session.id).uncertain, 1);
  for (let attempt = 0; attempt < 5; attempt++) f.store.deferDelivery(known);
  const replay = await f.call('activity', input, options);
  assert.equal(replay.status, 200); assert.equal(replay.body.command.status, 'done');
  assert.equal(f.store.deliveryState(session.id).failed, 1);
});

async function expectStatus(promise, expected) {
  const response = await promise;
  assert.equal(response.status, expected, JSON.stringify(response.body));
  return response.body;
}

test('browser and Activity resolve the same trusted player with separate capture and external consent', async t => {
  const f = fixture(t);
  const browser = await expectStatus(f.call('player'), 200), activity = await expectStatus(f.call('activity'), 200);
  assert.deepEqual(activity, browser);
  assert.equal(browser.owner, 'player-one'); assert.equal(browser.role, 'player');
  assert.deepEqual(browser.consent, { capture: false, external: false });
  await expectStatus(f.call('activity', f.action('consent', 'opt-in', { capture: true, external: false })), 200);
  assert.deepEqual((await expectStatus(f.call('player'), 200)).consent, { capture: true, external: false });
  assert.deepEqual((await expectStatus(f.call('other'), 200)).consent, { capture: false, external: false });
  await expectStatus(f.call('player', f.action('consent', 'spoof-owner', { capture: true, external: true, owner: 'gm' })), 400);
  await expectStatus(f.call('player', f.action('note', 'spoof-role', { text: 'spoofed', role: 'host' })), 400);
  await expectStatus(f.call('player', undefined, { cookie: 'fixture_session=unknown' }), 401);
});

test('players cannot enqueue GM controls even when authentication supplies a host role', async t => {
  const f = fixture(t);
  for (const type of ['start', 'pause', 'resume', 'voice', 'leave', 'summary', 'end']) {
    const extra = type === 'start' ? { sessionId: null, expectedRevision: 0, title: 'Unauthorized', mode: 'human', minutes: 10 } : {};
    await expectStatus(f.call('activity', f.action(type, `denied-${type}`, extra)), 403);
  }
  assert.deepEqual(f.queue.list(f.scope('player-one')), []);
});

test('stale GM revisions enqueue nothing, replay survives later revisions, and revoked members cannot use receipts', async t => {
  const f = fixture(t), command = f.action('voice', 'join-voice');
  await expectStatus(f.call('host', { ...command, expectedRevision: command.expectedRevision - 1 }), 409);
  assert.deepEqual(f.queue.list(f.scope('gm')), []);
  const accepted = await expectStatus(f.call('host', command), 200);
  f.store.append(f.session().id, 'new-event', 'session', { text: 'State advanced.' });
  assert.deepEqual(await expectStatus(f.call('host', command), 200), accepted);
  assert.equal(f.queue.list(f.scope('gm')).length, 1);
  f.members.delete('gm');
  await expectStatus(f.call('host'), 403);
  await expectStatus(f.call('host', command), 403);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS total FROM chronicle_commands').get().total, 1);
});

test('consent withdrawal accepts stale state but every newly enabled permission needs a current revision', async t => {
  const f = fixture(t), first = f.action('consent', 'capture-on', { capture: true, external: false });
  await expectStatus(f.call('player', first), 200);
  await expectStatus(f.call('activity', { ...first, requestId: 'stale-external-on', external: true }), 409);
  assert.deepEqual((await expectStatus(f.call('player'), 200)).consent, { capture: true, external: false });
  const external = f.action('consent', 'external-on', { capture: true, external: true });
  await expectStatus(f.call('activity', external), 200);
  f.store.append(f.session().id, 'later-state', 'session', { text: 'Another event.' });
  await expectStatus(f.call('player', { ...first, requestId: 'withdraw-stale', capture: false, external: false }), 200);
  assert.deepEqual((await expectStatus(f.call('activity'), 200)).consent, { capture: false, external: false });
  await expectStatus(f.call('activity', { ...first, requestId: 'stale-capture-on' }), 409);
  assert.deepEqual((await expectStatus(f.call('player'), 200)).consent, { capture: false, external: false });
});

test('queued and immediate actions share one request-ID namespace in both directions', async t => {
  const f = fixture(t);
  const voice = f.action('voice', 'queue-first');
  await expectStatus(f.call('host', voice), 200);
  await expectStatus(f.call('host', f.action('note', 'queue-first', { text: 'Must not be inserted.' })), 409);
  assert.equal(f.store.entries(f.session().id).some(entry => entry.text === 'Must not be inserted.'), false);
  const note = f.action('note', 'note-first', { text: 'A durable table note.' });
  const original = await expectStatus(f.call('host', note), 200);
  await expectStatus(f.call('host', f.action('summary', 'note-first')), 409);
  assert.deepEqual(await expectStatus(f.call('host', note), 200), original);
  await expectStatus(f.call('host', { ...note, text: 'A different payload.' }), 409);
  assert.equal(f.queue.list(f.scope('gm')).length, 1);
  assert.equal(f.store.entries(f.session().id).filter(entry => entry.text === 'A durable table note.').length, 1);
});

test('players correct only their own transcript while the GM can correct shared story entries', async t => {
  const f = fixture(t), session = f.session();
  f.store.consent(session.id, 'player-one', true); f.store.consent(session.id, 'player-two', true);
  const own = f.store.record(session.id, 'discord:message-own', { user: 'player-one', speaker: 'One', text: 'We went west.', medium: 'text' });
  const other = f.store.record(session.id, 'discord:message-other', { user: 'player-two', speaker: 'Two', text: 'Another speaker.', medium: 'text' });
  const note = f.store.append(session.id, 'table-note', 'note', { user: 'player-one', text: 'An old note.' });
  await expectStatus(f.call('activity', f.action('correct', 'correct-own', { entry: own.seq, text: 'We went east.' })), 200);
  await expectStatus(f.call('activity', f.action('correct', 'correct-other', { entry: other.seq, text: 'Not permitted.' })), 403);
  await expectStatus(f.call('player', f.action('correct', 'correct-note', { entry: note.seq, text: 'Not permitted.' })), 403);
  await expectStatus(f.call('host', f.action('correct', 'gm-correct-note', { entry: note.seq, text: 'GM-approved correction.' })), 200);
  const view = await expectStatus(f.call('player'), 200);
  assert.equal(view.entries.find(entry => entry.seq === own.seq).text, 'We went east.');
  assert.equal(view.entries.find(entry => entry.seq === own.seq).corrected, true);
  assert.equal(view.entries.find(entry => entry.seq === note.seq).text, 'GM-approved correction.');
  assert.equal(view.entries.find(entry => entry.seq === other.seq).canCorrect, false);
  assert.equal(view.entries.find(entry => entry.seq === note.seq).canCorrect, false);
});

test('deleted Discord transcript projects the tombstone and cannot be restored through corrections', async t => {
  const f = fixture(t), session = f.session();
  f.store.consent(session.id, 'player-one', true);
  const entry = f.store.record(session.id, 'discord:deleted-message', { user: 'player-one', speaker: 'One', text: 'Removed private words.', medium: 'text' });
  f.store.reviseMessage(session.id, 'deleted-message', { text: 'Replacement private words.', requestId: 'message-edited' });
  f.store.reviseMessage(session.id, 'deleted-message', { deleted: true, requestId: 'message-deleted' });
  for (const surface of ['player', 'host']) {
    const before = await expectStatus(f.call(surface), 200), projected = before.entries.find(value => value.seq === entry.seq);
    assert.equal(projected.deleted, true); assert.equal(projected.canCorrect, false);
    assert.equal(JSON.stringify(before.entries).includes('Removed private words.'), false);
    assert.equal(JSON.stringify(before.entries).includes('Replacement private words.'), false);
    await expectStatus(f.call(surface, f.action('correct', `restore-${surface}`, { entry: entry.seq, text: 'Attempted restoration.' })), 403);
  }
  assert.equal(f.store.evidence(session.id).some(value => value.seq === entry.seq), false);
});

test('immediate receipts and queued commands survive store restart without duplicate mutations', async t => {
  const f = fixture(t), voice = f.action('voice', 'restart-voice');
  const queued = await expectStatus(f.call('host', voice), 200);
  const note = f.action('note', 'restart-note', { text: 'Preserved once.' });
  const saved = await expectStatus(f.call('player', note), 200);
  const revision = f.store.revision(f.session().id);
  f.restart();
  assert.deepEqual(await expectStatus(f.call('host', voice), 200), queued);
  assert.deepEqual(await expectStatus(f.call('activity', note), 200), saved);
  assert.equal(f.store.revision(f.session().id), revision);
  assert.equal((await expectStatus(f.call('host'), 200)).commands.length, 1);
  assert.deepEqual((await expectStatus(f.call('activity'), 200)).commands, []);
  const claimed = f.queue.claim('restarted-bot', { campaign });
  assert.deepEqual(claimed.input, voice); assert.equal(claimed.scope.owner, 'gm'); assert.equal(claimed.scope.role, 'host');
});

test('session start queues without a preexisting session and replays after restart', async t => {
  const f = fixture(t, { start: false }), action = f.action('start', 'create-session', { title: 'First session', mode: 'human', minutes: 10 });
  const first = await expectStatus(f.call('host', action), 200);
  assert.equal(first.command.sessionId, null); assert.equal(first.command.type, 'start');
  assert.equal(f.session(), null);
  f.restart();
  assert.deepEqual(await expectStatus(f.call('host', action), 200), first);
  const claim = f.queue.claim('bot', { campaign });
  assert.equal(claim.input.sessionId, null); assert.equal(claim.input.title, 'First session');
});

test('a session in another campaign and invalid transcript cursors cannot cross the boundary', async t => {
  const f = fixture(t);
  const elsewhere = f.store.start({ campaign: 'campaign-other', title: 'Other story', mode: 'human', minutes: 10, host: 'other-gm', channel: 'other-channel', sourceChannel: 'other-chat', requestId: 'other-session' });
  await expectStatus(f.call('host', f.action('voice', 'cross-campaign', { sessionId: elsewhere.id, expectedRevision: f.store.revision(elsewhere.id) })), 409);
  assert.deepEqual(f.queue.list(f.scope('gm')), []);
  for (const query of ['?after=-1', '?after=1&after=2', '?campaign=campaign-other']) await expectStatus(f.call('player', undefined, { query }), 400);
});
