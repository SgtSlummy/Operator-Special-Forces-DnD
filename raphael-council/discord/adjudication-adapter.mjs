import { GameError } from '../game/store.mjs';
import { WorldError } from '../game/world.mjs';
import { missionAdjudication } from '../game/adjudication.mjs';
import { authenticateInteraction } from './import-adapter.mjs';
import { safeText, screen } from './import-ui.mjs';
import { informationPages } from './companion-adapter.mjs';
import { worldPageCard } from './world-information.mjs';

const button = (id, action, label, disabled = false) => ({ type: 2, custom_id: `rpj:${id}:${action}`, label, style: 2, disabled });
const HOME = { type: 2, custom_id: 'rpj:home', label: 'Review mission outcomes', style: 2 };
const MISSION = { type: 2, custom_id: 'rpw:home', label: 'Mission desk', style: 2 };
const fail = () => { throw new GameError('STALE', 'Review the current mission outcomes again.'); };

function preview(game, scope, context, record = {}) {
  const view = missionAdjudication(game, scope);
  if (!view.available) {
    if (record.expectedRevision !== undefined) fail();
    return screen('Host mission review · Only you', 'There is no active mission awaiting a reviewed host outcome. Party debrief stays on the mission desk.', [MISSION]);
  }
  if (record.expectedRevision !== undefined && (view.expectedRevision !== record.expectedRevision || view.expectedWorldRevision !== record.expectedWorldRevision)) fail();
  const index = record.index ?? 0, outcome = view.outcomes[index];
  if (!outcome) fail();
  const input = { reviewed: true, expectedRevision: view.expectedRevision, expectedWorldRevision: view.expectedWorldRevision, outcomeId: outcome.id };
  const confirmId = record.confirmId ?? game.createControl(scope, context, { kind: 'adjudication-confirm', input });
  const bound = { kind: 'adjudication-preview', index, expectedRevision: view.expectedRevision, expectedWorldRevision: view.expectedWorldRevision, page: record.page ?? 0, confirmId };
  const choice = (next, label, disabled) => {
    const id = game.createControl(scope, context, { ...bound, index: next, page: 0, confirmId: undefined });
    return button(id, 'choose', label, disabled);
  };
  const pages = informationPages([
    { id: 'outcome', label: `Outcome ${index + 1} of ${view.outcomes.length}`, items: [{ label: 'Title', value: outcome.title }, { label: 'Summary', value: outcome.summary }] },
    { id: 'mission', label: 'Reviewed mission', items: [{ label: 'Title', value: view.mission.title }, { label: 'Briefing', value: view.mission.briefing }] },
    { id: 'changes', label: 'Configured consequences', items: outcome.changes.length ? outcome.changes.map(change => ({ label: change.label, value: `${change.before}/100 → ${change.after}/100 (configured delta ${change.delta >= 0 ? '+' : ''}${change.delta}; clamped to 0–100)` })) : [{ label: 'Tracks', value: 'No track changes.' }] },
    { id: 'confirmation', label: 'Before confirming', items: [{ label: 'Selected outcome', value: outcome.title }, { label: 'Effect', value: 'Confirming records this outcome and opens the party debrief. It does not roll dice, heal characters or advance time. Reading and changing the preview is free.' }, { label: 'Snapshot', value: `Game revision ${view.expectedRevision}; world revision ${view.expectedWorldRevision}.` }] },
  ].map(group => ({ title: group.label, fields: group.items })));
  return worldPageCard({ game, scope, context, prefix: 'rpj', record: bound, title: 'Host mission review · Only you', pages, controls: [choice(index - 1, 'Previous outcome', index === 0), choice(index + 1, 'Next outcome', index === view.outcomes.length - 1), button(confirmId, 'confirm', 'Confirm this mission outcome'), MISSION] });
}

export function createAdjudicationHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpj:')) return false;
    let deferred = false;
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      if (game.member(scope) !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can review or record mission outcomes.');
      if (interaction.type !== 3) fail();
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
      deferred = true;
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      if (customId === 'rpj:home') await deliver(preview(game, scope, context));
      else {
        const match = /^rpj:([a-f0-9]{24}):(page|choose|confirm)$/.exec(customId);
        if (!match) fail();
        const record = game.control(scope, context, match[1]);
        if (match[2] === 'confirm') {
          if (record.kind !== 'adjudication-confirm') fail();
          const receipt = game.adjudicateMission(scope, { ...record.input, requestId: `discord-adjudicate-${match[1]}` });
          await deliver(screen('Mission outcome recorded · Only you', `The reviewed outcome is saved at game revision ${receipt.revision}, world revision ${receipt.worldRevision}. Open the mission desk for the separate party debrief. Retrying this confirmation returns the saved decision.`, [MISSION]));
        } else {
          if (record.kind !== 'adjudication-preview') fail();
          await deliver(preview(game, scope, context, record));
        }
      }
    } catch (error) {
      log({ outcome: 'adjudication_interaction_failed', code: error?.code || 'INTERNAL' });
      const message = error instanceof GameError || error instanceof WorldError ? error.message : 'The request could not finish. If you confirmed an outcome, retry that same confirmation to recover its saved result.';
      try {
        const data = screen('Host mission review · Only you', safeText(message), [HOME, MISSION]);
        if (deferred) await deliver(data);
        else await transport.respond(interaction.id, interaction.token, { type: 4, data });
      } catch { log({ outcome: 'adjudication_delivery_failed' }); }
    }
    return true;
  };
}
