'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch as fetch } from '../../client/api.mjs';
import { buildReviewedSaveRequest, createSaveDraft, DAMAGE_DIE_SIDES, DAMAGE_TYPES, SAVE_ABILITIES, savedDamageLines } from '../../client/check-consequences.mjs';

export type PublicDamageConsequence = { type: 'single_target_damage'; damageType: string; onSuccess: 'half' | 'none' };
export type SavedDamageConsequence = Parameters<typeof savedDamageLines>[0];
type SaveDraft = ReturnType<typeof createSaveDraft>;
type SaveRequest = ReturnType<typeof buildReviewedSaveRequest>;
export type ReviewedSaveRequestFormProps = {
  /** Must come from the authenticated server session. The endpoint independently checks host authority. */
  authorizedHost: boolean;
  gameRevision: number;
  actors: { id: string; name: string }[];
  onRefresh: () => Promise<void>;
  onRequested?: () => void | Promise<void>;
};
const controlClass = 'mt-1 block w-full rounded border border-white/30 bg-[#24212a] p-2';
const buttonClass = 'rounded border border-amber-200/40 px-4 py-2 disabled:opacity-50';

export function PendingDamageNotice({ consequence }: { consequence?: PublicDamageConsequence | null }) {
  if (!consequence || consequence.type !== 'single_target_damage') return null;
  return <p className="mt-1 text-sm text-amber-100">On a failed save: {consequence.damageType} damage. On a successful save: {consequence.onSuccess === 'half' ? 'half damage, rounded down' : 'no damage'}. Damage uses host-reviewed defenses.</p>;
}

export function SavedDamageDetails({ consequence }: { consequence?: SavedDamageConsequence | null }) {
  if (!consequence || consequence.type !== 'single_target_damage') return null;
  return <dl aria-label="Saved damage result" className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
    {savedDamageLines(consequence).map(line => <div key={line.label}><dt className="text-white/70">{line.label}</dt><dd>{line.value}</dd></div>)}
  </dl>;
}

export function ReviewedSaveRequestForm({ authorizedHost, gameRevision, actors, onRefresh, onRequested }: ReviewedSaveRequestFormProps) {
  const [draft, setDraft] = useState(createSaveDraft);
  const [reviewedRevision, setReviewedRevision] = useState<number | null>(null);
  const [pending, setPending] = useState<SaveRequest | null>(null);
  const [busy, setBusy] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState('');
  const draftId = useRef<string | null>(null), submitting = useRef(false), mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const formId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  function update<K extends keyof SaveDraft>(key: K, value: SaveDraft[K]) {
    if (busy || pending || needsRefresh) return;
    setDraft(current => ({ ...current, [key]: value, reviewed: key === 'reviewed' && value === true }));
    setReviewedRevision(key === 'reviewed' && value === true ? gameRevision : null);
    draftId.current = null;
    setMessage('');
  }

  async function requestSave(event: React.FormEvent) {
    event.preventDefault();
    if (!authorizedHost || submitting.current || needsRefresh) return;
    let request: SaveRequest;
    try {
      if (!pending && reviewedRevision !== gameRevision) throw new Error('Review the current game state before requesting this save.');
      draftId.current ??= crypto.randomUUID();
      request = pending ?? buildReviewedSaveRequest(draft, gameRevision, draftId.current, actors.map(actor => actor.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review the request fields.'); return; }
    submitting.current = true; setBusy(true); setPending(request); setMessage('');
    controller.current = new AbortController();
    try {
      const response = await fetch('/api/game/checks/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(15000)]),
      });
      const data = await response.json() as { check?: { id: string; label: string }; error?: string; code?: string };
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null); setDraft(current => ({ ...current, reviewed: false })); setReviewedRevision(null); draftId.current = null;
          if (response.status === 409 || response.status === 401 || response.status === 403) {
            setNeedsRefresh(true);
            setMessage(data.code === 'STALE' ? 'The game changed. Refresh, review the target and defenses, then confirm a new request.' : `${data.error ?? 'This request needs a fresh review.'} Refresh the game before continuing.`);
            return;
          }
          setMessage(data.error ?? 'The request was rejected. Review the fields before trying again.');
          return;
        }
        throw new Error('The request could not be confirmed. Retry the same saved request.');
      }
      if (!data.check || data.check.id !== request.id) throw new Error('The response could not be confirmed. Retry the same saved request.');
      setPending(null); setDraft(createSaveDraft()); setReviewedRevision(null); draftId.current = null;
      setMessage(`Requested ${data.check.label}. The player can now roll; no dice were rolled by this form.`);
      if (onRequested) void Promise.resolve().then(onRequested).catch(() => { if (mounted.current) setMessage('The save was requested. Refresh the game to see the latest pending checks.'); });
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error && error.message.startsWith('The ') ? error.message : 'The connection was interrupted. Retry the same saved request to avoid creating another save.');
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function refreshForReview() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await onRefresh();
      if (!mounted.current) return;
      setPending(null); draftId.current = null; setDraft(current => ({ ...current, reviewed: false })); setReviewedRevision(null); setNeedsRefresh(false);
      setMessage('Game refreshed. Review the current target, save, and defenses, then confirm a new request.');
    } catch { if (mounted.current) setMessage('The game could not be refreshed. Retry refresh before reviewing a new request.'); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  if (!authorizedHost) return null;
  const locked = busy || !!pending || needsRefresh;
  return <section aria-labelledby={`${formId}-heading`} className="mt-4 rounded border border-amber-200/30 p-4">
    <h3 id={`${formId}-heading`} className="text-lg">Request a save with damage</h3>
    <p className="mt-2 text-sm">Request one saving throw for one player character. The server uses approved character ability and proficiency numbers. The player rolls after you submit.</p>
    <p id={`${formId}-limits`} className="mt-2 text-sm text-white/70">Review defenses yourself; unchecked boxes do not mean a defense was inferred. This form does not handle area effects, temporary HP, concentration checks, or death rules.</p>
    {message && <p role="status" className="my-3 text-amber-100">{message}</p>}
    {needsRefresh && <button type="button" disabled={busy} onClick={() => void refreshForReview()} className={buttonClass}>{busy ? 'Refreshing…' : 'Refresh game for a new review'}</button>}
    <form onSubmit={event => void requestSave(event)} aria-describedby={`${formId}-limits`} className="mt-4 space-y-4">
      <fieldset disabled={locked} className="space-y-3">
        <legend className="mb-2 font-semibold">Target and saving throw</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Player character<select required value={draft.actorId} onChange={event => update('actorId', event.target.value)} className={controlClass}><option value="">Choose a character</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
          <label>Save label<input required maxLength={160} value={draft.label} onChange={event => update('label', event.target.value)} placeholder="Burning trap" className={controlClass} /></label>
          <label>Saving throw ability<select value={draft.ability} onChange={event => update('ability', event.target.value)} className={controlClass}>{SAVE_ABILITIES.map(ability => <option key={ability} value={ability}>{ability}</option>)}</select></label>
          <label>Save DC<input type="number" required min={0} max={100} step={1} value={draft.dc} onChange={event => update('dc', event.target.value)} className={controlClass} /></label>
        </div>
        <label className="block"><input type="checkbox" checked={draft.proficient} onChange={event => update('proficient', event.target.checked)} className="mr-2" />Apply saving throw proficiency</label>
        <label className="block">Reason for applying or omitting proficiency<textarea required maxLength={300} rows={2} value={draft.proficiencyReason} onChange={event => update('proficiencyReason', event.target.value)} className={controlClass} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Advantage reasons (optional)<textarea rows={2} maxLength={1287} placeholder="One reason per line; up to 8" value={draft.advantage} onChange={event => update('advantage', event.target.value)} className={controlClass} /></label>
          <label>Disadvantage reasons (optional)<textarea rows={2} maxLength={1287} placeholder="One reason per line; up to 8" value={draft.disadvantage} onChange={event => update('disadvantage', event.target.value)} className={controlClass} /></label>
          <label>Additional save adjustment<input type="number" required min={-20} max={20} step={1} value={draft.adjustmentValue} onChange={event => update('adjustmentValue', event.target.value)} className={controlClass} /></label>
          <label>Adjustment reason (required when adjusted)<input maxLength={160} value={draft.adjustmentSource} onChange={event => update('adjustmentSource', event.target.value)} className={controlClass} /></label>
        </div>
      </fieldset>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="mb-2 font-semibold">Single-target damage</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>Number of damage dice<input type="number" required min={0} max={20} step={1} value={draft.diceCount} onChange={event => update('diceCount', event.target.value)} className={controlClass} /></label>
          <label>Damage die<select value={draft.dieSides} onChange={event => update('dieSides', event.target.value)} className={controlClass}>{DAMAGE_DIE_SIDES.map(sides => <option key={sides} value={sides}>d{sides}</option>)}</select></label>
          <label>Damage bonus<input type="number" required min={-100} max={100} step={1} value={draft.bonus} onChange={event => update('bonus', event.target.value)} className={controlClass} /></label>
          <label>Damage type<select value={draft.damageType} onChange={event => update('damageType', event.target.value)} className={controlClass}>{DAMAGE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>Damage on a successful save<select value={draft.onSuccess} onChange={event => update('onSuccess', event.target.value)} className={controlClass}><option value="half">Half, rounded down</option><option value="none">None</option></select></label>
        </div>
      </fieldset>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="mb-2 font-semibold">Host-reviewed defenses</legend>
        <p className="text-sm text-white/70">Set only defenses you have reviewed for this character and damage type.</p>
        <label className="block">Flat damage reduction<input type="number" required min={0} max={100} step={1} value={draft.reduction} onChange={event => update('reduction', event.target.value)} className={controlClass} /></label>
        <div className="flex flex-wrap gap-4">
          <label><input type="checkbox" checked={draft.resistance} onChange={event => update('resistance', event.target.checked)} className="mr-2" />Resistance</label>
          <label><input type="checkbox" checked={draft.vulnerability} onChange={event => update('vulnerability', event.target.checked)} className="mr-2" />Vulnerability</label>
          <label><input type="checkbox" checked={draft.immunity} onChange={event => update('immunity', event.target.checked)} className="mr-2" />Immunity</label>
        </div>
        <label className="block">Reviewed defenses reason (required even when none apply)<textarea required maxLength={300} rows={2} value={draft.mitigationReason} onChange={event => update('mitigationReason', event.target.value)} className={controlClass} /></label>
      </fieldset>
      <label className="block"><input type="checkbox" disabled={locked} checked={draft.reviewed && reviewedRevision === gameRevision} onChange={event => update('reviewed', event.target.checked)} className="mr-2" />I reviewed this target, saving throw, damage, and applicable defenses against the current game state.</label>
      {pending && <p className="text-sm">This request is saved for retry. Its target and damage are locked until the server confirms the result.</p>}
      <button type="submit" disabled={busy || needsRefresh || (!pending && (!actors.length || !draft.reviewed || reviewedRevision !== gameRevision))} className={buttonClass}>{busy ? 'Requesting…' : pending ? 'Retry same saved request' : 'Request player saving throw'}</button>
    </form>
  </section>;
}
