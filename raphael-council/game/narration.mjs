import { coordinate } from '../maps/grid.mjs';

/** Deterministic narrator over authorized projections only. Never reads GM data,
 * rolls dice, interprets names as instructions or proposes a state mutation. */
export function narrateChange(before, after, receipt = null) {
  const facts = [];
  if (!before || before.map.id !== after.map.id) facts.push(`Your visible scene is ${after.map.title}.`);
  for (const actor of after.actors) {
    const prior = before?.actors.find(a => a.id === actor.id);
    if (prior && (prior.x !== actor.x || prior.y !== actor.y)) facts.push(`${actor.name} is now at ${coordinate(actor.x, actor.y)}.`);
    if (prior && actor.hp !== undefined && prior.hp !== undefined && actor.hp !== prior.hp) facts.push(`${actor.name} has ${actor.hp} of ${actor.maxHp} HP.`);
    if (prior && actor.defeated !== prior.defeated) facts.push(`${actor.name} is ${actor.defeated ? 'down' : 'no longer down'}.`);
    if (before && !prior) facts.push(`${actor.name} is now visible at ${coordinate(actor.x, actor.y)}.`);
  }
  for (const actor of before?.actors ?? []) if (!after.actors.some(a => a.id === actor.id)) facts.push(`${actor.name} is no longer in your visible view.`);
  for (const effect of after.effects) if (!before?.effects.some(e => e.id === effect.id)) facts.push(`${effect.name} is visible in the scene, with its current duration ending before turn ${effect.expiresAtTurn}.`);
  for (const effect of before?.effects ?? []) if (!after.effects.some(e => e.id === effect.id)) facts.push(`${effect.name} is no longer visible in this view.`);
  if (before && before.phase !== after.phase) {
    if (after.phase === 'complete') facts.push(before.phase === 'exploration' ? 'The reviewed mission has ended.' : 'The encounter has ended.');
    else if (after.phase === 'paused') facts.push('Play is paused.');
    else if (before.phase === 'paused' && ['combat', 'exploration'].includes(after.phase)) facts.push('Play has resumed.');
    else if (after.phase === 'exploration') facts.push('Exploration begins.');
    else if (after.phase === 'combat') facts.push('Combat begins.');
  }
  if (before && before.turn !== after.turn) facts.push(`Round ${after.round}, turn ${after.turn} begins.`);
  if (receipt?.revision === after.revision && receipt.result.type === 'attack') {
    const r = receipt.result;
    facts.push(`Your saved attack roll is ${r.dice.join(', ')}${r.modifiers.map(m => ` + ${m.value} (${m.source})`).join('')} = ${r.total}. ${r.hit ? `Hit for ${r.damage} damage.` : 'Miss.'}`);
  }
  return { source: `game:${after.campaign}:${after.revision}`, revision: after.revision,
    scene: after.map.title, round: after.round, turn: after.turn, facts,
    mode: 'deterministic-observation', proposals: [] };
}
