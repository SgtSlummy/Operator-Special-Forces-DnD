import { authenticateInteraction } from './import-adapter.mjs';
import { actionFor, readModal, renderModal } from './deck.mjs';
import { screen, safeText } from './import-ui.mjs';
import { SceneImageError } from '../images/service.mjs';
import { GameError } from '../game/store.mjs';
import { getReachOptions, assessReach } from '../game/reach.mjs';

const HOME = { type: 2, custom_id: 'rps:home', label: 'Show what I see', style: 1 };
const REACH = { type: 2, custom_id: 'rps:reach', label: 'Distance & reach', style: 2 };
const button = (view, action, label) => ({ type: 2, custom_id: `rps:${view}:${action}`, label, style: 2 });
class ImageInteractionError extends Error {}
const fail = message => { throw new ImageInteractionError(message); };
function route(customId) {
  const match = /^rps:([a-zA-Z0-9_-]{1,64}):(focus|submit|refresh|browser|reachform|reachsubmit)$/.exec(customId);
  if (!match || customId.length > 100) fail('This image control is unavailable. Open Show what I see again.');
  return { viewId: match[1], action: match[2] };
}
function imageAction(customId) {
  if (typeof customId !== 'string') return false;
  if (customId.startsWith('rps:')) return true;
  if (!customId.startsWith('rph:')) return false;
  try { return actionFor(customId).target === 'request_scene_image'; } catch { return false; }
}
const clipped = (value, length = 160) => safeText(String(value ?? '').slice(0, length));
function visibleSubjects(scene) {
  return (scene.subjects ?? []).map(subject => ({ id: subject.id, label: subject.label }));
}
function resolveFocus(value, subjects) {
  if (!value) return 'scene';
  const needle = value.toLocaleLowerCase('en-US');
  const matches = subjects.filter(subject => subject.id === value || subject.label.toLocaleLowerCase('en-US') === needle);
  if (matches.length !== 1) fail('Choose one visible subject from the image card, or leave the field empty for the whole scene. This request does not discover hidden details.');
  return matches[0].id;
}
function reachChoices(options) {
  return { actorIds: options.actors.map(actor => actor.id), targetIds: options.targets.map(target => target.id) };
}
function choiceList(choices, limit, budget = 950) {
  const rows = [];
  for (const choice of choices.slice(0, limit)) {
    const line = `${clipped(choice.label, 45)} — ID: ${clipped(choice.id, 96)}`;
    if ([...rows, line].join('\n').length > budget) break;
    rows.push(line);
  }
  if (choices.length > rows.length) rows.push(`Showing ${rows.length} of ${choices.length}; you can also enter an exact visible name or ID from the current tactical map.`);
  return rows.join('\n') || 'No visible targets. You can still ask about a visible grid square.';
}
function reachCard(service, scope, options) {
  const view = service.createView(scope, { kind: 'reach-options', revision: options.revision, ...reachChoices(options) });
  return screen('Distance & reach · Only you',
    `Current tactical map: ${clipped(options.mapTitle, 100)} · revision ${options.revision}\n` +
    'Ask how far a visible target is, whether your character can move there, and whether their configured weapon reaches it. This uses the current tactical map; an older scene image may show a different moment.\n\n' +
    `Your characters:\n${choiceList(options.actors, 4, 550)}\n\nVisible targets:\n${choiceList(options.targets, 7)}\n\n` +
    'You may enter a visible grid coordinate such as C4 instead of a target. Asking spends no action or movement and works during pauses or another player’s turn.',
    [button(view, 'reachform', 'Ask about distance'), REACH, HOME]);
}
function reachModal(viewId, options) {
  const fields = [
    ...(options.actors.length > 1 ? [{ id: 'actor', label: 'Your character name or ID', placeholder: 'Choose your character from the previous card' }] : []),
    { id: 'target', label: 'Visible target name, ID or grid square', placeholder: 'A visible target from the card, or C4' },
  ];
  return { type: 9, data: { title: 'Distance & reach', custom_id: `rps:${viewId}:reachsubmit`, components: fields.map(field => ({
    type: 18, label: field.label, component: { type: 4, custom_id: field.id, style: 1, required: true, min_length: 1, max_length: 120, placeholder: field.placeholder },
  })) } };
}
function readReachModal(components, needsActor) {
  if (!Array.isArray(components) || components.length > 2) fail('Open Distance & reach again and enter a visible target or grid square.');
  const values = Object.create(null);
  const allowed = needsActor ? ['actor', 'target'] : ['target'];
  for (const wrapper of components) {
    const fields = wrapper?.type === 18 ? [wrapper.component] : wrapper?.type === 1 && Array.isArray(wrapper.components) ? wrapper.components : [];
    if (!fields.length) fail('The distance form is invalid. Open Distance & reach again.');
    for (const field of fields) {
      if (field?.type !== 4 || !allowed.includes(field.custom_id) || Object.hasOwn(values, field.custom_id) || typeof field.value !== 'string' || field.value.length > 120 || !field.value.trim()) fail('The distance form is invalid. Open Distance & reach again.');
      values[field.custom_id] = field.value.trim();
    }
  }
  if (allowed.some(key => !values[key])) fail('Choose your character and a visible target or grid square.');
  return values;
}
function resolveChoice(value, choices, kind) {
  const exactId = choices.find(choice => choice.id === value);
  if (exactId) return exactId.id;
  const normalized = value.toLocaleLowerCase('en-US');
  const matches = choices.filter(choice => choice.label.toLocaleLowerCase('en-US') === normalized);
  if (matches.length !== 1) fail(`Choose one ${kind} by its exact name or ID. If names repeat, use the ID shown on the card.`);
  return matches[0].id;
}
function resolveTarget(value, choices) {
  const hasNamedTarget = choices.some(choice => choice.id === value || choice.label.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'));
  if (!hasNamedTarget && /^[A-Za-z]{1,2}[1-9]\d{0,2}$/.test(value)) return { coordinate: value };
  return { targetId: resolveChoice(value, choices, 'visible target') };
}
function reachFailure(error) {
  return ({ STALE: 'The tactical map changed while this form was open. Open Distance & reach again for current distances.',
    UNAUTHORIZED: 'Distance & reach needs your membership in the current tactical campaign. Ask the host to connect your character.',
    NOT_FOUND: 'The host has not set up a tactical map for this campaign yet.',
    NOT_VISIBLE: 'Choose a target or grid square visible on your current tactical map.',
    INVALID: 'Choose your character and one visible target or grid square from the current tactical map.' })[error.code] || 'Distance & reach is unavailable. Ask the host to check the tactical map and your character profile.';
}
function jobCard(service, scope, job) {
  const view = service.createView(scope, { kind: 'image-job', jobId: job.id });
  let current;
  try { current = service.scene(scope); }
  catch (error) { if (!(error instanceof SceneImageError) || error.code !== 'SCENE_UNAVAILABLE') throw error; }
  const subjects = current ? visibleSubjects(current) : [];
  const labels = subjects.map(subject => clipped(subject.label, 100)).join(', ').slice(0, 1100);
  const status = { queued: 'Your image is queued.', running: 'Your image is being painted.', ready: 'Your image is ready.', failed: 'This image could not be completed.' }[job.status];
  const body = `${status}\n${clipped(job.title, 180)} · ${clipped(job.focusLabel, 120)}\n` +
    `Scene revision ${clipped(job.sceneRevision, 24)}${job.sourceEventId ? ` · Record ${clipped(job.sourceEventId, 96)}` : ''}\n` +
    `${!current ? 'Your current scene is unavailable. This image records an earlier view; the host must update your scene before a new request.\n' : job.stale ? 'The scene has changed since this request. Show what I see will use the current scene.\n' : ''}` +
    `${job.message ? `${clipped(job.message, 360)}\n` : ''}` +
    'This is a free visual reference of your view at request time. It spends no action and advances no time.\n' +
    `${['queued', 'running'].includes(job.status) ? 'You may keep playing. The image will appear here when ready. Refresh remains available if it takes longer.\n' : ''}` +
    `${labels ? `For a closer view, choose Focus on something and enter one of these visible subjects: ${labels}` : 'No individual subjects are available for a closer view yet.'}`;
  return { ...screen('Your view · Only you', body.slice(0, 2700), [HOME, REACH, button(view, 'focus', 'Focus on something'), button(view, 'refresh', 'Refresh'), button(view, 'browser', 'Browser access')]), attachments: [] };
}
async function imageCard(service, scope, job) {
  const data = jobCard(service, scope, job);
  if (job.status !== 'ready') return data;
  const image = await service.image(scope, job.id);
  if (!Buffer.isBuffer(image.bytes) || image.mimeType !== 'image/png' || !/^[a-zA-Z0-9_.-]{1,100}\.png$/.test(image.fileName)) {
    fail('The image could not be attached. Open Show what I see and try again.');
  }
  if (image.bytes.length > 9 * 1024 * 1024) {
    data.components[0].content += '\nThis image is too large for a Discord attachment. Choose Browser access to view it in the browser game.';
    return data;
  }
  data.attachments = [{ id: '0', filename: image.fileName, description: String(job.focusLabel ?? 'Current scene').slice(0, 300) }];
  data.components.splice(1, 0, { type: 12, items: [{ media: { url: `attachment://${image.fileName}` }, description: String(job.focusLabel ?? 'Current scene').slice(0, 300) }] });
  data.files = [{ data: image.bytes, name: image.fileName, contentType: image.mimeType }];
  return data;
}

/** Current membership and owner-bound durable views are checked on every request.
 * Only scene projections and focus IDs reach the service; player prose is never a prompt.
 * There is deliberately no turn, pause, character-action, clock or resource mutation.
 */
export function createImageHandler({ service, game, config, transport, log = () => {}, waitMs = 1200, completionWaitMs = 240000 }) {
  return async function handle(interaction) {
    const customId = interaction.data?.custom_id;
    if (!imageAction(customId)) return false;
    let acknowledged = false;
    const respond = async payload => { await transport.respond(interaction.id, interaction.token, payload); acknowledged = true; };
    const reply = data => respond({ type: 4, data });
    const defer = () => respond({ type: 5, data: { flags: 64 } });
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      let scope;
      try { scope = authenticateInteraction(interaction, config); }
      catch { fail('Images are available to this campaign’s current players in its configured channel. Ask the host to add you to the roster.'); }
      if (![3, 5].includes(interaction.type)) fail('Unsupported image interaction. Open Show what I see again.');
      const reachOptions = () => {
        if (!game) fail('The host has not connected Distance & reach to a tactical campaign yet.');
        const options = getReachOptions(game, scope);
        if (!options.actors.length) fail('Distance & reach needs a character you control on the current tactical map. Ask the host to connect your character.');
        return options;
      };
      if (customId === 'rps:reach' && interaction.type === 3) {
        await reply(reachCard(service, scope, reachOptions())); return true;
      }
      const request = async focusId => {
        await defer();
        let job = await service.requestImage(scope, { requestId: interaction.id, focusId });
        if (['queued', 'running'].includes(job.status)) job = await service.waitForJob(scope, job.id, { timeoutMs: waitMs });
        await edit(await imageCard(service, scope, job));
        if (['queued', 'running'].includes(job.status)) {
          // Keep the original private interaction alive long enough for a normal
          // render, well inside Discord's interaction-token lifetime. This waits
          // on the existing durable job; it never submits another generation.
          job = await service.waitForJob(scope, job.id, { timeoutMs: Math.min(Math.max(completionWaitMs, 0), 240000) });
          if (['ready', 'failed'].includes(job.status)) await edit(await imageCard(service, scope, job));
        }
      };
      // Stable navigation reads the current projection even from an old deck card.
      if ((customId === 'rps:home' || customId.startsWith('rph:')) && interaction.type === 3) { await request('scene'); return true; }
      const parsed = route(customId);
      const view = service.resolveView(scope, parsed.viewId);
      if (parsed.action === 'reachform' || parsed.action === 'reachsubmit') {
        if (view.kind !== (parsed.action === 'reachform' ? 'reach-options' : 'reach-form') || !Array.isArray(view.actorIds) || !Array.isArray(view.targetIds)) fail('This distance form is unavailable. Open Distance & reach again.');
        const options = reachOptions();
        if (options.revision !== view.revision) fail('The tactical map changed while this form was open. Open Distance & reach again for current distances.');
        const actors = options.actors.filter(actor => view.actorIds.includes(actor.id));
        const targets = options.targets.filter(target => view.targetIds.includes(target.id));
        if (parsed.action === 'reachform' && interaction.type === 3) {
          const formId = service.createView(scope, { ...view, kind: 'reach-form' });
          await respond(reachModal(formId, { ...options, actors })); return true;
        }
        if (parsed.action === 'reachsubmit' && interaction.type === 5) {
          const values = readReachModal(interaction.data.components, view.actorIds.length > 1);
          const actorId = actors.length === 1 && view.actorIds.length === 1 ? actors[0].id : resolveChoice(values.actor ?? '', actors, 'character you control');
          const target = resolveTarget(values.target, targets);
          const result = assessReach(game, scope, { expectedRevision: view.revision, actorId, ...target });
          const body = `Current tactical map: ${clipped(options.mapTitle, 100)} · revision ${result.revision}\n` +
            result.summary.map(line => clipped(line, 900)).join('\n').slice(0, 2300) +
            '\n\nThis checks the current tactical map, rather than measuring image pixels. Asking spends no action, movement, resource or game time.';
          await reply(screen('Distance & reach · Only you', body, [REACH, HOME])); return true;
        }
        fail('Open Distance & reach again to ask about the current tactical map.');
      }
      if (interaction.type === 3) {
        if (view.kind !== 'image-job' || typeof view.jobId !== 'string') fail('This image control does not belong to an image card. Open Show what I see again.');
        // Resolve the job as well as the view before any follow-up or access code.
        service.getJob(scope, view.jobId);
        if (parsed.action === 'refresh') {
          await defer();
          await edit(await imageCard(service, scope, service.getJob(scope, view.jobId))); return true;
        }
        if (parsed.action === 'focus') {
          const scene = service.scene(scope);
          const formView = service.createView(scope, { kind: 'image-focus', sceneId: scene.id, sceneRevision: scene.revision, subjects: visibleSubjects(scene) });
          const modal = renderModal('sceneimage', { session: 'images', view: 'form', revision: 0 });
          modal.data.custom_id = `rps:${formView}:submit`;
          await respond(modal); return true;
        }
        if (parsed.action === 'browser') {
          const code = service.issueBrowserAccess(scope);
          await reply(screen('Browser access · Only you', `In the browser game, open Show what I see and enter this private access code:\n\n${clipped(code, 200)}\n\nKeep this code private. It connects the browser to your campaign view.`, [HOME, REACH])); return true;
        }
      } else if (parsed.action === 'submit') {
        if (view.kind !== 'image-focus' || !Array.isArray(view.subjects)) fail('This form was not opened from your image card. Open Show what I see again.');
        let values;
        try { values = readModal('sceneimage', interaction.data.components); }
        catch { fail('The focus field was not valid. Open the focus form and choose a visible subject or leave it empty.'); }
        const scene = service.scene(scope);
        if (scene.id !== view.sceneId || scene.revision !== view.sceneRevision) fail('The scene changed while this form was open. Open Show what I see to request the current view.');
        const focusId = resolveFocus(values.focus ?? '', view.subjects);
        if (focusId !== 'scene' && !visibleSubjects(scene).some(subject => subject.id === focusId)) fail('That subject is no longer visible. Open Show what I see again.');
        await request(focusId); return true;
      }
      fail('This image control is unavailable. Open Show what I see again.');
    } catch (error) {
      const expected = error instanceof ImageInteractionError || error instanceof SceneImageError || error instanceof GameError;
      log({ outcome: 'image_interaction_rejected', expected });
      const data = { ...screen('Your view · Only you', error instanceof GameError ? reachFailure(error) : expected ? clipped(error.message, 1000) : 'This request could not be completed. Open Show what I see and try again.', [HOME, REACH]), attachments: [] };
      try { if (acknowledged) await edit(data); else await reply(data); }
      catch { log({ outcome: 'image_response_failed' }); }
      return true;
    }
  };
}
