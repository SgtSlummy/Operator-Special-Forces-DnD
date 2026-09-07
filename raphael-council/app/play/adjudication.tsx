'use client';
import { useEffect, useRef, useState } from 'react';

type Outcome = { id: string; title: string; summary: string; changes: { trackId: string; label: string; delta: number; before: number; after: number }[] };
type Review = { available: true; expectedRevision: number; expectedWorldRevision: number; mission: { id: string; title: string; briefing: string }; outcomes: Outcome[] };
type Selection = { review: Review; outcome: Outcome };
type Decision = { reviewed: true; requestId: string; expectedRevision: number; expectedWorldRevision: number; outcomeId: string };

export default function Adjudication() {
  const [review, setReview] = useState<Review | null>(null), [selected, setSelected] = useState<Selection | null>(null);
  const [pending, setPending] = useState<{ input: Decision; selection: Selection } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lifetime = useRef(0), committed = useRef({ game: 0, world: 0 });
  useEffect(() => {
    const epoch = ++lifetime.current, abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/game/adjudication', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if (epoch !== lifetime.current) return;
        if ([401, 403].includes(response.status)) { setReview(null); setSelected(null); setPending(null); setMessage(''); return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { adjudication: Review | { available: false } };
        if (epoch !== lifetime.current) return;
        const fresh = data.adjudication.available ? data.adjudication : null;
        if (!fresh || (fresh.expectedRevision >= committed.current.game && fresh.expectedWorldRevision >= committed.current.world)) {
          setReview(fresh);
          setSelected(current => current && fresh?.expectedRevision === current.review.expectedRevision && fresh?.expectedWorldRevision === current.review.expectedWorldRevision ? current : null);
        }
      } catch { if (epoch === lifetime.current) { setReview(null); setSelected(null); setMessage('Mission review connection interrupted. A saved confirmation can be retried safely.'); } }
      if (epoch === lifetime.current) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { lifetime.current = epoch + 1; abort.abort(); clearTimeout(timer); };
  }, []);
  async function confirm() {
    if (busy || (!pending && !selected)) return;
    const decision = pending ?? { selection: selected!, input: { reviewed: true as const, requestId: crypto.randomUUID(), expectedRevision: selected!.review.expectedRevision, expectedWorldRevision: selected!.review.expectedWorldRevision, outcomeId: selected!.outcome.id } };
    const epoch = lifetime.current;
    setPending(decision); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/game/adjudication', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision.input), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { receipt?: { revision: number; worldRevision: number }; error?: string };
      if (epoch !== lifetime.current) return;
      if ([401, 403].includes(response.status)) { setReview(null); setSelected(null); setPending(null); setMessage(''); return; }
      if (!response.ok) { if (response.status < 500) { setPending(null); setSelected(null); setReview(null); } throw new Error(data.error || 'Retry the same saved confirmation.'); }
      if (!data.receipt) throw new Error('Retry the same saved confirmation to recover its receipt.');
      committed.current = { game: data.receipt.revision, world: data.receipt.worldRevision };
      setPending(null); setSelected(null); setReview(null);
      setMessage(`Mission outcome recorded at game revision ${data.receipt?.revision}, world revision ${data.receipt?.worldRevision}. Continue with the separate party debrief.`);
    } catch (error) { if (epoch === lifetime.current) setMessage(error instanceof Error ? error.message : 'Retry the same saved confirmation.'); }
    finally { if (epoch === lifetime.current) setBusy(false); }
  }
  const shown = pending?.selection ?? selected;
  if (!review && !pending && !message) return null;
  return <section aria-label="Host mission review" className="my-4 rounded-xl border border-amber-200/30 p-4">
    <h3 className="text-lg">Host mission review</h3>
    <p className="my-2 text-sm text-stone-300">Review the configured outcomes privately. Confirmation records the chosen outcome and opens the party debrief. Time, HP and rolls stay unchanged.</p>
    {message && <p role="status" className="my-3 text-amber-200">{message}</p>}
    {review && <><p>{review.mission.title}</p><p className="whitespace-pre-wrap">{review.mission.briefing}</p><div className="my-3 flex flex-wrap gap-2">{review.outcomes.map(outcome => <button key={outcome.id} disabled={busy || !!pending} onClick={() => { setSelected({ review, outcome }); setMessage(''); }} className="rounded border border-white/30 px-3 py-2">Review: {outcome.title}</button>)}</div></>}
    {shown && <div className="my-3 rounded border border-white/20 p-3">
      <h4>{shown.outcome.title}</h4><p className="my-2 whitespace-pre-wrap">{shown.outcome.summary}</p>
      <ul>{shown.outcome.changes.map(change => <li key={change.trackId}>{change.label}: {change.before}/100 → {change.after}/100 (configured delta {change.delta >= 0 ? '+' : ''}{change.delta}; bounded to 0–100)</li>)}</ul>
      {!shown.outcome.changes.length && <p>No track changes.</p>}
      <p className="my-2 text-xs">Game revision {shown.review.expectedRevision}; world revision {shown.review.expectedWorldRevision}.</p>
      <button disabled={busy} onClick={() => void confirm()} className="rounded border border-amber-200/50 px-4 py-2">{busy ? 'Saving outcome…' : pending ? 'Retry saved outcome confirmation' : 'Confirm this mission outcome'}</button>
      {!pending && <button disabled={busy} onClick={() => setSelected(null)} className="ml-3 underline">Cancel review</button>}
    </div>}
  </section>;
}
