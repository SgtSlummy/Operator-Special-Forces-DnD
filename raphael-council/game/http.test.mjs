import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';

const token = 'a'.repeat(64);
const scope = { campaign: 'test', owner: 'alice' };
function setup() {
  const game = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 14 : 6 });
  const actor = (name, owner, x, initiative) => ({ id: name, name, owner, team: owner ? 'party' : 'opposition', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: 'fixture-v1', weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: 'test', title: 'Test', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }], map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1, 20), actor('enemy', null, 3, 10), actor('secret', null, 10, 5)], effects: [] });
  let revoked = false;
  const access = { authenticateAccess(value) { if (revoked || value !== token) throw new Error('private credential details'); return scope; } };
  return { game, access, handlers: createGameHttp(() => ({ game, access })), revoke: () => { revoked = true; } };
}
function request(path = '', { method = 'GET', body, headers = {} } = {}) {
  return new Request(`https://raph.example/api/game${path}`, { method, headers: { cookie: `raph_game_access=${token}`, ...(method !== 'GET' ? { origin: 'https://raph.example', 'content-type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('revision feed rejects forged cursors and identities and rechecks revoked access', async () => {
  const { game, handlers, revoke } = setup();
  try {
    const response = await handlers.updates(request('/updates?after=0'));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    const data = await response.json(); assert.equal(data.next, 1); assert.equal(data.views.length, 1);
    assert.ok(!JSON.stringify(data).includes('secret'));
    for (const query of ['', '?after=-1', '?after=1.2', '?after=0&after=1', '?after=0&owner=host', '?after=0&limit=10000']) assert.equal((await handlers.updates(request('/updates' + query))).status, 400);
    assert.equal((await handlers.updates(request('/updates?after=9'))).status, 409);
    revoke(); assert.equal((await handlers.updates(request('/updates?after=0'))).status, 401);
  } finally { game.close(); }
});

test('journal uses the game session, bounded cursors and current membership', async () => {
  const { game, handlers, revoke } = setup();
  try {
    const response = await handlers.journal(request('/journal?after=0'));
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('secret'));
    assert.equal((await handlers.journal(request('/journal?after=0&owner=host'))).status, 400);
    assert.equal((await handlers.journal(request('/journal?after=999'))).status, 409);
    game.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    assert.equal((await handlers.journal(request('/journal?after=0'))).status, 403);
    revoke(); assert.equal((await handlers.journal(request('/journal?after=0'))).status, 401);
  } finally { game.close(); }
});

test('world/debrief routes enforce membership, origin and fixed player fields', async () => {
  const { game, handlers, revoke } = setup();
  try {
    assert.deepEqual(await (await handlers.world(request('/world'))).json(), { world: { configured: false } });
    const input = { requestId: 'debrief-test', expectedRevision: 1, notes: 'A shared note.' };
    assert.equal((await handlers.debrief(request('/world', { method: 'POST', body: input }))).status, 409);
    assert.equal((await handlers.debrief(request('/world', { method: 'POST', body: input, headers: { origin: 'https://other.example' } }))).status, 403);
    assert.equal((await handlers.debrief(request('/world', { method: 'POST', body: { ...input, tracks: [{ value: 100 }] } }))).status, 400);
    game.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    assert.equal((await handlers.world(request('/world'))).status, 403);
    revoke(); assert.equal((await handlers.debrief(request('/world', { method: 'POST', body: input }))).status, 401);
  } finally { game.close(); }
});

test('counsel endpoints reject forged inputs and preserve game-session authority', async () => {
  const { game, handlers, revoke } = setup();
  try {
    const read = await handlers.counsel(request('/counsel')); assert.equal(read.status, 200);
    assert.equal((await read.json()).counsel.remaining, 0);
    const input = { requestId: 'advice', expectedRevision: 1, expectedWorldRevision: 1, topic: 'mission' };
    assert.equal((await handlers.askCounsel(request('/counsel', { method: 'POST', body: input }))).status, 409);
    assert.equal((await handlers.askCounsel(request('/counsel', { method: 'POST', body: { ...input, owner: 'host' } }))).status, 400);
    assert.equal((await handlers.askCounsel(request('/counsel', { method: 'POST', body: input, headers: { origin: 'https://other.example' } }))).status, 403);
    game.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    assert.equal((await handlers.counsel(request('/counsel'))).status, 403);
    revoke(); assert.equal((await handlers.askCounsel(request('/counsel', { method: 'POST', body: input }))).status, 401);
  } finally { game.close(); }
});

test('council routes require the current player session and cannot accept fabricated votes', async () => {
  const { game, handlers, revoke } = setup();
  try {
    assert.deepEqual(await (await handlers.council(request('/council'))).json(), { council: null });
    const input = { requestId: 'choose', round: 1, branchId: 'recovery', expectedWorldRevision: 3 };
    assert.equal((await handlers.chooseCouncil(request('/council', { method: 'POST', body: input }))).status, 409);
    assert.equal((await handlers.chooseCouncil(request('/council', { method: 'POST', body: { ...input, votes: [100] } }))).status, 400);
    assert.equal((await handlers.chooseCouncil(request('/council', { method: 'POST', body: input, headers: { origin: 'https://other.example' } }))).status, 403);
    revoke(); assert.equal((await handlers.council(request('/council'))).status, 401);
  } finally { game.close(); }
});

test('one game cookie protects scene, image request, status and download without accepting image-only login', async () => {
  const { game, access, handlers, revoke } = setup();
  const seen = [];
  const job = { id: 'image_one', status: 'ready', title: 'Map', focusLabel: 'Scene', sceneRevision: 1, sourceEventId: 'game:test:1', stale: false };
  const capture = who => { assert.deepEqual(who, scope); seen.push(who); };
  access.scene = who => { capture(who); return { id: 'map', revision: 1, title: 'Map', description: 'Visible scene', subjects: [], sourceEventId: 'game:test:1' }; };
  access.requestImage = (who, input) => { capture(who); assert.equal(input.focusId, 'scene'); return job; };
  access.getJob = who => { capture(who); return job; };
  access.image = who => { capture(who); return { mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }; };
  const imageRequest = { method: 'POST', body: { requestId: '12345678-1234-4234-8234-123456789abc', focusId: 'scene' } };
  const reads = req => [() => handlers.imageScene(req), () => handlers.imageJob(req, job.id), () => handlers.imageContent(req, job.id)];
  try {
    for (const read of reads(request('/scene-images'))) assert.equal((await read()).status, 200);
    assert.equal((await handlers.imageRequest(request('/scene-images', imageRequest))).status, 202);
    const count = seen.length;
    for (const read of reads(request('/scene-images', { headers: { cookie: `witnesslight_access=${token}` } }))) assert.equal((await read()).status, 401);
    assert.equal((await handlers.imageRequest(request('/scene-images', { ...imageRequest, headers: { origin: 'https://other.example' } }))).status, 403);
    assert.equal((await handlers.imageRequest(request('/scene-images', { ...imageRequest, body: { ...imageRequest.body, owner: 'host' } }))).status, 400);
    assert.equal(seen.length, count);
    game.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    for (const read of reads(request('/scene-images'))) assert.equal((await read()).status, 403);
    assert.equal((await handlers.imageRequest(request('/scene-images', imageRequest))).status, 403);
    assert.equal(seen.length, count);
    revoke(); assert.equal((await handlers.imageScene(request('/scene-images'))).status, 401);
  } finally { game.close(); }
});
test('connect creates scoped HttpOnly cookie without returning the code; disconnect expires it', async () => {
  const { game, handlers } = setup();
  try { const r = await handlers.connect(request('/access', { method: 'POST', body: { token } })); assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /Path=\/api\/game; HttpOnly; SameSite=Strict; Secure/); assert.ok(!(await r.text()).includes(token)); const d = await handlers.disconnect(request('/access', { method: 'DELETE' })); assert.match(d.headers.get('set-cookie'), /Max-Age=0/); } finally { game.close(); }
});
test('state and map remain player-filtered and private', async () => {
  const { game, handlers } = setup();
  try { const r = await handlers.state(request()); const body = await r.text(); assert.equal(r.status, 200); assert.ok(!body.includes('secret')); assert.match(r.headers.get('cache-control'), /no-store/); const map = await handlers.map(request('?revision=1')); assert.equal(map.status, 200); assert.equal(map.headers.get('content-type'), 'image/png'); const bytes = new Uint8Array(await map.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal((await handlers.map(request('?revision=0'))).status, 409); } finally { game.close(); }
});
test('authentication and revocation protect every read, command and image', async () => {
  const { game, handlers, revoke } = setup();
  try {
    for (const cookie of ['', 'raph_game_access=bad', `raph_game_access=${token}; raph_game_access=${token}`]) assert.equal((await handlers.state(request('', { headers: { cookie } }))).status, 401);
    revoke(); const r = await handlers.state(request()); assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('private credential')); assert.equal((await handlers.map(request('?revision=1'))).status, 401);
  } finally { game.close(); }
});
test('forged identity, foreign origin and unsupported modifiers never reach a commit', async () => {
  const { game, handlers } = setup();
  try {
    const body = { requestId: 'one', actorId: 'scout', expectedRevision: 1, type: 'attack', targetId: 'enemy' };
    assert.equal((await handlers.command(request('', { method: 'POST', body, headers: { origin: 'https://evil.example' } }))).status, 403);
    assert.equal((await handlers.command(request('', { method: 'POST', body, headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
    assert.equal((await handlers.command(request('', { method: 'POST', body: { ...body, owner: 'host' } }))).status, 400);
    assert.equal((await handlers.command(request('', { method: 'POST', body: { ...body, bonus: 50 } }))).status, 400);
    assert.equal(game.view(scope).revision, 1);
  } finally { game.close(); }
});
test('HTTP action receipt is durable and only its owner can read it', async () => {
  const { game, handlers } = setup();
  try {
    const body = { requestId: 'one', actorId: 'scout', expectedRevision: 1, type: 'attack', targetId: 'enemy' };
    const first = await (await handlers.command(request('', { method: 'POST', body }))).json();
    assert.equal(first.receipt.result.total, 19); assert.equal(first.receipt.result.damage, 9);
    const again = await (await handlers.command(request('', { method: 'POST', body }))).json(); assert.deepEqual(again.receipt, first.receipt);
    const current = await (await handlers.state(request())).json(); assert.equal(current.receipts.length, 1); assert.equal(current.view.revision, first.receipt.revision);
    assert.equal(game.receipts({ campaign: 'test', owner: 'host' }).length, 0);
    game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run('test', 'alice');
    assert.equal((await handlers.state(request())).status, 403);
  } finally { game.close(); }
});
test('body limits and unexpected failures do not echo input or server paths', async () => {
  const { game, handlers } = setup();
  try { assert.equal((await handlers.command(request('', { method: 'POST', body: { path: 'x'.repeat(9000) } }))).status, 413); const broken = createGameHttp(() => { throw new Error('C:/private/secret-key'); }); const r = await broken.state(request()); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes('secret-key')); } finally { game.close(); }
});
