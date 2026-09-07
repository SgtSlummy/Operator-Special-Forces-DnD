import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Agent, createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { createConcentrationHttp } from './concentration-http.mjs';

// Production game/concentration Request adapters over a real loopback HTTP server.
// The cookie authenticator is a fixture seam, not Discord OAuth or Next routing.
const campaign = 'concentration_multiplayer_network';
const tokens = { host: 'a'.repeat(64), player: 'b'.repeat(64), other: 'c'.repeat(64) };
const scope = owner => ({ campaign, owner });
const snapshot = { edition: '2024', fields: { constitution: { value: 14 }, proficiencyBonus: { value: 2 } } };
const characterVersion = `approved-1-${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)}`;
const weapon = { name: 'Reviewed blade', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
const combatCapabilities = { attackKind: 'melee', meleeReachFeet: 5, constitutionSave: { abilityScore: 14, proficiencyBonus: 2, proficient: true, adjustments: [], advantage: [], disadvantage: [] } };
const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'guards', x, y: 2, size: 1, hp: 100, maxHp: 100, ac: 12, speed: 30, vision: 8, initiative, characterVersion, weapon, combatCapabilities, combatReview: { constitutionProficiencyReason: 'Reviewed fictional Constitution save proficiency.' } });
const effect = (id, x, damage) => ({ id, name: id, trigger: 'enter', damage, expiresAtTurn: 99, visible: true, cells: [{ x, y: 2 }] });

function session(context, owner) {
  let agent = new Agent({ keepAlive: true, maxSockets: 1 });
  return {
    owner,
    reconnect() { agent.destroy(); agent = new Agent({ keepAlive: true, maxSockets: 1 }); },
    close() { agent.destroy(); },
    send(path, body) {
      const url = new URL(path, context.origin), data = body === undefined ? null : JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const outgoing = httpRequest(url, {
          agent, method: data === null ? 'GET' : 'POST',
          headers: { cookie: `raph_game_access=${tokens[owner]}`, ...(data === null ? {} : { origin: context.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }) },
        }, incoming => {
          const chunks = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, bytes: Buffer.concat(chunks) }));
        });
        outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Fixture HTTP request timed out')));
        outgoing.on('error', reject);
        outgoing.end(data);
      });
    },
  };
}

function privateResponse(response, status = 200) {
  assert.equal(response.status, status, response.bytes.toString('utf8'));
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers.vary, 'Cookie');
  return JSON.parse(response.bytes.toString('utf8'));
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-concentration-multiplayer-'));
  const databasePath = join(directory, 'game.sqlite');
  const draws = [], rolls = [1], socketsByOwner = new Map(), serverErrors = [];
  let origin, server, game, dropRequestId = null, dropped = null;
  const clients = [];
  const openStore = () => new GameStore(databasePath, { rollDie(sides) {
    const value = rolls.shift();
    assert.ok(Number.isInteger(value) && value >= 1 && value <= sides, `unexpected d${sides} draw`);
    draws.push({ sides, value });
    return value;
  } });
  const access = { authenticateAccess(token) {
    const owner = Object.keys(tokens).find(owner => tokens[owner] === token);
    if (!owner) throw new Error('Fictional session is not authorized');
    return scope(owner);
  } };
  const services = () => ({ game, access });
  const gameHttp = createGameHttp(services);
  const concentrationHttp = createConcentrationHttp(services);
  const routes = {
    'GET /api/game': gameHttp.state,
    'POST /api/game/command': gameHttp.command,
    'GET /api/game/map': gameHttp.map,
    'GET /api/game/concentration': concentrationHttp.concentration,
    'POST /api/game/concentration': concentrationHttp.resolveConcentration,
  };
  async function listen() {
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), url = new URL(incoming.url, origin);
        const handle = routes[`${incoming.method} ${url.pathname}`];
        if (!handle) { outgoing.writeHead(404); outgoing.end(); return; }
        const owner = Object.keys(tokens).find(name => incoming.headers.cookie === `raph_game_access=${tokens[name]}`);
        if (owner) {
          if (!socketsByOwner.has(owner)) socketsByOwner.set(owner, new Set());
          socketsByOwner.get(owner).add(incoming.socket.remotePort);
        }
        const response = await handle(new Request(url, {
          method: incoming.method, headers: incoming.headers,
          ...(bytes.length ? { body: bytes } : {}),
        }));
        const payload = Buffer.from(await response.arrayBuffer());
        const posted = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
        if (dropRequestId && posted?.requestId === dropRequestId) {
          assert.equal(response.status, 200, payload.toString('utf8'));
          dropped = { status: response.status, body: JSON.parse(payload.toString('utf8')) };
          dropRequestId = null;
          // The adapter transaction finished, but no response bytes reach the caller.
          incoming.socket.destroy();
          return;
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(payload);
      } catch (error) {
        serverErrors.push(error);
        if (!outgoing.destroyed) { outgoing.writeHead(500); outgoing.end('Fixture server failure'); }
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function stopServer() {
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = null;
  }
  game = openStore();
  t.after(async () => {
    for (const client of clients) client.close();
    await stopServer();
    game.close();
    const target = realpathSync(directory);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.ok(basename(target).startsWith('raph-concentration-multiplayer-'));
    rmSync(target, { recursive: true, force: true });
  });
  game.createCampaign({
    campaign, title: 'Fictional concentration network acceptance',
    members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }, { owner: 'other', role: 'player' }],
    map: { id: 'network_map', title: 'Fictional network map', width: 10, height: 10, blocked: [], difficult: [] },
    actors: [actor('hero', 'player', 2, 30), actor('ally', 'other', 5, 20), actor('guard', null, 8, 10)],
    effects: [effect('focus', 7, 0), effect('first_hazard', 3, 6), effect('second_hazard', 4, 3)],
  });
  await listen();
  const context = {
    get origin() { return origin; }, get game() { return game; }, get dropped() { return dropped; },
    draws, socketsByOwner, serverErrors,
    connect(owner) { const client = session(context, owner); clients.push(client); return client; },
    loseResponse(requestId) { assert.equal(dropRequestId, null); dropRequestId = requestId; },
    async restart() {
      for (const client of clients) client.reconnect();
      await stopServer();
      game.close(); game = openStore();
      await listen();
    },
  };
  return context;
}

function assertGenericWaiting(concentration) {
  assert.equal(concentration.pending.canResolve, false);
  for (const key of ['id', 'actorId', 'dc', 'damageTaken', 'sourceLabel', 'profile', 'origin']) assert.equal(concentration.pending[key], undefined, key);
  assert.doesNotMatch(JSON.stringify(concentration), /Secret source label|Secret reviewed reason/);
}

test('two independent player HTTP sessions preserve concentration privacy and replay after socket loss and server restart', async t => {
  const context = await fixture(t);
  const player = context.connect('player'), other = context.connect('other'), host = context.connect('host');
  const initial = await Promise.all([player, other, host].map(async client => privateResponse(await client.send('/api/game'))));
  assert.deepEqual(initial.map(result => result.view.revision), [1, 1, 1]);
  const ports = [...context.socketsByOwner.values()].map(values => [...values][0]);
  assert.equal(new Set(ports).size, 3, 'each cookie session has its own live TCP connection');
  assert.equal(initial[0].view.actors.find(a => a.id === 'hero').hp, 100);
  assert.equal(initial[1].view.actors.find(a => a.id === 'hero').hp, undefined);

  const start = privateResponse(await host.send('/api/game/concentration', {
    action: 'start', requestId: 'network_start', expectedRevision: initial[2].view.revision,
    actorId: 'hero', characterVersion, sourceLabel: 'Secret source label', effectIds: ['focus'], reviewed: true, reason: 'Secret reviewed reason',
  }));
  const moveInput = { type: 'move', actorId: 'hero', requestId: 'network_move', expectedRevision: start.receipt.revision, path: [{ x: 3, y: 2 }, { x: 4, y: 2 }] };
  const movement = privateResponse(await player.send('/api/game/command', moveInput));
  assert.equal(movement.receipt.result.stopped, true);
  assert.deepEqual(movement.receipt.result.path, [{ x: 3, y: 2 }]);
  assert.deepEqual(context.draws, []);
  const ownerPending = privateResponse(await player.send('/api/game/concentration')).concentration;
  assert.equal(ownerPending.pending.canResolve, true);
  assert.equal(ownerPending.pending.actorId, 'hero');
  assert.equal(ownerPending.pending.dc, 10);
  assert.equal(ownerPending.pending.damageTaken, 6);
  const peerPending = privateResponse(await other.send('/api/game/concentration')).concentration;
  assertGenericWaiting(peerPending);
  const ownerView = privateResponse(await player.send('/api/game')).view;
  const peerView = privateResponse(await other.send('/api/game')).view;
  assert.equal(ownerView.revision, peerView.revision);
  assert.equal(ownerView.actors.find(a => a.id === 'hero').hp, 94);
  assert.equal(ownerView.actors.find(a => a.id === 'hero').x, 3);
  assert.equal(ownerView.movementRemaining, 25);
  assert.equal(peerView.actors.find(a => a.id === 'hero').hp, undefined);
  assert.equal(peerView.pendingConcentration.dc, undefined);

  const resolveInput = { action: 'resolve', requestId: 'network_resolve', expectedRevision: ownerPending.revision, pendingId: ownerPending.pending.id };
  const waitingState = context.game.load(campaign);
  privateResponse(await other.send('/api/game/concentration', resolveInput), 403);
  privateResponse(await host.send('/api/game/concentration', resolveInput), 403);
  assert.deepEqual(context.game.load(campaign), waitingState);
  assert.deepEqual(context.draws, []);

  // A fresh transport and reopened SQLite store must preserve the same pending save.
  await context.restart();
  const reloaded = privateResponse(await player.send('/api/game/concentration')).concentration;
  assert.deepEqual(reloaded.pending, ownerPending.pending);
  assertGenericWaiting(privateResponse(await other.send('/api/game/concentration')).concentration);
  const repeatedMove = privateResponse(await player.send('/api/game/command', moveInput));
  assert.deepEqual(repeatedMove.receipt, movement.receipt);
  assert.deepEqual(context.game.load(campaign), waitingState);
  assert.deepEqual(context.draws, []);

  context.loseResponse(resolveInput.requestId);
  await assert.rejects(player.send('/api/game/concentration', resolveInput), error => error.code === 'ECONNRESET');
  assert.equal(context.dropped?.status, 200, 'the save committed before the transport was dropped');
  assert.equal(context.dropped.body.receipt.result.type, 'concentration_save');
  assert.equal(context.dropped.body.receipt.result.success, false);
  assert.deepEqual(context.draws, [{ sides: 20, value: 1 }]);
  player.reconnect();
  const afterLoss = privateResponse(await player.send('/api/game')).view;
  assert.equal(afterLoss.actors.find(a => a.id === 'hero').x, 4);
  assert.equal(afterLoss.actors.find(a => a.id === 'hero').hp, 91);
  assert.equal(afterLoss.movementRemaining, 20);
  assert.equal(afterLoss.actionAvailable, true);
  assert.equal(afterLoss.pendingConcentration, undefined);
  const settledState = context.game.load(campaign);
  assert.equal((settledState.continuations ?? []).length, 0);
  assert.deepEqual(settledState.effects.map(e => e.id), ['first_hazard', 'second_hazard']);

  const replay = privateResponse(await player.send('/api/game/concentration', resolveInput));
  assert.deepEqual(replay.receipt, context.dropped.body.receipt);
  assert.deepEqual(context.game.load(campaign), settledState);
  const changed = { ...resolveInput, expectedRevision: resolveInput.expectedRevision + 1 };
  privateResponse(await player.send('/api/game/concentration', changed), 409);
  assert.deepEqual(context.game.load(campaign), settledState);
  assert.deepEqual(context.draws, [{ sides: 20, value: 1 }]);

  await context.restart();
  const savedAfterRestart = privateResponse(await player.send('/api/game/concentration', resolveInput));
  assert.deepEqual(savedAfterRestart.receipt, replay.receipt);
  const finalOwner = privateResponse(await player.send('/api/game/concentration')).concentration;
  const finalOther = privateResponse(await other.send('/api/game/concentration')).concentration;
  assert.equal(finalOwner.pending, null);
  assert.equal(finalOther.pending, null);
  assert.ok(finalOwner.recentResults.some(r => r.requestId === resolveInput.requestId));
  assert.equal(finalOther.recentResults.length, 0);
  const finalViews = await Promise.all([player, other, host].map(async client => privateResponse(await client.send('/api/game')).view));
  assert.deepEqual(finalViews.map(view => view.revision), [settledState.revision, settledState.revision, settledState.revision]);
  const ownerMap = await player.send(`/api/game/map?revision=${settledState.revision}`);
  const peerMap = await other.send(`/api/game/map?revision=${settledState.revision}`);
  for (const response of [ownerMap, peerMap]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers.vary, 'Cookie');
    assert.equal(response.headers['x-raph-revision'], String(settledState.revision));
    assert.equal(response.headers['content-type'], 'image/png');
    assert.deepEqual(response.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }

  // Existing cookie authority is checked on every request, including saved replay.
  context.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(campaign, 'player');
  const revokedReplay = await player.send('/api/game/concentration', resolveInput);
  assert.ok([401, 403].includes(revokedReplay.status), revokedReplay.bytes.toString('utf8'));
  assert.doesNotMatch(revokedReplay.bytes.toString('utf8'), /Secret source label|concentration_save|damageTaken/);
  assert.deepEqual(context.game.load(campaign), settledState);
  assert.deepEqual(context.draws, [{ sides: 20, value: 1 }]);
  assert.deepEqual(context.serverErrors, []);
});

test('a mixed concentration action is a client error over HTTP without mutation or dice', async t => {
  const context = await fixture(t), player = context.connect('player');
  const view = privateResponse(await player.send('/api/game')).view;
  const before = context.game.load(campaign);
  const response = await player.send('/api/game/concentration', {
    action: 'end', requestId: 'network_malformed', expectedRevision: view.revision,
    actorId: 'hero', pendingId: 'fixture_pending',
  });
  assert.deepEqual(context.game.load(campaign), before);
  assert.deepEqual(context.draws, []);
  assert.deepEqual(context.serverErrors, []);
  const body = privateResponse(response, 400);
  assert.equal(body.code, 'INVALID');
  assert.doesNotMatch(body.error, /Retry the same saved action|service could not finish/);
});
