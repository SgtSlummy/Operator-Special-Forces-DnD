'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useState } from 'react';
type Round = { round: number; worldRevision: number; leadingId: string; tieBreak: string; packetHash: string; selection: { branchId: string } | null; branches: { id: string; title: string; summary: string; cost: string }[]; totals: { branchId: string; score: number }[]; members: { id: string; name: string; mandate: string; weight: number; assessments: { branchId: string; score: number; assessment: string; evidence: string[] }[] }[] };
type Choice = { requestId: string; round: number; branchId: string; expectedWorldRevision: number };
export default function Council() {
  const [round, setRound] = useState<Round | null>(null), [chosen, setChosen] = useState(''), [pending, setPending] = useState<Choice | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch('/api/game/council', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if ([401, 403].includes(response.status)) { if (!cancelled) { setRound(null); setPending(null); } return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { council: Round | null };
        if (!cancelled) setRound(current => current?.selection && current.round === data.council?.round && !data.council.selection ? current : data.council);
      } catch { if (!cancelled) setError('Council connection interrupted. Retrying automatically.'); }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll(); return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, []);
  async function confirm() {
    if (!round || busy || (!pending && !chosen)) return;
    const input = pending ?? { requestId: crypto.randomUUID(), round: round.round, branchId: chosen, expectedWorldRevision: round.worldRevision };
    setPending(input); setBusy(true); setError('');
    try {
      const response = await fetch('/api/game/council', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { council: Round; error?: string };
      if (!response.ok) { if (response.status < 500) setPending(null); throw new Error(data.error); }
      setRound(data.council); setPending(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Retry the same selection.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 border-t border-amber-100/20 pt-4" aria-label="Mission council"><h3 className="text-xl">Mission council</h3>
    <p className="my-2 text-sm text-stone-300">Five equal-weight deterministic personas assess reviewed branches from the same saved world packet. Their lead is advice; the party chooses.</p>
    {error && <p role="status" className="my-2 text-amber-200">{error}</p>}
    {!round ? <p>The host can prepare the next mission council after the debrief.</p> : <>
      <p>Round {round.round} · World evidence revision {round.worldRevision} · Tie policy: {round.tieBreak}</p>
      <ul className="my-3 space-y-3">{round.branches.map(b => <li key={b.id}><strong>{b.title}{round.leadingId === b.id ? ' · council lead' : ''}</strong><p>{b.summary}</p><p className="text-sm text-stone-300">Cost: {b.cost} · Total {round.totals.find(t => t.branchId === b.id)?.score}</p></li>)}</ul>
      <details className="my-3"><summary>Read all five assessments</summary>{round.members.map(m => <div key={m.id} className="my-3"><strong>{m.name} · {m.mandate} · weight {m.weight}</strong>{m.assessments.map(a => <p key={a.branchId} className="mt-1 text-sm">{round.branches.find(b => b.id === a.branchId)?.title}: {a.score}. {a.assessment} Evidence: {a.evidence.join(', ')}</p>)}</div>)}<p className="break-all text-xs">Saved packet: {round.packetHash}</p></details>
      {round.selection ? <p className="text-amber-200">Party selected {round.branches.find(b => b.id === round.selection?.branchId)?.title}. Check the mission and Party departure sections for current progress.</p> : <><label htmlFor="council-choice">Party’s next branch</label><select id="council-choice" disabled={!!pending} value={chosen} onChange={e => setChosen(e.target.value)} className="mx-2 rounded border border-white/30 bg-[#24212a] p-2"><option value="">Choose explicitly</option>{round.branches.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></>}
      {(!round.selection || pending) && <button disabled={busy || (!pending && !chosen)} onClick={() => void confirm()} className="rounded border border-amber-200/30 px-4 py-2">{pending ? 'Retry saved selection' : 'Confirm party branch'}</button>}
    </>}
  </section>;
}
