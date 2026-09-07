import test from 'node:test';
import assert from 'node:assert/strict';
import { narrateChange } from './narration.mjs';
import { GameStore } from './store.mjs';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const view = (phase, revision = 1) => ({ campaign: 'narration-fixture', revision, phase,
  map: { id: 'hearth', title: 'The Last Hearth' }, actors: [], effects: [], round: 1, turn: 1 });

const transitions = [
  ['combat', 'exploration', 'Exploration begins.'],
  ['complete', 'exploration', 'Exploration begins.'],
  ['paused', 'exploration', 'Play has resumed.'],
  ['paused', 'combat', 'Play has resumed.'],
  ['exploration', 'paused', 'Play is paused.'],
  ['combat', 'paused', 'Play is paused.'],
  ['exploration', 'complete', 'The reviewed mission has ended.'],
  ['combat', 'complete', 'The encounter has ended.'],
  ['exploration', 'combat', 'Combat begins.'],
  ['complete', 'combat', 'Combat begins.'],
];
for (const [from, to, expected] of transitions) {
  test(`journal phase ${from} to ${to} describes the observed transition`, () => {
    const before = view(from);
    const after = view(to, 2);
    const saved = structuredClone({ before, after });
    assert.deepEqual(narrateChange(before, after), {
      source: 'game:narration-fixture:2', revision: 2,
      scene: 'The Last Hearth', round: 1, turn: 1,
      facts: [expected], mode: 'deterministic-observation', proposals: [],
    });
    assert.deepEqual({ before, after }, saved);
  });
}

test('unchanged phases and first observation do not invent a phase transition', () => {
  for (const phase of ['combat', 'exploration', 'paused', 'complete']) {
    assert.deepEqual(narrateChange(view(phase), view(phase, 2)).facts, []);
    assert.deepEqual(narrateChange(null, view(phase)).facts, ['Your visible scene is The Last Hearth.']);
  }
});

test('reviewed completion does not infer the chosen outcome or deltas from a receipt', () => {
  const receipt = { revision: 2, result: { type: 'mission_adjudicated', outcomeId: 'secret-outcome',
    summary: 'Unchosen secret option', deltas: { hiddenTrack: 6 } } };
  assert.deepEqual(narrateChange(view('exploration'), view('complete', 2), receipt).facts,
    ['The reviewed mission has ended.']);
});

test('saved GameStore journal narrates exploration and reviewed completion without leaking private facts or changing play', t => {
  const temporaryParent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(temporaryParent, 'raph-narration-test-')));
  const path = join(root, 'game.sqlite');
  let dice = 0;
  const options = { rollDie: () => { dice++; return 12; } };
  let game = new GameStore(path, options);
  t.after(() => {
    game.close();
    const resolvedRoot = realpathSync(root);
    assert.equal(dirname(resolvedRoot), temporaryParent);
    assert.match(basename(resolvedRoot), /^raph-narration-test-[A-Za-z0-9]+$/);
    rmSync(resolvedRoot, { recursive: true });
  });
  const host = { campaign: 'saved-narration', owner: 'fixture-host' };
  const player = { ...host, owner: 'fixture-player' };
  const actor = (id, owner, x, initiative) => ({ id, name: id, owner, team: owner ? 'party' : 'opposition', x, y: 1,
    size: 1, hp: 9, maxHp: 20, ac: 14, speed: 30, vision: 3, initiative, characterVersion: 'fixture-v1',
    weapon: { name: 'Bow', abilityScore: 16, proficient: true, proficiencyBonus: 2, equipmentBonus: 0,
      damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } });
  game.createCampaign({ campaign: host.campaign, title: 'Saved narration fixture',
    members: [{ owner: host.owner, role: 'host' }, { owner: player.owner, role: 'player' }],
    map: { id: 'hearth', title: 'The Last Hearth', width: 12, height: 12, blocked: [], difficult: [] },
    actors: [actor('Maren', player.owner, 1, 20), actor('PRIVATE-HIDDEN-NPC', null, 10, 10)], effects: [] });
  game.configureMission(host, { reviewed: true,
    tracks: [{ id: 'relationship', label: 'Relationship', kind: 'relationship', value: 50 }],
    mission: { id: 'conversation', title: 'A conversation', briefing: 'Listen to the villagers.', mapId: 'hearth', resolution: 'adjudicated',
      outcomes: [
        { id: 'listened', title: 'PRIVATE-CHOSEN-TITLE', summary: 'PRIVATE-CHOSEN-SUMMARY', changes: [{ trackId: 'relationship', delta: 3 }] },
        { id: 'departed', title: 'PRIVATE-UNCHOSEN-TITLE', summary: 'PRIVATE-UNCHOSEN-SUMMARY', changes: [{ trackId: 'relationship', delta: -8 }] },
      ] } });
  const explorationRevision = game.view(player).revision;
  const exploration = game.journal(player, explorationRevision - 1).entries;
  assert.deepEqual(exploration.map(entry => entry.facts), [['Exploration begins.']]);
  game.adjudicateMission(host, { reviewed: true, requestId: 'reviewed-narration-outcome',
    expectedRevision: explorationRevision, expectedWorldRevision: game.world(host).revision, outcomeId: 'listened' });
  const completionRevision = game.view(player).revision;
  const snapshot = () => ({ state: game.load(host.campaign), world: game.world(host), events: game.events(host), dice,
    gameReceipts: game.db.prepare('SELECT count(*) AS n FROM game_receipts').get().n,
    worldReceipts: game.db.prepare('SELECT count(*) AS n FROM world_receipts').get().n });
  const before = snapshot();
  const journal = game.journal(player, 0);
  assert.deepEqual(journal.entries.find(entry => entry.revision === completionRevision).facts, ['The reviewed mission has ended.']);
  for (const entry of journal.entries) {
    assert.equal(entry.source, `game:${host.campaign}:${entry.revision}`);
    assert.deepEqual(entry.proposals, []);
  }
  assert.doesNotMatch(JSON.stringify(journal), /PRIVATE-|Relationship|listened|departed|delta/);
  assert.equal(before.state.phase, 'complete');
  assert.equal(before.world.mission.status, 'debrief');
  assert.equal(before.dice, 0);
  assert.deepEqual(snapshot(), before);
  game.close();
  game = new GameStore(path, options);
  assert.deepEqual(game.journal(player, 0), journal);
  assert.deepEqual(game.journal(player, explorationRevision - 1).entries.map(entry => entry.facts),
    [['Exploration begins.'], ['The reviewed mission has ended.']]);
  assert.deepEqual(snapshot(), before);
});
