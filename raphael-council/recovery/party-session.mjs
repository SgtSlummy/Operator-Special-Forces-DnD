import { mkdir, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameStore } from '../game/store.mjs';
import { tacticalImageScene } from '../game/image-scene.mjs';
import { SceneImageService } from '../images/service.mjs';
import { collectAgentProposals, createDeckStep } from './deck-events.mjs';
import { adjudicateDetail } from './detail-adjudicator.mjs';
import { analyzeTacticalMap, evaluateTacticalPath } from './tactical-terrain-agent.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artRoot = resolve(root, '../campaign-art/witnesslight');
const campaign = 'party-visual-session';
const hostScope = { campaign, owner: 'host' };
const players = [
  { owner: 'player-1', id: 'branna', name: 'Branna Stonewake', ancestry: 'Human', className: 'Fighter', background: 'Guard', hp: 12, ac: 16, speed: 30, initiative: 18, x: 3, y: 5, ability: 16, weapon: { name: 'Longsword', rangeFeet: 5, damageDie: 8, damage: 3 }, color: '#bf7b4b' },
  { owner: 'player-2', id: 'pip', name: 'Pip Underbough', ancestry: 'Halfling', className: 'Wizard', background: 'Sage', hp: 8, ac: 12, speed: 25, initiative: 15, x: 3, y: 12, ability: 16, weapon: { name: 'Fire Bolt', rangeFeet: 120, damageDie: 10, damage: 3 }, color: '#6f9fbc' },
  { owner: 'player-3', id: 'kael', name: 'Kael Ashstep', ancestry: 'Half-orc', className: 'Rogue', background: 'Urchin', hp: 10, ac: 14, speed: 30, initiative: 14, x: 3, y: 19, ability: 16, weapon: { name: 'Shortbow', rangeFeet: 80, damageDie: 6, damage: 3 }, color: '#9b7b53' },
];
const enemies = [
  { id: 'brine-wight-a', name: 'Brine Wight A', x: 7, y: 5, initiative: 10 },
  { id: 'brine-wight-b', name: 'Brine Wight B', x: 7, y: 12, initiative: 9 },
  { id: 'brine-wight-c', name: 'Brine Wight C', x: 7, y: 19, initiative: 8 },
];

const rulesComponents = {
  dmHandbook: ['scene framing', 'read-aloud text', 'initiative tracker', 'hidden information', 'encounter roster', 'terrain and cover', 'visibility/fog', 'DC/check adjudication', 'NPC reactions', 'consequence ledger', 'world clock', 'session journal', 'checkpoint/debrief'],
  playerHandbook: ['character sheet', 'level/class/ancestry', 'ability modifiers', 'proficiencies', 'action economy', 'movement and difficult terrain', 'attack roll and damage', 'spell slot and cantrip tracking', 'inventory/equipment', 'conditions', 'reactions', 'concentration', 'death saves', 'inspiration', 'short/long rest', 'journal and known leads'],
};

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000; };
}

function actorSeed(p) {
  return { id: p.id, name: p.name, owner: p.owner, team: 'party', x: p.x, y: p.y, size: 1, hp: p.hp, maxHp: p.hp, ac: p.ac, speed: p.speed, vision: 8, initiative: p.initiative, characterVersion: 'party-v1', weapon: { name: p.weapon.name, abilityScore: p.ability, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: p.weapon.damageDie, addAbilityToDamage: true, rangeFeet: p.weapon.rangeFeet } };
}

function assertOrderedReplay(steps) {
  let firstTransition = -1;
  let lastEncounterAction = -1;
  let shoreImage = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.action.type === 'help_the_courier') firstTransition = firstTransition < 0 ? index : firstTransition;
    if (['move', 'attack', 'end_turn'].includes(step.action.type)) lastEncounterAction = index;
    if (firstTransition < 0) {
      shoreImage ??= step.image.approvedImage;
      if (step.image.approvedImage !== shoreImage || step.location.id !== 'saltglass-party-shore') throw new Error('Replay order invalid: encounter changed scene before transition.');
    }
  }
  if (firstTransition < 0 || firstTransition <= lastEncounterAction) throw new Error('Replay order invalid: transition must follow the completed encounter.');
  if (steps[firstTransition]?.location.id !== 'abbey-archive' || steps[firstTransition]?.image.approvedImage !== '12-drowned-abbey') throw new Error('Replay order invalid: transition must enter the Abbey scene and image together.');
}

export async function runPartySession({ temporaryRoot = null, proposeAgents = null, proposalTimeoutMs = 1200 } = {}) {
  const ownedRoot = temporaryRoot ?? await mkdtemp(join(tmpdir(), 'raphael-party-session-'));
  await mkdir(ownedRoot, { recursive: true });
  const game = new GameStore(join(ownedRoot, 'game.sqlite'), { rollDie: sides => sides });
  let activeImage = '11-saltglass-shore';
  let activeScene = null;
  const sceneImages = new SceneImageService({
    dataDir: join(ownedRoot, 'images'), artRoot,
    provider: async () => readFile(sceneImages.asset(activeImage)),
    resolveScene: scope => ({ ...(activeScene ?? tacticalImageScene(game.view(scope), scope)), approvedImage: activeImage }),
  });
  const steps = [];
  const rng = seededRandom(0x51a17); const classRolls = players.map(() => Math.floor(rng() * 6) + 1);
  const party = players.map((p, i) => ({ ...p, classRoll: classRolls[i], level: 1, hitDice: '1d10', proficiencies: p.className === 'Fighter' ? ['Athletics', 'Intimidation'] : p.className === 'Wizard' ? ['Arcana', 'Investigation'] : ['Stealth', 'Sleight of Hand'], spellcasting: p.className === 'Wizard' ? { cantrips: ['Fire Bolt', 'Light'], slots: { level1: 2 }, prepared: ['Shield', 'Sleep'] } : null, inventory: p.className === 'Fighter' ? ['longsword', 'shield', 'chain mail', 'adventurer pack'] : p.className === 'Wizard' ? ['spellbook', 'arcane focus', 'dagger', 'component pouch'] : ['shortbow', '20 arrows', 'two daggers', 'thieves tools']}));

  async function snapshot(screen, action, notes = {}) {
    const view = game.view(hostScope);
    const scene = activeScene ? { ...activeScene, revision: view.revision, sceneRevision: view.revision } : await sceneImages.scene(hostScope);
    const tactical = analyzeTacticalMap({ map: view.map, locationId: scene.id, viewer: 'admin' });
    const request = await sceneImages.requestImage(hostScope, { requestId: `party-image-${steps.length + 1}`, focusId: 'scene' });
    const job = await sceneImages.waitForJob(hostScope, request.id, { timeoutMs: 5000 });
    const actors = view.actors.map(actor => ({ ...actor, coordinate: `${String.fromCharCode(65 + actor.x)}${actor.y + 1}`, hp: actor.hp ?? null }));
    const buttons = ['What do I see?', 'Inspect map', 'View character', 'Move', 'Attack', 'Cast Spell', 'Use Equipment', 'End Turn', 'Open Journal', 'Save Checkpoint'];
    const initiative = view.actors.map(actor => ({ id: actor.id, name: actor.name, initiative: [...players, ...enemies].find(item => item.id === actor.id)?.initiative ?? null }));
    const proposals = await collectAgentProposals({ gameRevision: view.revision, action, location: scene, map: view.map, tactical, actors }, { propose: proposeAgents, timeoutMs: proposalTimeoutMs });
    const activeParty = party.find(member => member.id === action?.actorId) ?? party[0];
    const detail = adjudicateDetail({
      actor: activeParty,
      roll: action?.roll ?? null,
      buffs: activeParty?.buffs ?? [],
      storyInitiative: notes.storyInitiative ?? (screen.includes('SOCIAL') ? 'urgent' : 'ordinary'),
      requestedFocus: action?.type === 'inspect' ? action.focus ?? 'scene' : null,
    });
    const image = { phase: 'before', stateRevision: view.revision, status: job.status, jobId: job.id, sceneRevision: job.sceneRevision, approvedImage: activeImage, source: job.status === 'ready' ? 'generated' : 'approved_fallback' };
    const afterImage = { ...image, phase: 'after' };
    const step = createDeckStep({ index: steps.length + 1, total: null, view, scene, action, notes: { ...notes, screen, characterQuestion: 'The party asks: What do we see?' }, buttons, actors: view.actors.map(actor => ({ ...actor, coordinate: `${String.fromCharCode(65 + actor.x)}${actor.y + 1}`, hp: actor.hp ?? null })), initiative, party, rulesComponents, image, afterImage, detail, tactical, proposals });
    steps.push({ ...step, map: { ...view.map, blocked: view.map.blocked, difficult: view.map.difficult, visibleCells: view.map.cells?.length ?? 0 } });
    return job;
  }

  try {
    game.createCampaign({ campaign, title: 'Behind the Veil · Saltglass Shore · Three-Player Test', members: [{ owner: 'host', role: 'host' }, ...players.map(p => ({ owner: p.owner, role: 'player' }))], map: { id: 'saltglass-party-shore', title: 'Saltglass Shore', width: 25, height: 25, blocked: [
      { x: 10, y: 3 }, { x: 11, y: 3 }, { x: 12, y: 3 }, { x: 10, y: 4 }, { x: 11, y: 4 }, { x: 12, y: 4 }, { x: 11, y: 5 },
      { x: 14, y: 9 }, { x: 15, y: 9 }, { x: 16, y: 9 }, { x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 }, { x: 15, y: 11 },
      { x: 10, y: 17 }, { x: 11, y: 17 }, { x: 12, y: 17 }, { x: 10, y: 18 }, { x: 11, y: 18 }, { x: 12, y: 18 }, { x: 11, y: 19 },
      { x: 18, y: 5 }, { x: 19, y: 5 }, { x: 18, y: 6 }, { x: 19, y: 6 }, { x: 20, y: 6 }, { x: 18, y: 7 },
    ], difficult: [
      { x: 4, y: 5 }, { x: 4, y: 12 }, { x: 4, y: 19 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 5, y: 11 }, { x: 5, y: 13 }, { x: 6, y: 18 }, { x: 6, y: 20 },
      { x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 16 }, { x: 9, y: 16 }, { x: 20, y: 12 }, { x: 21, y: 12 },
    ] }, actors: [...players.map(actorSeed), ...enemies.map(e => ({ id: e.id, name: e.name, owner: null, team: 'opposition', x: e.x, y: e.y, size: 1, hp: 9, maxHp: 9, ac: 12, speed: 30, vision: 8, initiative: e.initiative, characterVersion: 'encounter-v1', weapon: { name: 'Salt claw', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } }))], effects: [] });
    await snapshot('CHARACTER ACCEPTANCE · PARTY READY', { type: 'accept_characters', cost: 'none' }, { randomSeed: '0x51a17', classRolls, acceptance: 'summary-first; all required combat fields present' });
    const movement = [
      ['player-1', 'branna', { x: 4, y: 5 }, 'difficult terrain costs 10 feet'], ['player-1', 'branna', { x: 5, y: 5 }, '5 feet'], ['player-1', 'branna', { x: 6, y: 5 }, '5 feet'],
      ['player-2', 'pip', { x: 4, y: 12 }, 'difficult terrain costs 10 feet'], ['player-2', 'pip', { x: 5, y: 12 }, '5 feet'], ['player-2', 'pip', { x: 6, y: 12 }, '5 feet'],
      ['player-3', 'kael', { x: 4, y: 19 }, 'difficult terrain costs 10 feet'], ['player-3', 'kael', { x: 5, y: 19 }, '5 feet'], ['player-3', 'kael', { x: 6, y: 19 }, '5 feet'],
    ];
    await snapshot('OPENING BRIEFING', { type: 'listen', cost: 'none' }, { visibleLeads: ['distress signal', 'fallen spar', 'three shapes in the surf'] });
    const turns = [
      { owner: 'player-1', actorId: 'branna', targetId: 'brine-wight-a', path: movement.slice(0, 3) },
      { owner: 'player-2', actorId: 'pip', targetId: 'brine-wight-b', path: movement.slice(3, 6) },
      { owner: 'player-3', actorId: 'kael', targetId: 'brine-wight-c', path: movement.slice(6, 9) },
    ];
    for (const { owner, actorId, targetId, path } of turns) {
      for (const [, , destination, cost] of path) {
        const tactical = analyzeTacticalMap({ map: game.view(hostScope).map, locationId: 'saltglass-party-shore', viewer: owner });
        const tacticalPath = evaluateTacticalPath({ tactical, path: [destination] });
        if (!tacticalPath.allowed) throw new Error(`Tactical movement rejected: ${tacticalPath.failures.join('; ')}`);
        const before = game.view({ campaign, owner }).revision;
        const result = game.command({ campaign, owner }, { requestId: `move-${steps.length + 1}`, expectedRevision: before, actorId, type: 'move', path: [destination] });
        await snapshot(`MOVEMENT · ${actorId.toUpperCase()} TO ${String.fromCharCode(65 + destination.x)}${destination.y + 1}`, { type: 'move', actorId, path: [destination], cost }, { result: result.result, impediment: cost.includes('difficult') ? 'difficult terrain' : 'none' });
      }
      const before = game.view({ campaign, owner }).revision;
      const result = game.command({ campaign, owner }, { requestId: `attack-${steps.length + 1}`, expectedRevision: before, actorId, type: 'attack', targetId });
      await snapshot(`COMBAT · ${actorId.toUpperCase()} ATTACKS`, { type: 'attack', actorId, targetId, cost: '1 action', roll: result.result }, { result: result.result, resources: 'action spent; movement remains until end turn' });
      const endBefore = game.view({ campaign, owner }).revision;
      const ended = game.command({ campaign, owner }, { requestId: `end-${steps.length + 1}`, expectedRevision: endBefore, actorId, type: 'end_turn' });
      await snapshot(`TURN END · ${actorId.toUpperCase()}`, { type: 'end_turn', actorId, cost: 'end turn' }, { result: ended.result });
    }
    activeImage = '12-drowned-abbey';
    activeScene = { campaign, audience: 'party', id: 'abbey-archive', title: 'Drowned Abbey Archive', sourceEventId: `narrative:${campaign}:abbey`, description: 'The rescued courier points toward a dry upper sanctuary. A brass seal, a wet trail and a locked records door are visible. The party has not yet chosen what to do.', references: [], subjects: [{ id: 'courier', label: 'Salt-stained courier', description: 'Visible injured courier; testimony not yet taken.' }] };
    sceneImages.publishScene(activeScene);
    await snapshot('TRANSITION · DROWNED ABBEY', { type: 'help_the_courier', cost: 'none' }, { consequence: 'courier rescued; abbey lead opened' });
    await snapshot('SOCIAL DECISION · BRASS SEAL', { type: 'decision', choice: 'Carry the seal into the records room', cost: 'none' }, { confirmation: 'committed', worldChange: 'records door becomes next objective' });
    const view = game.view(hostScope);
    assertOrderedReplay(steps);
    return { session: 'Behind the Veil: Saltglass Shore', generatedAt: new Date().toISOString(), party, seed: '0x51a17', checkpoint: { campaign, revision: view.revision, scene: activeScene.id, sceneImageRevision: steps.at(-1).sceneRevision, resumable: true, players: party.map(p => ({ owner: p.owner, id: p.id, level: p.level, className: p.className, hp: view.actors.find(a => a.id === p.id)?.hp ?? p.hp })), tactical: { engine: 'tactical-terrain-agent', version: 1 }, world: { courierRescued: true, abbeyLead: true } }, steps };
  } finally {
    await sceneImages.close(); game.close();
    if (!temporaryRoot) await rm(ownedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('party-session.mjs')) console.log(JSON.stringify(await runPartySession(), null, 2));
