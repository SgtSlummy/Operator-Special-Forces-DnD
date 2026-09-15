import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GameStore } from '../game/store.mjs';

const root = dirname(dirname(import.meta.filename));
const projectRoot = dirname(root);
const dataRoot = join(projectRoot, 'podman', 'dnd-data', 'data');
const gamePath = join(process.env.RAPHAEL_GAME_DATA_DIR ?? join(root, '.runtime', 'game'), 'game.sqlite');
const owner = process.env.RAPHAEL_SESSION_OWNER_ID;
if (!owner || !/^[A-Za-z0-9_-]{1,96}$/.test(owner)) throw new Error('Set RAPHAEL_SESSION_OWNER_ID to the Discord player who will operate the simulated party.');

const load = name => JSON.parse(readFileSync(join(dataRoot, `${name}.json`), 'utf8'));
const byName = (rows, name) => rows.find(row => row.name?.toLowerCase() === name.toLowerCase()) ?? rows.find(row => row.name?.toLowerCase().includes(name.toLowerCase()));
const blueprint = JSON.parse(readFileSync(join(projectRoot, 'campaigns', 'behind-the-veil.json'), 'utf8'));
const classes = load('classes');
const species = load('species');
const backgrounds = load('backgrounds');
const items = load('items');
const monsters = load('monsters');

const chosen = {
  branna: { class: byName(classes, 'Fighter'), species: byName(species, 'Human'), background: byName(backgrounds, 'Soldier'), item: byName(items, 'Longsword') },
  pip: { class: byName(classes, 'Wizard'), species: byName(species, 'Halfling'), background: byName(backgrounds, 'Sage'), item: byName(items, 'Quarterstaff') },
  kael: { class: byName(classes, 'Rogue'), species: byName(species, 'Half-orc'), background: byName(backgrounds, 'Criminal'), item: byName(items, 'Shortbow') },
};
const wightSource = byName(monsters, 'Brine Wight') ?? byName(monsters, 'Wight');
const sentinelSource = byName(monsters, 'Saltglass Sentinel') ?? byName(monsters, 'Bandit');
const sourceTag = (entry, fallback) => String(entry?.name ?? fallback).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');

const campaign = 'behind-veil-live';
const input = {
  campaign,
  title: `Behind the Veil · ${blueprint.locations.find(l => l.id === 'saltglass_shore')?.name ?? 'Saltglass Shore'}`,
  members: [{ owner, role: 'host' }],
  map: {
    id: 'saltglass-shore-town-gate', title: 'Saltglass Shore · Reedmarket Gate', width: 12, height: 8,
    blocked: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 7, y: 6 }],
    difficult: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 8, y: 5 }],
  },
  actors: [
    { id: 'branna', team: 'party', name: 'Branna Stonewake', owner, x: 1, y: 2, size: 1, hp: 28, maxHp: 28, ac: 16, speed: 30, vision: 8, initiative: 18, characterVersion: `dnd-2024-${sourceTag(chosen.branna.class, 'fighter')}-${sourceTag(chosen.branna.species, 'human')}-${sourceTag(chosen.branna.background, 'soldier')}`, weapon: { name: chosen.branna.item?.name ?? 'Longsword', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'pip', team: 'party', name: 'Pip Underbough', owner, x: 1, y: 4, size: 1, hp: 20, maxHp: 20, ac: 13, speed: 25, vision: 8, initiative: 16, characterVersion: `dnd-2024-${sourceTag(chosen.pip.class, 'wizard')}-${sourceTag(chosen.pip.species, 'halfling')}-${sourceTag(chosen.pip.background, 'sage')}`, weapon: { name: 'Fire Bolt', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 10, addAbilityToDamage: true, rangeFeet: 120 } },
    { id: 'kael', team: 'party', name: 'Kael Ashstep', owner, x: 2, y: 3, size: 1, hp: 24, maxHp: 24, ac: 14, speed: 30, vision: 8, initiative: 14, characterVersion: `dnd-2024-${sourceTag(chosen.kael.class, 'rogue')}-${sourceTag(chosen.kael.species, 'half-orc')}-${sourceTag(chosen.kael.background, 'criminal')}`, weapon: { name: chosen.kael.item?.name ?? 'Shortbow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 80 } },
    { id: 'brine-wight', team: 'opposition', name: wightSource?.name ?? 'Brine Wight', owner: null, x: 9, y: 2, size: 1, hp: 18, maxHp: 18, ac: 13, speed: 30, vision: 8, initiative: 11, characterVersion: `dnd-monster-${sourceTag(wightSource, 'brine-wight')}`, weapon: { name: 'Salt-flecked claws', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'saltglass-sentinel', team: 'opposition', name: sentinelSource?.name ?? 'Saltglass Sentinel', owner: null, x: 10, y: 5, size: 1, hp: 12, maxHp: 12, ac: 12, speed: 30, vision: 8, initiative: 9, characterVersion: `dnd-monster-${sourceTag(sentinelSource, 'saltglass-sentinel')}`, weapon: { name: 'Rust blade', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
  ],
  effects: [],
};

const store = new GameStore(gamePath);
try {
  if (!store.hasCampaign(campaign)) {
    const result = store.createCampaign(input);
    console.log(JSON.stringify({ created: true, ...result, party: input.actors.slice(0, 3).map(a => a.name), sources: { campaign: blueprint.title, classes: Object.fromEntries(Object.entries(chosen).map(([id, c]) => [id, c.class?.name])), species: Object.fromEntries(Object.entries(chosen).map(([id, c]) => [id, c.species?.name])), backgrounds: Object.fromEntries(Object.entries(chosen).map(([id, c]) => [id, c.background?.name])) } }, null, 2));
  } else {
    const state = store.load(campaign);
    console.log(JSON.stringify({ created: false, campaign, revision: state.revision, phase: state.phase, round: state.round, turn: state.turn, map: state.map.title, active: state.actors.find(a => a.id === state.order[state.activeIndex])?.name }, null, 2));
  }
} finally {
  store.close();
}
