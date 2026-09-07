import assert from 'node:assert/strict';
import test from 'node:test';
import { startMembershipBridge } from './server.mjs';
import { createMembershipClient } from './client.mjs';

const token = 'participant-fixture-service-token-00001';
const host = '12345678901234567';
const player = '12345678901234568';
const campaign = 'party-one';

async function fixture(t) {
  const roles = new Map([[host, 'host'], [player, 'player']]);
  const seen = [];
  const game = { member(scope) { seen.push(scope); return roles.get(scope.owner); } };
  const bridge = await startMembershipBridge({ game, token, campaigns: [campaign], port: 0 });
  t.after(() => bridge.close());
  return { roles, seen, url: bridge.url, client: createMembershipClient({ url: bridge.url, token }) };
}

test('a saved player may participate without acquiring host command authority', async t => {
  const { client, seen } = await fixture(t);
  for (const owner of [host, player]) assert.equal(await client.authorizeParticipant({ campaign, owner }), true);
  assert.equal(await client.authorizeCommand({ campaign, owner: host }), true);
  assert.equal(await client.authorizeCommand({ campaign, owner: player, role: 'host' }), false);
  assert.equal(seen.length, 4);
  assert.ok(seen.every(scope => Object.keys(scope).sort().join(',') === 'campaign,owner'));
});

test('participant permission is checked fresh after revocation and role changes', async t => {
  const { client, roles } = await fixture(t);
  const scope = { campaign, owner: player };
  assert.equal(await client.authorizeParticipant(scope), true);
  roles.delete(player);
  assert.equal(await client.authorizeParticipant(scope), false);
  roles.set(player, 'spectator');
  assert.equal(await client.authorizeParticipant(scope), false);
  roles.set(player, 'host');
  assert.equal(await client.authorizeParticipant(scope), true);
  assert.equal(await client.authorizeCommand(scope), true);
  roles.set(player, 'player');
  assert.equal(await client.authorizeCommand(scope), false);
});

test('participant scope stays campaign bounded and cannot submit client roles or consent', async t => {
  const { client, seen, url } = await fixture(t);
  assert.equal(await client.authorizeParticipant({ campaign: 'another-party', owner: player }), false);
  assert.equal(await client.authorizeParticipant({ campaign, owner: '11111111111111111', role: 'host', consent: true }), false);
  for (const extra of [{ role: 'host' }, { consent: true }, { session: 'secret' }]) {
    const response = await fetch(`${url}/v1/authorize-participant`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ campaign, owner: player, ...extra }) });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal(seen.length, 1);
});

test('malformed participant scope never makes a request and unknown responses fail closed', async () => {
  let calls = 0;
  const options = { url: 'http://127.0.0.1:38176', token, fetchImpl: async () => { calls++; throw new Error('offline'); } };
  const client = createMembershipClient(options);
  for (const scope of [null, {}, { campaign, owner: 'player' }, { campaign: '../party', owner: player }]) {
    assert.equal(await client.authorizeParticipant(scope), false);
  }
  assert.equal(calls, 0);
  assert.equal(await client.authorizeParticipant({ campaign, owner: player }), false);
  assert.equal(calls, 1);
  for (const payload of [{ allowed: 'true' }, { allowed: 1 }, { allowed: true, role: 'host' }, [], null]) {
    const malformed = createMembershipClient({ ...options, fetchImpl: async () => Response.json(payload) });
    assert.equal(await malformed.authorizeParticipant({ campaign, owner: player }), false);
  }
});

test('participant requests strip all fields except identity and use the separate endpoint', async () => {
  const client = createMembershipClient({ url: 'http://127.0.0.1:38176', token, fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:38176/v1/authorize-participant');
    assert.deepEqual(JSON.parse(init.body), { campaign, owner: player });
    assert.equal(init.redirect, 'manual');
    return Response.json({ allowed: true });
  } });
  assert.equal(await client.authorizeParticipant({ campaign, owner: player, role: 'host', consent: true, session: 'ignored' }), true);
});

test('unavailable canonical membership denies participants without a fallback', async t => {
  let calls = 0;
  const bridge = await startMembershipBridge({ token, campaigns: [campaign], port: 0,
    game: { member() { calls++; throw new Error('store unavailable'); } },
  });
  t.after(() => bridge.close());
  const client = createMembershipClient({ url: bridge.url, token });
  assert.equal(await client.authorizeParticipant({ campaign, owner: player }), false);
  assert.equal(calls, 1);
});
