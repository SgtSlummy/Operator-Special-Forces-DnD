import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
const player = { campaign: 'checks', owner: 'alice' }, host = { ...player, owner: 'host' };
function setup(path = ':memory:', dice = [4, 17]) {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, wisdom: { value: 9 }, proficiencyBonus: { value: 3 } } };
  const saved = { revision: 2, snapshot }, characters = { character: () => saved };
  const version = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, owner, x) => ({ id, owner, name: id, team: owner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative: owner ? 20 : 10, characterVersion: version, weapon: { name: 'Bow', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 60 } });
  let rolls = 0;
  const game = new GameStore(path, { rollDie: () => { const value = dice[rolls]; rolls++; return value; } });
  game.createCampaign({ campaign: 'checks', title: 'Checks', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1), actor('foe', null, 4)], effects: [] });
  const prompt = { id: 'balance', reviewed: true, expectedRevision: 1, actorId: 'scout', label: 'Keep your balance', kind: 'check', ability: 'dexterity', proficiencyMultiplier: 2, proficiencyReason: 'Host-reviewed expertise', advantage: ['Stable handhold'], disadvantage: [], adjustments: [{ source: 'Reviewed equipment', value: 1 }], dc: 25, cost: 'action' };
  return { game, characters, saved, prompt, rolls: () => rolls };
}
test('approved stats, expertise and advantage resolve once and survive restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-checks-')), 'game.sqlite');
  const h = setup(file); let game = h.game;
  try {
    const pending = game.requestCheck(h.characters, host, h.prompt);
    assert.equal(pending.modifiers.reduce((n, m) => n + m.value, 0), 10);
    assert.equal(pending.dc, undefined); assert.equal(game.view(player).revision, 1);
    assert.deepEqual(game.pendingChecks({ ...player, owner: 'bob' }), []);
    const input = { checkId: 'balance', requestId: 'roll-balance' };
    assert.throws(() => game.resolveCheck({ ...player, owner: 'bob' }, input), { code: 'UNAUTHORIZED' });
    const receipt = game.resolveCheck(player, input);
    assert.deepEqual(receipt.result.dice, [4, 17]); assert.deepEqual(receipt.result.discardedDice, [4]);
    assert.equal(receipt.result.total, 27); assert.equal(receipt.result.success, true); assert.equal(receipt.result.keptIndex, 1);
    assert.equal(game.view(player).actionAvailable, false); assert.equal(receipt.result.dc, undefined);
    assert.equal(h.rolls(), 2); assert.deepEqual(game.resolveCheck(player, input), receipt);
    assert.throws(() => game.resolveCheck(player, { ...input, requestId: 'roll-again' }), { code: 'CONFLICT' });
    game.close(); game = new GameStore(file, { rollDie: () => { throw new Error('Do not reroll'); } });
    assert.deepEqual(game.resolveCheck(player, input), receipt); assert.deepEqual(game.pendingChecks(player), []);
    assert.deepEqual(game.receipts({ ...player, owner: 'bob' }), []);
  } finally { game.close(); }
});
test('advantage and disadvantage cancel; saves use totals without attack critical rules', () => {
  const h = setup(':memory:', [20]);
  try {
    const prompt = { ...h.prompt, kind: 'save', ability: 'wisdom', proficiencyMultiplier: 1, advantage: ['Aid'], disadvantage: ['Interference'], adjustments: [], dc: 30, cost: 'none' };
    assert.equal(h.game.requestCheck(h.characters, host, prompt).mode, 'normal');
    const receipt = h.game.resolveCheck(player, { checkId: prompt.id, requestId: 'save' });
    assert.deepEqual(receipt.result.dice, [20]); assert.equal(receipt.result.total, 22); assert.equal(receipt.result.success, false);
    assert.equal(h.game.view(player).actionAvailable, true);
  } finally { h.game.close(); }
});
test('player check HTTP boundary accepts only owned prompt IDs and saved requests', async () => {
  const h = setup();
  try {
    h.game.requestCheck(h.characters, host, h.prompt);
    let revoked = false;
    const handlers = createGameHttp(() => ({ game: h.game, access: { authenticateAccess: () => { if (revoked) throw new Error(); return player; } } }));
    const request = (body, origin = 'https://raph.example') => new Request('https://raph.example/api/game/checks', { method: body ? 'POST' : 'GET', headers: { cookie: `raph_game_access=${'a'.repeat(64)}`, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await (await handlers.checks(request())).json(); assert.equal(data.pending.length, 1); assert.equal(data.pending[0].dc, undefined);
    const input = { checkId: h.prompt.id, requestId: 'http-check' };
    assert.equal((await handlers.resolveCheck(request({ ...input, modifiers: [] }))).status, 400);
    assert.equal((await handlers.resolveCheck(request(input, 'https://foreign.example'))).status, 403);
    const response = await handlers.resolveCheck(request(input)); assert.equal(response.status, 200);
    const receipt = (await response.json()).receipt;
    assert.deepEqual((await (await handlers.resolveCheck(request(input))).json()).receipt, receipt);
    revoked = true; assert.equal((await handlers.checks(request())).status, 401);
  } finally { h.game.close(); }
});

test('disadvantage keeps the lower die and failed random draws roll back action cost', () => {
  const h = setup(':memory:', [19, 1]);
  try {
    h.game.requestCheck(h.characters, host, { ...h.prompt, advantage: [], disadvantage: ['Darkness'], dc: 10 });
    const result = h.game.resolveCheck(player, { checkId: h.prompt.id, requestId: 'low' }).result;
    assert.equal(result.keptIndex, 1); assert.equal(result.total, 11); assert.equal(result.success, true);
  } finally { h.game.close(); }
  const invalid = setup(':memory:', [9, 99]);
  try {
    invalid.game.requestCheck(invalid.characters, host, invalid.prompt);
    assert.throws(() => invalid.game.resolveCheck(player, { checkId: invalid.prompt.id, requestId: 'bad-rng' }), { code: 'RNG' });
    assert.equal(invalid.game.view(player).revision, 1); assert.equal(invalid.game.view(player).actionAvailable, true);
    assert.equal(invalid.game.pendingChecks(player).length, 1); assert.deepEqual(invalid.game.receipts(player), []);
  } finally { invalid.game.close(); }
});

test('roll history pages survive intervening actions and restart without exposing other owners', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-roll-history-')), 'game.sqlite');
  const h = setup(file); let game = h.game;
  try {
    game.rollDie = sides => Math.min(10, sides);
    for (let i = 0; i < 25; i++) {
      game.requestCheck(h.characters, host, { ...h.prompt, id: `check-${i}`, expectedRevision: game.view(player).revision, cost: 'none', advantage: [] });
      game.resolveCheck(player, { checkId: `check-${i}`, requestId: `roll-${i}` });
    }
    for (let i = 0; i < 52; i++) game.command(i % 2 ? host : player, { requestId: `pause-${i}`, expectedRevision: game.view(player).revision, actorId: i % 2 ? 'foe' : 'scout', type: i % 2 ? 'resume' : 'pause' });
    game.command(player, { requestId: 'history-attack', expectedRevision: game.view(player).revision, actorId: 'scout', type: 'attack', targetId: 'foe' });
    assert.ok(!game.receipts(player).some(r => r.result.type === 'check'));
    const current = game.view(player), page = game.rollHistory(player), older = game.rollHistory(player, page.nextBefore);
    assert.equal(page.receipts.length, 20); assert.equal(older.receipts.length, 6); assert.equal(older.nextBefore, null);
    assert.equal(page.receipts[0].result.type, 'attack'); assert.equal(older.receipts.at(-1).requestId, 'roll-0');
    assert.equal(new Set([...page.receipts, ...older.receipts].map(r => r.requestId)).size, 26);
    assert.deepEqual(game.view(player), current); assert.deepEqual(game.rollHistory({ ...player, owner: 'bob' }).receipts, []);
    const handlers = createGameHttp(() => ({ game, access: { authenticateAccess: () => player } }));
    for (const query of ['?before=-1', '?before=0', '?before=1&before=2', '?owner=bob', '?before=1.5']) {
      const req = new Request('https://raph.example/api/game/checks' + query, { headers: { cookie: `raph_game_access=${'a'.repeat(64)}` } });
      assert.equal((await handlers.checks(req)).status, 400);
    }
    const req = new Request(`https://raph.example/api/game/checks?before=${page.nextBefore}`, { headers: { cookie: `raph_game_access=${'a'.repeat(64)}` } });
    assert.deepEqual((await (await handlers.checks(req)).json()).receipts, older.receipts);
    game.close(); game = new GameStore(file);
    assert.deepEqual(game.rollHistory(player), page); assert.deepEqual(game.rollHistory(player, page.nextBefore), older);
    game.db.prepare('DELETE FROM game_members WHERE owner=?').run(player.owner);
    assert.throws(() => game.rollHistory(player), { code: 'UNAUTHORIZED' });
  } finally { game.close(); }
});

test('pending request limits apply after owner and current revision filtering', () => {
  const h = setup();
  try {
    h.game.requestCheck(h.characters, host, h.prompt);
    const row = h.game.db.prepare('SELECT * FROM game_checks WHERE id=?').get(h.prompt.id);
    for (let i = 0; i < 105; i++) {
      const body = { ...JSON.parse(row.body), id: `foreign-${i}`, owner: 'bob' };
      h.game.db.prepare('INSERT INTO game_checks VALUES(?,?,?,?,?,NULL)').run(player.campaign, body.id, 'host', 'fixture', JSON.stringify(body));
    }
    assert.deepEqual(h.game.pendingChecks(player).map(p => p.id), [h.prompt.id]);
    assert.equal(h.game.pendingChecks({ ...player, owner: 'bob' }).length, 100);
  } finally { h.game.close(); }
});

test('changed profiles, stale requests and unsupported overrides fail before dice or resources', () => {
  const h = setup();
  try {
    assert.throws(() => h.game.requestCheck(h.characters, player, h.prompt), { code: 'UNAUTHORIZED' });
    h.saved.revision++;
    assert.throws(() => h.game.requestCheck(h.characters, host, h.prompt), { code: 'PROFILE' }); h.saved.revision--;
    assert.throws(() => h.game.requestCheck(h.characters, host, { ...h.prompt, abilityScore: 30 }), { code: 'INVALID' });
    h.game.requestCheck(h.characters, host, h.prompt);
    h.game.command(player, { requestId: 'move', expectedRevision: 1, actorId: 'scout', type: 'move', path: [{ x: 2, y: 1 }] });
    assert.deepEqual(h.game.pendingChecks(player), []);
    assert.throws(() => h.game.resolveCheck(player, { checkId: h.prompt.id, requestId: 'stale' }), { code: 'STALE' });
    assert.equal(h.rolls(), 0); assert.equal(h.game.view(player).actionAvailable, true);
  } finally { h.game.close(); }
});
