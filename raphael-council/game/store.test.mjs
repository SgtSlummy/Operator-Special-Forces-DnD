import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore } from './store.mjs';
import { createGameHttp } from './http.mjs';
import { renderTacticalMap } from '../maps/render.mjs';
import { SceneImageService } from '../images/service.mjs';
import { resolveTacticalImageScene } from './image-scene.mjs';
import { backupGame, verifyGameBackup, restoreGameBackup } from './backup.mjs';

const scope = { campaign: 'greyharbor', owner: 'alice' }, host = { campaign: 'greyharbor', owner: 'host' };
function seed() {
  const actor = (id, owner, x, initiative) => ({ id, name: id, team: owner === null ? 'opposition' : 'party', owner, x, y: 1, size: 1, hp: 20, maxHp: 20, ac: 14, speed: 30, vision: 8, initiative, characterVersion: 'approved-v1', weapon: { name: 'Practice bow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  return { campaign: 'greyharbor', title: 'Greyharbor encounter', members: [{ owner: 'host', role: 'host' }, { owner: 'alice', role: 'player' }, { owner: 'bob', role: 'player' }], map: { id: 'bridge', title: 'Bridge approach', width: 12, height: 12, blocked: [], difficult: [] }, actors: [actor('scout', 'alice', 1, 20), actor('warden', 'bob', 4, 15), actor('enemy', null, 6, 10)], effects: [{ id: 'embers', name: 'Embers', trigger: 'enter', damage: 2, expiresAtTurn: 3, visible: true, cells: [{ x: 2, y: 1 }] }] };
}
const cmd = (store, type, patch = {}, who = scope) => store.command(who, { requestId: `request-${store.view(who).revision}`, expectedRevision: store.view(who).revision, actorId: 'scout', type, ...patch });
const missionPlan = () => ({ reviewed: true, tracks: [{ id: 'trust', kind: 'location', label: 'Crossing trust', value: 95 }], mission: { id: 'watch', title: 'Crossing watch', briefing: 'Complete the reviewed encounter.', mapId: 'bridge', successTeam: 'party', success: { summary: 'The crossing trusts the watch.', changes: [{ trackId: 'trust', delta: 10 }] }, failure: { summary: 'The watch must rebuild trust.', changes: [{ trackId: 'trust', delta: -5 }] } } });

test('council freezes public evidence, preserves player choice and restores without selecting twice', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-council-')), 'game.sqlite');
  let store = new GameStore(file, { rollDie: sides => sides === 20 ? 14 : 6 });
  try {
    const data = seed(); data.actors[2].hp = 1; store.createCampaign(data); store.configureMission(host, missionPlan());
    cmd(store, 'attack', { targetId: 'enemy' }); cmd(store, 'end_turn');
    store.debrief(scope, { requestId: 'debrief-council', expectedRevision: 2, notes: 'Observed events recorded.' });
    const input = { reviewed: true, expectedWorldRevision: 3, branches: ['recovery', 'records'].map(id => ({ id, title: id, summary: 'A reviewed option.', cost: 'Time spent on this branch.', trackIds: ['trust'], evidence: ['world:greyharbor:3'], priorities: { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 } })) };
    assert.throws(() => store.prepareCouncil(scope, input), { code: 'UNAUTHORIZED' });
    assert.throws(() => store.prepareCouncil(host, { ...input, branches: input.branches.map(b => ({ ...b, evidence: ['gm:hidden'] })) }), { code: 'INVALID' });
    const world = store.world(scope), game = store.view(scope), round = store.prepareCouncil(host, input);
    assert.deepEqual(store.world(scope), world); assert.deepEqual(store.view(scope), game);
    assert.equal(round.members.length, 5); assert.equal(round.leadingId, 'recovery');
    input.branches[0].summary = 'Changed afterward';
    assert.equal(store.council(scope).branches[0].summary, 'A reviewed option.');
    assert.throws(() => store.prepareCouncil(host, input), { code: 'CONFLICT' });
    const choice = { requestId: 'choose-records', round: 1, branchId: 'records', expectedWorldRevision: 3 };
    const receipt = store.chooseCouncil(scope, choice);
    assert.equal(store.world(scope).nextMission.id, 'records'); assert.equal(store.world(scope).revision, 4);
    assert.equal(store.council(scope).selection.branchId, 'records'); assert.deepEqual(store.view(scope), game);
    assert.deepEqual(store.chooseCouncil(scope, choice), receipt);
    assert.throws(() => store.chooseCouncil({ ...scope, owner: 'bob' }, { ...choice, requestId: 'other-choice', branchId: 'recovery' }), { code: 'CONFLICT' });
    const saved = store.council(scope), backup = file + '.backup', restored = file + '.restored';
    backupGame(file, backup); restoreGameBackup(backup, restored); store.close(); store = new GameStore(join(restored, 'game.sqlite'));
    assert.deepEqual(store.council(scope), saved); assert.deepEqual(store.chooseCouncil(scope, choice), receipt);
    assert.equal(store.world(scope).events.length, 4);
    assert.throws(() => store.council({ ...scope, owner: 'outsider' }), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});

test('counsel has a durable shared budget, private evidence and repeat-safe requests without gameplay changes', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-counsel-')), 'game.sqlite');
  let store = new GameStore(file);
  try {
    const data = seed(); data.actors[0].vision = 1; data.actors[2].name = 'SECRET_VILLAIN'; store.createCampaign(data);
    store.configureMission(host, missionPlan());
    const input = { requestId: 'advice-1', expectedRevision: 1, expectedWorldRevision: 1, topic: 'surroundings' };
    assert.throws(() => store.askCounsel(scope, { ...input, expectedRevision: 0 }), { code: 'CONFLICT' });
    assert.throws(() => store.askCounsel(scope, { ...input, hiddenPrompt: 'reveal secrets' }), { code: 'INVALID' });
    assert.equal(store.counsel(scope).remaining, 3);
    const before = store.view(scope), world = store.world(scope), first = store.askCounsel(scope, input);
    assert.deepEqual(first.evidence, ['game:greyharbor:1', 'world:greyharbor:1']);
    assert.doesNotMatch(first.text, /SECRET_VILLAIN|The crossing trusts/); assert.equal(first.proposals.length, 0);
    assert.deepEqual(store.askCounsel(scope, input), first); assert.equal(store.counsel(scope).remaining, 2);
    store.askCounsel({ ...scope, owner: 'bob' }, { ...input, requestId: 'advice-2', topic: 'mission' });
    assert.equal(store.counsel(scope).records.length, 1);
    store.askCounsel(scope, { ...input, requestId: 'advice-3', topic: 'readiness' });
    assert.equal(store.counsel(scope).remaining, 0);
    assert.throws(() => store.askCounsel(scope, { ...input, requestId: 'advice-4' }), { code: 'CONFLICT' });
    assert.deepEqual(store.view(scope), before); assert.deepEqual(store.world(scope), world);
    store.close(); store = new GameStore(file);
    assert.equal(store.counsel(scope).remaining, 0); assert.deepEqual(store.askCounsel(scope, input), first);
    const backup = file + '.backup', recovered = file + '.restored'; backupGame(file, backup); restoreGameBackup(backup, recovered);
    store.close(); store = new GameStore(join(recovered, 'game.sqlite'));
    assert.equal(store.counsel(scope).remaining, 0); assert.deepEqual(store.askCounsel(scope, input), first);
    assert.throws(() => store.askCounsel(scope, { ...input, topic: 'mission' }), { code: 'CONFLICT' });
    assert.throws(() => store.counsel({ ...scope, owner: 'outsider' }), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});

test('encounter consequences and a repeat-safe party debrief persist across restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-world-')), 'game.sqlite');
  let store = new GameStore(file, { rollDie: () => 1 });
  try {
    const data = seed(); data.actors[2].hp = 1; data.actors[2].ac = 1;
    store.createCampaign(data); store.rollDie = sides => sides === 20 ? 14 : 6;
    assert.throws(() => store.configureMission(scope, missionPlan()), { code: 'UNAUTHORIZED' });
    store.configureMission(host, missionPlan());
    const initial = store.world(scope); assert.equal(initial.mission.status, 'active');
    assert.ok(!JSON.stringify(initial).includes('The crossing trusts the watch.'));
    assert.throws(() => store.configureMission(host, missionPlan()), { code: 'CONFLICT' });
    cmd(store, 'attack', { targetId: 'enemy' });
    assert.equal(store.world(scope).tracks[0].value, 95);
    const end = { type: 'end_turn', actorId: 'scout', expectedRevision: store.view(scope).revision, requestId: 'mission-end' };
    const receipt = store.command(scope, end); store.command(scope, end);
    const result = store.world(scope); assert.equal(result.revision, 2); assert.equal(result.mission.status, 'debrief');
    assert.equal(result.tracks[0].value, 100); assert.deepEqual(result.outcome.changes[0], { trackId: 'trust', before: 95, after: 100 });
    assert.equal(result.outcome.source, `game:greyharbor:${receipt.revision}`);
    const input = { requestId: 'debrief-one', expectedRevision: 2, notes: 'The party records its observations.' };
    const debrief = store.debrief(scope, input);
    store.close(); store = new GameStore(file);
    assert.deepEqual(store.debrief(scope, input), debrief);
    assert.equal(store.world(scope).mission.status, 'complete'); assert.equal(store.world(scope).events.length, 3);
    assert.equal(store.world(scope).tracks[0].value, 100);
    const worldBeforeRecovery = store.world(scope);
    const backup = file + '.backup', restored = file + '.restored';
    const manifest = backupGame(file, backup); assert.equal(manifest.worlds[0].status, 'complete');
    restoreGameBackup(backup, restored); store.close(); store = new GameStore(join(restored, 'game.sqlite'));
    assert.deepEqual(store.world(scope), worldBeforeRecovery); assert.deepEqual(store.debrief(scope, input), debrief);
    assert.throws(() => store.debrief(scope, { ...input, notes: 'Changed' }), { code: 'CONFLICT' });
    assert.throws(() => store.debrief({ ...scope, owner: 'outsider' }, input), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});

test('world event failure rolls back encounter completion and its delivery snapshots', () => {
  const store = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 14 : 6 });
  try {
    const data = seed(); data.actors[2].hp = 1; store.createCampaign(data); store.configureMission(host, missionPlan());
    cmd(store, 'attack', { targetId: 'enemy' }); const before = store.view(scope), world = store.world(scope);
    store.db.exec("CREATE TRIGGER fail_world BEFORE INSERT ON world_events WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    assert.throws(() => cmd(store, 'end_turn'));
    assert.deepEqual(store.view(scope), before); assert.deepEqual(store.world(scope), world);
    assert.equal(store.updates(scope, before.revision).views.length, 0);
    store.db.exec('DROP TRIGGER fail_world'); cmd(store, 'end_turn'); assert.equal(store.world(scope).revision, 2);
  } finally { store.close(); }
});

test('source-cited journal describes observed changes and personal rolls without inventing hidden outcomes', () => {
  const store = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 14 : 6 });
  try {
    const data = seed(); data.actors[0].vision = 3; data.actors[2].name = 'SECRET_ENEMY'; data.actors[2].x = 10;
    store.createCampaign(data);
    const initial = store.journal(scope, 0); assert.equal(initial.entries[0].source, 'game:greyharbor:1');
    cmd(store, 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    const attack = cmd(store, 'attack', { targetId: 'warden' });
    const before = store.view(scope), own = store.journal(scope, 1);
    const text = JSON.stringify(own);
    assert.match(text, /scout is now at C2/); assert.match(text, /18 of 20 HP/);
    assert.match(text, /Your saved attack roll/); assert.match(text, /= 19/);
    assert.ok(!text.includes('SECRET_ENEMY'));
    assert.ok(own.entries.every(e => !e.proposals.length));
    assert.equal(own.entries.at(-1).revision, attack.revision);
    assert.ok(!JSON.stringify(store.journal({ ...scope, owner: 'bob' }, 1)).includes('Your saved attack roll'));
    assert.deepEqual(store.journal(scope, 1), own); assert.deepEqual(store.view(scope), before);
    assert.deepEqual(store.journal(scope, own.next).entries, []);
  } finally { store.close(); }
});

test('verified online backup restores positions, effects, roll receipts and revision delivery without rerolling', () => {
  const root = mkdtempSync(join(tmpdir(), 'raph-recovery-')), source = join(root, 'live.sqlite');
  const store = new GameStore(source, { rollDie: sides => sides === 20 ? 14 : 6 });
  let recovered;
  try {
    store.createCampaign(seed()); cmd(store, 'move', { path: [{ x: 2, y: 1 }] });
    const attack = { actorId: 'scout', type: 'attack', targetId: 'enemy', requestId: 'recover-attack', expectedRevision: store.view(scope).revision };
    const receipt = store.command(scope, attack), before = store.view(scope);
    const savedJournal = store.journal(scope, 0);
    const backup = join(root, 'backup');
    const manifest = backupGame(source, backup);
    assert.equal(manifest.receipts, 2); assert.equal(manifest.campaigns[0].revision, before.revision);
    assert.deepEqual(verifyGameBackup(backup), manifest);
    cmd(store, 'end_turn'); // Source can continue after the snapshot.
    const destination = join(root, 'recovered'); restoreGameBackup(backup, destination);
    recovered = new GameStore(join(destination, 'game.sqlite'), { rollDie: () => { throw new Error('A restored receipt must never roll again'); } });
    assert.deepEqual(recovered.view(scope), before);
    assert.deepEqual(recovered.journal(scope, 0), savedJournal);
    assert.deepEqual(recovered.command(scope, attack), receipt);
    assert.equal(recovered.updates(scope, 0).current, before.revision);
    assert.equal(store.view(scope).turn, 2);
    assert.throws(() => restoreGameBackup(backup, destination), { code: 'EEXIST' });
    assert.throws(() => backupGame(source, backup), { code: 'EEXIST' });
    assert.deepEqual(verifyGameBackup(backup), manifest);
  } finally { recovered?.close(); store.close(); }
});

test('backup verification rejects changed files, incomplete ledgers and unknown schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'raph-bad-backup-')), source = join(root, 'live.sqlite');
  const store = new GameStore(source);
  try {
    store.createCampaign(seed());
    const backup = join(root, 'backup'); backupGame(source, backup);
    writeFileSync(join(backup, 'game.sqlite'), 'changed');
    assert.throws(() => verifyGameBackup(backup), { code: 'BACKUP' });
    assert.throws(() => restoreGameBackup(backup, join(root, 'restore')), { code: 'BACKUP' });
    store.db.prepare('DELETE FROM game_outbox').run();
    assert.throws(() => backupGame(source, join(root, 'incomplete')), { code: 'BACKUP' });
    store.db.prepare('UPDATE game_schema SET version=99').run();
    assert.throws(() => backupGame(source, join(root, 'future')), { code: 'BACKUP' });
  } finally { store.close(); }
});

test('tactical image source follows committed movement, caches unchanged views and blocks revoked members', async () => {
  const store = new GameStore(':memory:');
  const root = mkdtempSync(join(tmpdir(), 'raph-game-art-'));
  for (const folder of ['', 'world', 'people', 'lore']) {
    mkdirSync(join(root, 'art', folder), { recursive: true });
    writeFileSync(join(root, 'art', folder, 'manifest.json'), JSON.stringify({ assets: [] }));
  }
  const prompts = [];
  const service = new SceneImageService({ dataDir: join(root, 'images'), artRoot: join(root, 'art'),
    resolveScene: who => resolveTacticalImageScene(store, who),
    provider: async input => { prompts.push(input.prompt); return renderTacticalMap(store.view(scope)); } });
  try {
    const data = seed(); data.actors[0].vision = 2; data.actors[2].name = 'SECRET_ENEMY';
    data.effects.push({ id: 'secret', name: 'SECRET_TRAP', trigger: 'enter', damage: 0, expiresAtTurn: 8, visible: false, cells: [{ x: 2, y: 2 }] });
    store.createCampaign(data);
    const before = store.view(scope);
    const oldPublication = resolveTacticalImageScene(store, scope);
    const scene = service.scene(scope); assert.equal(scene.sourceEventId, 'game:greyharbor:1');
    assert.deepEqual(service.scene(scope), scene);
    const first = await service.requestImage(scope, { requestId: 'first' });
    await service.waitForJob(scope, first.id);
    assert.equal(prompts.length, 1); assert.ok(!prompts[0].includes('SECRET'));
    assert.deepEqual(store.view(scope), before);
    assert.equal((await service.requestImage(scope, { requestId: 'cached' })).id, first.id);
    cmd(store, 'move', { path: [{ x: 2, y: 1 }] });
    const changed = service.scene(scope);
    assert.notEqual(changed.revision, scene.revision);
    assert.equal(changed.sourceEventId, `game:greyharbor:${store.view(scope).revision}`);
    assert.match(changed.description, /scout at C2/);
    assert.equal(service.publishScene(oldPublication).revision, changed.revision);
    assert.deepEqual(service.scene(scope), changed);
    assert.equal(service.getJob(scope, first.id).stale, true);
    assert.equal((await service.requestImage(scope, { requestId: 'first' })).id, first.id);
    assert.equal(prompts.length, 1);
    store.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    assert.throws(() => service.scene(scope), { code: 'UNAUTHORIZED' });
    assert.throws(() => service.getJob(scope, first.id), { code: 'UNAUTHORIZED' });
    await assert.rejects(service.image(scope, first.id), { code: 'UNAUTHORIZED' });
  } finally { await service.close(); store.close(); }
});

test('image-only campaigns retain host scenes; tactical membership never falls back to party art', () => {
  const store = new GameStore(':memory:');
  try {
    assert.equal(resolveTacticalImageScene(store, scope), null);
    store.createCampaign(seed());
    assert.throws(() => resolveTacticalImageScene(store, { ...scope, owner: 'outsider' }), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});

test('revision pages retain every movement and hazard result across restart without consuming delivery', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-feed-')), 'game.sqlite');
  let store = new GameStore(file);
  try {
    store.createCampaign(seed());
    cmd(store, 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    const page = store.updates(scope, 1, 2);
    assert.deepEqual(page.views.map(v => v.revision), [2, 3]);
    assert.deepEqual(page.views.map(v => { const a = v.actors.find(a => a.id === 'scout'); return [a.x, a.hp]; }), [[2, 20], [2, 18]]);
    assert.equal(page.next, 3); assert.equal(page.hasMore, true);
    store.close(); store = new GameStore(file);
    assert.deepEqual(store.updates(scope, 1, 2), page);
    const tail = store.updates(scope, page.next);
    assert.equal(tail.views[0].actors.find(a => a.id === 'scout').x, 3);
    assert.equal(tail.hasMore, false);
    assert.deepEqual(store.updates(scope, tail.next).views, []);
    const other = store.updates({ ...scope, owner: 'bob' }, 1);
    assert.equal(other.views.length, 3);
    assert.equal(other.views[0].actors.find(a => a.id === 'scout').hp, undefined);
  } finally { store.close(); }
});

test('historical projections filter secrets, enforce current membership and validate cursors', () => {
  const store = new GameStore(':memory:');
  try {
    const data = seed(); data.actors[0].vision = 1; data.actors[2].name = 'SECRET';
    store.createCampaign(data);
    assert.ok(!JSON.stringify(store.updates(scope, 0)).includes('SECRET'));
    assert.throws(() => store.updates(scope, 2), { code: 'STALE' });
    for (const cursor of [-1, 1.5, NaN, '0']) assert.throws(() => store.updates(scope, cursor), { code: 'INVALID' });
    assert.throws(() => store.updates(scope, 0, 51), { code: 'INVALID' });
    store.db.prepare('DELETE FROM game_members WHERE owner=?').run('alice');
    assert.throws(() => store.updates(scope, 0), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});

test('expiry revision already removes the expired zone', () => {
  const store = new GameStore(':memory:');
  try {
    store.createCampaign(seed()); cmd(store, 'end_turn');
    cmd(store, 'end_turn', { actorId: 'warden' }, { ...scope, owner: 'bob' });
    const expired = store.events(host).find(e => e.kind === 'effect_expired');
    const frame = store.updates(scope, expired.revision - 1, 1).views[0];
    assert.equal(frame.effects.length, 0);
  } finally { store.close(); }
});
test('movement, effects, dice and repeated receipts survive restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-game-')), 'game.sqlite');
  let calls = 0;
  let store = new GameStore(file, { rollDie: sides => { calls++; return sides === 20 ? 14 : 6; } });
  try {
    store.createCampaign(seed());
    const move = cmd(store, 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    assert.equal(move.result.path.length, 2);
    assert.equal(store.view(scope).actors.find(a => a.id === 'scout').hp, 18);
    const input = { type: 'attack', actorId: 'scout', targetId: 'enemy', requestId: 'attack-one', expectedRevision: store.view(scope).revision };
    const receipt = store.command(scope, input);
    assert.equal(receipt.result.total, 19); assert.equal(receipt.result.damage, 9); assert.equal(calls, 2);
    assert.deepEqual(store.command(scope, input), receipt); assert.equal(calls, 2);
    store.close(); store = new GameStore(file, { rollDie: () => { throw new Error('Must not reroll'); } });
    assert.deepEqual(store.command(scope, input), receipt);
    assert.equal(store.view(host).actors.find(a => a.id === 'enemy').hp, 11);
    assert.equal(store.view(scope).actors.find(a => a.id === 'scout').x, 3);
  } finally { store.close(); }
});
test('stale, wrong-owner, wrong-turn and repeated-resource attacks change nothing', () => {
  const store = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 10 : 4 });
  try { store.createCampaign(seed()); const before = store.view(scope);
    assert.throws(() => cmd(store, 'move', { expectedRevision: 0, path: [{ x: 2, y: 1 }] }), { code: 'STALE' });
    assert.throws(() => cmd(store, 'end_turn', { actorId: 'warden' }), { code: 'UNAUTHORIZED' });
    assert.throws(() => cmd(store, 'end_turn', { actorId: 'warden' }, { ...scope, owner: 'bob' }), { code: 'TURN' });
    assert.deepEqual(store.view(scope), before);
    cmd(store, 'attack', { targetId: 'enemy' }); const after = store.view(scope);
    assert.throws(() => cmd(store, 'attack', { targetId: 'enemy' }), { code: 'RESOURCE' }); assert.deepEqual(store.view(scope), after);
  } finally { store.close(); }
});
test('pause allows map rendering but freezes movement and clock', () => {
  const store = new GameStore(':memory:');
  try { store.createCampaign(seed()); cmd(store, 'pause'); const view = store.view(scope); const image = renderTacticalMap(view);
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(image.readUInt32BE(16), 800); assert.ok(image.readUInt32BE(20) >= image.readUInt32BE(16), 'PNG includes the square board and its variable-height legend');
    assert.throws(() => cmd(store, 'move', { path: [{ x: 2, y: 1 }] }), { code: 'PAUSED' }); assert.deepEqual(store.view(scope), view);
  } finally { store.close(); }
});
test('effect expiration and once-per-turn entry are persisted as separate events', () => {
  const store = new GameStore(':memory:');
  try { store.createCampaign(seed()); cmd(store, 'move', { path: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] }); assert.equal(store.view(scope).actors.find(a => a.id === 'scout').hp, 18);
    cmd(store, 'end_turn'); assert.equal(store.view(scope).turn, 2); assert.equal(store.view(scope).effects.length, 1);
    cmd(store, 'end_turn', { actorId: 'warden' }, { ...scope, owner: 'bob' }); assert.equal(store.view(scope).turn, 3); assert.equal(store.view(scope).effects.length, 0);
    const events = store.events(host); assert.equal(events.filter(e => e.kind === 'actor_moved').length, 3); assert.equal(events.filter(e => e.kind === 'effect_triggered').length, 1); assert.equal(events.filter(e => e.kind === 'effect_expired').length, 1);
  } finally { store.close(); }
});
test('hidden actor, terrain and effect are absent from player projection and ledger', () => {
  const store = new GameStore(':memory:');
  try { const data = seed(); data.actors[0].vision = 2; data.actors[2].name = 'SECRET_VILLAIN'; data.map.blocked.push({ x: 10, y: 10 }); data.effects.push({ id: 'hidden-trap', name: 'SECRET_TRAP', trigger: 'enter', damage: 9, expiresAtTurn: 9, visible: false, cells: [{ x: 2, y: 2 }] }); store.createCampaign(data);
    const json = JSON.stringify(store.view(scope)); assert.ok(!json.includes('SECRET')); assert.ok(!json.includes('hidden-trap')); assert.ok(!json.includes('"x":10,"y":10')); assert.ok(!json.includes('"id":"enemy"'));
    assert.throws(() => store.events(scope), { code: 'UNAUTHORIZED' }); assert.throws(() => cmd(store, 'attack', { targetId: 'enemy' }), { code: 'NOT_VISIBLE' });
    assert.throws(() => store.view({ ...scope, campaign: 'other' }), { code: 'UNAUTHORIZED' });
  } finally { store.close(); }
});
test('lethal hazard stops movement before remaining cells without overspending', () => {
  const store = new GameStore(':memory:');
  try { const data = seed(); data.effects[0].damage = 20; store.createCampaign(data); const receipt = cmd(store, 'move', { path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] }); assert.equal(receipt.result.stopped, true); assert.equal(receipt.result.path.length, 1); assert.equal(receipt.result.movementRemaining, 25); }
  finally { store.close(); }
});
test('critical and natural-one outcomes use saved die values', () => {
  for (const [raw, hit, dice] of [[20, true, 2], [1, false, 0]]) {
    const store = new GameStore(':memory:', { rollDie: sides => sides === 20 ? raw : 4 });
    try { store.createCampaign(seed()); const r = cmd(store, 'attack', { targetId: 'enemy' }).result; assert.equal(r.hit, hit); assert.equal(r.damageDice.length, dice); assert.equal(r.damage, hit ? 11 : 0); }
    finally { store.close(); }
  }
});
test('two store connections reuse one command receipt and reject payload reuse', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-two-hosts-')), 'game.sqlite');
  const a = new GameStore(file, { rollDie: () => 7 }), b = new GameStore(file, { rollDie: () => { throw new Error('No second roll'); } });
  try { a.createCampaign(seed()); const input = { actorId: 'scout', type: 'attack', targetId: 'enemy', requestId: 'shared', expectedRevision: a.view(scope).revision }; const r = a.command(scope, input); assert.deepEqual(b.command(scope, input), r); assert.throws(() => b.command(scope, { ...input, targetId: 'warden' }), { code: 'CONFLICT' }); }
  finally { a.close(); b.close(); }
});


test('reviewed content validates its graph and drives council selection through player departure', () => {
  const store = new GameStore(':memory:', { rollDie: sides => sides === 20 ? 20 : 8 });
  try {
    const data = seed(); data.actors[2].hp = 1; store.createCampaign(data); store.configureMission(host, missionPlan());
    const pack = { schemaVersion: 1, id: 'greyharbor-chain', title: 'Greyharbor chain', world: { id: 'avarra', title: 'Avarra' }, regions: [{ id: 'coast', title: 'Coast' }], locations: [{ id: 'greyharbor', title: 'Greyharbor', regionId: 'coast' }],
      scenes: ['bridge', 'library', 'harbor'].map((id, index) => ({ map: { ...data.map, id }, locationId: 'greyharbor', entrances: [{ x: 1, y: 1 }, { x: 4, y: 1 }], npcs: [{ ...data.actors[2], id: index ? `guard-${id}` : 'enemy' }], effects: [] })),
      missions: ['watch', 'records', 'rescue'].map((id, index) => ({ mission: { ...missionPlan().mission, id, title: index ? id : 'Crossing watch', mapId: ['bridge', 'library', 'harbor'][index] }, summary: 'A public branch.', cost: 'No mechanical cost.', trackIds: ['trust'], priorities: { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 }, next: index ? [] : ['records', 'rescue'] })) };
    const install = { reviewed: true, pack };
    assert.throws(() => store.installContent(scope, install), { code: 'UNAUTHORIZED' });
    assert.throws(() => store.installContent(host, { reviewed: true, pack: { schema_version: '1.0.0', status: 'authored_content_blueprint_not_runtime' } }), { code: 'INVALID' });
    const broken = structuredClone(install); broken.pack.missions[0].next[0] = 'missing';
    assert.throws(() => store.installContent(host, broken), { code: 'INVALID' });
    const receipt = store.installContent(host, install);
    assert.deepEqual(store.installContent(host, install), receipt); assert.equal(store.view(scope).revision, 1);
    const changed = structuredClone(install); changed.pack.title = 'Different';
    assert.throws(() => store.installContent(host, changed), { code: 'CONFLICT' });
    cmd(store, 'attack', { targetId: 'enemy' }); cmd(store, 'end_turn');
    store.debrief(scope, { requestId: 'content-debrief', expectedRevision: 2, notes: '' });
    const council = store.prepareContentCouncil(host);
    assert.deepEqual(council.branches.map(b => b.id), ['records', 'rescue']);
    store.chooseCouncil(scope, { requestId: 'content-choice', round: council.round, branchId: 'records', expectedWorldRevision: 3 });
    const prepared = store.prepareContentDeparture(host, 'content-departure');
    assert.equal(store.view(scope).map.id, 'bridge');
    store.enterDeparture(scope, { departureId: prepared.id, requestId: 'content-enter' });
    assert.equal(store.view(scope).map.id, 'library'); assert.equal(store.world(scope).mission.id, 'records');
    assert.ok(!JSON.stringify(store.departure(scope)).includes('guard-harbor'));
  } finally { store.close(); }
});

test('scene transitions preserve party HP, archive casualties, revisit and restore repeat-safe mission activation', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'raph-scenes-')), 'game.sqlite');
  let store = new GameStore(file, { rollDie: sides => sides === 20 ? 20 : 8 });
  try {
    const data = seed(); data.actors[2].hp = 1; data.actors[0].hp = 11;
    store.createCampaign(data); store.configureMission(host, missionPlan());
    const select = (id) => {
      const revision = store.world(scope).revision;
      store.debrief(scope, { requestId: `debrief-${id}`, expectedRevision: revision, notes: 'Continue.' });
      const wr = store.world(scope).revision;
      const round = store.prepareCouncil(host, { reviewed: true, expectedWorldRevision: wr, branches: [id, `${id}-other`].map(branch => ({ id: branch, title: branch, summary: 'Reviewed.', cost: 'No mechanical cost.', trackIds: ['trust'], evidence: [`world:greyharbor:${wr}`], priorities: { aster: 1, mnemos: 1, seren: 1, kael: 1, mira: 1 } })) });
      store.chooseCouncil(scope, { requestId: `choice-${id}`, round: round.round, branchId: id, expectedWorldRevision: wr });
    };
    cmd(store, 'attack', { targetId: 'enemy' }); cmd(store, 'end_turn'); select('records');
    const map = { ...data.map, id: 'library', title: 'Library' };
    const input = { requestId: 'enter-library', reviewed: true, expectedRevision: store.view(scope).revision, expectedWorldRevision: store.world(scope).revision,
      destination: { mapId: map.id, map, npcs: [{ ...data.actors[2], id: 'sentinel' }], effects: [] },
      placements: [{ actorId: 'scout', x: 1, y: 1 }, { actorId: 'warden', x: 4, y: 1 }],
      mission: { ...missionPlan().mission, id: 'records', title: 'records', mapId: 'library' } };
    const before = store.load(scope.campaign), world = store.world(scope);
    assert.throws(() => store.transitionScene(scope, input), { code: 'UNAUTHORIZED' });
    assert.throws(() => store.transitionScene(host, { ...input, mission: { ...input.mission, id: 'unselected' } }), { code: 'CONFLICT' });
    assert.deepEqual(store.load(scope.campaign), before); assert.deepEqual(store.world(scope), world);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM game_scenes').get().n, 0);
    assert.throws(() => store.transitionScene(host, { ...input, placements: input.placements.map(p => ({ ...p, hp: 99 })) }), { code: 'INVALID' });
    assert.throws(() => store.prepareDeparture(scope, input), { code: 'UNAUTHORIZED' });
    const prepared = store.prepareDeparture(host, input);
    assert.deepEqual(store.load(scope.campaign), before); assert.deepEqual(store.world(scope), world);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM game_scenes').get().n, 0);
    assert.deepEqual(store.prepareDeparture(host, input), prepared);
    const replacement = store.prepareDeparture(host, { ...input, requestId: 'replacement-plan' });
    assert.throws(() => store.enterDeparture(scope, { departureId: prepared.id, requestId: 'old-offer' }), { code: 'STALE' });
    const token = 'a'.repeat(64);
    const handlers = createGameHttp(() => ({ game: store, access: { authenticateAccess: () => scope } }));
    const request = body => new Request('https://raph.example/api/game/departure', { method: 'POST', headers: { cookie: `raph_game_access=${token}`, origin: 'https://raph.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const get = new Request('https://raph.example/api/game/departure', { headers: { cookie: `raph_game_access=${token}` } });
    const publicDeparture = await (await handlers.departure(get)).json();
    assert.deepEqual(Object.keys(publicDeparture.departure).sort(), ['briefing', 'expectedRevision', 'expectedWorldRevision', 'id', 'title']);
    assert.equal(publicDeparture.departure.id, replacement.id);
    assert.ok(!JSON.stringify(publicDeparture).includes('sentinel'));
    const entry = { departureId: replacement.id, requestId: 'player-enter' };
    assert.equal((await handlers.enterDeparture(request({ ...entry, owner: 'host' }))).status, 400);
    assert.equal((await handlers.enterDeparture(request({ ...entry, destination: input.destination }))).status, 400);
    const cross = request(entry); cross.headers.set('origin', 'https://foreign.example');
    assert.equal((await handlers.enterDeparture(cross)).status, 403);
    const response = await handlers.enterDeparture(request(entry)); assert.equal(response.status, 200);
    const receipt = (await response.json()).receipt;
    assert.equal((await handlers.reach(request({ expectedRevision: input.expectedRevision, actorId: 'scout', targetId: 'sentinel' }))).status, 409);
    const reached = await handlers.reach(request({ expectedRevision: receipt.revision, actorId: 'scout', targetId: 'sentinel' }));
    assert.equal(reached.status, 200);
    assert.equal(store.view(scope).revision, receipt.revision);
    assert.equal(store.view(scope).map.id, 'library');
    assert.deepEqual(store.enterDeparture(scope, entry), receipt);
    assert.equal(store.departure(scope), null);
    assert.throws(() => store.enterDeparture({ ...scope, owner: 'bob' }, { ...entry, requestId: 'other-member' }), { code: 'STALE' });
    assert.equal(store.view(scope).actors.find(a => a.id === 'scout').hp, 11);
    assert.equal(store.world(scope).mission.id, 'records'); assert.equal(store.world(scope).mission.status, 'active');
    const old = JSON.parse(store.db.prepare('SELECT body FROM game_scenes WHERE map=?').get('bridge').body);
    assert.equal(old.npcs[0].hp, 0); assert.deepEqual(old.map, data.map);
    cmd(store, 'attack', { targetId: 'sentinel' }); cmd(store, 'end_turn'); select('return');
    const back = { ...input, requestId: 'return-bridge', expectedRevision: store.view(scope).revision, expectedWorldRevision: store.world(scope).revision, destination: { mapId: 'bridge' }, mission: { ...input.mission, id: 'return', title: 'return', mapId: 'bridge' } };
    assert.throws(() => store.transitionScene(host, { ...back, destination: { mapId: 'bridge', npcs: [] } }), { code: 'INVALID' });
    const returned = store.transitionScene(host, back);
    assert.equal(store.load(scope.campaign).actors.find(a => a.id === 'enemy').hp, 0);
    assert.equal(store.load(scope.campaign).effects.length, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM world_missions').get().n, 2);
    const backup = file + '.backup', restored = file + '.restored';
    backupGame(file, backup); restoreGameBackup(backup, restored); store.close(); store = new GameStore(join(restored, 'game.sqlite'));
    assert.deepEqual(store.transitionScene(host, back), returned);
    assert.equal(store.view(scope).map.id, 'bridge'); assert.equal(store.world(scope).mission.id, 'return');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM game_scenes').get().n, 2);
  } finally { store.close(); }
});
