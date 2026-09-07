import { WorldError } from './world.mjs';

/** Private, read-only projection of the currently configured reviewed mission. */
export function missionAdjudication(store, scope) {
  return store.transaction(() => {
    if (store.member(scope) !== 'host') throw new WorldError('UNAUTHORIZED', 'Only the host can review mission outcomes.');
    const row = store.db.prepare('SELECT body,plan FROM world_campaigns WHERE campaign=?').get(scope.campaign);
    const game = store.load(scope.campaign);
    if (!row) return { available: false };
    const state = JSON.parse(row.body), plan = JSON.parse(row.plan);
    if (game.phase !== 'exploration' || state.mission.status !== 'active' || plan.resolution !== 'adjudicated' || plan.mapId !== game.map.id) return { available: false };
    return {
      available: true, expectedRevision: game.revision, expectedWorldRevision: state.revision,
      mission: { id: plan.id, title: plan.title, briefing: plan.briefing },
      outcomes: plan.outcomes.map(outcome => ({
        id: outcome.id, title: outcome.title, summary: outcome.summary,
        changes: outcome.changes.map(change => {
          const track = state.tracks.find(value => value.id === change.trackId);
          return { trackId: track.id, label: track.label, delta: change.delta, before: track.value, after: Math.max(0, Math.min(100, track.value + change.delta)) };
        }),
      })),
    };
  });
}
