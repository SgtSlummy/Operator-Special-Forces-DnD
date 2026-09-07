import { GameError } from '../game/store.mjs';
import { authenticateInteraction } from './import-adapter.mjs';
import { safeText, screen } from './import-ui.mjs';
import { informationPages } from './companion-adapter.mjs';
import { worldPageCard } from './world-information.mjs';

export const WORLD_TIME_PREFIX = 'rwt:';
export const WORLD_TIME_ENTRY = { type: 2, custom_id: `${WORLD_TIME_PREFIX}home`, label: 'World time', style: 2 };
const MISSION = { type: 2, custom_id: 'rpw:home', label: 'Mission desk', style: 2 };
const button = (id, action, label, disabled = false, style = 2) => ({ type: 2, custom_id: `${WORLD_TIME_PREFIX}${id}:${action}`, label, disabled, style });
const stale = () => { throw new GameError('STALE', 'Open World time again for the current calendar and reviewed choices.'); };
const invalid = message => { throw new GameError('INVALID', message); };
const names = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
const text = value => value === null || value === undefined ? 'None' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
const describe = value => Array.isArray(value) ? value.map(describe).join('\n') : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${names(key)}: ${describe(item)}`).join('\n') : text(value);
const rows = (title, entries, render) => ({ title, fields: entries.length ? entries.map(render) : [{ label: title, value: 'None disclosed.' }] });
const pages = groups => informationPages(groups);
function revisions(view) {
  if (![view.gameRevision, view.worldRevision, view.timeRevision].every(Number.isSafeInteger)) stale();
  return { expectedGameRevision: view.gameRevision, expectedWorldRevision: view.worldRevision, expectedTimeRevision: view.timeRevision };
}
function current(game, scope, record) {
  const view = game.worldTime(scope);
  const expected = revisions(view);
  if (record && Object.keys(expected).some(key => record[key] !== expected[key])) stale();
  return view;
}
function host(view, writable = true) {
  if (view.role !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can review changes to world time.');
  if (!view.configured) throw new GameError('UNCONFIGURED', 'Install the campaign’s reviewed calendar and world-time definitions first.');
  if (writable && !view.canAdvance) throw new GameError(view.phase === 'paused' ? 'PAUSED' : 'PHASE', view.blockedReason || 'A world-time change is not available now.');
}
function calendarGroup(view) {
  return { title: view.calendar.label, fields: [
    { label: 'Calendar', value: `Day ${view.calendar.day} · ${view.calendar.tickWithinDay} ${view.calendar.unitLabel} within this day` },
    { label: 'Recorded time', value: `${view.calendar.tick} ${view.calendar.unitLabel} · ${view.calendar.ticksPerDay} per day` },
    { label: 'Play', value: view.phase === 'paused' ? 'Paused' : names(view.phase) },
    ...(view.blockedReason ? [{ label: 'Time changes', value: view.blockedReason }] : []),
  ] };
}
function eventGroups(events, unit) {
  return rows('Recorded timeline', events, event => ({
    label: `${event.tick} ${unit} · ${names(event.kind)}`,
    value: [event.summary,
      ...(event.changes?.length ? [`Changes:\n${event.changes.map(change => `${change.label}: ${describe(change.before)} → ${describe(change.after)}`).join('\n')}`] : []),
      ...(event.evidence?.length ? [`Reviewed evidence:\n${describe(event.evidence)}`] : []),
      ...(event.reviewReason ? [`Review reason: ${event.reviewReason}`] : []),
    ].join('\n\n'),
  }));
}
function disclosedGroups(view) {
  const entityLabel = id => view.entities.find(entity => entity.id === id)?.label ?? id;
  const factLabel = id => view.facts.find(fact => fact.id === id)?.label ?? id;
  const opportunityLabel = id => view.opportunities.find(option => option.id === id)?.title ?? id;
  const provenance = id => id ? `\nRecorded event: ${view.events.find(event => event.id === id)?.summary ?? id}` : '';
  return [calendarGroup(view),
    rows('Known people and places', view.entities, item => ({ label: item.label, value: names(item.kind) })),
    rows('Disclosed facts', view.facts, item => ({ label: `${entityLabel(item.entityId)} · ${item.label}`, value: `${names(item.kind)}: ${describe(item.value)}${provenance(item.sourceEventId)}` })),
    rows('Disclosed knowledge', view.knowledge, item => ({ label: `${entityLabel(item.subjectId)} · ${factLabel(item.factId)}`, value: `${names(item.status)}${provenance(item.sourceEventId)}` })),
    rows('Opportunities', view.opportunities, item => ({ label: item.title, value: `${names(item.status)}${provenance(item.sourceEventId)}` })),
    rows('Deadlines', view.deadlines, item => ({ label: item.label, value: `${opportunityLabel(item.opportunityId)}\nAt ${item.atTick} ${view.calendar.unitLabel} · ${names(item.status)}${provenance(item.sourceEventId)}` })),
    rows('World clocks', view.clocks, item => ({ label: item.label, value: `${item.value}/${item.maximum} · ${names(item.status)}${provenance(item.sourceEventId)}` })),
    eventGroups(view.events, view.calendar.unitLabel),
  ];
}
function pageCard(game, scope, context, record, title, groups, controls = []) {
  return worldPageCard({ game, scope, context, prefix: WORLD_TIME_PREFIX.slice(0, -1), record, title, pages: pages(groups), controls: [...controls, WORLD_TIME_ENTRY, MISSION] });
}
function homeCard(game, scope, context, record) {
  const view = current(game, scope, record);
  if (!view.configured) return screen('World time · Only you', 'This campaign has no installed reviewed calendar yet. The host must prepare its world-time definitions before time can advance.', [WORLD_TIME_ENTRY, MISSION]);
  const bound = { kind: 'world-time-read', ...revisions(view), page: record?.page ?? 0 };
  const controls = [];
  if (view.role === 'host') {
    const form = game.createControl(scope, context, { kind: 'world-time-form', form: 'advance', ...revisions(view) });
    const decisions = game.createControl(scope, context, { kind: 'world-time-decisions', index: 0, page: 0, ...revisions(view) });
    controls.push(button(form, 'form', 'Review time advance', !view.canAdvance), button(decisions, 'choose', 'Reviewed world decisions', !view.decisionOptions?.length));
  }
  return pageCard(game, scope, context, bound, 'World time · Only you', disclosedGroups(view), controls);
}
function decisionGroups(option, reason) {
  return [{ title: 'Reviewed world decision', fields: [
    { label: 'Choice', value: option.label }, { label: 'Summary', value: option.summary },
    { label: 'Availability', value: option.available ? 'Available' : option.unavailableReason || 'Unavailable' },
    ...(reason ? [{ label: 'Your review reason', value: reason }] : []),
  ] }, rows('Configured consequences', option.consequences, change => ({ label: change.label, value: `${describe(change.before)} → ${describe(change.after)}` })),
  { title: 'Reviewed evidence', fields: [{ label: 'Evidence', value: describe(option.evidence) }] }];
}
function decisionsCard(game, scope, context, record) {
  const view = current(game, scope, record); host(view, false);
  const options = view.decisionOptions ?? [];
  if (!options.length) return screen('Reviewed world decisions · Only you', 'No reviewed decisions are installed for this campaign.', [WORLD_TIME_ENTRY, MISSION]);
  const index = record.index ?? 0, option = options[index];
  if (!option) stale();
  const bound = { kind: 'world-time-decisions', ...revisions(view), index, page: record.page ?? 0 };
  const choice = (next, label) => button(game.createControl(scope, context, { ...bound, index: next, page: 0 }), 'choose', label, next < 0 || next >= options.length);
  const form = game.createControl(scope, context, { kind: 'world-time-form', form: 'decision', decisionId: option.id, ...revisions(view) });
  return pageCard(game, scope, context, bound, `World decision ${index + 1}/${options.length} · Only you`, decisionGroups(option), [choice(index - 1, 'Previous decision'), choice(index + 1, 'Next decision'), button(form, 'form', 'Review this decision', !view.canAdvance || !option.available)]);
}
function reviewGroups(record, view) {
  if (record.form === 'decision') return [...decisionGroups(record.option, record.input.reason), { title: 'Confirming this decision', fields: [{ label: 'Effect', value: 'Confirm the installed reviewed consequences shown here. Retrying this same confirmation recovers its saved result.' }] }];
  const preview = record.preview;
  return [{ title: 'Review time advance', fields: [
    { label: 'From', value: `${preview.fromTick} ${preview.calendar.unitLabel}` },
    { label: 'To', value: `${preview.targetTick} ${preview.calendar.unitLabel}` },
    { label: 'Time advancing', value: `${preview.targetTick - preview.fromTick} ${preview.calendar.unitLabel}` },
    { label: 'Review reason', value: preview.reason },
    { label: 'Confirmation', value: 'The exact saved preview below will be applied. Reading this preview does not advance time. Retry the same confirmation if its response is lost.' },
  ] }, eventGroups(preview.events, preview.calendar.unitLabel ?? view.calendar.unitLabel)];
}
function reviewCard(game, scope, context, record) {
  const view = current(game, scope, record); host(view);
  const confirm = record.confirmId ?? game.createControl(scope, context, { kind: 'world-time-confirm', form: record.form, input: record.input });
  return pageCard(game, scope, context, { ...record, confirmId: confirm }, 'Confirm world change · Only you', reviewGroups(record, view), [button(confirm, 'confirm', record.form === 'advance' ? 'Confirm this time advance' : 'Confirm this decision', false, 1)]);
}
function modal(id, record, view) {
  const fields = record.form === 'advance' ? [
    { id: 'increment', label: `Whole ${view.calendar.unitLabel} to advance`.slice(0, 45), style: 1, max: 16 },
    { id: 'reason', label: 'Reason for this time advance', style: 2, max: 300 },
  ] : [{ id: 'reason', label: 'Reason for this reviewed decision', style: 2, max: 300 }];
  return { type: 9, data: { custom_id: `${WORLD_TIME_PREFIX}${id}:submit`, title: record.form === 'advance' ? 'Review world time' : 'Review world decision', components: fields.map(field => ({ type: 18, label: field.label, component: { type: 4, custom_id: field.id, style: field.style, required: true, min_length: 1, max_length: field.max } })) } };
}
function readForm(components, form) {
  const limits = form === 'advance' ? { increment: 16, reason: 300 } : { reason: 300 }, values = Object.create(null);
  if (!Array.isArray(components) || !components.length || components.length > Object.keys(limits).length) invalid('Complete the current review form.');
  for (const wrapper of components) {
    const fields = wrapper?.type === 18 ? [wrapper.component] : wrapper?.type === 1 && Array.isArray(wrapper.components) ? wrapper.components : [];
    if (!fields.length) invalid('Complete the current review form.');
    for (const field of fields) {
      if (field?.type !== 4 || !Object.hasOwn(limits, field.custom_id) || Object.hasOwn(values, field.custom_id) || typeof field.value !== 'string' || field.value.length > limits[field.custom_id]) invalid('The review form contains an invalid field.');
      values[field.custom_id] = field.value.trim();
    }
  }
  if (Object.keys(limits).some(key => !values[key])) invalid('Complete every review field.');
  if (form === 'advance' && (!/^[1-9][0-9]*$/.test(values.increment) || !Number.isSafeInteger(Number(values.increment)))) invalid('Enter a positive whole number of the configured time units.');
  return values;
}
function selected(view, id) {
  const option = view.decisionOptions?.find(option => option.id === id);
  if (!option?.available) throw new GameError('STALE', option?.unavailableReason || 'Review the current available world decisions.');
  return option;
}
function savedCard(game, scope, context, receipt) {
  return pageCard(game, scope, context, { kind: 'world-time-receipt', receipt, page: 0 }, 'World change saved · Only you', [
    { title: 'Saved result', fields: [{ label: 'Recorded time', value: `${receipt.calendar.tick} ${receipt.calendar.unitLabel}` }, { label: 'Confirmation', value: 'This decision is saved. Retrying its original confirmation returns this same result.' }] },
    eventGroups(receipt.events, receipt.calendar.unitLabel),
  ]);
}
const errorMessages = {
  INVALID: 'Complete the current review form using whole time units and a review reason.',
  UNAUTHORIZED: 'This control is not available to your player. Open World time for your current access.',
  STALE: 'The scene or calendar changed. Open World time and review the current choice again.',
  CONFLICT: 'That saved request describes another choice. Open the current review before choosing again.',
  PAUSED: 'Play is paused. The calendar remains readable; resume play before reviewing a change.',
  PENDING: 'Resolve the current game interruption before reviewing a world-time change.',
  PHASE: 'World time cannot advance in the current stage of play. Open the mission desk for the current activity.',
  REVIEW: 'The host must review this world-time definition or choice before it can be applied.',
  UNCONFIGURED: 'The host must install this campaign’s reviewed calendar and world-time definitions first.',
  STATE: 'The saved world-time state needs host review before this request can continue.',
  LIMIT: 'This change exceeds the reviewed world-time limits. Review a smaller advance or ask the host to review the configuration.',
  NOT_FOUND: 'This saved choice is no longer available. Open World time for the current choices.',
};

/** Discord confirms the same scoped previews and immutable receipts as the browser. */
export function createWorldTimeHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith(WORLD_TIME_PREFIX)) return false;
    let acknowledged = false, retry;
    const respond = async payload => { await transport.respond(interaction.id, interaction.token, payload); acknowledged = true; };
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config); game.member(scope);
      if (![3, 5].includes(interaction.type)) stale();
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      const match = /^rwt:([a-f0-9]{24}):(page|choose|form|submit|confirm)$/.exec(customId);
      if (match?.[2] === 'form') {
        if (interaction.type !== 3) stale();
        const record = game.control(scope, context, match[1]);
        if (record.kind !== 'world-time-form') stale();
        const view = current(game, scope, record); host(view);
        if (record.form === 'decision') selected(view, record.decisionId);
        const id = game.createControl(scope, context, { ...record, kind: 'world-time-form-submit' });
        await respond(modal(id, record, view)); return true;
      }
      await respond({ type: 5, data: { flags: 64 } });
      game.member(scope);
      if (customId === `${WORLD_TIME_PREFIX}home` && interaction.type === 3) { await deliver(homeCard(game, scope, context)); return true; }
      if (!match) stale();
      const record = game.control(scope, context, match[1]), action = match[2];
      if (action === 'confirm' && interaction.type === 3) {
        if (record.kind !== 'world-time-confirm' || !['advance', 'decision'].includes(record.form)) stale();
        if (game.member(scope) !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can confirm this reviewed world change.');
        retry = { type: 2, custom_id: customId, label: 'Retry same confirmation', style: 1 };
        const input = { ...record.input, requestId: `discord-time-${match[1]}` };
        const receipt = record.form === 'advance' ? game.advanceWorldTime(scope, input) : game.recordWorldTimeDecision(scope, input);
        await deliver(savedCard(game, scope, context, receipt)); return true;
      }
      if (action === 'submit' && interaction.type === 5) {
        if (record.kind !== 'world-time-form-submit') stale();
        const view = current(game, scope, record); host(view);
        const values = readForm(interaction.data.components, record.form);
        const common = { ...revisions(view), reviewed: true };
        let review;
        if (record.form === 'advance') {
          const targetTick = view.calendar.tick + Number(values.increment);
          if (!Number.isSafeInteger(targetTick)) invalid('This time advance exceeds the supported range.');
          const preview = game.previewWorldTime(scope, { ...common, requestId: `discord-time-preview-${match[1]}`, targetTick, reason: values.reason });
          review = { kind: 'world-time-review', form: 'advance', ...revisions(view), input: { ...common, previewId: preview.previewId }, preview, page: 0 };
        } else if (record.form === 'decision') {
          const option = selected(view, record.decisionId);
          review = { kind: 'world-time-review', form: 'decision', ...revisions(view), input: { ...common, decisionId: option.id, reason: values.reason }, option, page: 0 };
        } else stale();
        await deliver(reviewCard(game, scope, context, review)); return true;
      }
      if (interaction.type === 3 && action === 'choose' && record.kind === 'world-time-decisions') { await deliver(decisionsCard(game, scope, context, record)); return true; }
      if (interaction.type === 3 && action === 'page') {
        if (record.kind === 'world-time-read') await deliver(homeCard(game, scope, context, record));
        else if (record.kind === 'world-time-decisions') await deliver(decisionsCard(game, scope, context, record));
        else if (record.kind === 'world-time-review') await deliver(reviewCard(game, scope, context, record));
        else if (record.kind === 'world-time-receipt') {
          if (game.member(scope) !== 'host') throw new GameError('UNAUTHORIZED', 'Only the host can read this saved review.');
          const receipt = record.receipt;
          await deliver(pageCard(game, scope, context, record, 'World change saved · Only you', [{ title: 'Saved result', fields: [{ label: 'Recorded time', value: `${receipt.calendar.tick} ${receipt.calendar.unitLabel}` }] }, eventGroups(receipt.events, receipt.calendar.unitLabel)]));
        } else stale();
        return true;
      }
      stale();
    } catch (error) {
      const known = Object.hasOwn(errorMessages, error?.code ?? '');
      log({ outcome: 'world_time_interaction_failed', code: known ? error.code : 'INTERNAL' });
      const message = known ? errorMessages[error.code] : 'This request could not finish. If you confirmed a change, retry that same confirmation to recover its saved result.';
      const data = screen('World time · Only you', safeText(message).slice(0, 2700), [...(retry ? [retry] : []), WORLD_TIME_ENTRY, MISSION]);
      try { if (acknowledged) await deliver(data); else await respond({ type: 4, data }); }
      catch { log({ outcome: 'world_time_delivery_failed' }); }
    }
    return true;
  };
}
