'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useRef, useState } from 'react';
import Counsel from './counsel';
import Council from './council';
import DeparturePanel from './departure';
import Checks from './checks';
import Adjudication from './adjudication';
import WorldTimePanel from './world-time';
type World = { configured: boolean; revision: number; tracks: { id: string; label: string; value: number }[]; mission: { title: string; briefing: string; status: string }; outcome?: { summary: string; source: string }; debrief?: { notes: string } };
type Request = { requestId: string; expectedRevision: number; notes: string };
export default function Mission({ gameRevision }: { gameRevision: number }) {
  const [world, setWorld] = useState<World | null>(null), [notes, setNotes] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Request | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch('/api/game/world', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if (!mounted.current) return;
        if ([401, 403].includes(response.status)) { setWorld(null); setError('Reconnect to the tactical table.'); return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { world: World };
        if (mounted.current) setWorld((current: World | null) => !current || !data.world.configured || data.world.revision >= current.revision ? data.world : current);
      } catch { if (mounted.current) setError('Mission connection interrupted. Retrying automatically.'); }
      if (mounted.current) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { mounted.current = false; abort.abort(); clearTimeout(timer); };
  }, []);
  async function debrief() {
    if (!world || busy) return;
    const request = pending ?? { requestId: crypto.randomUUID(), expectedRevision: world.revision, notes };
    setPending(request); setBusy(true); setError('');
    try {
      const response = await fetch('/api/game/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { world: World; error?: string };
      if (!mounted.current) return;
      if (!response.ok) { if (response.status < 500) setPending(null); throw new Error(data.error); }
      setWorld(data.world); setPending(null); setNotes('');
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Retry the same debrief.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="mt-5 rounded-xl border border-amber-100/20 p-5" aria-label="Mission and consequences"><h2 className="text-xl">Mission and consequences</h2>
    <Checks />
    <WorldTimePanel gameRevision={gameRevision} />
    {error && <p role="status" className="my-3 text-amber-200">{error}</p>}
    {!world?.configured ? <p className="mt-3 text-stone-300">Your host has not linked a reviewed mission to this encounter yet.</p> : <>
      <h3 className="mt-3 text-lg">{world.mission.title}</h3><p>{world.mission.briefing}</p><p className="my-3">Status: {world.mission.status} · World revision {world.revision}</p>
      <ul>{world.tracks.map(t => <li key={t.id}>{t.label}: {t.value}/100</li>)}</ul>
      {world.outcome && <div className="my-3"><p>{world.outcome.summary}</p><p className="text-xs text-stone-400">Source: {world.outcome.source}</p></div>}
      {world.debrief && <p className="my-3 whitespace-pre-wrap">Debrief: {world.debrief.notes || 'Recorded without additional notes.'}</p>}
      <Counsel gameRevision={gameRevision} worldRevision={world.revision} />
      <Council />
      <DeparturePanel />
      <Adjudication />
      {(world.mission.status === 'debrief' || pending) && <div className="mt-4"><label htmlFor="debrief" className="block">Party debrief notes (shared with your campaign)</label><textarea id="debrief" maxLength={2000} value={notes} disabled={!!pending} onChange={e => setNotes(e.target.value)} className="my-2 w-full rounded border border-white/30 bg-black/20 p-3" /><button disabled={busy} onClick={() => void debrief()} className="rounded border border-amber-200/30 px-4 py-2">{pending ? 'Retry saved debrief' : 'Record party debrief'}</button></div>}
    </>}
  </section>;
}
