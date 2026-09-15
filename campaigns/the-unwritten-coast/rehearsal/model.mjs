export const SAVE_VERSION = 1;
const roomKey = /^R\d{2}$/;
const unique = values => [...new Set(values)];
const fail = message => { throw new Error(message); };

/** Turn the authored atlas into a local rehearsal pack; no game-store writes. */
export function parseAtlas(markdown, revision) {
  const rows = markdown.split(/\r?\n/).filter(line => /^\| R\d{2} \|/.test(line));
  const sections = [...markdown.matchAll(/^### (R\d{2}) — (.+)\r?\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)];
  const rooms = rows.map(line => {
    const cells = line.split('|').slice(1, -1).map(value => value.trim());
    if (cells.length !== 6) fail('Atlas room table needs six columns.');
    const [id, name, footprint, vertical, shape, purpose] = cells;
    const section = sections.find(item => item[1] === id);
    if (!section) fail(`Missing room description: ${id}`);
    const fields = [...section[3].matchAll(/\*\*([^*]+):\*\*\s*([\s\S]*?)(?=\n\*\*|$(?![\s\S]))/g)]
      .map(([, label, text]) => ({ label, text: text.trim() }));
    const reveal = fields.find(field => field.label === 'Reveal')?.text;
    if (!reveal) fail(`Missing arrival description: ${id}`);
    const clean = footprint.replaceAll(',', '');
    const rectangle = clean.match(/(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?)/);
    const diameter = clean.match(/(\d+(?:\.\d+)?) ft diameter/);
    const hex = clean.match(/(\d+(?:\.\d+)?) ft across flats/);
    const width = Number(rectangle?.[1] ?? diameter?.[1] ?? hex?.[1]);
    const depth = Number(rectangle?.[2] ?? diameter?.[1] ?? (hex ? width * 2 / Math.sqrt(3) : NaN));
    if (![width, depth].every(value => Number.isFinite(value) && value > 0)) fail(`Invalid room size: ${id}`);
    return { id, name, footprint, vertical, shape, purpose, width, depth, reveal,
      notes: fields.filter(field => field.label !== 'Reveal') };
  });
  const expected = Array.from({ length: 18 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
  if (rooms.length !== 18 || expected.some(id => rooms.filter(room => room.id === id).length !== 1))
    fail('The atlas must contain R01 through R18 exactly once.');
  const known = new Set(['surface', ...expected]);
  const routes = [], boundaries = [];
  const normalize = id => /^surface$/i.test(id) ? 'surface' : id;
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\| (?:Surface|R\d{2})[–—]/.test(line)) continue;
    const [connection, passage, detail] = line.split('|').slice(1, -1).map(value => value.trim());
    const chain = connection.split(/[–—]/).map(normalize);
    for (let i = 1; i < chain.length; i++) {
      const [from, to] = [chain[i - 1], chain[i]];
      if (!known.has(from)) fail(`Unknown route origin: ${from}`);
      if (to === 'Stillwater') { boundaries.push({ from, name: to, passage, detail }); continue; }
      if (!known.has(to)) fail(`Unknown route destination: ${to}`);
      if (from === to || routes.some(route => [route.from, route.to].includes(from) && [route.from, route.to].includes(to)))
        fail(`Duplicate or self route: ${from}–${to}`);
      routes.push({ from, to, passage, detail });
    }
  }
  const reached = new Set(['surface']);
  for (let changed = true; changed;) {
    changed = false;
    for (const route of routes) for (const [a, b] of [[route.from, route.to], [route.to, route.from]])
      if (reached.has(a) && !reached.has(b)) { reached.add(b); changed = true; }
  }
  if (expected.some(id => !reached.has(id))) fail('The atlas has an unreachable room.');
  if (typeof revision !== 'string' || !revision) fail('A pack revision is required.');
  return { id: 'unwritten-coast-undertow', revision, title: 'The Undertow Works', rooms, routes, boundaries };
}

export function exits(pack, roomId) {
  return pack.routes.filter(route => route.from === roomId || route.to === roomId)
    .map(route => ({ ...route, destination: route.from === roomId ? route.to : route.from }));
}

export function newSession(pack) {
  return { version: SAVE_VERSION, packId: pack.id, packRevision: pack.revision,
    roomId: 'R01', visited: ['R01'], inspected: [], moves: 0, journal: [] };
}

/** Validate untrusted imports before replacing the current rehearsal. */
export function restoreSession(pack, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('This is not a rehearsal save.');
  if (input.version !== SAVE_VERSION || input.packId !== pack.id || input.packRevision !== pack.revision)
    fail('This save belongs to a different atlas version. Keep it for that version.');
  const keys = new Set(['surface', ...pack.rooms.map(room => room.id)]);
  const boundedList = (value, allowed, limit) => Array.isArray(value) && value.length <= limit &&
    value.every(item => typeof item === 'string' && allowed.has(item)) && unique(value).length === value.length;
  if (!keys.has(input.roomId) || !boundedList(input.visited, keys, 19) || !input.visited.includes(input.roomId) || !input.visited.includes('R01'))
    fail('The saved room or visited list is invalid.');
  const visited = new Set(input.visited);
  if (!boundedList(input.inspected, visited, 18) || input.inspected.includes('surface')) fail('The saved discoveries are invalid.');
  if (!Number.isSafeInteger(input.moves) || input.moves < 0 || input.moves > 100000) fail('The saved journey length is invalid.');
  if (!Array.isArray(input.journal) || input.journal.length !== Math.min(input.moves, 20)) fail('The saved journal is invalid.');
  let previous = null;
  for (const item of input.journal) {
    if (!item || !visited.has(item.from) || !visited.has(item.to) || !exits(pack, item.from).some(route => route.destination === item.to))
      fail('The saved journal contains an impossible route.');
    if (previous && previous !== item.from) fail('The saved journal is disconnected.');
    previous = item.to;
  }
  if (input.journal.length && previous !== input.roomId) fail('The saved journey ends in another room.');
  if (input.moves < 20 && input.journal.length && input.journal[0].from !== 'R01') fail('The saved journey starts in another room.');
  if (input.moves === 0 && (input.roomId !== 'R01' || input.visited.length !== 1)) fail('The starting save has unexpected rooms.');
  return { version: SAVE_VERSION, packId: pack.id, packRevision: pack.revision, roomId: input.roomId,
    visited: [...input.visited], inspected: [...input.inspected], moves: input.moves,
    journal: input.journal.map(({ from, to }) => ({ from, to })) };
}

export function travel(pack, state, destination) {
  if (!exits(pack, state.roomId).some(route => route.destination === destination)) fail('Choose a passage from this room.');
  if (state.moves >= 100000) fail('Journey limit reached. Save this rehearsal and start a fresh one.');
  return { ...state, roomId: destination, visited: unique([...state.visited, destination]), moves: state.moves + 1,
    journal: [...state.journal, { from: state.roomId, to: destination }].slice(-20) };
}

export function inspectRoom(pack, state) {
  if (!roomKey.test(state.roomId) || !pack.rooms.some(room => room.id === state.roomId)) return state;
  return { ...state, inspected: unique([...state.inspected, state.roomId]) };
}
