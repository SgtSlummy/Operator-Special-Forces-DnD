const cellKey = (x, y) => `${x},${y}`;

export const TACTICAL_LEGEND = Object.freeze([
  { key: 'cover', label: 'Cover', description: 'Full or half protection from attacks.' },
  { key: 'concealment', label: 'Concealment', description: 'Obscures a target without stopping movement.' },
  { key: 'lower', label: 'Lower level', description: 'A lower elevation; movement must use a valid route.' },
  { key: 'upper', label: 'Upper level', description: 'An elevated level; movement must use stairs.' },
  { key: 'stairs', label: 'Stairs', description: 'The only legal route between levels.' },
  { key: 'blocked', label: 'Blocked', description: 'Impassable structure or terrain.' },
]);

export const TACTICAL_AGENT_CONTRACTS = Object.freeze({
  terrain: Object.freeze({
    label: 'Terrain & cover agent',
    job: 'Classify visible cells for cover, concealment, blocked structure, water, and elevation.',
  }),
  movement: Object.freeze({
    label: 'Movement rules agent',
    job: 'Check movement cost, blocked cells, elevation changes, and staircase-only routes.',
  }),
  visibility: Object.freeze({
    label: 'Visibility agent',
    job: 'Publish only tactical facts and actors visible to the current viewer.',
  }),
});

const LOCATION_LAYOUTS = Object.freeze({
  'saltglass-party-shore': Object.freeze({
    '1,0': { cover: 'full', terrain: 'stone wall', affordances: ['take cover'] },
    '2,0': { cover: 'half', terrain: 'broken seawall', affordances: ['take cover'] },
    '1,2': { cover: 'full', terrain: 'stone wall', affordances: ['take cover'] },
    '2,2': { cover: 'half', terrain: 'broken seawall', affordances: ['take cover'] },
    '1,4': { cover: 'full', terrain: 'stone wall', affordances: ['take cover'] },
    '2,4': { cover: 'half', terrain: 'broken seawall', affordances: ['take cover'] },
    '2,1': { concealment: 'light', terrain: 'salt grass', affordances: ['hide', 'move carefully'] },
    '2,3': { concealment: 'light', terrain: 'salt grass', affordances: ['hide', 'move carefully'] },
    '2,5': { concealment: 'light', terrain: 'salt grass', affordances: ['hide', 'move carefully'] },
  }),
  'abbey-archive': Object.freeze({
    '1,1': { elevation: -1, level: 'lower', terrain: 'flooded lower floor', affordances: ['search lower floor'] },
    '1,2': { elevation: -1, level: 'lower', terrain: 'flooded lower floor', affordances: ['search lower floor'] },
    '1,3': { elevation: -1, level: 'lower', terrain: 'flooded lower floor', affordances: ['search lower floor'] },
    '4,2': { terrain: 'staircase', requiresStairs: true, affordances: ['use staircase'] },
    '4,3': { terrain: 'staircase', requiresStairs: true, affordances: ['use staircase'] },
    '5,2': { elevation: 1, level: 'upper', terrain: 'dry archive balcony', cover: 'half', affordances: ['search upper level', 'take cover'] },
    '5,3': { elevation: 1, level: 'upper', terrain: 'dry archive balcony', cover: 'half', affordances: ['search upper level', 'take cover'] },
    '6,2': { elevation: 1, level: 'upper', terrain: 'dry archive balcony', affordances: ['search upper level'] },
    '6,3': { elevation: 1, level: 'upper', terrain: 'dry archive balcony', affordances: ['search upper level'] },
  }),
});

function clone(value) { return structuredClone(value); }

function baseCell(map, x, y) {
  const key = cellKey(x, y);
  const blocked = (map.blocked ?? []).some(point => point.x === x && point.y === y);
  const difficult = (map.difficult ?? []).some(point => point.x === x && point.y === y);
  const water = x >= 6;
  return {
    x, y, key, label: `${String.fromCharCode(65 + x)}${y + 1}`,
    terrain: blocked ? 'blocked structure' : water ? 'water' : difficult ? 'rough ground' : 'ground',
    cover: blocked ? 'full' : 'none', concealment: 'none', elevation: 0, level: 'ground',
    movementCost: difficult || water ? 10 : 5, blocked, requiresStairs: false,
    affordances: blocked ? ['cannot enter'] : water ? ['cross only if movement rules allow'] : ['move through'],
  };
}

export function analyzeTacticalMap({ map, locationId = 'saltglass-party-shore', viewer = 'admin' } = {}) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height)) throw new Error('Tactical analysis requires a valid map.');
  const layout = LOCATION_LAYOUTS[locationId] ?? {};
  const cells = [];
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
    const cell = { ...baseCell(map, x, y), ...(layout[cellKey(x, y)] ?? {}) };
    if (cell.blocked) cell.affordances = ['cannot enter', 'provides full cover'];
    if (cell.requiresStairs) cell.movementCost = 10;
    cells.push(cell);
  }
  const counts = cells.reduce((result, cell) => {
    if (cell.cover !== 'none') result.cover += 1;
    if (cell.concealment !== 'none') result.concealment += 1;
    if (cell.level !== 'ground') result.elevation += 1;
    if (cell.requiresStairs) result.stairs += 1;
    return result;
  }, { cover: 0, concealment: 0, elevation: 0, stairs: 0 });
  return {
    version: 1, kind: 'TacticalMap', locationId, viewer,
    legend: clone(TACTICAL_LEGEND), cells, counts,
    summary: `${counts.cover} cover cells · ${counts.concealment} concealment cells · ${counts.elevation} elevated/lower cells · ${counts.stairs} staircase cells`,
  };
}

export function tacticalCell(tactical, coordinate) {
  if (!tactical || !coordinate) return null;
  let key;
  if (typeof coordinate === 'string' && /^[A-Z]\d+$/i.test(coordinate)) {
    key = cellKey(coordinate.toUpperCase().charCodeAt(0) - 65, Number(coordinate.slice(1)) - 1);
  } else key = typeof coordinate === 'string' ? coordinate : cellKey(coordinate.x, coordinate.y);
  return tactical.cells.find(cell => cell.key === key) ?? null;
}

export function evaluateTacticalPath({ tactical, path = [] } = {}) {
  const cells = path.map(point => tacticalCell(tactical, point));
  const failures = [];
  if (cells.some(cell => !cell)) failures.push('path leaves the map');
  if (cells.some(cell => cell?.blocked)) failures.push('path crosses blocked structure');
  const levels = cells.map(cell => cell?.elevation ?? 0);
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] !== levels[index - 1] && !cells[index]?.requiresStairs && !cells[index - 1]?.requiresStairs) failures.push('level changes require a staircase');
  }
  return {
    allowed: failures.length === 0,
    failures,
    steps: cells.map(cell => cell ? { coordinate: cell.label, movementCost: cell.movementCost, cover: cell.cover, concealment: cell.concealment, level: cell.level, affordances: [...cell.affordances] } : null),
    totalMovementCost: cells.reduce((total, cell) => total + (cell?.movementCost ?? 0), 0),
  };
}

export function tacticalProposal(role, tactical, pathResult = null) {
  const contract = TACTICAL_AGENT_CONTRACTS[role];
  if (!contract) return null;
  if (role === 'movement' && pathResult) return { role, label: contract.label, status: 'ready', summary: pathResult.allowed ? `Path is legal. Movement cost ${pathResult.totalMovementCost} feet.` : `Path rejected: ${pathResult.failures.join('; ')}.` };
  return { role, label: contract.label, status: 'ready', summary: contract.job + (tactical?.summary ? ` Visible map: ${tactical.summary}.` : '') };
}
