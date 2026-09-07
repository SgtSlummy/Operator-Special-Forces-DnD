'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useState } from 'react';
type Record = { requestId: string; text: string; evidence: string[] };
type State = { configured: boolean; remaining: number; limit: number; records: Record[] };
type Request = { requestId: string; expectedRevision: number; expectedWorldRevision: number; topic: string };
export default function Counsel({ gameRevision, worldRevision }: { gameRevision: number; worldRevision: number }) {
  const [state, setState] = useState<State | null>(null), [topic, setTopic] = useState('surroundings'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<Request | null>(null);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch('/api/game/counsel', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if ([401, 403].includes(response.status)) { if (!cancelled) { setState(null); setPending(null); setError('Reconnect to the tactical table.'); } return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { counsel: State };
        if (!cancelled) setState(data.counsel);
      } catch { if (!cancelled) setError('Counsel connection interrupted. Retrying automatically.'); }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll(); return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, []);
  async function ask() {
    if (busy) return;
    const input = pending ?? { requestId: crypto.randomUUID(), expectedRevision: gameRevision, expectedWorldRevision: worldRevision, topic };
    setPending(input); setBusy(true); setError('');
    try {
      const response = await fetch('/api/game/counsel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { counsel: State; error?: string };
      if (!response.ok) { if (response.status < 500) setPending(null); throw new Error(data.error); }
      setState(data.counsel); setPending(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Retry the saved request.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 border-t border-amber-100/20 pt-4" aria-label="Raphael's Counsel">
    <h3 className="text-xl">Raphael&apos;s Counsel</h3><p className="my-2 text-sm text-stone-300">{state?.remaining ?? '…'} of 3 requests remain for this mission, shared by the party. Saved advice here is private to your player. Counsel spends no turn or action.</p>
    <label htmlFor="counsel-topic" className="mr-2">Reflect on</label><select id="counsel-topic" value={topic} disabled={!!pending} onChange={e => setTopic(e.target.value)} className="rounded border border-white/30 bg-[#24212a] p-2"><option value="surroundings">Visible surroundings</option><option value="readiness">Character readiness</option><option value="mission">The recorded mission</option></select>
    <button onClick={() => void ask()} disabled={busy || (!pending && !state?.remaining)} className="ml-2 rounded border border-amber-200/30 px-4 py-2">{pending ? 'Retry saved counsel' : 'Ask Raphael · use one request'}</button>
    {error && <p role="status" className="my-3 text-amber-200">{error}</p>}
    <ol className="mt-4 space-y-4">{state?.records.map(record => <li key={record.requestId}><p>{record.text}</p><p className="mt-1 text-xs text-stone-400">Evidence: {record.evidence.join(', ')}</p></li>)}</ol>
  </section>;
}
