import { findPath, footprint, parseCoordinate } from '../maps/grid.mjs';

export const MAX_MOVE_STEPS = 24;
const cellKey = p => `${p.x},${p.y}`;

// Presentation only: the shared engine rechecks ownership, phase and every step.
export function tacticalControls(view, selectedActorId = '') {
  const actors = view?.actors ?? [];
  const active = actors.find(a => a.id === view?.activeActorId);
  const owned = actors.filter(a => a.controlled && !a.defeated);
  const exploration = view?.phase === 'exploration' || (view?.phase === 'paused' && view.resumePhase === 'exploration');
  const actor = exploration ? owned.find(a => a.id === selectedActorId) ?? owned.find(a => a.speed !== 0) ?? owned[0] : active?.controlled ? active : owned[0];
  const combatTurn = !!(active?.controlled && !active.defeated && view?.phase === 'combat');
  const transitionActor = actor ?? actors.find(a => a.controlled) ?? (view?.canResume ? actors[0] : undefined);
  return {
    active, actor, owned, transitionActor, exploration,
    canMove: !!(actor && !actor.defeated && actor.speed !== 0 && (view?.phase === 'exploration' || combatTurn)),
    canAttack: combatTurn && !!view?.actionAvailable,
    canEnd: !!(active?.controlled && view?.phase === 'combat'),
    canPause: !!(transitionActor && ['combat', 'exploration'].includes(view?.phase)),
    canResume: !!(transitionActor && view?.phase === 'paused' && view.canResume),
    status: exploration ? view.phase === 'paused' ? 'Paused · exploration' : 'Exploration · movement outside initiative' : view?.phase === 'combat' ? `Round ${view.round} · Turn ${view.turn} · combat` : view?.phase === 'paused' ? 'Paused · combat' : 'Scene complete',
    resources: exploration ? 'Routes do not spend combat movement or an action, or advance combat time. Hazards can interrupt movement.' : `Movement: ${view?.movementRemaining ?? '—'} feet`,
  };
}

export function movementPreview(view, actor, destination) {
  if (!view || !actor || !destination || !view.actors.some(a => a.id === actor.id && a.controlled && !a.defeated) || !tacticalControls(view, actor.id).canMove) return null;
  try {
    const target = typeof destination === 'string' ? parseCoordinate(destination) : destination;
    const visible = new Set(view.map.cells.map(cellKey)), hidden = [];
    for (let y = 0; y < view.map.height; y++) for (let x = 0; x < view.map.width; x++) if (!visible.has(`${x},${y}`)) hidden.push({ x, y });
    const route = findPath({ ...view.map, blocked: [...view.map.blocked, ...hidden] }, actor, target, {
      size: actor.size, budget: view.phase === 'exploration' ? Infinity : view.movementRemaining ?? 0,
      occupied: view.actors.filter(a => a.id !== actor.id && !a.defeated).flatMap(a => footprint(a, a.size)),
    });
    return route?.path.length <= MAX_MOVE_STEPS ? route : null;
  } catch { return null; }
}
