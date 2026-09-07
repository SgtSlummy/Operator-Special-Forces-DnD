import { GameError } from './store.mjs';
import { cellKey, coordinate, DIRECTIONS, distance, footprint, inBounds, lineOfSight, parseCoordinate, stepCost } from '../maps/grid.mjs';

const fail = (code, message) => { throw new GameError(code, message); };
const key = p => cellKey(p.x, p.y);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const nearest = (a, b) => Math.min(...a.flatMap(p => b.map(q => distance(p, q))));

export function getReachOptions(game, scope) {
  const view = game.view(scope);
  return {
    revision: view.revision,
    actors: view.actors.filter(actor => actor.controlled).map(actor => ({ id: actor.id, label: actor.name })),
    targets: view.actors.map(actor => ({ id: actor.id, label: actor.name })),
    mapTitle: view.map.title,
  };
}

// One bounded, multiple-destination search. Unknown cells are checked before
// stepCost, so neither hidden terrain nor hidden actors become a reach oracle.
function knownRouteCost(view, actor, target, targetCells) {
  const seen = new Set(view.map.cells.map(key));
  const occupied = view.actors.filter(a => a.id !== actor.id && !a.defeated).flatMap(a => footprint(a, a.size));
  const blocked = new Set([...view.map.blocked, ...occupied].map(key));
  const knownAnchors = new Map();
  const knownAnchor = p => {
    const id = key(p);
    if (!knownAnchors.has(id)) knownAnchors.set(id, inBounds(view.map, p, actor.size) && footprint(p, actor.size).every(cell => seen.has(key(cell)) && !blocked.has(key(cell))));
    return knownAnchors.get(id);
  };
  const atDestination = target
    ? p => target.id === actor.id || nearest(footprint(p, actor.size), targetCells) === 1
    : p => p.x === targetCells[0].x && p.y === targetCells[0].y;
  // A character already there has no movement to spend, even if its own sight
  // is unavailable while defeated. Further travel still needs visible cells.
  if (atDestination(actor)) return 0;
  if (!knownAnchor(actor)) return null;
  const options = { size: actor.size, occupied };
  const costs = new Map([[key(actor), 0]]), buckets = [[{ x: actor.x, y: actor.y }]];
  // Existing stepCost produces only 5/10-foot edges. Bucketed Dijkstra avoids
  // sorting the frontier or searching once for every possible adjacent cell.
  for (let units = 0; units < buckets.length; units++) {
    for (const current of buckets[units] ?? []) {
      if (costs.get(key(current)) !== units) continue;
      if (atDestination(current)) return units * 5;
      for (const [dx, dy] of DIRECTIONS) {
        const next = { x: current.x + dx, y: current.y + dy };
        if (!knownAnchor(next)) continue;
        if (dx && dy && (!knownAnchor({ x: current.x + dx, y: current.y }) || !knownAnchor({ x: current.x, y: current.y + dy }))) continue;
        const nextCost = units + stepCost(view.map, current, next, options) / 5;
        const nextKey = key(next);
        if (Number.isFinite(nextCost) && nextCost < (costs.get(nextKey) ?? Infinity)) {
          costs.set(nextKey, nextCost);
          (buckets[nextCost] ??= []).push(next);
        }
      }
    }
  }
  return null;
}

export function assessReach(game, scope, input) {
  const allowed = new Set(['expectedRevision', 'actorId', 'targetId', 'coordinate']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.has(k)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !validId(input.actorId) || (Object.hasOwn(input, 'targetId') === Object.hasOwn(input, 'coordinate'))) fail('INVALID', 'Choose your character and one visible target or grid coordinate.');
  if (Object.hasOwn(input, 'targetId') && !validId(input.targetId)) fail('INVALID', 'Choose a visible target.');
  if (Object.hasOwn(input, 'coordinate') && (typeof input.coordinate !== 'string' || input.coordinate.length > 12)) fail('INVALID', 'Use a grid coordinate such as A1.');
  const view = game.view(scope);
  if (input.expectedRevision !== view.revision) fail('STALE', 'The scene changed. Check distance again from the current view.');
  const actor = view.actors.find(a => a.id === input.actorId);
  if (!actor?.controlled) fail('UNAUTHORIZED', 'Check reach using a character you control.');
  let target, targetCells, targetLabel;
  if (Object.hasOwn(input, 'targetId')) {
    target = view.actors.find(a => a.id === input.targetId);
    if (!target) fail('NOT_VISIBLE', 'Choose a target in your current visible scene.');
    targetCells = footprint(target, target.size);
    targetLabel = target.name;
  } else {
    let point;
    try { point = parseCoordinate(input.coordinate); } catch { fail('INVALID', 'Use a grid coordinate such as A1.'); }
    if (!inBounds(view.map, point)) fail('INVALID', 'Choose a coordinate inside this map.');
    if (!view.map.cells.some(p => key(p) === key(point))) fail('NOT_VISIBLE', 'Choose a coordinate in your current visible scene.');
    targetCells = [point]; targetLabel = coordinate(point.x, point.y);
  }
  const actorCells = footprint(actor, actor.size);
  const distanceFeet = nearest(actorCells, targetCells) * 5;
  const active = view.activeActorId === actor.id;
  const pendingReason = view.pendingConcentration ? 'A concentration save is pending' : view.pendingReaction ? 'A reaction is pending' : null;
  const exploration = view.phase === 'exploration' || (view.phase === 'paused' && view.resumePhase === 'exploration');
  const budgetFeet = exploration ? null : active ? view.movementRemaining : actor.speed;
  const budgetLabel = exploration ? 'exploration movement' : active ? 'movement remaining this turn' : 'normal movement on a future turn';
  const costFeet = knownRouteCost(view, actor, target, targetCells);
  const canReach = costFeet !== null && (exploration ? costFeet === 0 || (actor.speed > 0 && !actor.defeated) : costFeet <= budgetFeet);
  const canMoveNow = canReach && costFeet > 0 && !pendingReason && !actor.defeated && (view.phase === 'exploration' ? actor.speed > 0 : view.phase === 'combat' && active);
  const movementParts = [costFeet === null
    ? 'No route is known through the currently visible cells.'
    : `${costFeet} feet of movement ${target ? 'to stand beside this target' : `to place your token’s upper-left cell at ${targetLabel}`}; ${budgetFeet} feet of ${budgetLabel}. ${canReach ? 'That fits this movement budget.' : 'That exceeds this movement budget.'}`];
  if (exploration) {
    if (costFeet !== null) movementParts[0] = costFeet === 0 ? 'This is your character’s current position: no movement is needed.' : `${costFeet} feet of movement through known terrain ${target ? 'to stand beside this target' : `to place your token’s upper-left cell at ${targetLabel}`}.`;
    movementParts.push('Exploration movement does not wait for initiative or spend a combat movement budget. Each move is limited to 24 grid steps; longer routes need further current previews.');
    if (actor.speed === 0) movementParts.push('This character has zero movement speed and cannot move.');
  } else if (target?.id === actor.id) movementParts[0] = `This is your character’s current position: 0 feet of movement; ${budgetFeet} feet of ${budgetLabel}.`;
  if (view.phase === 'paused') movementParts.push('Play is paused; movement waits until play resumes.');
  else if (!['combat', 'exploration'].includes(view.phase)) movementParts.push('This encounter is not active; this is a movement estimate.');
  if (!exploration && !active) movementParts.push('It is not this character’s turn; this is a future-turn estimate.');
  if (pendingReason) movementParts.push(`${pendingReason}; movement waits until it is resolved. Distance and route estimates remain available.`);
  if (actor.defeated) movementParts.push('This character is defeated and cannot move.');
  movementParts.push('This uses known terrain and visible occupied cells; it does not guarantee a safe route.');

  // Unknown cells also stop a confirmed line of sight. Only the already
  // filtered projection is used; no hidden geometry is queried.
  const seen = new Set(view.map.cells.map(key));
  const unknown = [];
  for (let y = 0; y < view.map.height; y++) for (let x = 0; x < view.map.width; x++) if (!seen.has(cellKey(x, y))) unknown.push({ x, y });
  const sightMap = { ...view.map, blocked: [...view.map.blocked, ...unknown] };
  const rangeFeet = actor.weapon.rangeFeet;
  const inRange = distanceFeet <= rangeFeet;
  const clearShot = actorCells.some(a => seen.has(key(a)) && targetCells.some(t => seen.has(key(t)) && distance(a, t) * 5 <= rangeFeet && lineOfSight(sightMap, a, t)));
  const validTarget = Boolean(target && target.id !== actor.id && !target.defeated);
  const canAttackNow = validTarget && clearShot && active && view.phase === 'combat' && !pendingReason && !actor.defeated && view.actionAvailable === true;
  const weaponParts = [`${actor.weapon.name}: ${rangeFeet}-foot configured range; this ${target ? 'target' : 'point'} is ${inRange ? 'within' : 'outside'} range from your current position.`];
  if (inRange && !clearShot) weaponParts.push('A clear line of sight within that range is not confirmed through known cells.');
  if (!target) weaponParts.push('This is a point measurement; choose a living actor to check attack availability.');
  else if (!validTarget) weaponParts.push('This is not another living actor you can attack.');
  if (view.phase === 'paused') weaponParts.push('Play is paused; attacks are unavailable.');
  else if (exploration) weaponParts.push('Attacks are unavailable during exploration.');
  else if (view.phase !== 'combat') weaponParts.push('This encounter is not active; attacks are unavailable.');
  if (!exploration && !active) weaponParts.push('Attacks wait for this character’s turn.');
  if (pendingReason) weaponParts.push(`${pendingReason}; attacks wait until it is resolved. Weapon range can still be checked.`);
  if (actor.defeated) weaponParts.push('This character is defeated and cannot attack.');
  if (active && view.actionAvailable === false) weaponParts.push('This turn’s action has already been spent.');
  if (canAttackNow) weaponParts.push('An attack is available now; this does not guarantee a hit.');
  const movement = { costFeet, budgetFeet, budgetLabel, canReach, canMoveNow, message: movementParts.join(' ') };
  const weapon = { name: actor.weapon.name, rangeFeet, inRange, canAttackNow, message: weaponParts.join(' ') };
  return {
    revision: view.revision, actorId: actor.id, targetLabel, distanceFeet, movement, weapon,
    summary: [`Grid distance: ${distanceFeet} feet to ${targetLabel}, measured between the nearest occupied cells at five feet per grid step.`, movement.message, weapon.message, 'Checking distance spends no movement, action, time, or dice. Spells, jumping, and extra movement require their own rules.'],
  };
}
