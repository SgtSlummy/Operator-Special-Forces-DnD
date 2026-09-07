import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';

const player = { campaign: 'checks', owner: 'player' };
const host = { campaign: 'checks', owner: 'host' };

function setup(path = ':memory:') {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 16 }, proficiencyBonus: { value: 2 } } };
  const characters = { character: () => ({ revision: 1, snapshot }) };
  const characterVersion = 'approved-1-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, owner, x) => ({ id, owner, name: id, team: owner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: owner ? 20 : 10, characterVersion: owner ? characterVersion : 'reviewed-npc', weapon: { name: 'Sword', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
  let rolls = 0;
  const rollDie = sides => { rolls++; return Math.min(10, sides); };
  const game = new GameStore(path, { rollDie });
  game.createCampaign({ campaign: 'checks', title: 'Fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('hero', 'player', 1), actor('enemy', null, 2)], effects: [] });
  const prompt = { id: 'balance', reviewed: true, expectedRevision: game.view(player).revision, actorId: 'hero', label: 'Keep your balance', kind: 'check', ability: 'dexterity', proficiencyMultiplier: 1, proficiencyReason: 'Reviewed', advantage: [], disadvantage: [], adjustments: [], dc: 12, cost: 'action' };
  game.requestCheck(characters, host, prompt);
  return { game, characters, prompt, rollDie, rolls: () => rolls };
}

function command(game, type, requestId, extra = {}) {
  const resume = type === 'resume';
  return game.command(resume ? host : player, { type, actorId: resume ? 'enemy' : 'hero', requestId, expectedRevision: game.view(player).revision, ...extra });
}

function pauseResume(game, suffix) {
  command(game, 'pause', `pause-${suffix}`);
  command(game, 'resume', `resume-${suffix}`);
}

function savedCheck(game) {
  return game.db.prepare('SELECT * FROM game_checks WHERE campaign=? AND id=?').get(player.campaign, 'balance');
}

function assertStale(h, requestId) {
  const state = h.game.view(player), row = savedCheck(h.game), receipts = h.game.receipts(player), rolls = h.rolls();
  assert.deepEqual(h.game.pendingChecks(player), []);
  assert.throws(() => h.game.resolveCheck(player, { checkId: h.prompt.id, requestId }), { code: 'STALE' });
  assert.equal(h.rolls(), rolls);
  assert.deepEqual(h.game.view(player), state);
  assert.deepEqual(h.game.receipts(player), receipts);
  assert.deepEqual(savedCheck(h.game), row);
}

test('pending checks return after repeated pause/resume without rewriting the approved request', () => {
  const h = setup();
  try {
    const original = savedCheck(h.game), pending = h.game.pendingChecks(player)[0];
    assert.equal(pending.modifiers.reduce((sum, modifier) => sum + modifier.value, 0), 5);
    for (let cycle = 0; cycle < 3; cycle++) {
      command(h.game, 'pause', `pause-${cycle}`);
      assert.deepEqual(h.game.pendingChecks(player), []);
      const paused = h.game.view(player), receipts = h.game.receipts(player);
      assert.throws(() => h.game.resolveCheck(player, { checkId: h.prompt.id, requestId: `paused-roll-${cycle}` }), { code: 'PAUSED' });
      assert.equal(h.rolls(), 0);
      assert.deepEqual(h.game.view(player), paused);
      assert.deepEqual(h.game.receipts(player), receipts);
      assert.deepEqual(savedCheck(h.game), original);
      command(h.game, 'resume', `resume-${cycle}`);
      assert.deepEqual(h.game.pendingChecks(player), [{ ...pending, revision: h.game.view(player).revision }]);
      assert.equal(JSON.parse(savedCheck(h.game).body).expectedRevision, h.prompt.expectedRevision);
      assert.deepEqual(savedCheck(h.game), original);
    }
    const input = { checkId: h.prompt.id, requestId: 'resumed-roll' };
    const receipt = h.game.resolveCheck(player, input);
    assert.deepEqual(receipt.result.dice, [10]);
    assert.equal(receipt.result.total, 15);
    assert.equal(receipt.result.success, true);
    assert.equal(h.game.view(player).actionAvailable, false);
    assert.equal(h.rolls(), 1);
    const resolved = savedCheck(h.game), state = h.game.view(player), receipts = h.game.receipts(player);
    assert.equal(resolved.body, original.body);
    assert.equal(resolved.fingerprint, original.fingerprint);
    assert.deepEqual(h.game.resolveCheck(player, input), receipt);
    assert.throws(() => h.game.resolveCheck(player, { ...input, requestId: 'second-roll' }), { code: 'CONFLICT' });
    assert.equal(h.rolls(), 1);
    assert.deepEqual(h.game.view(player), state);
    assert.deepEqual(h.game.receipts(player), receipts);
    assert.deepEqual(savedCheck(h.game), resolved);
    assert.deepEqual(h.game.pendingChecks(player), []);
  } finally { h.game.close(); }
});

test('resumed pending checks and their single saved result survive restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'raph-check-pause-'));
  const file = join(directory, 'game.sqlite');
  const h = setup(file);
  let game = h.game;
  try {
    const original = savedCheck(game);
    pauseResume(game, 'before-restart');
    const revision = game.view(player).revision;
    game.close(); game = new GameStore(file, { rollDie: h.rollDie });
    assert.equal(game.pendingChecks(player).length, 1);
    assert.equal(game.pendingChecks(player)[0].revision, revision);
    assert.deepEqual(savedCheck(game), original);
    const input = { checkId: h.prompt.id, requestId: 'persistent-roll' };
    const receipt = game.resolveCheck(player, input);
    const resolved = savedCheck(game), state = game.view(player);
    assert.equal(h.rolls(), 1);
    assert.equal(state.actionAvailable, false);
    assert.equal(resolved.body, original.body);
    assert.equal(resolved.fingerprint, original.fingerprint);
    game.close(); game = new GameStore(file, { rollDie: () => { throw new Error('Saved check must not reroll'); } });
    assert.deepEqual(game.resolveCheck(player, input), receipt);
    assert.deepEqual(game.view(player), state);
    assert.deepEqual(savedCheck(game), resolved);
    assert.deepEqual(game.pendingChecks(player), []);
    assert.throws(() => game.resolveCheck(player, { ...input, requestId: 'persistent-roll-again' }), { code: 'CONFLICT' });
  } finally { game.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const type of ['move', 'attack', 'end_turn']) {
  test(`pause/resume cannot revive a check invalidated by ${type}`, () => {
    const h = setup();
    try {
      pauseResume(h.game, 'before-action');
      command(h.game, type, `intervening-${type}`, type === 'move' ? { path: [{ x: 1, y: 2 }] } : type === 'attack' ? { targetId: 'enemy' } : {});
      pauseResume(h.game, 'after-action');
      assertStale(h, `stale-${type}`);
    } finally { h.game.close(); }
  });
}

for (const missing of ['first', 'middle', 'last', 'all']) {
  test(`pause/resume history with ${missing} events missing fails closed`, () => {
    const h = setup();
    try {
      pauseResume(h.game, 'first');
      pauseResume(h.game, 'second');
      const revision = h.game.view(player).revision;
      // Corrupt only this isolated in-memory fixture to model incomplete persisted history.
      if (missing === 'all') h.game.db.prepare('DELETE FROM game_events WHERE campaign=? AND revision>?').run(player.campaign, h.prompt.expectedRevision);
      else h.game.db.prepare('DELETE FROM game_events WHERE campaign=? AND revision=?').run(player.campaign, missing === 'first' ? h.prompt.expectedRevision + 1 : missing === 'middle' ? h.prompt.expectedRevision + 2 : revision);
      assertStale(h, `missing-${missing}`);
    } finally { h.game.close(); }
  });
}

test('pause/resume recovery uses complete events even after command receipts leave the recent window', () => {
  const h = setup();
  try {
    const original = savedCheck(h.game);
    for (let cycle = 0; cycle < 55; cycle++) pauseResume(h.game, `long-${cycle}`);
    assert.ok(!h.game.receipts(player).some(receipt => receipt.requestId === 'pause-long-0'));
    assert.equal(h.game.pendingChecks(player).length, 1);
    assert.deepEqual(savedCheck(h.game), original);
    assert.equal(h.game.resolveCheck(player, { checkId: h.prompt.id, requestId: 'long-history-roll' }).result.total, 15);
    assert.equal(h.rolls(), 1);
  } finally { h.game.close(); }
});

test('fractional event revisions cannot fill a missing authoritative integer revision', () => {
  const h = setup();
  try {
    pauseResume(h.game, 'first');
    pauseResume(h.game, 'second');
    // Keep the same row count while replacing one required revision in this fixture.
    h.game.db.prepare('UPDATE game_events SET revision=revision+0.5 WHERE campaign=? AND revision=?').run(player.campaign, h.prompt.expectedRevision + 1);
    assertStale(h, 'fractional-history');
  } finally { h.game.close(); }
});

test('an actor profile change remains rejected after pause/resume even without a revision increment', () => {
  const h = setup();
  try {
    pauseResume(h.game, 'profile');
    const changed = h.game.load(player.campaign);
    changed.actors.find(actor => actor.id === 'hero').characterVersion = 'changed-profile';
    h.game.save(changed);
    const state = h.game.view(player), row = savedCheck(h.game), receipts = h.game.receipts(player);
    assert.throws(() => h.game.resolveCheck(player, { checkId: h.prompt.id, requestId: 'changed-profile-roll' }), { code: 'PROFILE' });
    assert.equal(h.rolls(), 0);
    assert.deepEqual(h.game.view(player), state);
    assert.deepEqual(h.game.receipts(player), receipts);
    assert.deepEqual(savedCheck(h.game), row);
  } finally { h.game.close(); }
});

for (const kind of ['unknown_event', 'effect_started', 'character_refreshed']) {
  test(`a ${kind} revision between pause/resume events prevents recovery`, () => {
    const h = setup();
    try {
      pauseResume(h.game, 'first');
      pauseResume(h.game, 'second');
      // The unknown/disallowed kind is confined to this isolated in-memory fixture.
      h.game.db.prepare('UPDATE game_events SET kind=? WHERE campaign=? AND revision=?').run(kind, player.campaign, h.prompt.expectedRevision + 2);
      assertStale(h, `event-${kind}`);
    } finally { h.game.close(); }
  });
}
