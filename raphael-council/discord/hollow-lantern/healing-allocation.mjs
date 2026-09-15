import { randomUUID } from 'node:crypto';
import { FLAGS } from './components.mjs';

const safe = text => String(text).replace(/@/g, '@\u200b');
class AllocationError extends Error {}
const fail = message => { throw new AllocationError(message); };
export function allocationField(action) {
  return action?.fields?.find(f => f.kind === 'healing-allocation');
}
export function createAllocationDraft(field, scope, revision, expires) {
  if (!Number.isSafeInteger(field.pool) || field.pool < 1 || !Array.isArray(field.choices) || !field.choices.length ||
      field.choices.some(c => typeof c.id !== 'string' || !c.id || typeof c.label !== 'string') ||
      new Set(field.choices.map(c => c.id)).size !== field.choices.length) fail('Healing choices are unavailable. Reopen the panel.');
  return { scope: JSON.stringify([scope.campaignId, scope.userId, scope.actorId ?? '', scope.audience]), revision,
    expires, version: 0, status: 'editing', field: structuredClone(field), entries: [], commandId: randomUUID() };
}
export function checkAllocationDraft(draft, scope, revision, version, now) {
  if (draft.scope !== JSON.stringify([scope.campaignId, scope.userId, scope.actorId ?? '', scope.audience])) fail('This healing draft belongs to another player.');
  if (draft.status !== 'editing') fail('This healing draft is already confirmed or cancelled.');
  if (draft.revision !== revision || draft.expires <= now || draft.version !== version) fail('This healing draft changed or expired. Reopen the panel.');
}
export function setAllocation(draft, targetId, raw) {
  if (!draft.field.choices.some(c => c.id === targetId)) fail('Choose an available healing target.');
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) fail('Enter a positive whole number of HP.');
  const amount = Number(raw.trim());
  if (!Number.isSafeInteger(amount) || amount <= 0) fail('Enter a positive whole number of HP.');
  const entries = draft.entries.some(e => e.targetId === targetId)
    ? draft.entries.map(e => e.targetId === targetId ? { targetId, amount } : e)
    : draft.entries.concat({ targetId, amount });
  if (entries.reduce((n, e) => n + e.amount, 0) > draft.field.pool) fail('That allocation exceeds the available healing. Reduce an amount first.');
  if (JSON.stringify(entries).length > Math.min(draft.field.maxLength ?? 4000, 4000)) fail('Too many targets for this action. Remove a target first.');
  draft.entries = entries; draft.version++;
}

/** Server-side draft only. A returned input is an intention; no healing is applied here. */
export async function handleAllocation({ token, action, scope, view, interaction, tokenStore, send, reject, authorize }) {
  const field = allocationField(action);
  if (!field || action.fields.length !== 1 || scope.audience === 'public') return { handled: await reject('This healing action is unavailable. Reopen your private panel.') };
  let draft = token.healingAllocation?.draft;
  try {
    if (!draft) draft = createAllocationDraft(field, scope, view.revision, token.expires);
    else checkAllocationDraft(draft, scope, view.revision, token.healingAllocation.version, tokenStore.now());
    // Current action availability and eligible target set remain authoritative.
    if (JSON.stringify(draft.field) !== JSON.stringify(field)) fail('Healing choices changed. Reopen the panel.');
    const op = token.healingAllocation?.op ?? 'open';
    const target = token.healingAllocation?.target;
    const lastPage = Math.ceil(field.choices.length / 25) - 1;
    const page = token.healingAllocation?.page === undefined ? 0 : token.healingAllocation.page;
    if (!Number.isSafeInteger(page) || page < 0 || page > lastPage) fail('This target page is unavailable. Reopen the healing panel.');
    const issue = (op, extra = {}) => tokenStore.issue({ ...scope, revision: view.revision, actionId: action.id,
      commandId: draft.commandId, opensModal: op === 'amount', healingAllocation: { draft, version: draft.version, op, page, ...extra } });
    if (op === 'amount' && !interaction.isModalSubmit?.()) {
      const choice = field.choices.find(c => c.id === target);
      if (!choice) fail('Choose an available healing target.');
      if (!await authorize(scope)) return { handled: await reject('Access changed. Reopen the panel.') };
      await interaction.showModal({ title: 'Set healing amount', custom_id: issue('amount', { target }), components: [{ type: 18,
        label: `HP for ${safe(choice.label)}`.slice(0, 45), component: { type: 4, custom_id: 'amount', style: 1, required: true,
          max_length: 16, ...(draft.entries.some(e => e.targetId === target) ? { value: String(draft.entries.find(e => e.targetId === target).amount) } : {}) } }] });
      return { handled: true };
    }
    if (op === 'amount') setAllocation(draft, target, interaction.fields.getTextInputValue('amount'));
    if (op === 'remove') { draft.entries = draft.entries.filter(e => e.targetId !== target); draft.version++; }
    if (op === 'cancel') { draft.status = 'cancelled'; draft.version++; await send({ flags: FLAGS.componentsV2, components: [{ type: 10, content: 'Healing allocation cancelled. No healing was spent.' }], allowedMentions: { parse: [] }, attachments: [] }); return { handled: true }; }
    if (op === 'confirm') {
      if (!draft.entries.length) fail('Add at least one healing target before confirming.');
      draft.status = 'submitted';
      return { input: { [field.id]: JSON.stringify(draft.entries) } };
    }
    const options = field.choices.slice(page * 25, page * 25 + 25).map(c => ({ label: safe(c.label).slice(0, 100), value: issue('amount', { target: c.id }) }));
    const spent = draft.entries.reduce((n, e) => n + e.amount, 0);
    const summary = draft.entries.map(e => `${safe(field.choices.find(c => c.id === e.targetId).label).slice(0, 100)}: ${e.amount} HP`);
    const parts = [{ type: 10, content: `## ${safe(action.label).slice(0, 100)}\nAssign HP privately. Selecting a target opens its amount; selecting it again edits it. Nothing is spent until Confirm healing.\n**Remaining HP: ${field.pool - spent} / ${field.pool}**` }];
    for (let i = 0; i < summary.length; i += 10) parts.push({ type: 10, content: summary.slice(i, i + 10).join('\n').slice(0, 1500) });
    parts.push({ type: 1, components: [{ type: 3, custom_id: tokenStore.issue({ ...scope, revision: view.revision, select: true, opensModal: true }), placeholder: 'Add / edit healing target', options }] });
    const removable = draft.entries.filter(e => field.choices.slice(page * 25, page * 25 + 25).some(c => c.id === e.targetId));
    if (removable.length) parts.push({ type: 1, components: [{ type: 3, custom_id: tokenStore.issue({ ...scope, revision: view.revision, select: true }), placeholder: 'Remove healing target', options: removable.map(e => ({ label: safe(field.choices.find(c => c.id === e.targetId).label).slice(0, 100), value: issue('remove', { target: e.targetId }) })) }] });
    if (field.choices.length > 25) parts.push({ type: 1, components: [{ type: 2, style: 2, label: 'Previous targets', custom_id: issue('page', { page: Math.max(0, page - 1) }), disabled: page === 0 }, { type: 2, style: 2, label: 'Next targets', custom_id: issue('page', { page: Math.min(lastPage, page + 1) }), disabled: (page + 1) * 25 >= field.choices.length }] });
    parts.push({ type: 1, components: [{ type: 2, style: 1, label: 'Confirm healing', custom_id: issue('confirm'), disabled: !draft.entries.length }, { type: 2, style: 2, label: 'Cancel', custom_id: issue('cancel') }] });
    if (!await authorize(scope)) return { handled: await reject('Access changed. Reopen the panel.') };
    await send({ flags: FLAGS.componentsV2, components: parts, allowedMentions: { parse: [] }, attachments: [] });
    return { handled: true };
  } catch (error) { if (!(error instanceof AllocationError)) throw error; return { handled: await reject(error.message) }; }
}
