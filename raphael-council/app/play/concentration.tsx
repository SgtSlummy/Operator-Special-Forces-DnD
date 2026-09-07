'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch as fetch } from '../../client/api.mjs';

type Decision = { requestId: string; expectedRevision: number; action: 'start' | 'end' | 'resolve' | 'refresh'; actorId?: string; characterVersion?: string; sourceLabel?: string; effectIds?: string[]; reviewed?: true; reason?: string; pendingId?: string };
type SaveProfile = { abilityScore: number; proficiencyBonus: number; proficient: boolean; adjustments: { source: string; value: number }[]; advantage: string[]; disadvantage: string[] };
type Pending = { waiting: boolean; paused: boolean; id?: string; actorId?: string; actorName?: string; sourceLabel?: string; damageTaken?: number; dc?: number; profile?: SaveProfile; canResolve: boolean; canEnd: boolean; canRefresh: boolean; recoveryRequired?: boolean };
type Actor = { id: string; name: string; characterVersion: string; eligible: boolean; concentration: { sourceLabel: string } | null };
type Receipt = { requestId: string; revision: number; result: { type: string; actorId: string; sourceLabel?: string; dice?: number[]; kept?: number; modifier?: number; total?: number; dc?: number; success?: boolean; mode?: string } };
type State = { revision: number; role: string; phase: string; pendingReaction: boolean; actors: Actor[]; registrationActors: { id: string; name: string; characterVersion: string }[]; effects: { id: string; name: string }[]; pending: Pending | null; recentResults: Receipt[] };
const button = 'rounded-lg border border-amber-100/30 px-3 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'w-full rounded border border-white/30 bg-[#24212a] p-2';
class RequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request(decision?: Decision): Promise<{ concentration: State; receipt?: Receipt }> {
  const response = await fetch('/api/game/concentration', { method: decision ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', ...(decision ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision) } : {}) });
  const data = await response.json() as { concentration: State; receipt?: Receipt; error?: string | { message?: string }; message?: string };
  if (!response.ok) throw new RequestError(typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? 'Open the current concentration view and try again.', response.status);
  return data;
}

export default function ConcentrationPanel({ revision, onChanged }: { revision: number; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<State | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState<Decision | null>(null), [recoveryReason, setRecoveryReason] = useState('');
  const epoch = useRef(0), writing = useRef(false), reading = useRef(false), pendingRequest = useRef<Decision | null>(null), onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);
  const accept = useCallback((next: State) => setData(current => !current || next.revision >= current.revision ? next : current), []);
  const report = useCallback((reason: unknown) => {
    if (reason instanceof RequestError && [401, 403].includes(reason.status)) {
      epoch.current++; setData(null); setSaved(null); setBusy(false); setNotice(''); setRecoveryReason(''); pendingRequest.current = null;
      void onChangedRef.current();
    }
    setError(reason instanceof RequestError ? reason.message : 'The connection was interrupted. Retry a sent decision to recover its saved result.');
  }, []);
  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    const current = epoch.current; reading.current = true;
    try { const next = await request(); if (current === epoch.current) { accept(next.concentration); setError(''); } }
    catch (reason) { if (current === epoch.current) report(reason); }
    finally { reading.current = false; }
  }, [accept, report]);
  useEffect(() => {
    const current = ++epoch.current; let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() { if (!document.hidden) await refresh(); if (!stopped) timer = setTimeout(poll, 2000); }
    void poll();
    return () => { stopped = true; epoch.current = current + 1; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [revision, refresh]);
  async function send(decision: Decision) {
    if (writing.current) return;
    const current = epoch.current; writing.current = true; pendingRequest.current = decision;
    setSaved(decision); setBusy(true); setError(''); setNotice('');
    try {
      const next = await request(decision); if (current !== epoch.current) return;
      accept(next.concentration); pendingRequest.current = null; setSaved(null); setRecoveryReason('');
      setNotice(decision.action === 'resolve' ? 'Your concentration save is saved. Any remaining action has resumed up to its next required decision.' : decision.action === 'start' ? 'The reviewed concentration source is recorded.' : 'The concentration decision is saved.');
      await onChangedRef.current();
    } catch (reason) {
      if (current !== epoch.current) return;
      if (reason instanceof RequestError && reason.status < 500) { pendingRequest.current = null; setSaved(null); }
      report(reason);
    } finally { writing.current = false; if (current === epoch.current) { setBusy(false); void refresh(); } }
  }
  function decide(fields: Omit<Decision, 'requestId' | 'expectedRevision'>) {
    if (!data || busy || pendingRequest.current || data.phase === 'paused') return;
    void send({ ...fields, requestId: crypto.randomUUID(), expectedRevision: data.revision });
  }
  const pending = data?.pending, disabled = busy || !!saved || data?.phase === 'paused';
  return <section aria-label="Concentration" className="rounded-xl border border-amber-100/20 bg-[#17131d] p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Concentration</h2><button className={button} disabled={busy} onClick={() => void refresh()}>Refresh concentration</button></div>
    <p className="mb-3 text-sm text-stone-300">View this panel at any time. Required saves and voluntarily ending concentration cost no action.</p>
    {error && <p role="alert" className="mb-3 text-amber-100">{error}</p>}
    {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
    {saved && !busy && <div className="mb-3"><p className="mb-2 text-sm">Recover the sent decision before making another.</p><button className={button} onClick={() => void send(saved)}>Retry saved concentration decision</button></div>}
    {!data && !error && <p className="text-sm text-stone-300">Loading concentration…</p>}
    {data?.phase === 'paused' && <p className="mb-3 text-sm text-stone-300">Play is paused. The host must resume play before a concentration decision.</p>}
    {pending && <div className="mb-4 space-y-3 rounded-lg border border-amber-100/25 p-3">
      <p>{pending.actorName ? `${pending.actorName} must resolve concentration on ${pending.sourceLabel}.` : 'Waiting for a required concentration decision.'}</p>
      {pending.damageTaken !== undefined && <p className="text-sm">{pending.damageTaken} damage · Constitution save DC {pending.dc}</p>}
      {pending.profile && <p className="text-sm text-stone-300">Constitution {pending.profile.abilityScore} · {pending.profile.proficient ? `proficiency +${pending.profile.proficiencyBonus}` : 'no proficiency bonus'}{pending.profile.adjustments.map((item, index) => <span key={index}> · {item.source}: {item.value >= 0 ? '+' : ''}{item.value}</span>)} · {pending.profile.advantage.length && pending.profile.disadvantage.length ? 'advantage and disadvantage cancel' : pending.profile.advantage.length ? 'advantage' : pending.profile.disadvantage.length ? 'disadvantage' : 'normal roll'}</p>}
      <div className="flex flex-wrap gap-2">{pending.canResolve && pending.id && <button className={button} disabled={disabled} onClick={() => decide({ action: 'resolve', pendingId: pending.id })}>Roll required concentration save</button>}{pending.canEnd && pending.actorId && <button className={button} disabled={disabled} onClick={() => decide({ action: 'end', actorId: pending.actorId })}>End concentration · no action</button>}</div>
      {pending.recoveryRequired && <p className="text-sm text-amber-100">The reviewed source or controller changed. The host must review recovery.</p>}
      {pending.canRefresh && <div className="space-y-2"><label className="block text-sm" htmlFor="concentration-recovery">Why the saved source or controller is no longer valid</label><input id="concentration-recovery" className={inputClass} value={recoveryReason} maxLength={300} onChange={event => setRecoveryReason(event.target.value)} disabled={disabled} /><button className={button} disabled={disabled || !recoveryReason.trim()} onClick={() => decide({ action: 'refresh', pendingId: pending.id, reviewed: true, reason: recoveryReason.trim() })}>End invalid source and resume</button></div>}
    </div>}
    {data && !pending && <p className="mb-3 text-sm text-stone-300">No concentration save is pending.</p>}
    {!!data?.actors.some(actor => actor.concentration) && <ul className="mb-4 space-y-3">{data.actors.filter(actor => actor.concentration).map(actor => <li key={actor.id} className="flex flex-wrap items-center justify-between gap-2"><span>{actor.name} · {actor.concentration?.sourceLabel}</span><button className={button} disabled={disabled || !!pending} onClick={() => decide({ action: 'end', actorId: actor.id })}>End concentration</button></li>)}</ul>}
    {data?.role === 'host' && <RegistrationForm key={data.revision} data={data} disabled={disabled || !!pending || data.pendingReaction || !['combat', 'exploration'].includes(data.phase)} onRecord={decide} />}
    {!!data?.recentResults.length && <details className="mt-4 border-t border-white/15 pt-3"><summary className="cursor-pointer">Your saved concentration results</summary><ul className="mt-3 space-y-3">{data.recentResults.map(receipt => <li key={receipt.requestId}><p className="text-sm">{receipt.result.sourceLabel ?? 'Concentration decision'} · revision {receipt.revision}</p>{receipt.result.type === 'concentration_save' ? <p className="text-sm text-stone-300">d20 {receipt.result.dice?.join(', ')} · kept {receipt.result.kept} {Number(receipt.result.modifier) < 0 ? '−' : '+'} {Math.abs(Number(receipt.result.modifier))} = {receipt.result.total} vs DC {receipt.result.dc} · {receipt.result.success ? 'Concentration held' : 'Concentration ended'}</p> : <p className="text-sm text-stone-300">{receipt.result.type === 'concentration_started' ? 'Reviewed source recorded' : 'Source ended'}</p>}</li>)}</ul></details>}
  </section>;
}

function RegistrationForm({ data, disabled, onRecord }: { data: State; disabled: boolean; onRecord: (fields: Omit<Decision, 'requestId' | 'expectedRevision'>) => void }) {
  const [actorId, setActorId] = useState(''), [source, setSource] = useState(''), [reason, setReason] = useState(''), [effectIds, setEffectIds] = useState<string[]>([]), [reviewed, setReviewed] = useState(false);
  const actor = data.registrationActors.find(item => item.id === actorId);
  return <details className="mt-3 border-t border-white/15 pt-3"><summary className="cursor-pointer">Host · record reviewed concentration</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); if (actor && reviewed && source.trim() && reason.trim() && !disabled) onRecord({ action: 'start', actorId: actor.id, characterVersion: actor.characterVersion, sourceLabel: source.trim(), effectIds, reviewed: true, reason: reason.trim() }); }}>
    <p className="text-sm text-stone-300">Record an ongoing effect whose casting and costs have already been reviewed. Replacing concentration ends its previous bound effects. The draft resets when the scene changes.</p>
    <label className="block text-sm">Character<select className={inputClass} required disabled={disabled} value={actorId} onChange={event => { setActorId(event.target.value); setReviewed(false); }}><option value="">Choose a reviewed character</option>{data.registrationActors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="block text-sm">Ongoing spell or effect<input className={inputClass} required disabled={disabled} maxLength={120} value={source} onChange={event => { setSource(event.target.value); setReviewed(false); }} /></label>
    {!!data.effects.length && <fieldset disabled={disabled}><legend className="text-sm">Existing effects that end with this concentration</legend><div className="max-h-40 space-y-2 overflow-auto py-2">{data.effects.map(effect => <label key={effect.id} className="flex gap-2 text-sm"><input type="checkbox" checked={effectIds.includes(effect.id)} onChange={event => { setEffectIds(current => event.target.checked ? [...current, effect.id] : current.filter(id => id !== effect.id)); setReviewed(false); }} />{effect.name}</label>)}</div></fieldset>}
    <label className="block text-sm">Review note<textarea className={inputClass} required disabled={disabled} maxLength={300} value={reason} onChange={event => { setReason(event.target.value); setReviewed(false); }} /></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} />I reviewed the ongoing source, character version, and effects listed here.</label>
    <button className={button} disabled={disabled || !actor || !source.trim() || !reason.trim() || !reviewed}>Record reviewed concentration</button>
  </form></details>;
}
