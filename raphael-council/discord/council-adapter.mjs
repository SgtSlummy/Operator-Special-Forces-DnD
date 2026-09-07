import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { GameError } from '../game/store.mjs';
import { WorldError } from '../game/world.mjs';
import { informationPages } from './companion-adapter.mjs';
import { councilPages, worldPageCard } from './world-information.mjs';

const HOME = { type: 2, custom_id: 'rpq:home', label: 'Mission council', style: 2 };
const MISSION = { type: 2, custom_id: 'rpw:home', label: 'Mission & counsel', style: 2 };
const fail = () => { throw new WorldError('CONFLICT', 'Open Mission council again for a current private control.'); };
function current(game, scope, record) {
  const round = game.council(scope);
  if (!round || round.round !== record.round || round.worldRevision !== record.worldRevision) fail();
  return round;
}
function card(game, scope, context, record = {}) {
  const round = record.round === undefined ? game.council(scope) : current(game, scope, record);
  if (!round) return screen('Mission council · Only you', 'The host can prepare the next mission council after the debrief.', [HOME, MISSION]);
  const data = worldPageCard({ game, scope, context, prefix: 'rpq', record: { kind: 'council-pages', round: round.round, worldRevision: round.worldRevision, page: record.page ?? 0 },
    title: 'Mission council · Only you', pages: councilPages(round), controls: [HOME, MISSION] });
  if (!round.selection && game.world(scope).revision === round.worldRevision) {
    const id = game.createControl(scope, context, { kind: 'council-picker', round: round.round, worldRevision: round.worldRevision, branchIds: round.branches.map(b => b.id) });
    data.components.push({ type: 1, components: [{ type: 3, custom_id: `rpq:${id}:choose`, placeholder: 'Preview the party’s next branch', min_values: 1, max_values: 1,
      options: round.branches.map((b, i) => ({ label: `${i + 1}. ${b.title}`.slice(0, 100), value: b.id })) }] });
  }
  return data;
}
function preview(game, scope, context, record) {
  const round = current(game, scope, record), branch = round.branches.find(b => b.id === record.branchId);
  if (!branch || round.selection || game.world(scope).revision !== record.worldRevision) fail();
  const confirmId = record.confirmId ?? game.createControl(scope, context, { kind: 'council-confirm', input: {
    round: round.round, branchId: branch.id, expectedWorldRevision: round.worldRevision,
  } });
  return worldPageCard({ game, scope, context, prefix: 'rpq', record: { ...record, kind: 'council-preview', confirmId }, title: 'Confirm party branch · Only you',
    pages: informationPages([{ title: 'Party choice', fields: [
      { label: 'Branch', value: branch.title }, { label: 'Summary', value: branch.summary }, { label: 'Cost', value: branch.cost },
      { label: 'Confirmation', value: 'Confirming records this selection for the whole party. It does not spend the stated fictional cost or launch the next scene.' },
    ] }]), controls: [{ type: 2, custom_id: `rpq:${confirmId}:confirm`, label: 'Confirm party branch', style: 1 }, HOME, MISSION] });
}

/** Discord and browser call the same revision-checked, repeat-safe council
 * service. Browsing a decision never submits it. */
export function createCouncilHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpq:')) return false;
    let deferred = false;
    const reply = data => transport.respond(interaction.id, interaction.token, { type: 4, data });
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config); game.member(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } }); deferred = true;
      if (interaction.type !== 3) fail();
      if (customId === 'rpq:home') { await edit(card(game, scope, context)); return true; }
      const parsed = /^rpq:([a-f0-9]{24}):(page|choose|confirm)$/.exec(customId);
      if (!parsed) fail();
      const [, id, action] = parsed, binding = game.control(scope, context, id);
      if (action === 'page' && binding.kind === 'council-pages') await edit(card(game, scope, context, binding));
      else if (action === 'page' && binding.kind === 'council-preview') await edit(preview(game, scope, context, binding));
      else if (action === 'choose' && binding.kind === 'council-picker') {
        const values = interaction.data.values;
        if (!Array.isArray(values) || values.length !== 1 || !binding.branchIds.includes(values[0])) fail();
        await edit(preview(game, scope, context, { ...binding, branchId: values[0], page: 0 }));
      } else if (action === 'confirm' && binding.kind === 'council-confirm') {
        // The service resolves a saved receipt before its stale-revision check,
        // so an uncertain delivery may retry the original confirmation safely.
        game.chooseCouncil(scope, { ...binding.input, requestId: `discord-council-choice-${id}` });
        await edit(card(game, scope, context));
      } else fail();
      return true;
    } catch (error) {
      const message = error instanceof WorldError || error instanceof GameError ? error.message : 'The council request could not finish. Retry the same confirmation or reopen the council.';
      try { const data = screen('Council status · Only you', safeText(message).slice(0, 2600), [HOME, MISSION]); if (deferred) await edit(data); else await reply(data); }
      catch { log({ outcome: 'council_delivery_failed' }); }
      return true;
    }
  };
}
