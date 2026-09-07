import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GameStore } from './store.mjs';
import { backupGame, restoreGameBackup, verifyGameBackup } from './backup.mjs';

function setup(t, { combat = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'raph-adjudication-backup-'));
  const file = join(root, 'source.sqlite'), stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    const target = resolve(root), temporary = resolve(tmpdir());
    assert.ok(target.startsWith(temporary + sep) && target.slice(temporary.length + 1).startsWith('raph-adjudication-backup-'));
    rmSync(target, { recursive: true, force: true });
  });
  const game = new GameStore(file, { rollDie: sides => sides }); stores.push(game);
  const campaign = 'adjudication-backup', host = { campaign, owner: 'host' }, player = { campaign, owner: 'player' };
  const weapon = { name: 'Staff', abilityScore: 10, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 4, addAbilityToDamage: true, rangeFeet: 30 };
  const hero = { id: 'hero', name: 'Hero', team: 'party', owner: 'player', x: 0, y: 0, size: 1, hp: 9, maxHp: 20, ac: 12, speed: 30, vision: 8, initiative: 10, characterVersion: 'profile1', weapon };
  game.createCampaign({ campaign, title: 'Recovery fixture', members: [{ owner: 'host', role: 'host' }, { owner: 'player', role: 'player' }], map: { id: 'room', title: 'Room', width: 4, height: 4, blocked: [], difficult: [] }, actors: [hero, { ...hero, id: 'witness', name: 'Witness', owner: null, team: 'other', x: 3, y: 3, hp: 1, initiative: 0 }], effects: [] });
  // Deliberately separate game and world revisions before linking the mission.
  for (const [index, x] of [1, 2].entries()) game.command(player, { requestId: `move-${index}`, expectedRevision: game.view(player).revision, actorId: 'hero', type: 'move', path: [{ x, y: 0 }] });
  const mission = { id: 'hearing', title: 'Hearing', briefing: 'Listen to the witness.', mapId: 'room', ...(combat ? { resolution: 'combat', successTeam: 'party', success: { summary: 'The encounter ended.', changes: [] }, failure: { summary: 'The party withdrew.', changes: [] } } : { resolution: 'adjudicated', outcomes: [{ id: 'agreed', title: 'Agreement', summary: 'An agreement was reached.', changes: [{ trackId: 'trust', delta: 10 }] }, { id: 'withheld', title: 'Withheld', summary: 'Private unselected alternative.', changes: [] }] }) };
  game.configureMission(host, { reviewed: true, tracks: [{ id: 'trust', label: 'Trust', kind: 'relationship', value: 40 }], mission });
  const request = { reviewed: true, requestId: 'adjudicate-once', expectedRevision: game.view(host).revision, expectedWorldRevision: game.world(host).revision, outcomeId: 'agreed' };
  let receipt;
  if (combat) {
    game.command(player, { requestId: 'attack', expectedRevision: game.view(player).revision, actorId: 'hero', type: 'attack', targetId: 'witness' });
    game.command(player, { requestId: 'end-turn', expectedRevision: game.view(player).revision, actorId: 'hero', type: 'end_turn' });
  } else receipt = game.adjudicateMission(host, request);
  const reopen = path => { const store = new GameStore(path); stores.push(store); return store; };
  return { root, file, game, host, player, request, receipt, reopen };
}
function savedWorldReceipts(game) {
  return game.db.prepare('SELECT campaign,owner,request,fingerprint,body FROM world_receipts ORDER BY campaign,owner,request').all();
}
function changeReceipt(game, mutate) {
  const row = game.db.prepare("SELECT body FROM world_receipts WHERE request='adjudicate-once'").get();
  const body = mutate(JSON.parse(row.body));
  game.db.prepare("UPDATE world_receipts SET body=? WHERE request='adjudicate-once'").run(JSON.stringify(body));
}

test('adjudicated mission backs up before debrief and restored retry preserves the original decision', t => {
  const f = setup(t), backup = join(f.root, 'backup'), destination = join(f.root, 'restored');
  assert.ok(f.receipt.revision > f.receipt.worldRevision);
  assert.equal(f.game.world(f.player).mission.status, 'debrief');
  const manifest = backupGame(f.file, backup);
  assert.deepEqual(verifyGameBackup(backup), manifest);
  restoreGameBackup(backup, destination);
  const restored = f.reopen(join(destination, 'game.sqlite'));
  assert.deepEqual(restored.view(f.host), f.game.view(f.host));
  assert.deepEqual(restored.world(f.player), f.game.world(f.player));
  assert.deepEqual(savedWorldReceipts(restored), savedWorldReceipts(f.game));
  const before = { game: restored.events(f.host), world: restored.world(f.player), receipts: savedWorldReceipts(restored) };
  assert.deepEqual(restored.adjudicateMission(f.host, f.request), f.receipt);
  assert.deepEqual({ game: restored.events(f.host), world: restored.world(f.player), receipts: savedWorldReceipts(restored) }, before);
  assert.throws(() => restored.adjudicateMission(f.host, { ...f.request, outcomeId: 'withheld' }), { code: 'CONFLICT' });
  assert.throws(() => restored.adjudicateMission(f.player, f.request), { code: 'UNAUTHORIZED' });
});

test('adjudication and explicit player debrief both replay after restore with different revision counters', t => {
  const f = setup(t), notes = { requestId: 'player-notes', expectedRevision: f.game.world(f.player).revision, notes: 'The players recorded their own debrief.' };
  const debrief = f.game.debrief(f.player, notes);
  assert.ok(f.receipt.revision > f.game.world(f.player).revision);
  const backup = join(f.root, 'backup'), destination = join(f.root, 'restored');
  backupGame(f.file, backup); restoreGameBackup(backup, destination);
  const restored = f.reopen(join(destination, 'game.sqlite'));
  const before = { game: restored.events(f.host), world: restored.world(f.player), receipts: savedWorldReceipts(restored) };
  assert.deepEqual(restored.adjudicateMission(f.host, f.request), f.receipt);
  assert.deepEqual(restored.debrief(f.player, notes), debrief);
  assert.deepEqual({ game: restored.events(f.host), world: restored.world(f.player), receipts: savedWorldReceipts(restored) }, before);
});

test('legacy combat debrief receipts keep their world-revision format through recovery', t => {
  const f = setup(t, { combat: true }), notes = { requestId: 'legacy-notes', expectedRevision: f.game.world(f.player).revision, notes: 'The encounter has an explicit debrief.' };
  const debrief = f.game.debrief(f.player, notes);
  assert.equal(debrief.worldRevision, undefined);
  const backup = join(f.root, 'backup'), destination = join(f.root, 'restored');
  backupGame(f.file, backup); restoreGameBackup(backup, destination);
  const restored = f.reopen(join(destination, 'game.sqlite'));
  assert.deepEqual(restored.debrief(f.player, notes), debrief);
  assert.deepEqual(restored.world(f.player), f.game.world(f.player));
});

const corruptions = [
  ['zero game revision', r => ({ ...r, revision: 0 })],
  ['negative game revision', r => ({ ...r, revision: -1 })],
  ['fractional game revision', r => ({ ...r, revision: r.revision - 0.5 })],
  ['string game revision', r => ({ ...r, revision: String(r.revision) })],
  ['unsafe game revision', r => ({ ...r, revision: Number.MAX_SAFE_INTEGER + 1 })],
  ['future game revision', r => ({ ...r, revision: r.revision + 1 })],
  ['wrong committed game revision', r => ({ ...r, revision: r.revision - 1 })],
  ['zero world revision', r => ({ ...r, worldRevision: 0 })],
  ['negative world revision', r => ({ ...r, worldRevision: -1 })],
  ['fractional world revision', r => ({ ...r, worldRevision: 1.5 })],
  ['string world revision', r => ({ ...r, worldRevision: String(r.worldRevision) })],
  ['unsafe world revision', r => ({ ...r, worldRevision: Number.MAX_SAFE_INTEGER + 1 })],
  ['future world revision', r => ({ ...r, worldRevision: r.worldRevision + 1 })],
  ['wrong committed world revision', r => ({ ...r, worldRevision: r.worldRevision - 1 })],
  ['missing world revision', r => { delete r.worldRevision; return r; }],
  ['missing outcome identity', r => { delete r.outcomeId; return r; }],
  ['unknown mission identity', r => ({ ...r, missionId: 'another-mission' })],
  ['unknown outcome identity', r => ({ ...r, outcomeId: 'withheld' })],
  ['different request identity', r => ({ ...r, requestId: 'another-request' })],
  ['unexpected receipt field', r => ({ ...r, invented: true })],
  ['null receipt', () => null],
  ['array receipt', r => [r]],
];
for (const [name, mutate] of corruptions) test(`backup rejects adjudication receipt with ${name}`, t => {
  const f = setup(t); changeReceipt(f.game, mutate);
  assert.throws(() => backupGame(f.file, join(f.root, 'rejected')), { code: 'BACKUP' });
});

test('removing adjudication markers cannot turn a receipt into a legacy debrief', t => {
  const f = setup(t);
  f.game.debrief(f.player, { requestId: 'player-notes', expectedRevision: f.game.world(f.player).revision, notes: 'The actual debrief.' });
  changeReceipt(f.game, r => { delete r.worldRevision; delete r.outcomeId; r.revision = f.game.world(f.player).revision; return r; });
  assert.throws(() => backupGame(f.file, join(f.root, 'rejected')), { code: 'BACKUP' });
});

test('backup rejects a decision receipt with a mismatched retry fingerprint', t => {
  const f = setup(t);
  f.game.db.prepare("UPDATE world_receipts SET fingerprint=? WHERE request='adjudicate-once'").run('0'.repeat(64));
  assert.throws(() => backupGame(f.file, join(f.root, 'rejected')), { code: 'BACKUP' });
});

test('backup rejects a decision whose world source no longer names its game event', t => {
  const f = setup(t), row = f.game.db.prepare('SELECT body FROM world_events WHERE campaign=? AND revision=?').get(f.host.campaign, f.receipt.worldRevision);
  f.game.db.prepare('UPDATE world_events SET body=? WHERE campaign=? AND revision=?').run(JSON.stringify({ ...JSON.parse(row.body), source: 'game:another-campaign:1' }), f.host.campaign, f.receipt.worldRevision);
  assert.throws(() => backupGame(f.file, join(f.root, 'rejected')), { code: 'BACKUP' });
});

test('verify and restore reject malformed decision revisions even with a matching file hash', t => {
  const f = setup(t), backup = join(f.root, 'backup'), destination = join(f.root, 'must-not-exist');
  backupGame(f.file, backup);
  const copy = new DatabaseSync(join(backup, 'game.sqlite'));
  try {
    const row = copy.prepare("SELECT body FROM world_receipts WHERE request='adjudicate-once'").get();
    copy.prepare("UPDATE world_receipts SET body=? WHERE request='adjudicate-once'").run(JSON.stringify({ ...JSON.parse(row.body), worldRevision: 1000 }));
  } finally { copy.close(); }
  const manifestFile = join(backup, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.sha256 = createHash('sha256').update(readFileSync(join(backup, 'game.sqlite'))).digest('hex');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => verifyGameBackup(backup), { code: 'BACKUP' });
  assert.throws(() => restoreGameBackup(backup, destination), { code: 'BACKUP' });
  assert.equal(existsSync(destination), false);
});
