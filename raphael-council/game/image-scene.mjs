import { coordinate } from '../maps/grid.mjs';
import { createHash } from 'node:crypto';

// Input is an authenticated projection, never the full game state. No appearance,
// hidden lore, reference asset or mechanical outcome is inferred from a name.
export function tacticalImageScene(view, scope, { resolvePortrait = () => null } = {}) {
  const actors = view.actors.map(a => `${a.name.slice(0, 100)} at ${coordinate(a.x, a.y)}${a.defeated ? ', down' : ''}`);
  const effects = view.effects.map(e => `${e.name.slice(0, 100)} at ${e.cells.slice(0, 12).map(p => coordinate(p.x, p.y)).join(', ')}${e.cells.length > 12 ? ' (additional visible cells omitted)' : ''}`);
  const description = [
    `Observable tactical scene: ${view.map.title}. Saved revision ${view.revision}, round ${view.round}, turn ${view.turn}.`,
    'Coordinates describe positions on a five-foot octagonal grid. Render only an illustrative view; the tactical map remains authoritative. Appearance is unspecified. Do not infer appearance, terrain beyond visibility, identities or lore from names.',
    `Visible actors: ${actors.join('; ') || 'none'}.`,
    `Visible effect zones: ${effects.join('; ') || 'none'}.`,
  ].join('\n');
  // Keep service bounds without truncating a fact midway or hiding that details
  // were omitted. Large encounters deliberately fall back to compact context.
  const bounded = description.length <= 6000 ? description : `Observable tactical scene: ${view.map.title}. Revision ${view.revision}. The full visible encounter exceeds the illustration description limit. Use only the selected subject when supplied; do not invent omitted surroundings.`;
  return { campaign: scope.campaign, audience: scope.owner, id: view.map.id,
    title: view.map.title, sourceEventId: `game:${view.campaign}:${view.revision}`, gameRevision: view.revision,
    description: bounded, references: [], subjects: view.actors.slice(0, 20).map(a => ({
      id: `actor_${createHash('sha256').update(a.id).digest('hex')}`, label: a.name.slice(0, 100),
      description: `Visible actor at ${coordinate(a.x, a.y)}${a.defeated ? ', down' : ''}. Appearance and equipment appearance are unspecified; no hidden traits or identities may be inferred.`,
      portraitPath: a.owner ? resolvePortrait(a.owner) : null,
    })) };
}

export function resolveTacticalImageScene(game, scope, options = {}) {
  // Image-only campaigns keep their host-authored scenes. Once a campaign has
  // tactical state, lost membership must fail instead of falling back to art.
  if (!game.hasCampaign(scope.campaign)) return null;
  return tacticalImageScene(game.view(scope), scope, options);
}
