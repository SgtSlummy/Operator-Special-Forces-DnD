import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GameStore } from '../game/store.mjs';

const repo = dirname(dirname(import.meta.filename));
const project = dirname(repo);
const data = name => JSON.parse(readFileSync(join(project, 'podman', 'dnd-data', 'data', `${name}.json`), 'utf8'));
const pick = (rows, name, fallback) => rows.find(row => row.name?.toLowerCase() === name.toLowerCase()) ?? rows.find(row => row.name?.toLowerCase().includes(name.toLowerCase())) ?? { name: fallback };
const slug = value => String(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
const owner = process.env.RAPHAEL_SESSION_OWNER_ID;
if (!owner || !/^[A-Za-z0-9_-]{1,96}$/.test(owner)) throw new Error('Set RAPHAEL_SESSION_OWNER_ID.');

const classes = data('classes');
const species = data('species');
const backgrounds = data('backgrounds');
const monsters = data('monsters');
const fighter = { class: pick(classes, 'Fighter', 'Fighter'), species: pick(species, 'Human', 'Human'), background: pick(backgrounds, 'Soldier', 'Soldier') };
const wizard = { class: pick(classes, 'Wizard', 'Wizard'), species: pick(species, 'Halfling', 'Halfling'), background: pick(backgrounds, 'Sage', 'Sage') };
const rogue = { class: pick(classes, 'Rogue', 'Rogue'), species: pick(species, 'Half-orc', 'Half-Orc'), background: pick(backgrounds, 'Criminal', 'Criminal') };
const goblin = pick(monsters, 'Goblin', 'Goblin Raider');
const worg = pick(monsters, 'Worg', 'Worg');
const ogre = pick(monsters, 'Ogre', 'Ogre');
const version = (profile, id) => `dnd-2024-${slug(profile.class.name)}-${slug(profile.species.name)}-${slug(profile.background.name)}-${id}`;
const monsterVersion = (source, id) => `dnd-monster-${slug(source.name)}-${id}`;
const campaign = 'camp-emberfall-live';
const gamePath = join(process.env.RAPHAEL_GAME_DATA_DIR ?? join(repo, '.runtime', 'game'), 'game.sqlite');
const input = {
  campaign,
  title: 'Camp Emberfall · Night Raid',
  members: [{ owner, role: 'host' }],
  map: {
    id: 'camp-emberfall-night', title: 'Camp Emberfall · Palisade Breach', width: 12, height: 8,
    blocked: [{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 2, y: 6 }, { x: 3, y: 6 }],
    difficult: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 5 }],
  },
  actors: [
    { id: 'camp-branna', team: 'party', name: 'Branna Stonewake', owner, x: 3, y: 2, size: 1, hp: 28, maxHp: 28, ac: 16, speed: 30, vision: 8, initiative: 18, characterVersion: version(fighter, 'branna'), weapon: { name: 'Longsword', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'camp-pip', team: 'party', name: 'Pip Underbough', owner, x: 4, y: 4, size: 1, hp: 20, maxHp: 20, ac: 13, speed: 25, vision: 8, initiative: 16, characterVersion: version(wizard, 'pip'), weapon: { name: 'Fire Bolt', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 10, addAbilityToDamage: true, rangeFeet: 120 } },
    { id: 'camp-kael', team: 'party', name: 'Kael Ashstep', owner, x: 3, y: 4, size: 1, hp: 24, maxHp: 24, ac: 14, speed: 30, vision: 8, initiative: 14, characterVersion: version(rogue, 'kael'), weapon: { name: 'Shortbow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 80 } },
    { id: 'camp-goblin', team: 'opposition', name: 'Goblin Raider', owner: null, x: 9, y: 1, size: 1, hp: 9, maxHp: 9, ac: 15, speed: 30, vision: 8, initiative: 15, characterVersion: monsterVersion(goblin, 'raider'), weapon: { name: 'Scimitar', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'camp-worg', team: 'opposition', name: 'Worg Stalker', owner: null, x: 10, y: 3, size: 1, hp: 18, maxHp: 18, ac: 13, speed: 50, vision: 8, initiative: 12, characterVersion: monsterVersion(worg, 'stalker'), weapon: { name: 'Bite', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'camp-ogre', team: 'opposition', name: 'Ogre Warbreaker', owner: null, x: 10, y: 6, size: 1, hp: 36, maxHp: 36, ac: 11, speed: 30, vision: 8, initiative: 8, characterVersion: monsterVersion(ogre, 'warbreaker'), weapon: { name: 'Greatclub', abilityScore: 19, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } },
  ],
  effects: [{ id: 'camp-fire', name: 'Campfire light', trigger: 'enter', damage: 0, expiresAtTurn: 9999, visible: true, cells: [{ x: 5, y: 4 }, { x: 6, y: 4 }] }],
};

const store = new GameStore(gamePath);
try {
  if (!store.hasCampaign(campaign)) console.log(JSON.stringify({ created: true, ...store.createCampaign(input), campaign, map: input.map.title, party: input.actors.slice(0, 3).map(a => a.name), enemies: input.actors.slice(3).map(a => a.name) }, null, 2));
  else {
    const state = store.load(campaign);
    console.log(JSON.stringify({ created: false, campaign, revision: state.revision, phase: state.phase, round: state.round, turn: state.turn, active: state.actors.find(a => a.id === state.order[state.activeIndex])?.name }, null, 2));
  }
} finally { store.close(); }
