import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { GameStore } from '../game/store.mjs';

const repo = dirname(dirname(import.meta.filename));
const project = dirname(repo);
const owner = process.env.RAPHAEL_SESSION_OWNER_ID;
const token = process.env.DISCORD_TOKEN;
const channel = process.env.RAPHAEL_CHANNEL_ID ?? '1546676505780944979';
if (!owner || !token) throw new Error('Set RAPHAEL_SESSION_OWNER_ID and DISCORD_TOKEN.');
const data = name => JSON.parse(readFileSync(join(project, 'podman', 'dnd-data', 'data', `${name}.json`), 'utf8'));
const pick = (rows, name, fallback) => rows.find(row => row.name?.toLowerCase() === name.toLowerCase()) ?? rows.find(row => row.name?.toLowerCase().includes(name.toLowerCase())) ?? { name: fallback };
const classes = data('classes'), species = data('species'), backgrounds = data('backgrounds'), monsters = data('monsters');
const source = { fighter: { class: pick(classes, 'Fighter', 'Fighter'), species: pick(species, 'Human', 'Human'), background: pick(backgrounds, 'Soldier', 'Soldier') }, wizard: { class: pick(classes, 'Wizard', 'Wizard'), species: pick(species, 'Halfling', 'Halfling'), background: pick(backgrounds, 'Sage', 'Sage') }, rogue: { class: pick(classes, 'Rogue', 'Rogue'), species: pick(species, 'Half-orc', 'Half-Orc'), background: pick(backgrounds, 'Criminal', 'Criminal') } };
const monster = name => pick(monsters, name, name);
const slug = value => String(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
const version = (profile, id) => `dnd-2024-${slug(profile.class.name)}-${slug(profile.species.name)}-${slug(profile.background.name)}-${id}`;
const campaign = 'camp-emberfall-round25c';
const dbPath = join(process.env.RAPHAEL_GAME_DATA_DIR ?? join(repo, '.runtime', 'game'), 'game.sqlite');
const artDir = join(repo, 'tmp', 'camp-round25');
mkdirSync(artDir, { recursive: true });

const base = {
  campaign, title: 'Camp Emberfall · Round 1 (25×25)', members: [{ owner, role: 'host' }],
  map: {
    id: 'camp-emberfall-25x25', title: 'Camp Emberfall · Palisade Breach', width: 25, height: 25,
    blocked: [
      ...[6, 7, 8].flatMap(x => [10, 11, 12].map(y => ({ x, y }))),
      ...[6, 7, 8].flatMap(x => [16, 17, 18].map(y => ({ x, y }))),
      ...[17, 18, 19].flatMap(x => [5, 6, 7].map(y => ({ x, y }))),
      ...[17, 18, 19].flatMap(x => [20, 21, 22].map(y => ({ x, y }))),
      { x: 12, y: 3 }, { x: 13, y: 3 }, { x: 12, y: 22 }, { x: 13, y: 22 },
    ],
    difficult: [
      ...[3, 4, 5, 6, 7].map(x => ({ x, y: 14 })),
      ...[14, 15, 16, 17, 18].map(x => ({ x, y: 13 })),
      ...[10, 11, 12, 13].map(y => ({ x: 15, y })),
    ],
  },
  actors: [
    { id: 'round-branna', team: 'party', name: 'Branna Stonewake', owner, x: 4, y: 12, size: 1, hp: 28, maxHp: 28, ac: 16, speed: 30, vision: 12, initiative: 18, characterVersion: version(source.fighter, 'branna'), weapon: { name: 'Longsword', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'round-pip', team: 'party', name: 'Pip Underbough', owner, x: 5, y: 14, size: 1, hp: 20, maxHp: 20, ac: 13, speed: 25, vision: 12, initiative: 16, characterVersion: version(source.wizard, 'pip'), weapon: { name: 'Fire Bolt', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 10, addAbilityToDamage: true, rangeFeet: 120 } },
    { id: 'round-kael', team: 'party', name: 'Kael Ashstep', owner, x: 4, y: 16, size: 1, hp: 24, maxHp: 24, ac: 14, speed: 30, vision: 12, initiative: 15, characterVersion: version(source.rogue, 'kael'), weapon: { name: 'Shortbow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 80 } },
    { id: 'round-goblin', team: 'opposition', name: 'Goblin Raider', owner: null, x: 12, y: 14, size: 1, hp: 9, maxHp: 9, ac: 15, speed: 30, vision: 12, initiative: 14, characterVersion: `dnd-monster-${slug(monster('Goblin').name)}-raider`, weapon: { name: 'Scimitar', abilityScore: 14, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'round-worg', team: 'opposition', name: 'Worg Stalker', owner: null, x: 17, y: 15, size: 1, hp: 18, maxHp: 18, ac: 13, speed: 50, vision: 12, initiative: 12, characterVersion: `dnd-monster-${slug(monster('Worg').name)}-stalker`, weapon: { name: 'Bite', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } },
    { id: 'round-ogre', team: 'opposition', name: 'Ogre Warbreaker', owner: null, x: 20, y: 20, size: 1, hp: 36, maxHp: 36, ac: 11, speed: 30, vision: 12, initiative: 10, characterVersion: `dnd-monster-${slug(monster('Ogre').name)}-warbreaker`, weapon: { name: 'Greatclub', abilityScore: 19, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 5 } },
  ],
  effects: [{ id: 'round-campfire', name: 'Campfire light', trigger: 'enter', damage: 0, expiresAtTurn: 9999, visible: true, cells: [{ x: 12, y: 14 }, { x: 13, y: 14 }] }],
};

function mapPng(state, activeId, actionPath = []) {
  const cell = 30, top = 74, canvas = createCanvas(state.map.width * cell, top + state.map.height * cell);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111820'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e6d6b3'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`${state.map.title}  ·  Round ${state.round}  ·  Turn ${state.turn}`, 18, 28);
  ctx.fillStyle = '#9ca9ae'; ctx.font = '14px sans-serif'; ctx.fillText('NORTH ↑   blue = company   red = hostiles   gold ring = active actor   amber = difficult ground', 18, 52);
  const blocked = new Set(state.map.blocked.map(p => `${p.x},${p.y}`)), difficult = new Set(state.map.difficult.map(p => `${p.x},${p.y}`));
  const path = new Set(actionPath.map(p => `${p.x},${p.y}`));
  for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) {
    const key = `${x},${y}`, px = x * cell, py = top + y * cell;
    ctx.fillStyle = blocked.has(key) ? '#27333a' : difficult.has(key) ? '#6e5436' : '#34484a'; ctx.fillRect(px, py, cell, cell);
    if (blocked.has(key)) { ctx.fillStyle = '#59666a'; ctx.fillRect(px + 5, py + 6, cell - 10, cell - 12); }
    if (path.has(key)) { ctx.strokeStyle = '#f5c76b'; ctx.lineWidth = 3; ctx.strokeRect(px + 3, py + 3, cell - 6, cell - 6); }
    ctx.strokeStyle = '#56686b'; ctx.lineWidth = 1; ctx.strokeRect(px, py, cell, cell);
  }
  ctx.fillStyle = '#c6923c'; ctx.beginPath(); ctx.arc(12 * cell + 15, top + 14 * cell + 15, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe2a0'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('F', 12 * cell + 11, top + 14 * cell + 20);
  for (const actor of state.actors) {
    const cx = actor.x * cell + 15, cy = top + actor.y * cell + 15, party = actor.team === 'party';
    ctx.fillStyle = actor.hp === 0 ? '#596168' : party ? '#4ba3d3' : '#ce665c'; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    if (actor.id === activeId) { ctx.strokeStyle = '#f7d36b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#101820'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(actor.name[0], cx - 4, cy + 4);
  }
  ctx.fillStyle = '#d2dadd'; ctx.font = '12px sans-serif'; ctx.fillText('W', 3, top - 6); ctx.fillText('E', canvas.width - 14, top - 6);
  return canvas.toBuffer('image/png');
}

async function post({ title, description, actor, button, result, state, path }) {
  const filename = `camp-round25-${String(state.revision).padStart(2, '0')}.png`;
  const file = join(artDir, filename); writeFileSync(file, mapPng(state, actor?.id, path));
  const payload = { embeds: [{ title, description, color: actor?.team === 'opposition' ? 13445205 : 4509882, fields: [{ name: 'BUTTON PRESS', value: `[2;${button}[0m`, inline: true }, { name: 'RESULT', value: result, inline: true }], image: { url: `attachment://${filename}` }, footer: { text: `saved revision ${state.revision} · 25×25 overhead grid · ${actor?.name ?? 'DM'}` } }], components: [{ type: 1, components: [{ type: 2, custom_id: 'rpg:home', label: 'Open current battle table', style: 1 }, { type: 2, custom_id: 'rpi:home', label: 'My hero', style: 2 }] }], attachments: [{ id: 0, filename }] };
  const selected = button.toUpperCase();
  const actionButton = (name, id) => ({ type: 2, custom_id: `history:${id}:${state.revision}`, label: selected.includes(name) ? `✓ ${name}` : name, style: selected.includes(name) ? 3 : 2, disabled: true });
  payload.embeds[0].fields[0] = { name: 'BUTTON PRESSED', value: button, inline: true };
  payload.components = [{ type: 1, components: [actionButton('MOVE', 'move'), actionButton('ATTACK', 'attack'), actionButton('END TURN', 'end')] }, { type: 1, components: [{ type: 2, custom_id: 'rpg:home', label: 'Open current battle table', style: 1 }, { type: 2, custom_id: 'rpi:home', label: 'My hero', style: 2 }] }];
  const form = new FormData(); form.append('payload_json', JSON.stringify(payload)); form.append('files[0]', new Blob([readFileSync(file)], { type: 'image/png' }), filename);
  const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token}` }, body: form });
  if (!response.ok) throw new Error(`Discord post failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const store = new GameStore(dbPath);
const scope = { campaign, owner };
try {
  if (!store.hasCampaign(campaign)) store.createCampaign(base);
  const marker = store.db.prepare("SELECT 1 FROM game_events WHERE campaign=? AND kind='round_script_complete'").get(campaign);
  if (marker) { console.log(JSON.stringify({ skipped: true, campaign, reason: 'round already published' })); }
  else {
    let state = store.load(campaign);
    await post({ title: 'CAMP EMBERFALL  ·  ROUND 1', description: '**The night raid begins.**\\nSix actors will resolve their turns in initiative order. This is the visible combat log; every map is the saved 25×25 overhead state.', actor: state.actors.find(a => a.id === state.order[state.activeIndex]), button: 'OPEN BATTLE TABLE', result: 'Branna is active. The campfire is lit. The palisade breach is east.', state });
    const steps = [
      { actorId: 'round-branna', type: 'move', path: [{ x: 5, y: 12 }, { x: 5, y: 13 }, { x: 6, y: 13 }, { x: 7, y: 13 }, { x: 8, y: 13 }, { x: 9, y: 13 }], button: 'MOVE', result: 'Branna advances 6 squares around the canvas tents and holds the line.' },
      { actorId: 'round-branna', type: 'end_turn', button: 'END TURN', result: 'Branna ends her turn. Initiative passes to Pip.' },
      { actorId: 'round-pip', type: 'attack', targetId: 'round-goblin', button: 'ATTACK', result: 'Pip fires Fire Bolt at the Goblin Raider from the fireline.' },
      { actorId: 'round-pip', type: 'end_turn', button: 'END TURN', result: 'Pip ends her turn. Initiative passes to Kael.' },
      { actorId: 'round-kael', type: 'move', path: [{ x: 5, y: 16 }, { x: 5, y: 15 }, { x: 6, y: 15 }, { x: 7, y: 15 }, { x: 8, y: 15 }, { x: 9, y: 15 }], button: 'MOVE', result: 'Kael slips 6 squares around the tent line toward the breach.' },
      { actorId: 'round-kael', type: 'attack', targetId: 'round-goblin', button: 'ATTACK', result: 'Kael looses a Shortbow shot at the Goblin Raider.' },
      { actorId: 'round-kael', type: 'end_turn', button: 'END TURN', result: 'Kael ends his turn. The raiders answer.' },
      { actorId: 'round-goblin', type: 'move', path: [{ x: 11, y: 14 }, { x: 10, y: 14 }], button: 'MOVE', result: 'The Goblin Raider darts 2 squares around the fire and closes on Kael.' },
      { actorId: 'round-goblin', type: 'attack', targetId: 'round-kael', button: 'ATTACK', result: 'The Goblin Raider swings a scimitar at Kael.' },
      { actorId: 'round-goblin', type: 'end_turn', button: 'END TURN', result: 'The Goblin Raider breaks away. The Worg Stalker moves.' },
      { actorId: 'round-worg', type: 'move', path: [{ x: 16, y: 15 }, { x: 15, y: 14 }, { x: 14, y: 13 }, { x: 13, y: 13 }, { x: 12, y: 13 }, { x: 11, y: 13 }, { x: 10, y: 13 }], button: 'MOVE', result: 'The Worg Stalker crosses 7 squares and reaches the edge of the firelight.' },
      { actorId: 'round-worg', type: 'attack', targetId: 'round-branna', button: 'ATTACK', result: 'The Worg Stalker lunges at Branna from the north.' },
      { actorId: 'round-worg', type: 'end_turn', button: 'END TURN', result: 'The Worg Stalker ends its turn. The Ogre advances on the camp.' },
      { actorId: 'round-ogre', type: 'move', path: [{ x: 20, y: 19 }, { x: 19, y: 18 }, { x: 18, y: 18 }, { x: 17, y: 18 }, { x: 16, y: 18 }], button: 'MOVE', result: 'The Ogre Warbreaker advances 5 squares toward the supply tents.' },
      { actorId: 'round-ogre', type: 'end_turn', button: 'END TURN', result: 'The Ogre ends its turn. Round 1 is complete; the company regains the initiative.' },
    ];
    for (const [index, step] of steps.entries()) {
      state = store.load(campaign);
      const actor = state.actors.find(a => a.id === step.actorId);
      const input = { requestId: `round25-${index + 1}`, expectedRevision: state.revision, actorId: step.actorId, type: step.type, ...(step.path ? { path: step.path } : {}), ...(step.targetId ? { targetId: step.targetId } : {}) };
      const receipt = store.command(scope, input);
      state = store.load(campaign);
      const target = step.targetId ? state.actors.find(a => a.id === step.targetId) : null;
      const detail = step.type === 'attack' ? `${step.result} ${receipt.result.hit ? `Hit for ${receipt.result.damage} damage${receipt.result.critical ? ' — critical.' : '.'}` : 'The attack misses.'} ${target?.name} is at ${target?.hp}/${target?.maxHp} HP.` : step.result;
      await post({ title: `ROUND 1  ·  ${actor.name.toUpperCase()}  ·  ${step.button}`, description: detail, actor, button: `✅ ${step.button}`, result: step.type === 'attack' ? `${receipt.result.dice[0]} + ${receipt.result.modifiers.map(m => m.value).join(' + ')} = ${receipt.result.total}` : 'Saved to the combat ledger.', state, path: step.path ?? [] });
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    state = store.load(campaign);
    store.record(state, 'round_script_complete', { round: 1, actors: state.actors.map(a => ({ id: a.id, hp: a.hp })) });
    store.save(state);
    await post({ title: 'ROUND 1 COMPLETE  ·  CAMP EMBERFALL', description: '**The camp still stands.**\\nThe first full initiative cycle is saved. Branna, Pip, Kael, the Goblin Raider, the Worg Stalker, and the Ogre Warbreaker all acted on the 25×25 overhead map. The next round is ready in the tactical table.', actor: null, button: 'ROUND RECAP', result: `Revision ${state.revision}. Branna ${state.actors.find(a => a.id === 'round-branna').hp}/${state.actors.find(a => a.id === 'round-branna').maxHp} HP · Pip ${state.actors.find(a => a.id === 'round-pip').hp}/${state.actors.find(a => a.id === 'round-pip').maxHp} HP · Kael ${state.actors.find(a => a.id === 'round-kael').hp}/${state.actors.find(a => a.id === 'round-kael').maxHp} HP.`, state });
    console.log(JSON.stringify({ published: true, campaign, revision: state.revision, round: state.round, turn: state.turn, posts: steps.length + 2 }, null, 2));
  }
} finally { store.close(); }
