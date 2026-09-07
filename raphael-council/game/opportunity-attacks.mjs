import { cellKey, distance, footprint, visibleCells } from '../maps/grid.mjs';

const separationFeet = (left, right) => Math.min(...left.flatMap(a => right.map(b => distance(a, b)))) * 5;

/**
 * Enumerate ordinary-movement triggers from authoritative state and validated positions.
 * Returns private internal candidates, not a player projection or a resolution order.
 * The caller owns movement provenance, simultaneous choices, and reaction resolution.
 */
export function opportunityCandidates(state, mover, from, to) {
  if (state.phase !== 'combat' || mover.disengagedTurn === state.turn) return [];
  const before = footprint(from, mover.size), after = footprint(to, mover.size);
  const candidates = [];
  for (const actor of state.actors) {
    const capability = actor.combatCapabilities, reachFeet = capability?.meleeReachFeet;
    if (actor.id === mover.id || !(actor.hp > 0) || actor.incapacitated === true || actor.reactionAvailable !== true) continue;
    if (capability?.attackKind !== 'melee' || !Number.isInteger(reachFeet) || reachFeet < 5 || reachFeet > 30 || reachFeet % 5 !== 0) continue;
    const occupied = footprint(actor, actor.size);
    if (separationFeet(occupied, before) > reachFeet || separationFeet(occupied, after) <= reachFeet) continue;
    // visibleCells uses the shared conservative lineOfSight rule for each viewer cell.
    const seen = new Set(visibleCells(state.map, occupied.map(point => ({ ...point, vision: actor.vision }))).map(point => cellKey(point.x, point.y)));
    if (before.some(point => seen.has(cellKey(point.x, point.y)))) candidates.push({ actorId: actor.id, reachFeet });
  }
  return candidates;
}
