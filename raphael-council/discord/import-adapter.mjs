import { renderModal, readModal, parseId, actionFor } from './deck.mjs';
import { heroScreen, jobScreen, savedScreen, screen } from './import-ui.mjs';
import { ImportError } from '../characters/store.mjs';
import { emptyDraft, addEvidence, correctDraft, finishDraft } from '../characters/model.mjs';

export function authenticateInteraction(interaction, config) {
  const member = interaction.member;
  const owner = member?.user?.id;
  if (interaction.guild_id !== config.guildId || interaction.channel_id !== config.channelId || !owner || member.user.bot ||
    !Array.isArray(member.roles) || !(config.playerIds.includes(owner) || (config.playerRoleId && member.roles.includes(config.playerRoleId)))) {
    throw new ImportError('This character desk is only available to this campaign’s current players. Ask the host to add you to its roster.');
  }
  return { owner, campaign: config.campaignId };
}
function parseRoute(customId) {
  const match = /^rpi:1:([a-f0-9]{24}):([a-z]+):(\d{1,4})$/.exec(customId);
  if (!match || Number(match[3]) > 999) throw new ImportError('Invalid character control. Open My Hero again.');
  return { viewId: match[1], action: match[2], page: Number(match[3]) };
}
const HOME = { type: 2, custom_id: 'rpi:home', label: 'My Hero', style: 2 };
export function createImportHandler({ store, service, config, transport, log = () => {} }) {
  return async function handle(interaction) {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !(customId.startsWith('rpi:') || customId.startsWith('rph:'))) return false;
    let acknowledged = false;
    const respond = async payload => {
      await transport.respond(interaction.id, interaction.token, payload);
      acknowledged = true;
    };
    const reply = data => respond({ type: 4, data });
    const defer = () => respond({ type: 5, data: { flags: 64 } });
    const edit = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      if (![3, 5].includes(interaction.type)) throw new ImportError('Unsupported character interaction.');
      if (customId === 'rpi:home' && interaction.type === 3) { await reply(heroScreen(store, scope)); return true; }
      // Existing deck buttons can enter the importer. Actual game commands remain
      // outside this adapter and are never acknowledged as successful mutations.
      if (customId.startsWith('rph:')) {
        const legacy = parseId(customId);
        const action = actionFor(customId);
        if (interaction.type === 3 && (action.target === 'hero' || action.target === 'review_import' || action.target === 'importpdf')) {
          await reply(heroScreen(store, scope)); return true;
        }
        if (legacy.card === 'home' && action.target === 'join' && interaction.type === 3) { await reply(heroScreen(store, scope)); return true; }
        throw new ImportError('This local bot currently handles character imports. Adventure actions need the game-engine adapter.');
      }
      const route = parseRoute(customId);
      const view = store.resolveView(route.viewId, scope);
      const job = view.job_id ? store.job(view.job_id, scope) : null;
      const stale = job ? job.revision !== view.revision : (store.character(scope)?.revision ?? 0) !== view.revision;
      if (route.action === 'home' && interaction.type === 3) { await reply(heroScreen(store, scope)); return true; }
      if (stale && !['refresh', 'resume'].includes(route.action) && !(route.action === 'approve' && job?.status === 'saved')) throw new ImportError('This card is stale. Open My Hero or refresh the import.');
      if (interaction.type === 3) {
        if (['upload', 'manual', 'correct'].includes(route.action)) {
          if (route.action === 'correct') { if (!job) throw new ImportError('Open your import first.'); store.assertReview(job, view.revision); }
          else if (view.kind !== 'hero') throw new ImportError('Open My Hero first.');
          const modalId = route.action === 'upload' ? 'importpdf' : route.action === 'correct' ? 'importcorrect' : 'hero';
          const payload = renderModal(modalId, { session: 'import', view: 'form', revision: 0 });
          // A fresh immutable binding prevents replaying a different form type.
          const formView = store.view(scope, { jobId: job?.id ?? null, revision: view.revision, kind: modalId });
          payload.data.custom_id = `rpi:1:${formView}:submit:${route.page}`;
          await respond(payload); return true;
        }
        if (route.action === 'character' && view.kind === 'hero') { await reply(savedScreen(store, scope, route.page)); return true; }
        if (route.action === 'resume' && view.kind === 'hero') {
          const latest = store.latest(scope);
          await reply(latest ? jobScreen(store, scope, latest.id) : heroScreen(store, scope)); return true;
        }
        if (!job || view.kind !== 'job') throw new ImportError('Invalid import action. Open My Hero again.');
        if (['page', 'refresh'].includes(route.action)) { await reply(jobScreen(store, scope, job.id, route.page)); return true; }
        if (route.action === 'approve') { await defer(); await service.approve(job.id, scope, view.revision); await edit(jobScreen(store, scope, job.id)); return true; }
        if (route.action === 'cancel') { await defer(); await service.cancel(job.id, scope, view.revision); await edit(jobScreen(store, scope, job.id)); return true; }
      } else if (route.action === 'submit') {
        if (!['importpdf', 'importcorrect', 'hero'].includes(view.kind)) throw new ImportError('Invalid form binding.');
        const values = readModal(view.kind, interaction.data.components);
        await defer();
        if (view.kind === 'importpdf') {
          const uploaded = await service.submit(scope, interaction.id, values.pdf, interaction.data.resolved?.attachments, values.edition);
          await edit(jobScreen(store, scope, uploaded.id));
        } else if (view.kind === 'importcorrect') {
          if (!job) throw new ImportError('Open your import first.');
          const result = store.correct(job.id, scope, view.revision, values.correction);
          await edit(result.changed ? jobScreen(store, scope, job.id, route.page) : screen('Please clarify · No changes made', result.clarification, [HOME]));
        } else {
          const manual = store.createJob(scope, interaction.id, 'manual character entry');
          if (!manual.duplicate) {
            let draft = emptyDraft();
            addEvidence(draft, 'notes', values.concept, { method: 'manual', page: null });
            if (values.rules) {
              const correction = correctDraft(draft, values.rules);
              if (correction.changed) draft = correction.draft;
              else draft.unknown.push({ page: null, method: 'manual', text: values.rules });
            }
            store.ready(manual.id, scope, finishDraft(draft), null);
          }
          await edit(jobScreen(store, scope, manual.id));
        }
        return true;
      }
      throw new ImportError('Invalid character control. Open My Hero again.');
    } catch (error) {
      log({ outcome: 'interaction_rejected', expected: error instanceof ImportError });
      const data = screen('Raphael · Character desk', error instanceof ImportError ? error.message : 'This request could not be completed. No new character changes were applied. Open My Hero and try again.', [HOME]);
      try { if (acknowledged) await edit(data); else await reply(data); } catch { log({ outcome: 'discord_response_failed' }); }
      return true;
    }
  };
}
