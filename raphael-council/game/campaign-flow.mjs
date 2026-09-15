export const FLOW_PHASES = Object.freeze(['combat', 'aftermath', 'travel', 'store', 'downtime', 'ready']);

export class CampaignFlowError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const fail = (code, message) => { throw new CampaignFlowError(code, message); };
const clone = value => structuredClone(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const text = (value, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const membersById = state => new Map(state.members.map(member => [member.id, member]));
const findMember = (state, owner) => membersById(state).get(owner);
const findItem = (state, itemId) => state.store.items.find(item => item.id === itemId);
const eventId = (state, prefix) => `${prefix}-${state.revision + 1}-${state.log.length + 1}`;

function assertScope(state, scope, { host = false, member = false } = {}) {
  if (!scope || !id(scope.owner)) fail('UNAUTHORIZED', 'A campaign owner is required.');
  if (host && scope.role !== 'host') fail('UNAUTHORIZED', 'Only the campaign host can do that.');
  if (member && !findMember(state, scope.owner)) fail('UNAUTHORIZED', 'That owner is not a campaign member.');
}

function normalizeCell(cell) {
  if (!cell || !text(cell.coord, 4) || !text(cell.terrain, 80)) fail('INVALID', 'Every tactical cell needs a coordinate and terrain.');
  return {
    coord: cell.coord,
    terrain: cell.terrain,
    blocked: Boolean(cell.blocked),
    difficult: Boolean(cell.difficult),
    cover: cell.cover ?? null,
    concealment: cell.concealment ?? null,
    hidden: Boolean(cell.hidden),
    dc: Number.isInteger(cell.dc) ? cell.dc : null,
    clue: cell.clue ?? null,
    public: Boolean(cell.public),
  };
}

function defaultCells() {
  return [
    { coord: 'D8', terrain: 'Broken seawall', blocked: true, cover: 'full', public: true },
    { coord: 'E8', terrain: 'Broken seawall', blocked: true, cover: 'full', public: true },
    { coord: 'K11', terrain: 'Salt grass', difficult: true, concealment: 'light', public: true },
    { coord: 'L11', terrain: 'Salt grass', difficult: true, concealment: 'light', public: true },
    { coord: 'P7', terrain: 'Flooded steps', difficult: true, public: true },
    { coord: 'Q7', terrain: 'Flooded steps', difficult: true, public: true },
    { coord: 'H15', terrain: 'Wind-carved outcropping', cover: 'half', hidden: true, dc: 12, clue: 'A low outcropping breaks the sightline toward the abbey gate.' },
    { coord: 'M18', terrain: 'Collapsed arch', blocked: true, cover: 'full', hidden: true, dc: 14, clue: 'The fallen arch can be used as hard cover, but the rubble is unstable.' },
    { coord: 'S5', terrain: 'Tidepool', difficult: true, hidden: true, dc: 13, clue: 'The tidepool is deeper than it looks and counts as difficult terrain.' },
    { coord: 'V20', terrain: 'Concealed salt grass', difficult: true, concealment: 'heavy', hidden: true, dc: 11, clue: 'Dense salt grass grants concealment until a creature crosses its edge.' },
    { coord: 'B22', terrain: 'Signal cairn', public: true, clue: 'A weathered cairn marks the old courier route.' },
  ].map(normalizeCell);
}

function defaultStore() {
  return {
    id: 'saltglass-outfitters',
    title: 'Saltglass Outfitters',
    description: 'A tide-worn cart that opens after the party finishes an encounter.',
    currency: 'gp',
    items: [
      { id: 'healing-draught', name: 'Healing draught', kind: 'consumable', price: 25, sellPrice: 12, stock: 6, summary: 'Restore a small amount of vitality during the next scene.' },
      { id: 'smoke-bead', name: 'Smoke bead', kind: 'tool', price: 15, sellPrice: 7, stock: 8, summary: 'Create a brief obscuring cloud; the map marks it as concealment.' },
      { id: 'grappling-line', name: 'Grappling line', kind: 'tool', price: 30, sellPrice: 15, stock: 3, summary: 'Useful for elevation routes, broken walls, and tide-slick crossings.' },
      { id: 'saltglass-lens', name: 'Saltglass lens', kind: 'relic', price: 45, sellPrice: 22, stock: 2, summary: 'Gain advantage on the next perception check against a hidden terrain clue.' },
    ],
  };
}

function defaultMembers() {
  return [
    { id: 'player-1', name: 'Branna Stonewake', perception: 3, intelligence: 1, gold: 80 },
    { id: 'player-2', name: 'Pip Underbough', perception: 2, intelligence: 4, gold: 65 },
    { id: 'player-3', name: 'Kael Ashstep', perception: 5, intelligence: 2, gold: 70 },
  ];
}

export function createCampaignFlow(input = {}) {
  const members = (input.members ?? defaultMembers()).map(member => ({
    id: member.id,
    name: member.name,
    perception: Number.isInteger(member.perception) ? member.perception : 0,
    intelligence: Number.isInteger(member.intelligence) ? member.intelligence : 0,
    gold: Number.isInteger(member.gold) ? member.gold : 0,
  }));
  if (!members.length || members.some(member => !id(member.id) || !text(member.name, 120))) fail('INVALID', 'A campaign needs named members.');
  const scene = input.scene ?? {};
  const store = clone(input.store ?? defaultStore());
  const wallets = Object.fromEntries(members.map(member => [member.id, { gold: member.gold, inventory: [] }]));
  const discovery = Object.fromEntries(members.map(member => [member.id, []]));
  return {
    schemaVersion: 1,
    campaign: input.campaign ?? 'saltglass-shore-next',
    title: input.title ?? 'Saltglass Shore · The Courier’s Interval',
    revision: 1,
    phase: 'combat',
    round: 1,
    scene: {
      id: scene.id ?? 'saltglass-shore-courier-yard',
      title: scene.title ?? 'Saltglass Shore · Courier Yard',
      art: scene.art ?? '/art/saltglass-shore-sd.png',
      width: 25,
      height: 25,
      cells: (scene.cells ?? defaultCells()).map(normalizeCell),
    },
    members,
    actors: clone(input.actors ?? [
      { id: 'branna', owner: 'player-1', name: 'Branna Stonewake', team: 'party', x: 5, y: 18, public: true },
      { id: 'pip', owner: 'player-2', name: 'Pip Underbough', team: 'party', x: 6, y: 20, public: true },
      { id: 'kael', owner: 'player-3', name: 'Kael Ashstep', team: 'party', x: 5, y: 22, public: true },
      { id: 'wight-a', owner: null, name: 'Brine Wight A', team: 'enemy', x: 19, y: 8, public: false },
      { id: 'wight-b', owner: null, name: 'Brine Wight B', team: 'enemy', x: 19, y: 12, public: false },
    ]),
    alwaysBranch: {
      id: 'always-interval',
      label: 'Always-on campaign interval',
      resumePolicy: ['combat', 'aftermath', 'travel', 'store', 'ready'],
      current: 'combat',
      promise: 'Every completed encounter opens a debrief and a way to prepare before the next scene.',
    },
    store,
    wallets,
    discoveries: discovery,
    inspected: Object.fromEntries(members.map(member => [member.id, []])),
    log: [{ id: 'session-1', phase: 'combat', thread: 'general', kind: 'scene_opened', actor: 'system', summary: 'The courier yard is live. The party sees the shared map; hidden terrain remains undisclosed.' }],
  };
}

function publicCell(cell) {
  if (cell.hidden) return { coord: cell.coord, terrain: 'unread terrain', blocked: false, difficult: false };
  return { coord: cell.coord, terrain: cell.terrain, blocked: cell.blocked, difficult: cell.public ? cell.difficult : false };
}

function privateCell(cell, known) {
  const revealed = !cell.hidden || known.has(cell.coord);
  return {
    coord: cell.coord,
    terrain: revealed ? cell.terrain : 'unread terrain',
    blocked: revealed ? cell.blocked : false,
    difficult: revealed ? cell.difficult : false,
    ...(revealed && cell.cover ? { cover: cell.cover } : {}),
    ...(revealed && cell.concealment ? { concealment: cell.concealment } : {}),
    ...(revealed && cell.clue ? { clue: cell.clue } : {}),
  };
}

function actorsFor(state, scope, visibility) {
  if (visibility === 'admin') return clone(state.actors);
  if (visibility === 'private') return state.actors.filter(actor => actor.public || actor.owner === scope.owner).map(actor => ({ ...actor, ...(actor.owner === scope.owner ? {} : { owner: undefined }) }));
  return state.actors.filter(actor => actor.public || actor.team === 'party').map(({ owner, ...actor }) => actor);
}

function sharedThread(state) {
  return {
    id: 'general',
    name: 'DMD Arcade · general',
    audience: 'party',
    phase: state.phase,
    scene: { id: state.scene.id, title: state.scene.title, art: state.scene.art, width: state.scene.width, height: state.scene.height },
    map: { width: state.scene.width, height: state.scene.height, cells: state.scene.cells.map(publicCell) },
    actors: actorsFor(state, { owner: null }, 'shared'),
    messages: state.log.filter(event => event.thread === 'general').map(({ actor, summary, kind }) => ({ actor, summary, kind })),
  };
}

function storeThread(state) {
  return {
    id: 'store',
    name: 'Saltglass Outfitters',
    audience: 'party',
    phase: state.phase,
    store: { id: state.store.id, title: state.store.title, description: state.store.description, currency: state.store.currency, items: state.store.items.map(({ id, name, kind, price, stock, summary }) => ({ id, name, kind, price, stock, summary })) },
    messages: state.log.filter(event => event.thread === 'store').map(({ actor, summary, kind }) => ({ actor, summary, kind })),
  };
}

function playerThread(state, owner) {
  const member = findMember(state, owner);
  const known = new Set(state.discoveries[owner] ?? []);
  const wallet = state.wallets[owner];
  return {
    id: `player:${owner}`,
    name: `${member.name} · private table`,
    audience: [owner],
    phase: state.phase,
    scene: { id: state.scene.id, title: state.scene.title, art: state.scene.art, width: state.scene.width, height: state.scene.height },
    map: { width: state.scene.width, height: state.scene.height, cells: state.scene.cells.map(cell => privateCell(cell, known)) },
    actors: actorsFor(state, { owner }, 'private'),
    discoveries: state.discoveries[owner] ?? [],
    wallet: { gold: wallet.gold, inventory: clone(wallet.inventory) },
    inspected: state.inspected[owner] ?? [],
    messages: state.log.filter(event => event.thread === `player:${owner}` || event.thread === 'general' || event.thread === 'store').map(({ actor, summary, kind, thread }) => ({ actor, summary, kind, thread })),
  };
}

function adminThread(state) {
  return {
    id: 'admin',
    name: 'DM · campaign control',
    audience: ['host'],
    phase: state.phase,
    alwaysBranch: clone(state.alwaysBranch),
    scene: clone(state.scene),
    actors: clone(state.actors),
    discoveries: clone(state.discoveries),
    wallets: clone(state.wallets),
    store: clone(state.store),
    messages: clone(state.log),
  };
}

export function projectThreads(state, scope = { owner: 'dm', role: 'host' }) {
  assertScope(state, scope);
  /** @type {{general: ReturnType<typeof sharedThread>, store: ReturnType<typeof storeThread>, player?: ReturnType<typeof playerThread>, admin?: ReturnType<typeof adminThread>}} */
  const result = { general: sharedThread(state), store: storeThread(state) };
  if (findMember(state, scope.owner)) result.player = playerThread(state, scope.owner);
  if (scope.role === 'host') result.admin = adminThread(state);
  return result;
}

function addLog(state, event) {
  state.log.push({ id: eventId(state, event.kind), ...event });
  state.revision++;
  state.alwaysBranch.current = state.phase;
}

function requirePhase(state, phases) {
  if (!phases.includes(state.phase)) fail('PHASE', `This action is unavailable during ${state.phase}.`);
}

export function applyCampaignAction(previous, action) {
  const state = clone(previous);
  const scope = { owner: action?.owner, role: action?.role ?? 'player' };
  assertScope(state, scope, { member: ['inspect_item', 'buy_item', 'sell_item', 'spot'].includes(action?.type) });
  if (!text(action?.type, 80)) fail('INVALID', 'Choose a campaign action.');
  switch (action.type) {
    case 'finish_combat':
      assertScope(state, scope, { host: true });
      requirePhase(state, ['combat']);
      state.phase = 'aftermath';
      addLog(state, { phase: state.phase, thread: 'general', kind: 'combat_finished', actor: scope.owner, summary: 'Combat ends. The field is secured; the party can debrief before the next branch.' });
      break;
    case 'record_debrief':
      assertScope(state, scope, { host: true });
      requirePhase(state, ['aftermath']);
      if (!text(action.notes, 1000)) fail('INVALID', 'Record a short debrief.');
      state.phase = 'travel';
      addLog(state, { phase: state.phase, thread: 'general', kind: 'debrief_recorded', actor: scope.owner, summary: action.notes });
      break;
    case 'open_store':
      assertScope(state, scope, { host: true });
      requirePhase(state, ['travel', 'downtime']);
      state.phase = 'store';
      addLog(state, { phase: state.phase, thread: 'store', kind: 'store_opened', actor: scope.owner, summary: `${state.store.title} is open. Players can inspect and buy from their own private thread.` });
      break;
    case 'inspect_item': {
      assertScope(state, scope, { member: true });
      requirePhase(state, ['store', 'downtime']);
      const item = findItem(state, action.itemId);
      if (!item) fail('NOT_FOUND', 'That item is not in the store.');
      if (!state.inspected[scope.owner].includes(item.id)) state.inspected[scope.owner].push(item.id);
      addLog(state, { phase: state.phase, thread: `player:${scope.owner}`, kind: 'item_inspected', actor: scope.owner, summary: `${item.name}: ${item.summary}` });
      break;
    }
    case 'buy_item': {
      assertScope(state, scope, { member: true });
      requirePhase(state, ['store']);
      const item = findItem(state, action.itemId), quantity = Number.isInteger(action.quantity) ? action.quantity : 1;
      if (!item || quantity < 1 || quantity > 5) fail('INVALID', 'Choose a valid store item and quantity.');
      if (item.stock < quantity) fail('CONFLICT', 'The store does not have enough stock.');
      const wallet = state.wallets[scope.owner], total = item.price * quantity;
      if (wallet.gold < total) fail('CONFLICT', 'That purchase is beyond this character’s current gold.');
      item.stock -= quantity; wallet.gold -= total;
      const existing = wallet.inventory.find(entry => entry.itemId === item.id);
      if (existing) existing.quantity += quantity; else wallet.inventory.push({ itemId: item.id, name: item.name, quantity });
      addLog(state, { phase: state.phase, thread: `player:${scope.owner}`, kind: 'item_bought', actor: scope.owner, summary: `${item.name} ×${quantity} purchased for ${total} gp.` });
      addLog(state, { phase: state.phase, thread: 'store', kind: 'stock_changed', actor: 'store', summary: `${item.name} stock changed. Personal gold and inventory remain private.` });
      break;
    }
    case 'sell_item': {
      assertScope(state, scope, { member: true });
      requirePhase(state, ['store']);
      const item = findItem(state, action.itemId), quantity = Number.isInteger(action.quantity) ? action.quantity : 1;
      const wallet = state.wallets[scope.owner], entry = wallet.inventory.find(value => value.itemId === action.itemId);
      if (!item || !entry || quantity < 1 || quantity > entry.quantity) fail('CONFLICT', 'That item is not available to sell.');
      entry.quantity -= quantity; wallet.gold += item.sellPrice * quantity;
      if (entry.quantity === 0) wallet.inventory = wallet.inventory.filter(value => value !== entry);
      item.stock += quantity;
      addLog(state, { phase: state.phase, thread: `player:${scope.owner}`, kind: 'item_sold', actor: scope.owner, summary: `${item.name} ×${quantity} sold for ${item.sellPrice * quantity} gp.` });
      break;
    }
    case 'spot': {
      assertScope(state, scope, { member: true });
      const ability = action.ability;
      if (!['perception', 'intelligence'].includes(ability) || !Number.isInteger(action.roll) || action.roll < 1 || action.roll > 20) fail('INVALID', 'Use a d20 roll and either perception or intelligence.');
      const cell = state.scene.cells.find(value => value.coord === action.coord);
      if (!cell || !cell.hidden || !cell.dc) fail('NOT_FOUND', 'That coordinate has no hidden discovery in the authored scene.');
      const member = findMember(state, scope.owner), total = action.roll + member[ability];
      const success = total >= cell.dc;
      if (success && !state.discoveries[scope.owner].includes(cell.coord)) state.discoveries[scope.owner].push(cell.coord);
      addLog(state, { phase: state.phase, thread: `player:${scope.owner}`, kind: success ? 'discovery_revealed' : 'discovery_missed', actor: scope.owner, summary: success ? `${cell.coord}: ${cell.clue}` : `${cell.coord}: the details remain unclear.` });
      break;
    }
    case 'ready_next_scene':
      assertScope(state, scope, { host: true });
      requirePhase(state, ['store', 'downtime']);
      state.phase = 'ready';
      addLog(state, { phase: state.phase, thread: 'general', kind: 'next_scene_ready', actor: scope.owner, summary: 'The party has finished its interval. The next authored scene can now begin.' });
      break;
    case 'start_next_scene':
      assertScope(state, scope, { host: true });
      requirePhase(state, ['ready']);
      state.phase = 'combat'; state.round += 1;
      addLog(state, { phase: state.phase, thread: 'general', kind: 'scene_started', actor: scope.owner, summary: `Round ${state.round} begins. The shared map is live again.` });
      break;
    default:
      fail('INVALID', `Unknown campaign action: ${action.type}.`);
  }
  return state;
}

export function flowSummary(state) {
  return {
    campaign: state.campaign,
    phase: state.phase,
    revision: state.revision,
    round: state.round,
    next: state.phase === 'combat' ? 'finish_combat' : state.phase === 'aftermath' ? 'record_debrief' : state.phase === 'travel' ? 'open_store' : state.phase === 'store' ? 'buy_item or ready_next_scene' : state.phase === 'ready' ? 'start_next_scene' : 'continue',
    threadAccess: { general: 'party', store: 'party', privatePlayer: 'owner only', admin: 'host' },
  };
}
