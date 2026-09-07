'use client';
import { apiFetch as fetch } from '../../client/api.mjs';

import { useEffect, useState } from 'react';

type Entry = { source: string; revision: number; scene: string; round: number; turn: number; facts: string[] };

export default function Journal() {
  const [entries, setEntries] = useState<Entry[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, cursor = 0, timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      let delay = 2000;
      try {
        const response = await fetch(`/api/game/journal?after=${cursor}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if ([401, 403].includes(response.status)) {
          if (!cancelled) { setEntries([]); setError('Reconnect to the tactical table to read your journal.'); }
          return;
        }
        if (!response.ok) throw new Error('Journal is temporarily unavailable.');
        const page = await response.json() as { entries: Entry[]; next: number; hasMore: boolean };
        if (cancelled) return;
        setEntries(current => [...current, ...page.entries.filter(e => !current.some(old => old.source === e.source))].slice(-100));
        cursor = page.next; setError(''); delay = page.hasMore ? 250 : 2000;
      } catch { if (!cancelled) setError('Journal connection interrupted. Saved actions remain available; retrying automatically.'); }
      if (!cancelled) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => { cancelled = true; abort.abort(); clearTimeout(timer); };
  }, []);
  return <section className="mt-5 rounded-xl border border-amber-100/20 bg-[#17131d] p-5" aria-label="Campaign journal">
    <h2 className="text-xl">Campaign journal</h2>
    <p className="my-2 text-sm text-stone-300">Observed changes from the saved game ledger. Each entry cites its source revision. The latest 100 entries are shown.</p>
    {error && <p role="status" className="my-3 text-amber-200">{error}</p>}
    <ol className="max-h-96 space-y-4 overflow-auto">{entries.map(entry => <li key={entry.source} className="border-t border-white/10 pt-3">
      <p className="text-sm text-amber-200">{entry.scene} · Round {entry.round} · Turn {entry.turn}</p>
      {entry.facts.map((fact, index) => <p key={index} className="mt-1">{fact}</p>)}
      <p className="mt-2 text-xs text-stone-400">Source: {entry.source}</p>
    </li>)}</ol>
  </section>;
}
