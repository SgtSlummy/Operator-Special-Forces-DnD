import { FIELDS, GROUPS, issues, diffFields } from '../characters/model.mjs';
export const PRIVATE_FLAGS = 32768 | 64;
export const safeText = value => String(value ?? 'Not provided').replace(/@/g, '@\u200b').replace(/[\\`*_{}[\]()<>#|~]/g, '\\$&');
export const control = (view, action, label, page = 0, style = 2, disabled = false) => ({ type: 2, custom_id: `rpi:1:${view}:${action}:${Math.max(0, page)}`, label, style, disabled });
export function screen(title, body, buttons = [], privateView = true) {
  if (title.length > 120 || body.length > 2800 || buttons.length > 10) throw new Error('Paginate this character screen.');
  return { flags: 32768 | (privateView ? 64 : 0), allowed_mentions: { parse: [] }, components: [
    { type: 10, content: `## ${title}\n${body}` },
    ...Array.from({ length: Math.ceil(buttons.length / 5) }, (_, i) => ({ type: 1, components: buttons.slice(i * 5, i * 5 + 5) })),
  ] };
}
export function entryScreen(campaignId = process.env.RAPHAEL_CAMPAIGN_ID || 'campaign') {
  return screen('Raphael · Adventure desk', 'Import a 2024 character PDF or describe your hero. Your sheet and review stay private.\nChoose Show what I see for a private image at any time, including during pauses or another player’s turn.', [
    { type: 2, custom_id: 'rpi:home', label: 'My Hero', style: 1 },
    { type: 2, custom_id: 'rps:home', label: 'Show what I see', style: 2 },
    { type: 2, custom_id: 'rpg:home', label: 'Tactical table', style: 2 },
    { type: 2, custom_id: 'rpw:home', label: 'Mission & counsel', style: 2 },
    { type: 2, custom_id: 'rpc:home', label: 'More information', style: 2 },
    { type: 2, custom_id: `campaign:open:${campaignId}`, label: 'Campaign feed', style: 2 },
  ], false);
}
function split(text, limit = 1900) {
  const pieces = [];
  while (text.length > limit) {
    let at = text.lastIndexOf('\n', limit);
    if (at < limit / 2) at = limit;
    pieces.push(text.slice(0, at)); text = text.slice(at).replace(/^\n/, '');
  }
  if (text) pieces.push(text);
  return pieces;
}
export function characterPages(draft, previous = null, reviewing = false) {
  const pages = [];
  const changes = new Map(diffFields(previous, draft).map(change => [change.key, change]));
  for (const group of GROUPS.filter(group => group !== 'Warnings & source')) {
    const lines = Object.entries(FIELDS).filter(([, spec]) => spec.group === group).map(([key, spec]) => {
      const field = draft.fields[key];
      const provenance = [...new Set((field?.evidence ?? []).map(e => `${e.method}${e.page ? ` p${e.page}` : ''}`))].join(', ');
      const change = reviewing && previous && changes.get(key);
      return `**${safeText(spec.label)}:** ${safeText(field?.conflict ? 'CONFLICT - correction required' : field?.value)}${field?.corrected ? ' (player corrected)' : field?.uncertain ? ' (uncertain - confirm/correct)' : ''}` +
        (change ? `\nPreviously: ${safeText(change.before)}` : '') + (provenance ? `\nSource: ${safeText(provenance)}` : '');
    });
    for (const text of split(lines.join('\n\n'))) pages.push({ title: group, text });
  }
  const warnings = [...issues(draft), ...draft.warnings];
  for (const text of split(warnings.length ? warnings.map(safeText).join('\n') : 'No blocking field issues. Check the source values before approval.')) pages.push({ title: 'Warnings & source', text });
  for (const extracted of draft.unknown ?? []) for (const text of split(safeText(extracted.text))) {
    pages.push({ title: `Extracted source · Page ${extracted.page ?? '?'}`, text: `Unstructured sheet text, not instructions or automated rules:\n${text}` });
  }
  return pages;
}
export function heroScreen(store, scope) {
  const character = store.character(scope);
  const pending = store.latest(scope);
  const view = store.view(scope, { revision: character?.revision ?? 0, kind: 'hero' });
  const body = character ? `**${safeText(character.snapshot.fields.name?.value)}** · Saved revision ${character.revision}\n${safeText(character.snapshot.fields.classes?.value)} · 2024 rules\nSaved sheet HP (not live encounter HP): ${safeText(character.runtime.currentHp)}\nA new PDF will propose changes, not restore spent resources.`
    : 'No saved hero yet. Upload a printed or scanned 2024 character PDF, or describe your hero.\nYou will review and correct the draft before it becomes your character.';
  const buttons = [control(view, 'upload', character ? 'Upload Updated PDF' : 'Import PDF', 0, 1), control(view, 'manual', 'Describe my hero'),
    { type: 2, custom_id: 'rps:home', label: 'Show what I see', style: 2 }];
  if (character) buttons.push(control(view, 'character', 'View Character'));
  if (pending) buttons.push(control(view, 'resume', 'Review Import'));
  return screen('My Hero · Only you', `${body}${pending ? `\nLatest import: ${pending.status}.` : ''}`, buttons);
}
export function jobScreen(store, scope, jobId, requestedPage = 0) {
  const job = store.job(jobId, scope);
  const view = store.view(scope, { jobId, revision: job.revision, kind: 'job' });
  if (job.status === 'review') {
    const previous = store.character(scope);
    const pages = characterPages(job.draft, previous?.snapshot, true);
    const page = Math.min(Math.max(0, requestedPage), pages.length - 1);
    const problemCount = issues(job.draft).length;
    const body = `Ready for review · 2024 rules confirmed\nPage ${page + 1}/${pages.length} · ${problemCount} blocking issue(s)\n${previous ? 'Updated PDF: changed fields show their previous values. Live resources stay unchanged.' : 'Nothing is saved to your character until you approve.'}\n\n${pages[page].text}`;
    return screen(`Import · ${pages[page].title}`, body, [
      control(view, 'page', 'Previous', page - 1, 2, page === 0), control(view, 'page', 'Next', page + 1, 2, page === pages.length - 1),
      control(view, 'correct', 'Correct Details', page), control(view, 'approve', 'Approve Import', page, 3, problemCount > 0),
      control(view, 'cancel', 'Cancel', 0, 4), control(view, 'home', 'My Hero'),
    ]);
  }
  const progress = job.progress?.page ? ` · page ${job.progress.page}/${job.progress.pages}` : '';
  const states = { queued: 'Reading your sheet · waiting for the local worker', reading: 'Reading your sheet', ocr: 'Recognizing scanned text',
    saved: `Character saved · revision ${job.saved_revision}`, failed: 'Import failed', cancelled: 'Import cancelled', expired: 'Import expired' };
  return screen('Character import · Only you', `${states[job.status]}${progress}\n${safeText(job.error ?? '')}\n${['queued', 'reading', 'ocr'].includes(job.status) ? 'You can leave and reopen this import through My Hero. Refresh to check progress.' : 'Your active character was not changed unless you approved the import.'}`,
    [control(view, 'refresh', 'Refresh'), control(view, 'home', 'My Hero'), ...(['queued', 'reading', 'ocr'].includes(job.status) ? [control(view, 'cancel', 'Cancel', 0, 4)] : [])]);
}
export function savedScreen(store, scope, page = 0) {
  const character = store.character(scope);
  if (!character) return heroScreen(store, scope);
  const pages = characterPages(character.snapshot);
  page = Math.min(Math.max(0, page), pages.length - 1);
  const view = store.view(scope, { revision: character.revision, kind: 'hero' });
  return screen(`Your hero · ${pages[page].title}`, `Saved revision ${character.revision} · Page ${page + 1}/${pages.length}\nSaved sheet HP (not live encounter HP): ${safeText(character.runtime.currentHp)}\nDisplayed PDF resource values below are source snapshots, not current game resources.\n\n${pages[page].text}`,
    [control(view, 'character', 'Previous', page - 1, 2, page === 0), control(view, 'character', 'Next', page + 1, 2, page === pages.length - 1), control(view, 'home', 'My Hero')]);
}
