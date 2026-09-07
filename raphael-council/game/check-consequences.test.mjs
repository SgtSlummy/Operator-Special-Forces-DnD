import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';

const player = { campaign: 'save-damage', owner: 'alice' };
const host = { ...player, owner: 'host' }, ally = { ...player, owner: 'bob' };
const reviewReason = 'Reviewed hidden ward source: concealed-defender-42';
const mitigation = (overrides = {}) => ({ reduction: 0, resistance: false, vulnerability: false, immunity: false, reason: reviewReason, ...overrides });
const consequence = (overrides = {}) => ({ type: 'single_target_damage', dice: { count: 2, sides: 6, bonus: 2 }, damageType: 'fire', onSuccess: 'half', mitigation: mitigation(), ...overrides });
function setup({ path = ':memory:', dice = [3, 5, 6], includeAlly = false } = {}) {
  const snapshot = { edition: '2024', fields: { dexterity: { value: 17 }, wisdom: { value: 9 }, proficiencyBonus: { value: 3 } } };
  const saved = { revision: 2, snapshot }, characters = { character: () => saved };
  const version = 'approved-2-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
  const actor = (id, owner, x, initiative) => ({ id, owner, name: id, team: owner ? 'party' : 'enemy', x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 5, initiative, characterVersion: version, weapon: { name: 'Bow', abilityScore: 17, proficiencyBonus: 3, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 60 } });
  const actors = [actor('scout', 'alice', 1, 20), actor('foe', null, 4, 10)];
  if (includeAlly) actors.push(actor('ally', 'bob', 2, 15));
  const dieSides = [];
  const game = new GameStore(path, { rollDie: sides => { const value = dice[dieSides.length]; dieSides.push(sides); return value; } });
  game.createCampaign({ campaign: player.campaign, title: 'Save damage', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'map', title: 'Map', width: 8, height: 8, blocked: [], difficult: [] }, actors, effects: [] });
  const prompt = { id: 'hazard-save', reviewed: true, expectedRevision: 1, actorId: 'scout', label: 'Avoid the reviewed fire hazard', kind: 'save', ability: 'dexterity', proficiencyMultiplier: 0, proficiencyReason: 'Reviewed: no saving throw proficiency applies', advantage: [], disadvantage: [], adjustments: [], dc: 15, cost: 'none', consequence: consequence() };
  return { game, saved, characters, prompt, dieSides };
}
function hp(game, actorId = 'scout') { return game.view(host).actors.find(actor => actor.id === actorId).hp; }
function events(game) { return game.db.prepare('SELECT revision,kind,body FROM game_events WHERE campaign=? ORDER BY revision').all(player.campaign).map(row => ({ ...row, body: JSON.parse(row.body) })); }
function checkRows(game) { return game.db.prepare('SELECT * FROM game_checks WHERE campaign=? ORDER BY id').all(player.campaign); }
function resolve(h, input = {}, session = player) { return h.game.resolveCheck(session, { checkId: h.prompt.id, requestId: 'resolve-hazard', ...input }); }
function without(value, key) { const result = structuredClone(value); delete result[key]; return result; }
function plainMitigation(overrides = {}) { return { reduction: 0, resistance: false, vulnerability: false, immunity: false, ...overrides }; }

test('failed saving throw rolls damage after save dice and publishes the exact sanitized breakdown', () => {
  const h = setup({ dice: [3, 18, 5, 6] });
  try {
    const prompt = { ...h.prompt, advantage: ['Reviewed footing'], dc: 25 };
    const pending = h.game.requestCheck(h.characters, host, prompt);
    assert.deepEqual(pending.consequence, { type: 'single_target_damage', damageType: 'fire', onSuccess: 'half' });
    for (const publicPending of [pending, h.game.pendingChecks(player)]) {
      const json = JSON.stringify(publicPending);
      for (const secret of [reviewReason, 'concealed-defender-42', '"mitigation"', '"dc"']) assert.equal(json.includes(secret), false);
    }
    assert.deepEqual(h.game.pendingChecks(ally), []);
    const before = h.game.view(player), receipt = resolve(h);
    const expected = { type: 'single_target_damage', damageType: 'fire', dice: [5, 6], dieSides: 6, bonus: 2, rolledTotal: 13, afterSave: 13, mitigation: plainMitigation(), appliedDamage: 13, hpBefore: 20, hpAfter: 7 };
    assert.deepEqual(h.dieSides, [20, 20, 6, 6]);
    assert.deepEqual(receipt.result.dice, [3, 18]);
    assert.equal(receipt.result.total, 21); assert.equal(receipt.result.success, false);
    assert.deepEqual(receipt.result.consequence, expected);
    assert.equal(receipt.result.dc, undefined); assert.equal(JSON.stringify(receipt).includes(reviewReason), false);
    assert.equal(hp(h.game), 7); assert.equal(h.game.view(player).actionAvailable, before.actionAvailable);
    assert.equal(h.game.view(player).revision, before.revision + 2); assert.equal(receipt.revision, h.game.view(player).revision);
    const applied = events(h.game).filter(event => ['check_resolved', 'save_damage_applied'].includes(event.kind));
    assert.deepEqual(applied.map(event => event.kind), ['check_resolved', 'save_damage_applied']);
    assert.deepEqual(applied[0].body.consequence, expected);
    assert.deepEqual(applied[1].body, { checkId: prompt.id, actorId: 'scout', consequence: expected });
    const snapshots = h.game.db.prepare('SELECT revision,snapshot FROM game_outbox WHERE campaign=? AND revision>? ORDER BY revision').all(player.campaign, before.revision);
    assert.deepEqual(snapshots.map(row => row.revision), applied.map(event => event.revision));
    for (const row of snapshots) assert.equal(JSON.parse(row.snapshot).actors.find(actor => actor.id === 'scout').hp, 7);
  } finally { h.game.close(); }
});

test('successful save halves odd damage before reduction, resistance rounding, and vulnerability', () => {
  const h = setup({ dice: [20, 5, 6] });
  try {
    h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: consequence({ mitigation: mitigation({ reduction: 1, resistance: true, vulnerability: true }) }) });
    const result = resolve(h).result;
    assert.equal(result.success, true);
    assert.deepEqual(result.consequence, { type: 'single_target_damage', damageType: 'fire', dice: [5, 6], dieSides: 6, bonus: 2, rolledTotal: 13, afterSave: 6, mitigation: plainMitigation({ reduction: 1, resistance: true, vulnerability: true }), appliedDamage: 4, hpBefore: 20, hpAfter: 16 });
    assert.equal(hp(h.game), 16);
  } finally { h.game.close(); }
});

for (const scenario of [
  { name: 'successful save with no damage', save: 20, onSuccess: 'none', defenses: {}, afterSave: 0 },
  { name: 'failed save against reviewed immunity', save: 1, onSuccess: 'half', defenses: { immunity: true }, afterSave: 13 },
  { name: 'successful no-damage save with immunity', save: 20, onSuccess: 'none', defenses: { reduction: 100, resistance: true, vulnerability: true, immunity: true }, afterSave: 0 },
]) {
  test(`${scenario.name} still rolls and persists the damage dice`, () => {
    const h = setup({ dice: [scenario.save, 5, 6] });
    try {
      const reviewedDamage = consequence({ onSuccess: scenario.onSuccess, mitigation: mitigation(scenario.defenses) });
      h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: reviewedDamage });
      const result = resolve(h).result;
      assert.deepEqual(h.dieSides, [20, 6, 6]); assert.deepEqual(result.consequence.dice, [5, 6]);
      assert.equal(result.consequence.rolledTotal, 13); assert.equal(result.consequence.afterSave, scenario.afterSave);
      assert.equal(result.consequence.appliedDamage, 0); assert.equal(result.consequence.hpBefore, 20); assert.equal(result.consequence.hpAfter, 20);
      assert.equal(hp(h.game), 20); assert.deepEqual(h.game.rollHistory(player).receipts[0], resolve(h)); assert.equal(h.dieSides.length, 3);
    } finally { h.game.close(); }
  });
}

test('zero dice, negative totals, and reduction floor damage at zero', () => {
  for (const spec of [
    { dice: { count: 0, sides: 4, bonus: -3 }, defenses: {}, expectedDice: [], rolled: 0, rolls: [1] },
    { dice: { count: 1, sides: 4, bonus: -3 }, defenses: {}, expectedDice: [2], rolled: 0, rolls: [1, 2] },
    { dice: { count: 1, sides: 4, bonus: 0 }, defenses: { reduction: 10, vulnerability: true }, expectedDice: [4], rolled: 4, rolls: [1, 4] },
  ]) {
    const h = setup({ dice: spec.rolls });
    try {
      h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: consequence({ dice: spec.dice, mitigation: mitigation(spec.defenses) }) });
      const result = resolve(h).result.consequence;
      assert.deepEqual(result.dice, spec.expectedDice); assert.equal(result.rolledTotal, spec.rolled);
      assert.equal(result.appliedDamage, 0); assert.equal(result.hpAfter, 20); assert.equal(h.dieSides.length, spec.rolls.length);
    } finally { h.game.close(); }
  }
});

test('invalid, extra, multiple-target, and action check specifications reject before RNG or writes', () => {
  const valid = consequence();
  const invalidConsequences = [
    undefined, false, 0, null, [], 'fire', { ...valid, type: 'multi_target_damage' }, { ...valid, targets: ['scout', 'foe'] },
    { ...valid, targetIds: ['scout'] }, { ...valid, targetId: 'foe' }, { ...valid, bonus: 1 },
    { ...valid, damageType: 'untyped' }, { ...valid, onSuccess: 'full' },
    ...Object.keys(valid).map(key => without(valid, key)),
    { ...valid, dice: null }, { ...valid, dice: [2, 6, 2] },
    ...Object.keys(valid.dice).map(key => ({ ...valid, dice: without(valid.dice, key) })),
    ...[-1, 21, 0.5, '2'].map(count => ({ ...valid, dice: { ...valid.dice, count } })),
    ...[3, 100, '6'].map(sides => ({ ...valid, dice: { ...valid.dice, sides } })),
    ...[-101, 101, 0.5, '2'].map(bonus => ({ ...valid, dice: { ...valid.dice, bonus } })),
    { ...valid, dice: { ...valid.dice, extra: true } },
    { ...valid, mitigation: null }, { ...valid, mitigation: [] },
    ...Object.keys(valid.mitigation).map(key => ({ ...valid, mitigation: without(valid.mitigation, key) })),
    ...[-1, 101, 0.5, '2'].map(reduction => ({ ...valid, mitigation: mitigation({ reduction }) })),
    ...['resistance', 'vulnerability', 'immunity'].map(key => ({ ...valid, mitigation: mitigation({ [key]: 1 }) })),
    ...['', '   ', 'x'.repeat(301), null].map(reason => ({ ...valid, mitigation: mitigation({ reason }) })),
    { ...valid, mitigation: mitigation({ temporaryHp: 3 }) },
  ];
  const h = setup();
  try {
    const before = h.game.view(host), beforeEvents = events(h.game);
    for (const value of invalidConsequences) assert.throws(() => h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: value }), { code: 'INVALID' }, JSON.stringify(value));
    for (const override of [{ kind: 'check' }, { cost: 'action' }, { actorIds: ['scout', 'ally'] }]) assert.throws(() => h.game.requestCheck(h.characters, host, { ...h.prompt, ...override }), { code: 'INVALID' });
    assert.deepEqual(h.dieSides, []); assert.deepEqual(checkRows(h.game), []);
    assert.deepEqual(events(h.game), beforeEvents); assert.deepEqual(h.game.view(host), before); assert.deepEqual(h.game.receipts(player), []);
  } finally { h.game.close(); }
});

test('a pending request cannot be reused for conflicting reviewed damage or mitigation intent', () => {
  const h = setup();
  try {
    const pending = h.game.requestCheck(h.characters, host, h.prompt), before = checkRows(h.game);
    assert.deepEqual(h.game.requestCheck(h.characters, host, h.prompt), pending);
    for (const updated of [
      consequence({ damageType: 'cold' }), consequence({ onSuccess: 'none' }),
      consequence({ dice: { count: 2, sides: 6, bonus: 3 } }),
      consequence({ mitigation: mitigation({ resistance: true }) }),
      consequence({ mitigation: mitigation({ reason: 'Different reviewed source' }) }),
    ]) assert.throws(() => h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: updated }), { code: 'CONFLICT' });
    assert.deepEqual(checkRows(h.game), before); assert.deepEqual(h.dieSides, []); assert.equal(hp(h.game), 20);
  } finally { h.game.close(); }
});

test('saved damage retries survive restart without dice, HP, events, or resource changes', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'raph-save-damage-')), 'game.sqlite'), h = setup({ path });
  let game = h.game;
  try {
    game.requestCheck(h.characters, host, h.prompt);
    const receipt = resolve(h), before = game.view(host), beforeEvents = events(game);
    assert.deepEqual(resolve(h), receipt); assert.equal(h.dieSides.length, 3);
    assert.throws(() => resolve(h, { requestId: 'second-resolution' }), { code: 'CONFLICT' });
    game.close(); game = new GameStore(path, { rollDie: () => { throw new Error('A saved check must not reroll'); } });
    assert.deepEqual(game.resolveCheck(player, { checkId: h.prompt.id, requestId: 'resolve-hazard' }), receipt);
    assert.deepEqual(game.view(host), before); assert.deepEqual(events(game), beforeEvents); assert.deepEqual(game.pendingChecks(player), []);
    assert.equal(game.receipts(player).length, 1); assert.deepEqual(game.receipts(ally), []);
  } finally { game.close(); }
});

test('failed damage-event insertion rolls back HP, resolution, events, resources, and receipt', () => {
  const h = setup({ dice: [3, 5, 6, 3, 5, 6] });
  try {
    h.game.requestCheck(h.characters, host, h.prompt);
    const before = h.game.view(host), beforeEvents = events(h.game), beforeChecks = checkRows(h.game);
    h.game.db.exec("CREATE TRIGGER fail_save_damage BEFORE INSERT ON game_events WHEN NEW.kind='save_damage_applied' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => resolve(h), /fixture failure/);
    assert.deepEqual(h.game.view(host), before); assert.deepEqual(events(h.game), beforeEvents); assert.deepEqual(checkRows(h.game), beforeChecks);
    assert.deepEqual(h.game.receipts(player), []); assert.equal(h.game.pendingChecks(player).length, 1); assert.equal(h.dieSides.length, 3);
    h.game.db.exec('DROP TRIGGER fail_save_damage');
    const receipt = resolve(h);
    assert.equal(receipt.result.consequence.hpAfter, 7); assert.equal(hp(h.game), 7); assert.equal(h.game.receipts(player).length, 1); assert.equal(h.dieSides.length, 6);
  } finally { h.game.close(); }
});

test('invalid damage dice leave the earlier save draw uncommitted and roll back all state writes', () => {
  const h = setup({ dice: [3, 5, 7] });
  try {
    h.game.requestCheck(h.characters, host, h.prompt);
    const before = h.game.view(host), beforeEvents = events(h.game), beforeChecks = checkRows(h.game);
    assert.throws(() => resolve(h), { code: 'RNG' });
    assert.deepEqual(h.game.view(host), before); assert.deepEqual(events(h.game), beforeEvents); assert.deepEqual(checkRows(h.game), beforeChecks);
    assert.deepEqual(h.game.receipts(player), []); assert.equal(h.game.pendingChecks(player).length, 1);
  } finally { h.game.close(); }
});

test('unreviewed profiles and stale damage requests reject before dice or resource use', () => {
  const h = setup();
  try {
    const initial = h.game.view(host);
    assert.throws(() => h.game.requestCheck(h.characters, player, h.prompt), { code: 'UNAUTHORIZED' });
    h.saved.revision++;
    assert.throws(() => h.game.requestCheck(h.characters, host, h.prompt), { code: 'PROFILE' });
    h.saved.revision--;
    assert.deepEqual(h.game.view(host), initial); assert.deepEqual(checkRows(h.game), []);
    h.game.requestCheck(h.characters, host, h.prompt);
    h.game.command(player, { requestId: 'move-before-save', expectedRevision: 1, actorId: 'scout', type: 'move', path: [{ x: 2, y: 1 }] });
    const before = h.game.view(host), beforeEvents = events(h.game);
    assert.throws(() => resolve(h), { code: 'STALE' });
    assert.deepEqual(h.game.view(host), before); assert.deepEqual(events(h.game), beforeEvents);
    assert.deepEqual(h.game.receipts(player).filter(receipt => ['check', 'save'].includes(receipt.result.type)), []);
    assert.deepEqual(h.dieSides, []); assert.equal(hp(h.game), 20); assert.equal(h.game.view(player).actionAvailable, true);
  } finally { h.game.close(); }
});

test('paused saving-throw damage resolution rejects before RNG and remains pending', () => {
  const h = setup();
  try {
    h.game.requestCheck(h.characters, host, h.prompt);
    h.game.command(player, { requestId: 'pause-before-save', expectedRevision: 1, actorId: 'scout', type: 'pause' });
    const before = h.game.view(host), beforeEvents = events(h.game), beforeChecks = checkRows(h.game);
    assert.throws(() => resolve(h), { code: 'PAUSED' });
    assert.deepEqual(h.dieSides, []); assert.deepEqual(h.game.view(host), before); assert.deepEqual(events(h.game), beforeEvents); assert.deepEqual(checkRows(h.game), beforeChecks);
    assert.equal(hp(h.game), 20); assert.equal(h.game.receipts(player).filter(receipt => ['check', 'save'].includes(receipt.result.type)).length, 0);
  } finally { h.game.close(); }
});

test('fatal damage clamps HP and skips a defeated active actor when combat continues', () => {
  const h = setup({ includeAlly: true, dice: [1, 6, 6, 6, 6] });
  try {
    const before = h.game.load(player.campaign);
    assert.equal(before.order[before.activeIndex], 'scout');
    h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: consequence({ dice: { count: 4, sides: 6, bonus: 0 } }) });
    const receipt = resolve(h), after = h.game.load(player.campaign);
    assert.equal(receipt.result.consequence.appliedDamage, 24); assert.equal(receipt.result.consequence.hpAfter, 0); assert.equal(hp(h.game), 0);
    assert.equal(after.phase, 'combat'); assert.equal(after.order[after.activeIndex], 'ally');
    assert.equal(after.turn, before.turn + 1); assert.equal(after.round, before.round); assert.equal(after.actionAvailable, true);
  } finally { h.game.close(); }
});

test('fatal damage to an inactive actor preserves the active actor turn and spent resources', () => {
  const h = setup({ includeAlly: true, dice: [1, 6, 6, 6, 6] });
  try {
    h.game.command(player, { requestId: 'scout-move', expectedRevision: 1, actorId: 'scout', type: 'move', path: [{ x: 1, y: 2 }] });
    const before = h.game.load(player.campaign);
    const prompt = { ...h.prompt, actorId: 'ally', expectedRevision: h.game.view(host).revision, consequence: consequence({ dice: { count: 4, sides: 6, bonus: 0 } }) };
    h.game.requestCheck(h.characters, host, prompt);
    const receipt = resolve(h, {}, ally), after = h.game.load(player.campaign);
    assert.equal(receipt.result.consequence.hpAfter, 0); assert.equal(hp(h.game, 'ally'), 0);
    assert.equal(after.phase, 'combat'); assert.equal(after.order[after.activeIndex], 'scout');
    for (const key of ['activeIndex', 'turn', 'round', 'actionAvailable', 'movementRemaining']) assert.deepEqual(after[key], before[key], key);
  } finally { h.game.close(); }
});

test('fatal saving-throw damage completes combat when one living team remains', () => {
  const h = setup({ dice: [1, 6, 6, 6, 6] });
  try {
    h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: consequence({ dice: { count: 4, sides: 6, bonus: 0 } }) });
    const receipt = resolve(h);
    assert.equal(receipt.result.consequence.hpAfter, 0); assert.equal(h.game.load(player.campaign).phase, 'complete');
    const before = h.game.view(host), beforeEvents = events(h.game);
    assert.deepEqual(resolve(h), receipt); assert.deepEqual(h.game.view(host), before); assert.deepEqual(events(h.game), beforeEvents); assert.equal(h.dieSides.length, 5);
    assert.throws(() => h.game.requestCheck(h.characters, host, { ...h.prompt, id: 'completed-save', expectedRevision: before.revision }), { code: 'UNSUPPORTED' });
    assert.equal(h.dieSides.length, 5);
  } finally { h.game.close(); }
});

test('adjudicated mission state remains unchanged when fatal save damage completes combat', () => {
  const h = setup({ dice: [1, 6, 6, 6, 6] });
  try {
    const worldBody = JSON.stringify({ revision: 1, mission: { status: 'active' }, tracks: [] });
    const worldPlan = JSON.stringify({ resolution: 'adjudicated', mapId: h.game.load(player.campaign).map.id });
    h.game.db.prepare('INSERT INTO world_campaigns(campaign,revision,body,plan) VALUES(?,?,?,?)').run(player.campaign, 1, worldBody, worldPlan);
    const before = h.game.db.prepare('SELECT revision,body,plan FROM world_campaigns WHERE campaign=?').get(player.campaign);
    h.game.requestCheck(h.characters, host, { ...h.prompt, consequence: consequence({ dice: { count: 4, sides: 6, bonus: 0 } }) });
    assert.equal(resolve(h).result.consequence.hpAfter, 0);
    assert.equal(h.game.load(player.campaign).phase, 'complete');
    assert.deepEqual(h.game.db.prepare('SELECT revision,body,plan FROM world_campaigns WHERE campaign=?').get(player.campaign), before);
  } finally { h.game.close(); }
});

test('legacy saves without a consequence retain the plain receipt, HP, and RNG behavior', () => {
  const h = setup({ dice: [20] });
  try {
    const prompt = without(h.prompt, 'consequence'), pending = h.game.requestCheck(h.characters, host, prompt);
    assert.equal(Object.hasOwn(pending, 'consequence'), false);
    const receipt = resolve(h);
    assert.equal(receipt.result.success, true); assert.equal(Object.hasOwn(receipt.result, 'consequence'), false);
    assert.deepEqual(h.dieSides, [20]); assert.equal(hp(h.game), 20); assert.equal(h.game.view(player).actionAvailable, true);
    assert.equal(events(h.game).filter(event => event.kind === 'save_damage_applied').length, 0); assert.deepEqual(resolve(h), receipt);
  } finally { h.game.close(); }
});
