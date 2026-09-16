import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { renderModal, readModal } from './deck.mjs';
import { renderTacticalMap } from '../maps/render.mjs';
import { coordinate, parseCoordinate } from '../maps/grid.mjs';
import { tacticalControls, movementPreview, MAX_MOVE_STEPS } from '../client/tactical-controls.mjs';
import { GameError } from '../game/store.mjs';

const HOME = { type: 2, custom_id: 'rpg:home', label: 'Tactical table', style: 1 };
const control = (id, action, label, disabled = false) => ({ type: 2, custom_id: `rpg:${id}:${action}`, label, style: 2, disabled });
const fail = message => { throw new GameError('INTERACTION', message); };
function route(value) {
  const m = /^rpg:([a-f0-9]{24}):(map|move|attack|end|pause|resume|submit|confirm)$/.exec(value);
  if (!m) fail('Open the Tactical table again.');
  return { id: m[1], action: m[2] };
}
export function board(game, scope, context, heading = '', view = game.view(scope)) {
  const controls = tacticalControls(view), active = controls.active;
  const binding = game.createControl(scope, context, { kind: 'board', revision: view.revision, actorId: controls.transitionActor?.id });
  const actors = view.actors.slice(0, 15).map(a => `${safeText(a.name)} [${a.id}] · ${coordinate(a.x, a.y)}${a.hp === undefined ? '' : ` · HP ${a.hp}/${a.maxHp}`}`).join('\n');
  const effects = view.effects.slice(0, 8).map(e => `${safeText(e.name)} · expires before turn ${e.expiresAtTurn}`).join('\n') || 'No visible lingering effects.';
  const body = `${heading ? `${heading}\n\n` : ''}${controls.status} · Revision ${view.revision}${view.phase === 'combat' ? `\n${safeText(active?.name || 'Another actor')} acting` : ''}\n${controls.resources}${controls.exploration ? '\nMove lets you choose any living character you control.' : ''}${view.phase === 'paused' ? '\nThe host can resume play. Images and distance questions remain available.' : ''}\n\n${actors}\n\n${effects}`.slice(0, 2700);
  const data = screen('Your tactical map · Only you', body, [HOME, control(binding, 'map', 'Refresh map'), control(binding, 'move', 'Move', !controls.canMove), control(binding, 'attack', 'Attack', !controls.canAttack), control(binding, 'end', 'End turn', !controls.canEnd), control(binding, 'pause', 'Pause', !controls.canPause), control(binding, 'resume', 'Resume', !controls.canResume),
    { type: 2, custom_id: 'rpc:characters', label: 'Character details', style: 2 },
    { type: 2, custom_id: 'rpc:home', label: 'More information', style: 2 },
    { type: 2, custom_id: 'rpw:home', label: 'Mission & counsel', style: 2 },
    { type: 2, custom_id: `campaign:open:${scope.campaign}`, label: 'Campaign feed', style: 2 },
  ]);
  const png = renderTacticalMap(view, { cellSize: Math.min(64, Math.floor(3900 / Math.max(view.map.width, view.map.height))) });
  if (png.length <= 9 * 1024 * 1024) {
    const name = `map-${view.revision}.png`;
    data.attachments = [{ id: '0', filename: name, description: 'Your authorized tactical map' }];
    data.components.splice(1, 0, { type: 12, items: [{ media: { url: `attachment://${name}` }, description: `Map revision ${view.revision}` }] });
    data.files = [{ data: png, name, contentType: 'image/png' }];
  } else data.components[0].content += '\nThe image is too large to attach here. Use the browser tactical table.';
  return data;
}
function preview(game, scope, context, command, description) {
  const id = game.createControl(scope, context, { kind: 'confirm', command });
  return screen('Confirm your action', description, [control(id, 'confirm', 'Confirm action'), HOME]);
}
function resultText(receipt) {
  const r = receipt.result;
  if (r.type === 'attack') return `Saved roll: ${r.dice.join(', ')}${r.modifiers.map(m => ` + ${m.value} ${m.source}`).join('')} = ${r.total}. ${r.hit ? `Hit: ${r.damage} damage.` : 'Miss.'}`;
  if (r.type === 'move') return `Movement saved. ${r.movementRemaining == null ? 'No combat movement or action was spent.' : `${r.movementRemaining} feet remain.`}${r.stopped ? ' Your route was interrupted.' : ''}`;
  return 'Action saved.';
}
/** Opening a private board also renews its bounded automatic refresh window. */
export function createAdventureHandler({ game, config, transport, delivery, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpg:')) return false;
    let deferred = false;
    const reply = data => transport.respond(interaction.id, interaction.token, { type: 4, data });
    const defer = async () => { await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } }); deferred = true; };
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      game.member(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      const sendBoard = async heading => {
        const view = game.view(scope);
        await edit(board(game, scope, context, heading, view));
        delivery?.watch(scope, context, interaction, view.revision);
      };
      if (customId === 'rpg:home' && interaction.type === 3) { await defer(); await sendBoard('Private updates run for 14 minutes. Refresh map renews them.'); return true; }
      const selected = route(customId), binding = game.control(scope, context, selected.id);
      if (selected.action === 'confirm' && interaction.type === 3 && binding.kind === 'confirm') {
        await defer();
        const receipt = game.command(scope, { ...binding.command, requestId: `discord-${selected.id}` });
        await sendBoard(resultText(receipt)); return true;
      }
      const view = game.view(scope);
      if (selected.action === 'map' && interaction.type === 3 && binding.kind === 'board') { await defer(); await sendBoard('Private updates renewed for 14 minutes.'); return true; }
      if (view.revision !== binding.revision) fail('This control is from an earlier game state. Open the Tactical table again.');
      let actor = view.actors.find(a => a.id === binding.actorId && (a.controlled || (view.canResume && ['pause', 'resume'].includes(selected.action))));
      if (!actor) fail('This control does not belong to a character you can operate.');
      const controls = tacticalControls(view, actor.id);
      if (interaction.type === 3 && binding.kind === 'board') {
        if (['move', 'attack'].includes(selected.action)) {
          if (selected.action === 'move' ? !controls.canMove : !controls.canAttack) fail('That action is unavailable in the current game state.');
          const form = game.createControl(scope, context, { kind: selected.action, revision: view.revision, actorId: actor.id, exploration: controls.exploration });
          const modal = renderModal('sceneimage', { session: 'game', view: 'form', revision: 0 });
          modal.data.custom_id = `rpg:${form}:submit`;
          modal.data.title = selected.action === 'move' ? 'Preview movement' : 'Choose attack target';
          modal.data.components[0].label = selected.action === 'move' ? 'Destination coordinate, such as C4' : 'Visible target name or ID';
          modal.data.components[0].component.placeholder = selected.action === 'move' ? 'C4' : 'Enter a name or ID from your map card';
          if (selected.action === 'move' && controls.exploration) modal.data.components.push({ type: 18, label: 'Your character name or ID', component: { type: 4, custom_id: 'moving_actor', style: 1, required: true, max_length: 100, value: actor.id } });
          await transport.respond(interaction.id, interaction.token, modal); return true;
        }
        if (['end', 'pause', 'resume'].includes(selected.action)) {
          if (!({ end: controls.canEnd, pause: controls.canPause, resume: controls.canResume })[selected.action]) fail('That action is unavailable in the current game state.');
          const type = { end: 'end_turn', pause: 'pause', resume: 'resume' }[selected.action];
          await reply(preview(game, scope, context, { type, actorId: actor.id, expectedRevision: view.revision }, `Confirm ${selected.action === 'end' ? 'ending your turn' : selected.action === 'pause' ? 'pausing play' : 'resuming play'}.`)); return true;
        }
      }
      if (interaction.type === 5 && selected.action === 'submit' && ['move', 'attack'].includes(binding.kind)) {
        let components = interaction.data.components;
        if (binding.kind === 'move' && binding.exploration) {
          const fields = Array.isArray(components) ? components.flatMap(c => c.component ? [c.component] : c.components ?? []) : [];
          const names = fields.filter(c => c.custom_id === 'moving_actor');
          const name = names.length === 1 && typeof names[0].value === 'string' ? names[0].value.trim() : '';
          const matches = view.actors.filter(a => a.controlled && !a.defeated && (a.id === name || a.name.toLowerCase() === name.toLowerCase()));
          if (!name || matches.length !== 1) fail('Choose one living character you control by its name or ID.');
          actor = matches[0];
          components = components.filter(c => c.component?.custom_id !== 'moving_actor').map(c => c.components ? { ...c, components: c.components.filter(field => field.custom_id !== 'moving_actor') } : c).filter(c => !c.components || c.components.length);
        }
        const currentControls = tacticalControls(view, actor.id);
        if (binding.kind === 'move' ? !currentControls.canMove : !currentControls.canAttack) fail('That action is unavailable in the current game state.');
        const value = readModal('sceneimage', components).focus?.trim();
        if (!value) fail('Enter a destination or visible target.');
        await defer();
        const command = { type: binding.kind, actorId: actor.id, expectedRevision: view.revision };
        let description;
        if (binding.kind === 'move') {
          let target; try { target = parseCoordinate(value); } catch { fail('Use a coordinate such as C4.'); }
          const path = movementPreview(view, actor, target);
          if (!path?.path.length) fail(`No legal visible route fits one move of up to ${MAX_MOVE_STEPS} steps${currentControls.exploration ? '' : ' within your remaining movement'}. Choose a closer visible cell.`);
          command.path = path.path;
          description = `Move ${safeText(actor.name)} to ${coordinate(target.x, target.y)}.\nRoute: ${path.path.map(p => coordinate(p.x, p.y)).join(' → ')}\n${currentControls.exploration ? 'Route distance' : 'Cost'}: ${currentControls.exploration ? path.path.length * 5 : path.cost} feet. Hazards can interrupt the route.${currentControls.exploration ? '\nNo combat movement or action is spent; combat time does not advance.' : ''}`;
        } else {
          const targets = view.actors.filter(a => !a.defeated && a.id !== actor.id && (a.id === value || a.name.toLowerCase() === value.toLowerCase()));
          if (targets.length !== 1) fail('Choose one unambiguous visible target from your map.');
          command.targetId = targets[0].id;
          description = `Attack ${safeText(targets[0].name)} with ${safeText(actor.weapon?.name)}. This spends your action if accepted. The engine checks range and records the dice once.`;
        }
        await edit(preview(game, scope, context, command, description)); return true;
      }
      fail('That control is unavailable. Open the Tactical table again.');
    } catch (error) {
      const message = error instanceof GameError ? error.message : 'The game could not finish this request. Open the Tactical table or retry the same confirmation.';
      const data = screen('Game status · Only you', safeText(message).slice(0, 2600), [HOME]);
      try { if (deferred) await edit(data); else await reply(data); } catch { log({ outcome: 'game_delivery_failed' }); }
      return true;
    }
  };
}
