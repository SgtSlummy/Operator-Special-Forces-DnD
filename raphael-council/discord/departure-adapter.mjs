import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { GameError } from '../game/store.mjs';
import { WorldError } from '../game/world.mjs';
import { informationPages } from './companion-adapter.mjs';
import { worldPageCard } from './world-information.mjs';

const HOME = { type: 2, custom_id: 'rpd:home', label: 'Party departure', style: 2 };
const TABLE = { type: 2, custom_id: 'rpg:home', label: 'Tactical table', style: 2 };
const MISSION = { type: 2, custom_id: 'rpw:home', label: 'Mission & counsel', style: 2 };
const fail = () => { throw new GameError('STALE', 'Open Party departure again for the current host-prepared scene.'); };

function departureCard(game, scope, context, record = {}) {
  const departure = game.departure(scope);
  if (record.departureId && record.departureId !== departure?.id) fail();
  if (!departure) return screen('Party departure · Only you', 'There is no current departure prepared by your host. Finish the mission, debrief and party choice; your host then prepares the next scene.', [HOME, MISSION, TABLE]);
  const confirmId = record.confirmId ?? game.createControl(scope, context, { kind: 'departure-confirm', departureId: departure.id });
  return worldPageCard({ game, scope, context, prefix: 'rpd', record: { kind: 'departure-pages', departureId: departure.id, confirmId, page: record.page ?? 0 }, title: 'Preview party departure · Only you',
    pages: informationPages([{ title: departure.title, fields: [
      { label: 'Briefing', value: departure.briefing },
      { label: 'Party confirmation', value: 'Confirming moves the whole party into the host-prepared scene. Your current injuries and saved character profiles carry forward. This does not heal the party. Browsing this preview changes nothing.' },
    ] }]), controls: [{ type: 2, custom_id: `rpd:${confirmId}:confirm`, label: 'Confirm party departure', style: 1 }, HOME, MISSION, TABLE] });
}

export function createDepartureHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string') return false;
    const legacy = /^rpw:([a-f0-9]{24}):departure$/.exec(customId);
    if (!customId.startsWith('rpd:') && !legacy) return false;
    let deferred = false;
    const reply = data => transport.respond(interaction.id, interaction.token, { type: 4, data });
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config); game.member(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } }); deferred = true;
      if (interaction.type !== 3) fail();
      if (customId === 'rpd:home') { await edit(departureCard(game, scope, context)); return true; }
      if (legacy) {
        const binding = game.control(scope, context, legacy[1]);
        if (binding.kind !== 'world' || !binding.departureId) fail();
        await edit(departureCard(game, scope, context, { departureId: binding.departureId })); return true;
      }
      const parsed = /^rpd:([a-f0-9]{24}):(page|confirm)$/.exec(customId);
      if (!parsed) fail();
      const [, id, action] = parsed, binding = game.control(scope, context, id);
      if (action === 'page' && binding.kind === 'departure-pages') await edit(departureCard(game, scope, context, binding));
      else if (action === 'confirm' && binding.kind === 'departure-confirm') {
        game.enterDeparture(scope, { departureId: binding.departureId, requestId: `discord-departure-${id}` });
        await edit(screen('Party departure recorded · Only you', 'The party entered the prepared scene. Open the tactical table for your current view. Repeating this confirmation will not move the party again.', [TABLE, MISSION, HOME]));
      } else fail();
      return true;
    } catch (error) {
      const message = error instanceof GameError || error instanceof WorldError ? error.message : 'The departure request could not finish. Retry the same confirmation; do not create a second departure request.';
      try { const data = screen('Departure status · Only you', safeText(message).slice(0, 2600), [HOME, TABLE]); if (deferred) await edit(data); else await reply(data); }
      catch { log({ outcome: 'departure_delivery_failed' }); }
      return true;
    }
  };
}
