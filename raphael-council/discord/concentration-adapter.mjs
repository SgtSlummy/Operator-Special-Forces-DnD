import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { informationPages } from './companion-adapter.mjs';
import { GameError } from '../game/store.mjs';

const button = (custom_id, label, style = 2, disabled = false) => ({ type: 2, custom_id, label, style, disabled });
const HOME = button('rpf:home', 'Current concentration');
const ACTORS = button('rpf:actors', 'Your concentration');
const RESULTS = button('rpf:results', 'Your concentration rolls');
const REGISTER = button('rpf:register', 'Record reviewed source');
const MORE = button('rpc:rolls', 'Checks & rolls');
const field = (label, value) => ({ label, value });
const stale = () => { throw new GameError('STALE', 'Open Current concentration again for current choices.'); };
const invalid = message => { throw new GameError('INVALID', message); };
const bound = (game, scope, context, record, label, action = 'page', disabled = false) => button(`rpf:${game.createControl(scope, context, record)}:${action}`, label, action === 'resolve' ? 1 : 2, disabled);
const joined = values => values?.length ? values.join(', ') : 'None';
const signed = value => `${value >= 0 ? '+' : ''}${value}`;
function profileFields(profile) {
  if (!profile) return [];
  return [field('Constitution score', profile.abilityScore), field('Save proficiency', profile.proficient ? 'Proficient' : 'Not proficient'), field('Proficiency bonus', profile.proficiencyBonus),
    field('Reviewed adjustments', profile.adjustments?.length ? profile.adjustments.map(item => `${signed(item.value)} ${item.source}`).join('\n') : 'None'),
    field('Advantage sources', joined(profile.advantage)), field('Disadvantage sources', joined(profile.disadvantage))];
}
function current(game, scope, record = {}) {
  const state = game.concentration(scope);
  if (record.expectedRevision !== undefined && state.revision !== record.expectedRevision) stale();
  if (record.pendingId !== undefined && state.pending?.id !== record.pendingId) stale();
  return state;
}
function pageFields(game, scope, context, groups, record, controls) {
  const pages = informationPages(groups), page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) stale();
  if (page > 0) controls.push(bound(game, scope, context, { ...record, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...record, page: page + 1 }, 'Next detail'));
  return `Detail ${page + 1}/${pages.length}\n\n${safeText(pages[page].text)}`;
}
function homeCard(game, scope, context, record = {}) {
  const state = current(game, scope, record), pending = state.pending, controls = [];
  const base = { kind: 'concentration-home', expectedRevision: state.revision, ...(pending?.id ? { pendingId: pending.id } : {}) };
  let body = `Scene revision ${state.revision}. Reading this panel spends no action, movement, time, or dice.`;
  if (!pending) body += '\n\nNo concentration save is waiting. Open Your concentration to review or end an effect you control.';
  else {
    body += `\n\n${pending.paused ? 'Play is paused. Decisions wait until play resumes.' : 'Play is waiting for a concentration decision.'}`;
    if (pending.actorId) {
      const fields = [field('Character', pending.actorName), field('Source', pending.sourceLabel), field('Damage taken', pending.damageTaken), field('Constitution save DC', pending.dc), ...profileFields(pending.profile)];
      body += `\n\n${pageFields(game, scope, context, [{ title: 'Pending concentration save', fields }], { ...base, page: record.page ?? 0 }, controls)}`;
    } else body += '\n\nThe affected character’s decision and save details remain private.';
    if (pending.canResolve) controls.push(bound(game, scope, context, { kind: 'concentration-decision', input: { action: 'resolve', pendingId: pending.id, expectedRevision: state.revision } }, 'Roll concentration save', 'resolve', pending.paused));
    if (pending.canEnd) controls.push(bound(game, scope, context, { kind: 'concentration-decision', input: { action: 'end', actorId: pending.actorId, expectedRevision: state.revision } }, 'End concentration', 'resolve', pending.paused));
    if (pending.canRefresh) controls.push(bound(game, scope, context, { ...base, kind: 'concentration-form', action: 'refresh' }, 'Review recovery', 'form', pending.paused));
    if (pending.recoveryRequired) body += '\n\nThe responder or source is no longer eligible. Host review is required to clear this interruption.';
    if (pending.canResolve) body += '\n\nRolling uses the pinned Constitution save. Ending concentration instead removes its bound effects without rolling. Neither choice spends an action.';
  }
  controls.push(ACTORS, RESULTS);
  if (state.role === 'host') controls.push(REGISTER);
  controls.push(HOME, MORE);
  return screen('Concentration · Only you', body, controls);
}
function actorsCard(game, scope, context, record = {}) {
  const state = current(game, scope, record), index = record.actorIndex ?? 0, controls = [];
  if (!state.actors.length) return screen('Your concentration · Only you', 'No characters under your control are available in this scene.', [HOME, RESULTS, MORE]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.actors.length) stale();
  const actor = state.actors[index], focus = actor.concentration;
  const base = { kind: 'concentration-actors', expectedRevision: state.revision, actorIndex: index };
  const fields = [field('Character', actor.name), field('Character version', actor.characterVersion), field('Reviewed Constitution save available', actor.eligible ? 'Yes' : 'No'), field('Active source', focus?.sourceLabel ?? 'None')];
  if (focus) fields.push(field('Bound effect IDs', joined(focus.effects.map(effect => effect.id))), field('Reviewed reason', focus.review.reason), field('Reviewed revision', focus.review.revision), ...profileFields(focus.profile));
  const body = pageFields(game, scope, context, [{ title: 'Your concentration', fields }], { ...base, page: record.page ?? 0 }, controls);
  if (index > 0) controls.push(bound(game, scope, context, { ...base, actorIndex: index - 1 }, 'Previous character'));
  if (index + 1 < state.actors.length) controls.push(bound(game, scope, context, { ...base, actorIndex: index + 1 }, 'Next character'));
  if (focus && (!state.pending || (state.pending.actorId === actor.id && state.pending.canEnd))) controls.push(bound(game, scope, context, { kind: 'concentration-decision', input: { action: 'end', actorId: actor.id, expectedRevision: state.revision } }, 'End concentration', 'resolve', state.phase === 'paused'));
  controls.push(HOME, RESULTS, MORE);
  return screen('Your concentration · Only you', `Character ${index + 1}/${state.actors.length}\n${body}\n\nEnding concentration is a free choice that removes only this source’s bound effects.`, controls);
}
function registrationCard(game, scope, context, record = {}) {
  const state = current(game, scope, record), index = record.actorIndex ?? 0, controls = [];
  if (state.role !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can record a reviewed source.');
  const actors = state.registrationActors;
  if (!actors.length) return screen('Record reviewed source · Host', 'No eligible character with a reviewed Constitution save is available.', [HOME, MORE]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= actors.length) stale();
  const actor = actors[index], base = { kind: 'concentration-registration', expectedRevision: state.revision, actorIndex: index };
  const fields = [field('Character', actor.name), field('Character ID', actor.id), field('Character version', actor.characterVersion), field('Available effect IDs', state.effects.length ? state.effects.map(effect => `${effect.id}: ${effect.name}`).join('\n') : 'None. A reviewed source may have no modeled effect.')];
  const body = pageFields(game, scope, context, [{ title: 'Reviewed source', fields }], { ...base, page: record.page ?? 0 }, controls);
  if (index > 0) controls.push(bound(game, scope, context, { ...base, actorIndex: index - 1 }, 'Previous character'));
  if (index + 1 < actors.length) controls.push(bound(game, scope, context, { ...base, actorIndex: index + 1 }, 'Next character'));
  const blocked = state.phase === 'paused' || state.phase === 'complete' || Boolean(state.pending || state.pendingReaction);
  controls.push(bound(game, scope, context, { kind: 'concentration-form', action: 'start', expectedRevision: state.revision, actorId: actor.id, characterVersion: actor.characterVersion, effectIds: state.effects.map(effect => effect.id) }, 'Review source for character', 'form', blocked), HOME, MORE);
  return screen('Record reviewed source · Host', `Character ${index + 1}/${actors.length}\n${body}\n\nRecord an ongoing source whose casting, costs, and effects have already been reviewed. This records concentration; it does not cast a spell or spend a spell slot. A new source replaces this character’s previous concentration and removes its old bound effects.${blocked ? '\n\nRecording is unavailable while play is paused, complete, or awaiting a decision.' : ''}`, controls);
}
function modal(id, action) {
  const fields = action === 'start' ? [
    { id: 'sourceLabel', label: 'Exact reviewed source', max: 120 },
    { id: 'effectIds', label: 'Bound effect IDs, comma separated (optional)', max: 4000, optional: true },
    { id: 'reason', label: 'Review reason: source, costs and effects', max: 300 },
  ] : [{ id: 'reason', label: 'Why the responder or source is now ineligible', max: 300 }];
  return { type: 9, data: { title: action === 'start' ? 'Record reviewed concentration' : 'Review concentration recovery', custom_id: `rpf:${id}:submit`, components: fields.map(item => ({ type: 18, label: item.label, component: { type: 4, custom_id: item.id, style: item.id === 'reason' ? 2 : 1, required: !item.optional, min_length: item.optional ? 0 : 1, max_length: item.max } })) } };
}
function readForm(components, action) {
  const limits = action === 'start' ? { sourceLabel: 120, effectIds: 4000, reason: 300 } : { reason: 300 };
  const values = Object.create(null);
  if (!Array.isArray(components) || components.length > Object.keys(limits).length) invalid('Open the review form again.');
  for (const wrapper of components) {
    const fields = wrapper?.type === 18 ? [wrapper.component] : wrapper?.type === 1 && Array.isArray(wrapper.components) ? wrapper.components : [];
    if (!fields.length) invalid('Open the review form again.');
    for (const item of fields) {
      if (item?.type !== 4 || !Object.hasOwn(limits, item.custom_id) || Object.hasOwn(values, item.custom_id) || typeof item.value !== 'string' || item.value.length > limits[item.custom_id]) invalid('The review form contains an invalid field.');
      values[item.custom_id] = item.value.trim();
    }
  }
  if (!values.reason || (action === 'start' && !values.sourceLabel)) invalid('Enter the exact reviewed source and a review reason.');
  if (action === 'start') {
    values.effectIds = values.effectIds ? values.effectIds.split(',').map(value => value.trim()) : [];
    if (values.effectIds.length > 128 || new Set(values.effectIds).size !== values.effectIds.length || values.effectIds.some(value => !/^[A-Za-z0-9_-]{1,96}$/.test(value))) invalid('Use unique exact effect IDs from the review card, separated by commas.');
  }
  return values;
}
function assertForm(state, record) {
  if (state.role !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can review concentration registration or recovery.');
  if (state.phase === 'paused') throw new GameError('PAUSED', 'Resume play before confirming a concentration change.');
  if (record.action === 'start') {
    if (state.phase === 'complete' || state.pending || state.pendingReaction) throw new GameError('PENDING', 'Complete the waiting decisions before recording a reviewed source.');
    if (!state.registrationActors.some(actor => actor.id === record.actorId && actor.characterVersion === record.characterVersion)) stale();
  } else if (record.action !== 'refresh' || !state.pending?.canRefresh || state.pending.id !== record.pendingId) stale();
}
function confirmationCard(game, scope, context, record) {
  const input = record.input, controls = [];
  const fields = [field('Action', input.action === 'start' ? 'Record reviewed source' : 'Clear ineligible interruption'), field('Scene revision', input.expectedRevision)];
  if (input.action === 'start') fields.push(field('Character ID', input.actorId), field('Character version', input.characterVersion), field('Exact reviewed source', input.sourceLabel), field('Bound effect IDs', joined(input.effectIds)));
  else fields.push(field('Pending concentration', input.pendingId));
  fields.push(field('Review reason', input.reason));
  const body = pageFields(game, scope, context, [{ title: 'Review before confirming', fields }], record, controls);
  controls.push(button(`rpf:${record.decisionId}:resolve`, input.action === 'start' ? 'Confirm reviewed source' : 'Confirm reviewed recovery', 1), HOME, MORE);
  return screen('Confirm concentration review · Host', `${body}\n\nConfirm only after reviewing these exact details. Recording replaces any existing concentration; recovery clears only an interruption whose responder or source is no longer eligible. Retrying this same confirmation reuses the saved request.`, controls);
}
function receiptGroups(receipt) {
  const result = receipt.result;
  const fields = [field('Saved request', receipt.requestId), field('Scene revision', receipt.revision)];
  for (const [key, label] of [['type', 'Saved outcome'], ['actorId', 'Character ID'], ['concentrationId', 'Concentration record'], ['sourceLabel', 'Source'], ['damageTaken', 'Damage taken'], ['dc', 'Constitution save DC'], ['mode', 'Dice mode'], ['kept', 'Kept die'], ['modifier', 'Save modifier'], ['total', 'Save total'], ['reason', 'Review reason']]) if (result[key] !== undefined) fields.push(field(label, result[key]));
  if (result.dice) fields.push(field('Dice rolled', joined(result.dice)));
  if (result.success !== undefined) fields.push(field('Outcome', result.success ? 'Concentration maintained' : 'Concentration ended'));
  if (result.effectIds) fields.push(field('Bound effect IDs', joined(result.effectIds)));
  if (result.removedEffectIds) fields.push(field('Removed effect IDs', joined(result.removedEffectIds)));
  fields.push(...profileFields(result.profile));
  return { title: 'Saved concentration result', fields };
}
function resultsCard(game, scope, context, record = {}) {
  const state = game.concentration(scope), ids = record.requestIds ?? state.recentResults.map(receipt => receipt.requestId);
  const receipts = ids.map(id => state.recentResults.find(receipt => receipt.requestId === id)).filter(Boolean);
  if (!receipts.length) return screen('Your concentration rolls · Only you', 'No saved concentration rolls are available for your characters. Reading here never rerolls dice.', [HOME, MORE]);
  const controls = [], body = pageFields(game, scope, context, receipts.map(receiptGroups), { kind: 'concentration-results', requestIds: ids, page: record.page ?? 0 }, controls);
  controls.push(RESULTS, HOME, MORE);
  return screen('Your concentration rolls · Only you', `${body}\n\nSaved results only. Reading and paging never repeat a save or apply damage.`, controls);
}

/** All gameplay commands use a durable owner, campaign, guild and channel binding. */
export function createConcentrationHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpf:')) return false;
    let acknowledged = false, retry;
    const respond = async payload => { await transport.respond(interaction.id, interaction.token, payload); acknowledged = true; };
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      game.member(scope);
      if (![3, 5].includes(interaction.type)) stale();
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      const match = /^rpf:([a-f0-9]{24}):(page|resolve|form|submit)$/.exec(customId);
      if (match?.[2] === 'form') {
        if (interaction.type !== 3) stale();
        const record = game.control(scope, context, match[1]);
        if (record.kind !== 'concentration-form') stale();
        assertForm(current(game, scope, record), record);
        const formId = game.createControl(scope, context, { ...record, kind: 'concentration-form-submit' });
        await respond(modal(formId, record.action));
        return true;
      }
      await respond({ type: 5, data: { flags: 64 } });
      game.member(scope);
      if (customId === 'rpf:home' && interaction.type === 3) await deliver(homeCard(game, scope, context));
      else if (customId === 'rpf:actors' && interaction.type === 3) await deliver(actorsCard(game, scope, context));
      else if (customId === 'rpf:register' && interaction.type === 3) await deliver(registrationCard(game, scope, context));
      else if (customId === 'rpf:results' && interaction.type === 3) await deliver(resultsCard(game, scope, context));
      else {
        if (!match) stale();
        const record = game.control(scope, context, match[1]);
        if (match[2] === 'resolve' && interaction.type === 3) {
          if (record.kind !== 'concentration-decision') stale();
          retry = button(customId, 'Retry same confirmation', 1);
          const receipt = game.resolveConcentration(scope, { ...record.input, requestId: `discord-concentration-${match[1]}` });
          await deliver(screen('Concentration decision saved · Only you', `Saved at scene revision ${receipt.revision}. Open Current concentration for any next required decision, or Your concentration rolls for the completed save.\n\nRetrying this same confirmation reuses its saved request.`, [HOME, RESULTS, MORE]));
        } else if (match[2] === 'submit' && interaction.type === 5) {
          if (record.kind !== 'concentration-form-submit') stale();
          const state = current(game, scope, record);
          assertForm(state, record);
          const values = readForm(interaction.data.components, record.action);
          if (record.action === 'start' && values.effectIds.some(id => !record.effectIds.includes(id) || !state.effects.some(effect => effect.id === id))) invalid('Choose only current unbound effect IDs from the review card.');
          const input = { action: record.action, expectedRevision: record.expectedRevision, reviewed: true, reason: values.reason,
            ...(record.action === 'start' ? { actorId: record.actorId, characterVersion: record.characterVersion, sourceLabel: values.sourceLabel, effectIds: values.effectIds } : { pendingId: record.pendingId }) };
          const decisionId = game.createControl(scope, context, { kind: 'concentration-decision', input });
          await deliver(confirmationCard(game, scope, context, { kind: 'concentration-confirmation', input, decisionId }));
        } else if (match[2] === 'page' && interaction.type === 3) {
          if (record.kind === 'concentration-home') await deliver(homeCard(game, scope, context, record));
          else if (record.kind === 'concentration-actors') await deliver(actorsCard(game, scope, context, record));
          else if (record.kind === 'concentration-registration') await deliver(registrationCard(game, scope, context, record));
          else if (record.kind === 'concentration-confirmation') await deliver(confirmationCard(game, scope, context, record));
          else if (record.kind === 'concentration-results') await deliver(resultsCard(game, scope, context, record));
          else stale();
        } else stale();
      }
    } catch (error) {
      log({ outcome: 'concentration_interaction_failed', code: error?.code || 'INTERNAL' });
      const message = error instanceof GameError ? error.message : 'The request could not be completed. If you confirmed a decision, retry that same confirmation or check your saved concentration rolls before choosing again.';
      const data = screen('Concentration · Only you', safeText(message), [...(retry ? [retry] : []), HOME, RESULTS, MORE]);
      try { if (acknowledged) await deliver(data); else await respond({ type: 4, data: { ...data, flags: 32768 | 64 } }); }
      catch { log({ outcome: 'concentration_delivery_failed' }); }
    }
    return true;
  };
}
