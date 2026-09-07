import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { GameError } from '../game/store.mjs';
import { WorldError } from '../game/world.mjs';
import { missionPages, worldPageCard } from './world-information.mjs';
import { informationPages } from './companion-adapter.mjs';
import { WORLD_TIME_ENTRY } from './world-time-adapter.mjs';
const HOME = { type: 2, custom_id: 'rpw:home', label: 'Mission & counsel', style: 1 };
const MAP = { type: 2, custom_id: 'rpg:home', label: 'Tactical table', style: 2 };
const button = (id, action, label, disabled = false) => ({ type: 2, custom_id: `rpw:${id}:${action}`, label, style: 2, disabled });
const fail = () => { throw new WorldError('CONFLICT', 'Open Mission & counsel again for a current private control.'); };
function home(game, scope, context) {
  const world = game.world(scope), counsel = game.counsel(scope), view = game.view(scope);
  if (!world.configured) return screen('Mission & counsel · Only you', 'Your host has not linked a reviewed mission to this encounter yet.', [HOME, MAP, WORLD_TIME_ENTRY]);
  const id = game.createControl(scope, context, { kind: 'world', gameRevision: view.revision, worldRevision: world.revision, departureId: game.departure(scope)?.id });
  const body = `${world.mission.title}\nStatus: ${world.mission.status} · World revision ${world.revision}\n\nRead the full mission record for its briefing, every track, recorded outcome and debrief.\n\nRaphael counsel: ${counsel.remaining}/${counsel.limit} requests remain for this mission, shared by the party. Each Ask button spends one request; saved advice is private.`;
  return screen('Mission & counsel · Only you', safeText(body).slice(0, 2700), [WORLD_TIME_ENTRY, MAP,
    button(id, 'surroundings', 'Ask · surroundings', !counsel.remaining), button(id, 'readiness', 'Ask · readiness', !counsel.remaining), button(id, 'mission', 'Ask · mission', !counsel.remaining),
    button(id, 'history', 'Saved counsel'), button(id, 'debrief', 'Record party debrief', world.mission.status !== 'debrief'),
    button(id, 'details', 'Full mission record'), { type: 2, custom_id: 'rpq:home', label: 'Mission council', style: 2 }, button(id, 'departure', 'Next scene', !game.departure(scope))]);
}
function details(game, scope, context, record) {
  const world = game.world(scope);
  if (!world.configured || world.revision !== record.worldRevision) fail();
  return worldPageCard({ game, scope, context, prefix: 'rpw', record: { ...record, kind: 'world-pages' }, title: 'Full mission record · Only you', pages: missionPages(world), controls: [HOME, MAP, ...(game.member(scope) === 'host' ? [{ type: 2, custom_id: 'rpj:home', label: 'Review mission outcomes', style: 2 }] : [])] });
}
function debriefPreview(game, scope, context, record) {
  const confirmId = record.confirmId ?? game.createControl(scope, context, { kind: 'debrief-confirm', input: record.input });
  return worldPageCard({ game, scope, context, prefix: 'rpw', record: { ...record, kind: 'debrief-preview', confirmId }, title: 'Confirm shared debrief',
    pages: informationPages([{ title: 'Shared campaign notes', fields: [{ label: 'Sharing', value: 'These notes will be visible to your campaign. Recording the debrief completes this mission record without applying consequences again.' }, { label: 'Notes', value: record.input.notes || '(No additional notes)' }] }]),
    controls: [button(confirmId, 'confirm', 'Confirm shared debrief'), HOME] });
}
function advice(record) {
  return screen('Raphael’s Counsel · Only you', `${safeText(record.text)}\n\nEvidence: ${safeText(record.evidence.join(', '))}`.slice(0, 2700), [HOME, MAP]);
}
export function createWorldHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpw:')) return false;
    let deferred = false;
    const reply = data => transport.respond(interaction.id, interaction.token, { type: 4, data });
    const defer = async () => { await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } }); deferred = true; };
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config); game.member(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      if (customId === 'rpw:home' && interaction.type === 3) { await defer(); await edit(home(game, scope, context)); return true; }
      const parsed = /^rpw:([a-f0-9]{24}):(surroundings|readiness|mission|history|debrief|submit|confirm|details|departure|enter|page|saved[0-2])$/.exec(customId);
      if (!parsed) fail();
      const [, id, action] = parsed, binding = game.control(scope, context, id);
      // A modal must be the first callback. All other successful controls defer
      // privately before projections, pagination or saved-state commands.
      if (!(interaction.type === 3 && action === 'debrief' && binding.kind === 'world')) await defer();
      if (interaction.type === 3 && action === 'departure' && binding.kind === 'world') {
        const departure = game.departure(scope);
        if (!departure || departure.id !== binding.departureId) fail();
        const confirmation = game.createControl(scope, context, { kind: 'departure-confirm', departureId: departure.id });
        await edit(screen('Enter next scene � Party action', `${safeText(departure.title)}\n\nEntering moves the whole party to the host-prepared scene. Current HP carries forward.`, [button(confirmation, 'enter', 'Enter with the party'), HOME])); return true;
      }
      if (interaction.type === 3 && action === 'enter' && binding.kind === 'departure-confirm') {
        game.enterDeparture(scope, { departureId: binding.departureId, requestId: `discord-departure-${id}` });
        await edit(home(game, scope, context)); return true;
      }
      if (interaction.type === 3 && ((action === 'details' && binding.kind === 'world') || (action === 'page' && binding.kind === 'world-pages'))) {
        await edit(details(game, scope, context, binding)); return true;
      }
      if (interaction.type === 3 && action === 'page' && binding.kind === 'debrief-preview') {
        if (game.world(scope).revision !== binding.input.expectedRevision) fail();
        await edit(debriefPreview(game, scope, context, binding)); return true;
      }
      if (interaction.type === 3 && action === 'confirm' && binding.kind === 'debrief-confirm') {
        game.debrief(scope, { ...binding.input, requestId: `discord-world-${id}` }); await edit(home(game, scope, context)); return true;
      }
      if (interaction.type === 3 && ['surroundings', 'readiness', 'mission'].includes(action) && binding.kind === 'world') {
        const record = game.askCounsel(scope, { requestId: `discord-counsel-${id}-${action}`, topic: action, expectedRevision: binding.gameRevision, expectedWorldRevision: binding.worldRevision });
        await edit(advice(record)); return true;
      }
      if (interaction.type === 3 && action === 'history' && binding.kind === 'world') {
        const records = game.counsel(scope).records;
        const history = game.createControl(scope, context, { kind: 'history', requestIds: records.map(r => r.requestId) });
        await edit(screen('Saved counsel · Only you', records.length ? 'Read your earlier advice without spending a request.' : 'No advice has been recorded for your player yet.', [HOME, ...records.map((_, i) => button(history, `saved${i}`, `Read advice ${i + 1}`))])); return true;
      }
      if (interaction.type === 3 && /^saved[0-2]$/.test(action) && binding.kind === 'history') {
        const record = game.counsel(scope).records.find(r => r.requestId === binding.requestIds[Number(action.slice(-1))]);
        if (!record) fail(); await edit(advice(record)); return true;
      }
      const world = game.world(scope);
      if (!world.configured || world.revision !== binding.worldRevision || world.mission.status !== 'debrief') fail();
      if (interaction.type === 3 && action === 'debrief' && binding.kind === 'world') {
        const form = game.createControl(scope, context, { kind: 'debrief-form', worldRevision: world.revision });
        await transport.respond(interaction.id, interaction.token, { type: 9, data: { custom_id: `rpw:${form}:submit`, title: 'Party debrief · shared notes', components: [{ type: 18, label: 'Shared campaign notes (optional)', component: { type: 4, custom_id: 'notes', style: 2, required: false, max_length: 2000 } }] } }); return true;
      }
      if (interaction.type === 5 && action === 'submit' && binding.kind === 'debrief-form') {
        const fields = interaction.data.components, field = fields?.[0]?.component;
        if (!Array.isArray(fields) || fields.length !== 1 || fields[0].type !== 18 || field?.type !== 4 || field.custom_id !== 'notes' || typeof field.value !== 'string' || field.value.length > 2000) fail();
        await edit(debriefPreview(game, scope, context, { input: { expectedRevision: world.revision, notes: field.value } })); return true;
      }
      fail();
    } catch (error) {
      const message = error instanceof WorldError || error instanceof GameError ? error.message : 'The mission request could not finish. Open the mission desk or retry the same confirmation.';
      try { const data = screen('Mission status · Only you', safeText(message).slice(0, 2600), [HOME]); if (deferred) await edit(data); else await reply(data); }
      catch { log({ outcome: 'world_delivery_failed' }); }
      return true;
    }
  };
}
