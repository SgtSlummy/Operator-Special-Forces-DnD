import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';

const player = { campaign: 'effects', owner: 'player' };
const host = { campaign: 'effects', owner: 'host' };
const hp = (view, id = 'hero') => view.actors.find(actor => actor.id === id).hp;

function fixture(t, { heroHp = 20, effects } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'raph-effects-'));
  const path = join(directory, 'game.sqlite');
  const options = { rollDie: () => { throw new Error('Fixed-damage hazards must not roll dice.'); } };
  let current = new GameStore(path, options);
  const weapon = { name: 'Sword', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 };
  const actor = { name: 'Hero', x: 1, y: 1, size: 1, hp: heroHp, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 20, characterVersion: 'approved', weapon };
  current.createCampaign({
    campaign: player.campaign,
    title: 'Hazard timing fixture',
    members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }],
    map: { id: 'map', title: 'Hazard chamber', width: 8, height: 8, blocked: [], difficult: [] },
    actors: [{ ...actor, id: 'hero', owner: 'player', team: 'party' }, { ...actor, id: 'enemy', name: 'Enemy', owner: null, team: 'enemy', x: 5, y: 5, hp: 20, initiative: 10 }],
    effects: effects ?? [{ id: 'zone', name: 'Lingering fire', trigger: 'end_turn', damage: 3, expiresAtTurn: 4, visible: true, cells: [{ x: 1, y: 1 }] }],
  });
  t.after(() => { current.db.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return current; },
    restart() { current.db.close(); current = new GameStore(path, options); return current; },
  };
}

function command(store, scope, type, requestId, extra = {}) {
  const input = { type, requestId, expectedRevision: store.view(scope).revision, ...extra };
  return { input, result: store.command(scope, input) };
}

function mission(store) {
  store.configureMission(host, {
    reviewed: true,
    tracks: [{ id: 'readiness', label: 'Expedition readiness', kind: 'readiness', value: 50 }],
    mission: {
      id: 'hold-the-chamber', title: 'Hold the chamber', briefing: 'Survive the lingering fire.', mapId: 'map', successTeam: 'party',
      success: { summary: 'The expedition holds the chamber.', changes: [{ trackId: 'readiness', delta: 7 }] },
      failure: { summary: 'The expedition loses the chamber.', changes: [{ trackId: 'readiness', delta: -9 }] },
    },
  });
}

function world(store) {
  return JSON.parse(store.db.prepare('SELECT body FROM world_campaigns WHERE campaign=?').get(player.campaign).body);
}

function counts(store) {
  return Object.fromEntries(['game_events', 'game_outbox', 'game_receipts', 'world_events'].map(table => [table, store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE campaign=?`).get(player.campaign).count]));
}

test('end-turn hazards wait through entry, then publish damage before the turn boundary in every saved view', t => {
  const { store } = fixture(t);
  assert.equal(hp(store.view(player)), 20, 'an end-turn zone does not trigger when the encounter starts');
  command(store, player, 'move', 'leave-zone', { actorId: 'hero', path: [{ x: 2, y: 1 }] });
  command(store, player, 'move', 'reenter-zone', { actorId: 'hero', path: [{ x: 1, y: 1 }] });
  const before = store.view(player);
  assert.equal(hp(before), 20, 'entering an end-turn zone does not trigger it early');
  assert.equal(store.events(host).filter(event => event.kind === 'effect_triggered').length, 0);

  command(store, player, 'end_turn', 'end-in-zone', { actorId: 'hero' });
  const events = store.events(host).filter(event => event.revision > before.revision);
  assert.deepEqual(events.map(event => event.kind), ['effect_triggered', 'turn_ended', 'turn_started']);
  assert.equal(events[0].body.trigger, 'end_turn');
  assert.equal(events[0].body.actorId, 'hero');
  assert.equal(events[0].body.damage, 3);
  assert.equal(events[0].body.hp, 17);
  assert.equal(events[0].body.turn, before.turn);

  const updates = store.updates(player, before.revision, 50);
  assert.equal(updates.hasMore, false);
  assert.deepEqual(updates.views.map(view => view.revision), events.map(event => event.revision));
  assert.deepEqual(updates.views.map(view => hp(view)), [17, 17, 17]);
  assert.deepEqual(updates.views.map(view => view.turn), [before.turn, before.turn, before.turn + 1]);
  assert.ok(updates.views.every(view => view.effects.some(effect => effect.id === 'zone')));
});

test('zones expire before the destination global turn, after eligible end-turn damage', t => {
  const { store } = fixture(t, { effects: [
    { id: 'ending-fire', name: 'Ending fire', trigger: 'end_turn', damage: 3, expiresAtTurn: 2, visible: true, cells: [{ x: 1, y: 1 }] },
    { id: 'starting-fire', name: 'Starting fire', trigger: 'start_turn', damage: 4, expiresAtTurn: 2, visible: true, cells: [{ x: 5, y: 5 }] },
  ] });
  const before = store.view(host);
  assert.equal(before.turn, 1);
  command(store, player, 'end_turn', 'expire-at-boundary', { actorId: 'hero' });
  const events = store.events(host).filter(event => event.revision > before.revision);
  assert.deepEqual(events.map(event => event.kind), ['effect_triggered', 'turn_ended', 'effect_expired', 'effect_expired', 'turn_started']);
  assert.deepEqual(events.filter(event => event.kind === 'effect_expired').map(event => event.body.effectId).sort(), ['ending-fire', 'starting-fire']);
  const views = store.updates(host, before.revision, 50).views;
  for (const event of events.filter(event => event.kind === 'effect_expired')) {
    const view = views.find(candidate => candidate.revision === event.revision);
    assert.equal(view.turn, 2);
    assert.ok(!view.effects.some(effect => effect.id === event.body.effectId), 'the expiry snapshot already removes the expired zone');
  }
  const after = store.view(host);
  assert.equal(hp(after), 17);
  assert.equal(hp(after, 'enemy'), 20, 'an effect expiring before turn two cannot trigger at its start');
  assert.deepEqual(after.effects, []);
});

test('pause freezes hazard timing, and receipt retries survive restart without duplicate damage', t => {
  const setup = fixture(t);
  let store = setup.store;
  const initial = store.view(player);
  command(store, host, 'pause', 'pause-fixture', { actorId: 'enemy' });
  const paused = store.view(player);
  const pausedEvents = store.events(host);
  assert.throws(() => store.command(player, { type: 'end_turn', actorId: 'hero', requestId: 'paused-end', expectedRevision: paused.revision }), error => error.code === 'PAUSED');
  assert.deepEqual(store.view(player), paused);
  assert.deepEqual(store.events(host), pausedEvents);
  assert.equal(hp(paused), 20);
  assert.equal(paused.turn, initial.turn);
  command(store, host, 'resume', 'resume-fixture', { actorId: 'enemy' });
  const { input, result } = command(store, player, 'end_turn', 'saved-hazard-end', { actorId: 'hero' });
  const after = store.view(player);
  const savedCounts = counts(store);
  assert.equal(hp(after), 17);
  assert.deepEqual(store.command(player, input), result);
  assert.deepEqual(counts(store), savedCounts);

  store = setup.restart();
  assert.deepEqual(store.view(player), after);
  assert.deepEqual(store.command(player, input), result, 'the original revision remains a valid retry for the saved request');
  assert.deepEqual(store.view(player), after);
  assert.deepEqual(counts(store), savedCounts);
  assert.equal(store.events(host).filter(event => event.kind === 'effect_triggered').length, 1);
});

test('lethal end-turn damage resolves the reviewed mission outcome once in the same action', t => {
  const { store } = fixture(t, { heroHp: 2 });
  mission(store);
  const before = store.view(player);
  const { input, result } = command(store, player, 'end_turn', 'lethal-end', { actorId: 'hero' });
  const events = store.events(host).filter(event => event.revision > before.revision);
  assert.deepEqual(events.map(event => event.kind), ['effect_triggered', 'turn_ended', 'encounter_completed']);
  const after = store.view(player);
  assert.equal(after.phase, 'complete');
  assert.equal(hp(after), 0);
  const resolved = world(store);
  assert.equal(resolved.revision, 2);
  assert.equal(resolved.mission.status, 'debrief');
  assert.equal(resolved.outcome.result, 'failure');
  assert.equal(resolved.tracks[0].value, 41);
  assert.deepEqual(resolved.outcome.changes, [{ trackId: 'readiness', before: 50, after: 41 }]);
  assert.equal(resolved.outcome.source, `game:${player.campaign}:${events.at(-1).revision}`);
  const snapshots = store.updates(player, before.revision, 50).views;
  assert.deepEqual(snapshots.map(view => hp(view)), [0, 0, 0]);
  assert.equal(snapshots.at(-1).phase, 'complete');
  const savedCounts = counts(store);
  assert.deepEqual(store.command(player, input), result);
  assert.throws(() => store.command(player, { ...input, requestId: 'different-end', expectedRevision: after.revision }));
  assert.deepEqual(world(store), resolved);
  assert.deepEqual(counts(store), savedCounts);
});

test('failed mission persistence rolls back hazard damage, snapshots and receipt so the same request can succeed once', t => {
  const { store } = fixture(t, { heroHp: 2 });
  mission(store);
  const before = store.view(player), beforeWorld = world(store), beforeEvents = store.events(host), beforeCounts = counts(store);
  const input = { type: 'end_turn', actorId: 'hero', requestId: 'retry-after-world-failure', expectedRevision: before.revision };
  store.db.exec("CREATE TRIGGER reject_effect_fixture_world BEFORE INSERT ON world_events BEGIN SELECT RAISE(ABORT, 'effect fixture world write failure'); END;");
  assert.throws(() => store.command(player, input), /effect fixture world write failure/);
  assert.deepEqual(store.view(player), before);
  assert.deepEqual(world(store), beforeWorld);
  assert.deepEqual(store.events(host), beforeEvents);
  assert.deepEqual(counts(store), beforeCounts);
  assert.deepEqual(store.updates(player, before.revision, 50).views, []);

  store.db.exec('DROP TRIGGER reject_effect_fixture_world');
  const result = store.command(player, input);
  assert.equal(hp(store.view(player)), 0);
  assert.equal(world(store).tracks[0].value, 41);
  assert.equal(world(store).revision, 2);
  assert.equal(store.events(host).filter(event => event.kind === 'effect_triggered').length, 1);
  const savedCounts = counts(store);
  assert.deepEqual(store.command(player, input), result);
  assert.deepEqual(counts(store), savedCounts);
});

test('saved effect events distinguish entry and start-of-turn damage from end-of-turn damage', t => {
  for (const trigger of ['enter', 'start_turn']) {
    const { store } = fixture(t, { effects: [{ id: `zone-${trigger}`, name: 'Timed zone', trigger, damage: 3, expiresAtTurn: 4, visible: true, cells: [{ x: trigger === 'enter' ? 2 : 1, y: 1 }] }] });
    if (trigger === 'enter') command(store, player, 'move', 'enter-effect', { actorId: 'hero', path: [{ x: 2, y: 1 }] });
    const events = store.events(host).filter(event => event.kind === 'effect_triggered');
    assert.equal(events.length, 1);
    assert.equal(events[0].body.trigger, trigger);
    assert.equal(events[0].body.damage, 3);
    assert.equal(events[0].body.hp, 17);
    assert.equal(hp(store.view(player)), 17);
  }
});
