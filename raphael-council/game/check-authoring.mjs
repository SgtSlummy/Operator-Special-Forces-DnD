import { createHash } from 'node:crypto';
import { GameError } from './store.mjs';

/** Read-only host authoring options. Never expose character snapshots or owner identities. */
export function getCheckRequestOptions(game, characters, scope) {
  return game.transaction(() => {
    if (game.member(scope) !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can prepare a reviewed check.');
    if (!characters || typeof characters.character !== 'function') throw new GameError('PROFILE', 'Approved character records are unavailable.');
    const state = game.load(scope.campaign), owners = new Map();
    const actors = state.actors.filter(actor => {
      if (!actor.owner || actor.hp <= 0) return false;
      try { game.member({ campaign: scope.campaign, owner: actor.owner }); }
      catch (error) { if (error instanceof GameError && error.code === 'UNAUTHORIZED') return false; throw error; }
      if (!owners.has(actor.owner)) owners.set(actor.owner, characters.character({ campaign: scope.campaign, owner: actor.owner }));
      const saved = owners.get(actor.owner);
      if (!saved || saved.snapshot?.edition !== '2024') return false;
      const digest = createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16);
      return actor.characterVersion === `approved-${saved.revision}-${digest}`;
    }).map(actor => ({ id: actor.id, name: actor.name }));
    return { gameRevision: state.revision, phase: state.phase, canRequest: state.phase !== 'complete' && !state.pendingReaction && !state.pendingConcentration, actors };
  });
}
