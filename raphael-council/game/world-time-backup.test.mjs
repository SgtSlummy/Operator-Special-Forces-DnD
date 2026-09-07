import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { GameStore } from './store.mjs';
import { backupGame, restoreGameBackup, verifyGameBackup } from './backup.mjs';

const party = { audience: 'party', owners: [] }, hostOnly = { audience: 'host', owners: [] }, personal = { audience: 'owners', owners: ['p1'] };
function definition() {
  const fact = (id, label, value, visibility = party, entityId = 'village') => ({ id, label, value, visibility, entityId, kind: 'condition', evidence: ['test:explicit-review'] });
  return {
    schemaVersion: 1, id: 'time-recovery', version: 'v1',
    calendar: { label: 'Recovery fixture calendar', unitLabel: 'reviewed quarter-day', ticksPerDay: 4, originDay: 6, originTick: 0, initialTick: 0, originLabel: 'Explicit fixture origin' },
    maxAdvanceTicks: 120, adoption: { mode: 'new', reason: 'Reviewed fixture origin and records.', evidence: ['test:explicit-review'] },
    entities: [{ id: 'village', label: 'Village', kind: 'location', visibility: party }, { id: 'hidden-vault', label: 'Secret host vault', kind: 'location', visibility: hostOnly }, { id: 'personal-stash', label: 'Personal hidden stash', kind: 'location', visibility: personal }],
    facts: [fact('lamps', 'Festival lamps', true), fact('cause', 'Unsettled pressure', true), fact('road', 'Road closed', false), fact('host-secret', 'Secret host fact', true, hostOnly, 'hidden-vault'), fact('personal-secret', 'Personal hidden fact', true, personal, 'personal-stash')],
    knowledge: [], opportunities: [{ id: 'accord', title: 'Accord', status: 'open', visibility: party, evidence: ['test:explicit-review'] }],
    deadlines: [{ id: 'lamps-due', label: 'Lamp deadline', opportunityId: 'accord', atTick: 11, order: 1, when: [], effects: [{ type: 'fact', id: 'lamps', value: false }], summary: 'The lamps are withheld.', visibility: party, evidence: ['test:explicit-review'], initialState: 'pending' }],
    clocks: [{ id: 'pressure', label: 'Pressure', value: 0, status: 'active', periodTicks: 12, anchorTick: 0, creditTicks: 0, accrualPolicy: 'retain', order: 2, when: [{ factId: 'cause', equals: true }], thresholds: [{ value: 1, effects: [{ type: 'fact', id: 'road', value: true }], summary: 'The road closes under pressure.', visibility: party, evidence: ['test:explicit-review'], initiallyConsumed: false }], summary: 'The reviewed pressure grows.', visibility: party, evidence: ['test:explicit-review'] }],
    decisions: [{ id: 'settle', label: 'Reviewed settlement', when: [], effects: [{ type: 'opportunity', id: 'accord', status: 'resolved' }, { type: 'clock_reverse', id: 'pressure', steps: 1 }], summary: 'The settlement reduces pressure.', visibility: party, evidence: ['test:explicit-review'], initiallyConsumed: false }],
  };
}
function fixture(t, { configure = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'raph-world-time-backup-')), file = join(root, 'source.sqlite'), stores = new Set();
  const open = path => { const game = new GameStore(path, { rollDie: () => { throw new Error('World time recovery must not roll combat dice.'); } }); stores.add(game); return game; };
  t.after(() => {
    for (const game of stores) game.close();
    const target = resolve(root), temporary = resolve(tmpdir());
    assert.ok(target.startsWith(temporary + sep) && target.slice(temporary.length + 1).startsWith('raph-world-time-backup-'));
    rmSync(target, { recursive: true, force: true });
  });
  const game = open(file), campaign = 'world-time-recovery';
  const scopes = Object.fromEntries(['host', 'host2', 'p1', 'p2'].map(owner => [owner, { campaign, owner }]));
  const actor = (id, owner, x, initiative) => ({ id, owner, team: owner, name: id, x, y: 2, size: 1, hp: 40, maxHp: 40, ac: 10, speed: 30, vision: 12, initiative, characterVersion: 'v1', weapon: { name: 'Reviewed sword', abilityScore: 10, proficiencyBonus: 0, proficient: false, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: false, rangeFeet: 5 } });
  game.createCampaign({ campaign, title: 'World time recovery fixture', members: Object.keys(scopes).map(owner => ({ owner, role: owner.startsWith('host') ? 'host' : 'player' })), map: { id: 'map', title: 'Map', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('hero', 'p1', 2, 20), actor('guard', 'p2', 8, 10)], effects: [] });
  game.configureMission(scopes.host, { reviewed: true, tracks: [], mission: { id: 'opening', title: 'Opening', briefing: 'Fixture', mapId: 'map', resolution: 'adjudicated', outcomes: [{ id: 'done', title: 'Done', summary: 'Fixture done', changes: [] }] } });
  const configureInput = configure ? input(game, scopes.host, 'configure-time', { definition: definition() }) : null;
  const configureReceipt = configure ? game.configureWorldTime(scopes.host, configureInput) : null;
  return { root, file, game, scopes, open, configureInput, configureReceipt };
}
function input(game, scope, requestId, fields = {}) {
  const time = game.worldTime(scope);
  return { requestId, expectedGameRevision: time.gameRevision, expectedWorldRevision: time.worldRevision, expectedTimeRevision: time.timeRevision, reviewed: true, ...fields };
}
function preview(game, scope, requestId = 'prepare-interval', targetTick = 12) {
  const request = input(game, scope, requestId, { targetTick, reason: 'Reviewed fictional interval for recovery.' });
  return { request, result: game.previewWorldTime(scope, request) };
}
function advance(game, scope, prepared, requestId = 'confirm-interval') {
  const request = input(game, scope, requestId, { previewId: prepared.result.previewId });
  return { request, receipt: game.advanceWorldTime(scope, request) };
}
function database(game) {
  return game.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => ({ name, rows: game.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() }));
}
function snapshot(game, f) {
  return { database: database(game), projections: Object.fromEntries(Object.entries(f.scopes).map(([owner, scope]) => {
    try { return [owner, game.worldTime(scope)]; } catch (error) { return [owner, { code: error.code }]; }
  })) };
}
function restore(f, source = f.file, name = 'pending') {
  const directory = join(f.root, `${name}-backup`), destination = join(f.root, `${name}-restored`);
  const manifest = backupGame(source, directory);
  assert.deepEqual(verifyGameBackup(directory), manifest);
  assert.equal(restoreGameBackup(directory, destination).status, 'restored_to_new_directory');
  const file = join(destination, 'game.sqlite');
  return { file, game: f.open(file) };
}
function assertPrivate(game, f) {
  for (const owner of ['p1', 'p2']) {
    const time = game.worldTime(f.scopes[owner]);
    for (const key of ['definition', 'runtime', 'receipts']) assert.equal(Object.hasOwn(time, key), false);
    assert.doesNotMatch(JSON.stringify(time), /hidden-vault|host-secret|Secret host/);
    if (owner === 'p1') assert.equal(time.facts.find(fact => fact.id === 'personal-secret').value, true);
    else assert.doesNotMatch(JSON.stringify(time), /personal-secret|personal-stash|Personal hidden/);
    for (const event of time.events) assert.deepEqual(Object.keys(event).sort(), ['id', 'kind', 'summary', 'tick']);
  }
}

test('actual backup restores the reviewed definition and owner-private projections without advancing time', t => {
  const f = fixture(t), before = snapshot(f.game, f);
  const restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assertPrivate(restored.game, f);
  assert.equal(restored.game.worldTime(f.scopes.host).calendar.tick, 0);
  assert.deepEqual(restored.game.configureWorldTime(f.scopes.host, f.configureInput), f.configureReceipt);
  assert.deepEqual(snapshot(restored.game, f), before);
  assert.deepEqual(snapshot(f.game, f), before);
});

test('saved preview survives actual restore, confirms once, and remains owned by its original host', t => {
  const f = fixture(t), prepared = preview(f.game, f.scopes.host);
  const before = snapshot(f.game, f), restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assert.deepEqual(restored.game.previewWorldTime(f.scopes.host, prepared.request), prepared.result);
  assert.deepEqual(snapshot(restored.game, f), before);
  for (const owner of ['p1', 'p2', 'host2']) {
    const request = input(restored.game, f.scopes[owner], `copied-${owner}`, { previewId: prepared.result.previewId });
    assert.throws(() => restored.game.advanceWorldTime(f.scopes[owner], request), { code: 'UNAUTHORIZED' });
  }
  assert.deepEqual(snapshot(restored.game, f), before);
  const committed = advance(restored.game, f.scopes.host, prepared);
  const time = restored.game.worldTime(f.scopes.host);
  assert.equal(time.calendar.tick, 12);
  assert.equal(time.clocks.find(clock => clock.id === 'pressure').value, 1);
  assert.equal(time.facts.find(fact => fact.id === 'lamps').value, false);
  assert.equal(time.facts.find(fact => fact.id === 'road').value, true);
  assert.equal(time.deadlines[0].status, 'applied');
  assertPrivate(restored.game, f);
  const final = snapshot(restored.game, f), completed = restore(f, restored.file, 'committed');
  assert.deepEqual(snapshot(completed.game, f), final);
  assert.deepEqual(completed.game.advanceWorldTime(f.scopes.host, committed.request), committed.receipt);
  assert.deepEqual(completed.game.previewWorldTime(f.scopes.host, prepared.request), prepared.result);
  const reuse = input(completed.game, f.scopes.host, 'reuse-consumed-preview', { previewId: prepared.result.previewId });
  assert.throws(() => completed.game.advanceWorldTime(f.scopes.host, reuse), { code: 'CONFLICT' });
  assert.deepEqual(snapshot(completed.game, f), final);
  assert.deepEqual(snapshot(f.game, f), before);
});

test('committed advance and decision restore immutable receipts and never repeat a consumed threshold after clock reversal', t => {
  const f = fixture(t), firstPreview = preview(f.game, f.scopes.host), first = advance(f.game, f.scopes.host, firstPreview);
  const decisionInput = input(f.game, f.scopes.host, 'settlement', { decisionId: 'settle', reason: 'The reviewed settlement reduces pressure.' });
  const decisionReceipt = f.game.recordWorldTimeDecision(f.scopes.host, decisionInput);
  assert.equal(f.game.worldTime(f.scopes.host).clocks[0].value, 0);
  const before = snapshot(f.game, f), restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assert.deepEqual(restored.game.advanceWorldTime(f.scopes.host, first.request), first.receipt);
  assert.deepEqual(restored.game.recordWorldTimeDecision(f.scopes.host, decisionInput), decisionReceipt);
  assert.deepEqual(restored.game.configureWorldTime(f.scopes.host, f.configureInput), f.configureReceipt);
  assert.deepEqual(snapshot(restored.game, f), before);
  const rowsBefore = restored.game.db.prepare('SELECT occurrence,event_id FROM world_time_occurrences WHERE campaign=? ORDER BY occurrence').all(f.scopes.host.campaign);
  const secondPreview = preview(restored.game, f.scopes.host, 'next-preview', 24);
  const second = advance(restored.game, f.scopes.host, secondPreview, 'next-advance');
  const time = restored.game.worldTime(f.scopes.host);
  assert.equal(time.calendar.tick, 24);
  assert.equal(time.clocks[0].value, 1);
  assert.equal(time.opportunities[0].status, 'resolved');
  assert.equal(time.facts.find(fact => fact.id === 'road').value, true);
  const once = rowsBefore.filter(row => row.occurrence === 'threshold:pressure:1' || row.occurrence === 'deadline:lamps-due' || row.occurrence === 'decision:settle');
  assert.equal(once.length, 3);
  for (const row of once) assert.deepEqual(restored.game.db.prepare('SELECT occurrence,event_id FROM world_time_occurrences WHERE campaign=? AND occurrence=?').get(f.scopes.host.campaign, row.occurrence), row);
  assert.equal(restored.game.db.prepare("SELECT COUNT(*) AS n FROM world_time_events WHERE campaign=? AND (json_extract(body,'$.thresholdOccurrence')='threshold:pressure:1' OR json_extract(body,'$.occurrence')='threshold:pressure:1')").get(f.scopes.host.campaign).n, 1);
  const final = snapshot(restored.game, f), twice = restore(f, restored.file, 'after-reversal');
  assert.deepEqual(snapshot(twice.game, f), final);
  assert.deepEqual(twice.game.advanceWorldTime(f.scopes.host, second.request), second.receipt);
  assert.deepEqual(twice.game.recordWorldTimeDecision(f.scopes.host, decisionInput), decisionReceipt);
  assert.deepEqual(snapshot(twice.game, f), final);
});

test('revoked host and player grants remain restorable while current authority controls every replay and projection', t => {
  const f = fixture(t), prepared = preview(f.game, f.scopes.host);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner IN (?,?)').run(f.scopes.host.campaign, 'host', 'p1');
  const before = snapshot(f.game, f), restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  for (const owner of ['host', 'p1']) assert.throws(() => restored.game.worldTime(f.scopes[owner]), { code: 'UNAUTHORIZED' });
  assert.throws(() => restored.game.previewWorldTime(f.scopes.host, prepared.request), { code: 'UNAUTHORIZED' });
  assert.throws(() => restored.game.configureWorldTime(f.scopes.host, f.configureInput), { code: 'UNAUTHORIZED' });
  assert.doesNotMatch(JSON.stringify(restored.game.worldTime(f.scopes.p2)), /personal-secret|personal-stash|Personal hidden|Secret host/);
  const copied = input(restored.game, f.scopes.host2, 'copy-revoked-preview', { previewId: prepared.result.previewId });
  assert.throws(() => restored.game.advanceWorldTime(f.scopes.host2, copied), { code: 'UNAUTHORIZED' });
  const ownPreview = preview(restored.game, f.scopes.host2, 'new-host-review');
  const committed = advance(restored.game, f.scopes.host2, ownPreview, 'new-host-confirm');
  assert.equal(committed.receipt.calendar.tick, 12);
  assert.deepEqual(restored.game.worldTime(f.scopes.host2).receipts.map(receipt => receipt.requestId), ['new-host-confirm']);
  assert.deepEqual(snapshot(f.game, f), before);
});

test('revoked host cannot recover committed advance or decision receipts after actual restore', t => {
  const f = fixture(t), prepared = preview(f.game, f.scopes.host), committed = advance(f.game, f.scopes.host, prepared);
  const decisionInput = input(f.game, f.scopes.host, 'reviewed-decision', { decisionId: 'settle', reason: 'The host reviewed this settlement.' });
  f.game.recordWorldTimeDecision(f.scopes.host, decisionInput);
  f.game.db.prepare('DELETE FROM game_members WHERE campaign=? AND owner=?').run(f.scopes.host.campaign, 'host');
  const before = snapshot(f.game, f), restored = restore(f);
  assert.deepEqual(snapshot(restored.game, f), before);
  assert.throws(() => restored.game.advanceWorldTime(f.scopes.host, committed.request), { code: 'UNAUTHORIZED' });
  assert.throws(() => restored.game.recordWorldTimeDecision(f.scopes.host, decisionInput), { code: 'UNAUTHORIZED' });
  assert.deepEqual(restored.game.worldTime(f.scopes.host2).receipts, []);
  assert.deepEqual(snapshot(restored.game, f), before);
});

function mutateBackup(f, mutate) {
  const directory = join(f.root, 'tampered-backup'), manifest = backupGame(f.file, directory), file = join(directory, 'game.sqlite');
  const db = new DatabaseSync(file);
  try { mutate(db, f.scopes.host.campaign); } finally { db.close(); }
  manifest.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}
function mutateTime(db, campaign, mutate) {
  const state = JSON.parse(db.prepare('SELECT body FROM world_time_campaigns WHERE campaign=?').get(campaign).body);
  mutate(state);
  db.prepare('UPDATE world_time_campaigns SET body=? WHERE campaign=?').run(JSON.stringify(state), campaign);
}
const timeTables = ['world_time_previews', 'world_time_receipts', 'world_time_occurrences', 'world_time_events', 'world_time_campaigns'];

test('a real legacy backup without any time tables restores without inventing a calendar', t => {
  const f = fixture(t, { configure: false });
  const gameBefore = f.game.load(f.scopes.host.campaign), worldBefore = f.game.world(f.scopes.host), timeBefore = f.game.worldTime(f.scopes.host);
  assert.equal(timeBefore.configured, false);
  for (const table of timeTables) f.game.db.exec(`DROP TABLE ${table}`);
  const restored = restore(f);
  assert.deepEqual(restored.game.load(f.scopes.host.campaign), gameBefore);
  assert.deepEqual(restored.game.world(f.scopes.host), worldBefore);
  assert.deepEqual(restored.game.worldTime(f.scopes.host), timeBefore);
});

for (const [name, mutate] of [
  ['missing time preview table', db => db.exec('DROP TABLE world_time_previews')],
  ['all time tables removed despite committed time history', db => { for (const table of timeTables) db.exec(`DROP TABLE ${table}`); }],
  ['unsupported time schema', (db, campaign) => db.prepare('UPDATE world_time_campaigns SET schema_version=99 WHERE campaign=?').run(campaign)],
  ['changed definition with retained hash', (db, campaign) => mutateTime(db, campaign, state => { state.definition.calendar.label = 'Changed without review'; })],
  ['invalid clock accrual', (db, campaign) => mutateTime(db, campaign, state => { state.clocks[0].creditTicks = -1; })],
  ['missing consumed occurrence', (db, campaign) => db.prepare("DELETE FROM world_time_occurrences WHERE campaign=? AND occurrence='deadline:lamps-due'").run(campaign)],
  ['event tick mismatch', (db, campaign) => db.prepare('UPDATE world_time_events SET tick=tick+1 WHERE campaign=?').run(campaign)],
  ['future receipt revision', (db, campaign) => { const row = db.prepare('SELECT request,body FROM world_time_receipts WHERE campaign=? ORDER BY rowid DESC LIMIT 1').get(campaign); const body = JSON.parse(row.body); body.timeRevision += 100; db.prepare('UPDATE world_time_receipts SET body=? WHERE campaign=? AND request=?').run(JSON.stringify(body), campaign, row.request); }],
  ['changed saved preview plan', (db, campaign) => { const row = db.prepare('SELECT id,body FROM world_time_previews WHERE campaign=? LIMIT 1').get(campaign); const body = JSON.parse(row.body); body.planHash = '0'.repeat(64); db.prepare('UPDATE world_time_previews SET body=? WHERE campaign=? AND id=?').run(JSON.stringify(body), campaign, row.id); }],
  ['preview references a missing commit', (db, campaign) => db.prepare("UPDATE world_time_previews SET used_request='missing-commit' WHERE campaign=?").run(campaign)],
]) {
  test(`verify and restore reject checksum-matching world time backup with ${name}`, t => {
    const f = fixture(t), prepared = preview(f.game, f.scopes.host);
    advance(f.game, f.scopes.host, prepared);
    const before = snapshot(f.game, f), directory = mutateBackup(f, mutate), destination = join(f.root, 'rejected-restore');
    assert.throws(() => verifyGameBackup(directory), { code: 'BACKUP' });
    assert.throws(() => restoreGameBackup(directory, destination), { code: 'BACKUP' });
    assert.equal(existsSync(destination), false);
    assert.deepEqual(snapshot(f.game, f), before);
  });
}
