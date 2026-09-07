import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from './store.mjs';
import { createWorldTimeHttp } from './world-time-http.mjs';

const origin = 'http://localhost';
const tokens = { host: 'a'.repeat(64), p1: 'b'.repeat(64), p2: 'c'.repeat(64) };
const scope = owner => ({ campaign: 'world-time-http', owner });
function request(owner = 'host', { method = 'GET', body, raw, query = '', headers = {} } = {}) {
  const values = new Headers({ cookie: `raph_game_access=${tokens[owner]}`, ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}) });
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) values.delete(key);
    else values.set(key, value);
  }
  return new Request(`${origin}/api/game/world-time${query}`, { method, headers: values, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) });
}
function privateResponse(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('vary'), 'Cookie');
}
function setup(t) {
  const revoked = new Set();
  const game = new GameStore(':memory:', { rollDie: () => { throw new Error('World time must never roll combat dice.'); } });
  t.after(() => game.close());
  const actor = (id, owner, x, initiative) => ({
    id, owner, team: owner, name: id, x, y: 2, size: 1, hp: 40, maxHp: 40, ac: 10, speed: 30, vision: 12, initiative, characterVersion: 'v1',
    weapon: { name: 'Reviewed spear', abilityScore: 10, proficiencyBonus: 0, proficient: false, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 },
  });
  game.createCampaign({
    campaign: scope('host').campaign, title: 'World time HTTP fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'p1', role: 'player' }, { owner: 'p2', role: 'player' }],
    map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] },
    actors: [actor('hero', 'p1', 2, 20), actor('guard', 'p2', 8, 10)], effects: [],
  });
  const services = { game, access: { authenticateAccess(token) { const owner = Object.keys(tokens).find(owner => tokens[owner] === token); if (!owner || revoked.has(owner)) throw new Error('private-access-detail'); return scope(owner); } } };
  return { game, revoked, services, handlers: createWorldTimeHttp(() => services) };
}
function database(game) {
  return JSON.stringify(game.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({ name, rows: game.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() })));
}

const party = { audience: 'party', owners: [] }, hostOnly = { audience: 'host', owners: [] }, personal = { audience: 'owners', owners: ['p1'] };
function definition() {
  return {
    schemaVersion: 1, id: 'time-test', version: 'v1',
    calendar: { label: 'Test calendar', unitLabel: 'reviewed quarter-day', ticksPerDay: 4, originDay: 6, originTick: 0, initialTick: 0, originLabel: 'Host-selected test anchor' },
    maxAdvanceTicks: 120, adoption: { mode: 'new', reason: 'Explicit test setup', evidence: ['test:review'] },
    entities: [
      { id: 'village', label: 'Village', kind: 'location', visibility: party },
      { id: 'host_vault', label: 'Secret host vault', kind: 'location', visibility: hostOnly },
      { id: 'personal_stash', label: 'Personal hidden stash', kind: 'location', visibility: personal },
    ],
    facts: [
      { id: 'lamps', entityId: 'village', kind: 'condition', label: 'Festival lamps', value: true, visibility: party, evidence: ['test:review'] },
      { id: 'host_secret', entityId: 'host_vault', kind: 'condition', label: 'Secret host evidence', value: true, visibility: hostOnly, evidence: ['test:private-host'] },
      { id: 'personal_secret', entityId: 'personal_stash', kind: 'condition', label: 'Personal hidden evidence', value: true, visibility: personal, evidence: ['test:private-player'] },
    ],
    knowledge: [], opportunities: [{ id: 'accord', title: 'Accord', status: 'open', visibility: party, evidence: ['test:review'] }],
    deadlines: [
      { id: 'lamps_due', label: 'Lamp deadline', opportunityId: 'accord', atTick: 11, order: 1, when: [], effects: [{ type: 'fact', id: 'lamps', value: false }], summary: 'The lamps are withheld.', visibility: party, evidence: ['test:review'], initialState: 'pending' },
      { id: 'host_deadline', label: 'Secret host deadline', opportunityId: 'accord', atTick: 11, order: 2, when: [], effects: [{ type: 'fact', id: 'host_secret', value: false }], summary: 'Secret host consequence.', visibility: hostOnly, evidence: ['test:private-host'], initialState: 'pending' },
    ],
    clocks: [], decisions: [{ id: 'settle', label: 'Reviewed settlement', when: [], effects: [{ type: 'opportunity', id: 'accord', status: 'resolved' }], summary: 'The settlement is recorded.', visibility: party, evidence: ['test:review'], initiallyConsumed: false }],
  };
}
function input(game, action, requestId, fields = {}) {
  const time = game.worldTime(scope('host'));
  return { action, requestId, expectedGameRevision: time.gameRevision, expectedWorldRevision: time.worldRevision, expectedTimeRevision: time.timeRevision, reviewed: true, ...fields };
}
function explore(context) {
  context.game.configureMission(scope('host'), { reviewed: true, tracks: [], mission: { id: 'opening', title: 'Opening', briefing: 'Fixture', mapId: 'map', resolution: 'adjudicated', outcomes: [{ id: 'done', title: 'Done', summary: 'Fixture done', changes: [] }] } });
}
async function configured(t) {
  const context = setup(t);
  explore(context);
  const body = input(context.game, 'configure', 'configure-calendar', { definition: definition() });
  const response = await context.handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(response.status, 200, await response.clone().text());
  privateResponse(response);
  return { ...context, configureInput: body, configureResponse: await response.json() };
}
async function preview(context, requestId = 'preview-interval', targetTick = 11) {
  const body = input(context.game, 'preview', requestId, { targetTick, reason: 'Reviewed fictional activity interval.' });
  const response = await context.handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(response.status, 200, await response.clone().text());
  privateResponse(response);
  const result = await response.json();
  assert.equal(typeof result.preview.previewId, 'string');
  return { body, result };
}

test('GET reads the authenticated calendar projection without creating or advancing fictional time', async t => {
  const { game, handlers } = setup(t), before = database(game);
  for (const owner of ['host', 'p1', 'p2']) {
    const response = await handlers.worldTime(request(owner));
    assert.equal(response.status, 200);
    privateResponse(response);
    assert.deepEqual(await response.json(), { time: game.worldTime(scope(owner)) });
  }
  assert.equal(database(game), before);
});

test('both endpoints reject missing, malformed, duplicate and revoked access cookies privately', async t => {
  const { handlers, revoked } = setup(t);
  for (const cookie of [null, 'raph_game_access=invalid', 'raph_game_access=%', `raph_game_access=${tokens.p1}; raph_game_access=${tokens.p1}`]) {
    for (const method of ['GET', 'POST']) {
      const response = await handlers[method === 'GET' ? 'worldTime' : 'changeWorldTime'](request('p1', { method, body: { action: 'preview' }, headers: { cookie } }));
      assert.equal(response.status, 401);
      privateResponse(response);
    }
  }
  revoked.add('p1');
  for (const method of ['GET', 'POST']) {
    const response = await handlers[method === 'GET' ? 'worldTime' : 'changeWorldTime'](request('p1', { method, body: { action: 'preview' } }));
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /private-access-detail/);
  }
});

test('membership revocation applies to reads and writes through token and Discord authentication', async t => {
  for (const session of [false, true]) {
    const { game, handlers, services } = setup(t);
    if (session) {
      services.auth = { authenticate: async () => scope('p1') };
      services.access.authenticateAccess = () => { throw new Error('Cookie fallback must not replace an authenticated session'); };
    }
    const headers = session ? { cookie: null } : {};
    assert.equal((await handlers.worldTime(request('p1', { headers }))).status, 200);
    game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(scope('p1').campaign, 'p1');
    for (const method of ['GET', 'POST']) {
      const denied = await handlers[method === 'GET' ? 'worldTime' : 'changeWorldTime'](request('p1', { method, body: { action: 'preview' }, headers }));
      assert.equal(denied.status, 403);
      privateResponse(denied);
    }
  }
});

test('POST rejects missing or foreign Origin and cross-site metadata before changing state', async t => {
  const { game, handlers } = setup(t), before = database(game);
  for (const headers of [{ origin: null }, { origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await handlers.changeWorldTime(request('host', { method: 'POST', body: { action: 'preview' }, headers }));
    assert.equal(response.status, 403);
    privateResponse(response);
  }
  assert.equal(database(game), before);
});

test('queries, malformed JSON, unknown actions and bounded request failures expose no private details', async t => {
  const { game, handlers } = setup(t), before = database(game);
  for (const method of ['GET', 'POST']) {
    const response = await handlers[method === 'GET' ? 'worldTime' : 'changeWorldTime'](request('host', { method, body: { action: 'preview' }, query: '?owner=host&campaign=another-game' }));
    assert.equal(response.status, 400);
    privateResponse(response);
  }
  for (const [options, status] of [
    [{ raw: '{' }, 400], [{ raw: 'null' }, 400], [{ raw: '[]' }, 400], [{ raw: '"preview"' }, 400],
    [{ body: {} }, 400], [{ body: { action: 'toString' } }, 400], [{ body: { action: '__proto__' } }, 400],
    [{ body: { action: ['advance'] } }, 400], [{ body: { action: { toString: 'advance' } } }, 400],
    [{ raw: ' '.repeat(1048577) }, 413], [{ body: { action: 'preview' }, headers: { 'content-length': '1100000' } }, 413],
    [{ body: { action: 'preview' }, headers: { 'content-type': 'text/plain' } }, 415],
  ]) {
    const response = await handlers.changeWorldTime(request('host', { method: 'POST', ...options }));
    assert.equal(response.status, status);
    privateResponse(response);
  }
  assert.equal(database(game), before);
});

test('host previews and advances a reviewed interval once and retains the same immutable receipt on retry', async t => {
  const context = await configured(t), { game, handlers } = context;
  assert.deepEqual(context.configureResponse.time, game.worldTime(scope('host')));
  const gameBefore = game.load(scope('host').campaign), worldBefore = game.world(scope('host')), timeBefore = game.worldTime(scope('host'));
  const prepared = await preview(context);
  assert.deepEqual(game.load(scope('host').campaign), gameBefore);
  assert.deepEqual(game.world(scope('host')), worldBefore);
  const timeAfter = game.worldTime(scope('host'));
  for (const key of ['gameRevision', 'worldRevision', 'timeRevision', 'calendar', 'facts', 'opportunities', 'events']) assert.deepEqual(timeAfter[key], timeBefore[key]);
  const repeatedPreview = await handlers.changeWorldTime(request('host', { method: 'POST', body: prepared.body }));
  assert.equal(repeatedPreview.status, 200);
  assert.deepEqual((await repeatedPreview.json()).preview, prepared.result.preview);
  const body = input(game, 'advance', 'advance-interval', { previewId: prepared.result.preview.previewId });
  const response = await handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(response.status, 200, await response.clone().text());
  privateResponse(response);
  const result = await response.json();
  assert.equal(result.receipt.requestId, body.requestId);
  assert.deepEqual(result.time, game.worldTime(scope('host')));
  assert.equal(result.time.facts.find(fact => fact.id === 'lamps').value, false);
  assert.equal(result.time.facts.find(fact => fact.id === 'host_secret').value, false);
  assert.equal(result.time.timeRevision, timeBefore.timeRevision + 1);
  const settled = database(game);
  const retry = await handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).receipt, result.receipt);
  assert.equal(database(game), settled);
  const conflict = await handlers.changeWorldTime(request('host', { method: 'POST', body: { ...body, previewId: 'another-preview' } }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'CONFLICT');
  assert.equal(database(game), settled);
});

test('party and owner-specific time projections do not disclose host definitions, hidden facts or private events', async t => {
  const context = await configured(t), { game, handlers } = context;
  const prepared = await preview(context);
  const response = await handlers.changeWorldTime(request('host', { method: 'POST', body: input(game, 'advance', 'advance-for-privacy', { previewId: prepared.result.preview.previewId }) }));
  assert.equal(response.status, 200);
  const beforeReads = database(game);
  for (const owner of ['p1', 'p2']) {
    const current = await handlers.worldTime(request(owner));
    assert.equal(current.status, 200);
    privateResponse(current);
    const body = await current.json();
    assert.deepEqual(body, { time: game.worldTime(scope(owner)) });
    assert.doesNotMatch(JSON.stringify(body), /host_vault|host_secret|host_deadline|Secret host|private-host/);
    for (const key of ['definition', 'runtime', 'receipts']) assert.equal(Object.hasOwn(body.time, key), false);
    assert.equal(body.time.facts.find(fact => fact.id === 'lamps').value, false);
    if (owner === 'p1') assert.equal(body.time.facts.find(fact => fact.id === 'personal_secret').value, true);
    else assert.doesNotMatch(JSON.stringify(body), /personal_secret|personal_stash|Personal hidden|private-player/);
    for (const event of body.time.events) assert.deepEqual(Object.keys(event).sort(), ['id', 'kind', 'summary', 'tick']);
  }
  assert.equal(database(game), beforeReads);
});

test('all review and mutation actions require the current host even with copied preview and request identities', async t => {
  const context = await configured(t), { game, handlers } = context;
  const prepared = await preview(context), before = database(game);
  const commands = [
    input(game, 'configure', 'unauthorized-config', { definition: definition() }),
    input(game, 'preview', 'unauthorized-preview', { targetTick: 11, reason: 'Copied review' }),
    input(game, 'advance', 'unauthorized-advance', { previewId: prepared.result.preview.previewId }),
    input(game, 'decision', 'unauthorized-decision', { decisionId: 'settle', reason: 'Copied review' }),
  ];
  for (const owner of ['p1', 'p2']) for (const body of commands) {
    const response = await handlers.changeWorldTime(request(owner, { method: 'POST', body }));
    assert.equal(response.status, 403);
    privateResponse(response);
    assert.doesNotMatch(await response.text(), /host_secret|Secret host|private-host|Personal hidden/);
  }
  assert.equal(database(game), before);
});

test('reviewed decision results and configure receipts replay without changing the calendar or repeating effects', async t => {
  const context = await configured(t), { game, handlers } = context;
  const body = input(game, 'decision', 'record-settlement', { decisionId: 'settle', reason: 'The host reviewed the completed settlement.' });
  const response = await handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.time.opportunities.find(item => item.id === 'accord').status, 'resolved');
  const before = database(game);
  for (const [command, receipt] of [[body, result.receipt], [context.configureInput, context.configureResponse.receipt]]) {
    const retry = await handlers.changeWorldTime(request('host', { method: 'POST', body: command }));
    assert.equal(retry.status, 200);
    assert.deepEqual((await retry.json()).receipt, receipt);
  }
  assert.equal(database(game), before);
  game.db.prepare("UPDATE game_members SET role='player' WHERE campaign=? AND owner='host'").run(scope('host').campaign);
  const afterRevocation = database(game);
  const denied = await handlers.changeWorldTime(request('host', { method: 'POST', body }));
  assert.equal(denied.status, 403);
  assert.equal(database(game), afterRevocation);
});

test('stale revisions, changed previews and unsupported core fields cannot advance the current world', async t => {
  const context = await configured(t), { game, handlers } = context;
  const prepared = await preview(context);
  const stale = input(game, 'advance', 'stale-advance', { previewId: prepared.result.preview.previewId });
  game.command(scope('p1'), { type: 'move', requestId: 'fictional-position-change', expectedRevision: game.view(scope('p1')).revision, actorId: 'hero', path: [{ x: 3, y: 2 }] });
  const before = database(game);
  const response = await handlers.changeWorldTime(request('host', { method: 'POST', body: stale }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'STALE');
  const changedPreview = await handlers.changeWorldTime(request('host', { method: 'POST', body: input(game, 'advance', 'changed-preview', { previewId: prepared.result.preview.previewId }) }));
  assert.equal(changedPreview.status, 409);
  const valid = input(game, 'preview', 'malformed-review', { targetTick: 11, reason: 'Reviewed interval.' });
  for (const extra of [{ owner: 'p1' }, { campaign: 'another' }, { arbitrary: true }, { reviewed: false }]) {
    const rejected = await handlers.changeWorldTime(request('host', { method: 'POST', body: { ...valid, ...extra } }));
    assert.equal(rejected.status, 400, await rejected.clone().text());
    privateResponse(rejected);
  }
  assert.equal(database(game), before);
});

test('paused calendar reads remain available while fresh interval mutations fail privately', async t => {
  const context = await configured(t), { game, handlers } = context;
  game.command(scope('p1'), { type: 'pause', requestId: 'pause-calendar', expectedRevision: game.view(scope('p1')).revision, actorId: 'hero' });
  const before = database(game);
  const current = await handlers.worldTime(request('p1'));
  assert.equal(current.status, 200);
  const response = await handlers.changeWorldTime(request('host', { method: 'POST', body: input(game, 'preview', 'paused-preview', { targetTick: 11, reason: 'Reviewed interval.' }) }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PAUSED');
  privateResponse(response);
  assert.equal(database(game), before);
});

test('unknown service failures never disclose database locations or provider details', async t => {
  const { game, handlers } = setup(t);
  game.worldTime = () => { throw new Error('database C:/private secret-provider-key'); };
  const response = await handlers.worldTime(request('p1'));
  assert.equal(response.status, 503);
  privateResponse(response);
  assert.doesNotMatch(await response.text(), /database|C:\/private|secret-provider-key/);
});
