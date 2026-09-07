'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useRef, useState } from 'react';
import { PendingDamageNotice, SavedDamageDetails, type PublicDamageConsequence, type SavedDamageConsequence } from './check-consequences';
type Modifier = { source: string; value: number };
type Check = { id: string; label: string; kind: string; mode: string; cost: string; modifiers: Modifier[]; consequence?: PublicDamageConsequence };
type Receipt = { requestId: string; revision: number; result: { type: string; label?: string; weapon?: string; dice: number[]; keptIndex?: number; modifiers: Modifier[]; total: number; success?: boolean; hit?: boolean; damage?: number; damageDice?: number[]; damageModifier?: number; critical?: boolean; consequence?: SavedDamageConsequence } };
export default function Checks() {
  const [checks, setChecks] = useState<Check[]>([]), [receipts, setReceipts] = useState<Receipt[]>([]), [error, setError] = useState('');
  const [pending, setPending] = useState<{ checkId: string; requestId: string } | null>(null), [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<number | null>(null), [nextBefore, setNextBefore] = useState<number | null>(null), [trail, setTrail] = useState<(number | null)[]>([]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/game/checks' + (before === null ? '' : `?before=${before}`), { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if (abort.signal.aborted) return;
        if ([401, 403].includes(response.status)) { if (mounted.current) { setChecks([]); setReceipts([]); setPending(null); setError('Reconnect to view your rolls.'); } return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { pending: Check[]; receipts: Receipt[]; nextBefore: number | null }; if (mounted.current && !abort.signal.aborted) { setChecks(data.pending); setReceipts(data.receipts); setNextBefore(data.nextBefore); }
      } catch { if (mounted.current) setError('Roll connection interrupted. Retrying automatically.'); }
      if (mounted.current) timer = setTimeout(poll, 2000);
    }
    void poll(); return () => { mounted.current = false; abort.abort(); clearTimeout(timer); };
  }, [before]);
  async function roll(checkId: string) {
    if (busy) return;
    const request = pending ?? { checkId, requestId: crypto.randomUUID() }; setPending(request); setBusy(true); setError('');
    try {
      const response = await fetch('/api/game/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { receipt: Receipt; error?: string }; if (!mounted.current) return;
      if (!response.ok) { if (response.status < 500) setPending(null); throw new Error(data.error); }
      setPending(null); setChecks([]); setBefore(null); setTrail([]); setNextBefore(null); setReceipts(current => before === null ? [data.receipt, ...current.filter(r => r.requestId !== data.receipt.requestId)] : [data.receipt]);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Retry the same saved request.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section aria-label="Checks and saving throws" className="mt-4 rounded border border-amber-200/30 p-4"><h3 className="text-lg">Checks and saving throws</h3>
    {error && <p role="status">{error}</p>}
    {!checks.length && !pending && <p className="my-2">Your host can request a check using your approved character stats.</p>}
    {checks.map(check => <div key={check.id} className="my-3"><p>{check.label} · {check.kind} · {check.mode} · Cost: {check.cost}</p><p>{check.modifiers.map(m => `${m.source}: ${m.value >= 0 ? '+' : ''}${m.value}`).join('; ')}</p><PendingDamageNotice consequence={check.consequence} /><button disabled={busy || !!pending} onClick={() => void roll(check.id)} className="mt-2 rounded border border-amber-200/40 px-4 py-2">Roll {check.label}</button></div>)}
    {pending && <button disabled={busy} onClick={() => void roll(pending.checkId)} className="rounded border px-4 py-2">{busy ? 'Rolling…' : 'Retry saved roll'}</button>}
    <h4 className="mt-4 font-semibold">Saved rolls {before === null ? '· Latest' : '· Earlier history'}</h4>
    <ul className="mt-3 space-y-2">{receipts.map(r => <li key={r.requestId}>{r.result.label ?? r.result.weapon ?? r.result.type}: dice [{r.result.dice.join(', ')}], kept {r.result.dice[r.result.keptIndex ?? 0]}; {r.result.modifiers.map(m => `${m.source} ${m.value >= 0 ? '+' : ''}${m.value}`).join('; ')} = <strong>{r.result.total}</strong> · {r.result.type === 'attack' ? `${r.result.critical ? 'Critical hit' : r.result.hit ? 'Hit' : 'Miss'}; damage dice [${(r.result.damageDice ?? []).join(', ')}] ${Number(r.result.damageModifier) >= 0 ? '+' : ''}${r.result.damageModifier ?? 0} = ${r.result.damage}` : r.result.success ? 'Success' : 'Failure'} <span className="text-xs">(revision {r.revision})</span><SavedDamageDetails consequence={r.result.consequence} /></li>)}</ul>
    <nav aria-label="Roll history pages" className="mt-3 flex gap-3">
      <button disabled={!trail.length || busy} onClick={() => { setReceipts([]); setNextBefore(null); setBefore(trail.at(-1) ?? null); setTrail(current => current.slice(0, -1)); }} className="rounded border px-3 py-1">Newer rolls</button>
      <button disabled={nextBefore === null || busy} onClick={() => { setReceipts([]); setTrail(current => [...current, before]); setBefore(nextBefore); setNextBefore(null); }} className="rounded border px-3 py-1">Older rolls</button>
    </nav>
  </section>;
}
