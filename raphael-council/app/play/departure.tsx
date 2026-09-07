'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useRef, useState } from 'react';

type Offer = { id: string; title: string; briefing: string; expectedRevision: number; expectedWorldRevision: number };
type Request = { departureId: string; requestId: string };

export default function Departure() {
  const [offer, setOffer] = useState<Offer | null>(null), [pending, setPending] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lifetime = useRef(0);
  useEffect(() => {
    const epoch = ++lifetime.current;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/game/departure', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
        if (epoch !== lifetime.current) return;
        if ([401, 403].includes(response.status)) { setOffer(null); setPending(null); setNotice(''); setError('Reconnect to the campaign to view its departure.'); return; }
        if (!response.ok) throw new Error();
        const data = await response.json() as { departure: Offer | null };
        if (epoch === lifetime.current) setOffer(data.departure);
      } catch { if (epoch === lifetime.current) setError('Departure connection interrupted. Retrying automatically.'); }
      if (epoch === lifetime.current) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { lifetime.current = epoch + 1; abort.abort(); clearTimeout(timer); };
  }, []);
  async function confirm() {
    if (busy || (!pending && !offer)) return;
    const epoch = lifetime.current;
    const request = pending ?? { departureId: offer!.id, requestId: crypto.randomUUID() };
    setPending(request); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/game/departure', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { error?: string };
      if (epoch !== lifetime.current) return;
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        if ([401, 403].includes(response.status)) setOffer(null);
        throw new Error(data.error || 'The departure could not be confirmed.');
      }
      setPending(null); setOffer(null); setNotice('Party departure recorded. Your tactical table will show the new scene.');
    } catch (reason) { if (epoch === lifetime.current) setError(reason instanceof Error ? reason.message : 'Retry the saved departure confirmation.'); }
    finally { if (epoch === lifetime.current) setBusy(false); }
  }
  return <section className="mt-5 border-t border-amber-100/20 pt-4" aria-label="Party departure">
    <h3 className="text-xl">Party departure</h3>
    {offer ? <><h4 className="mt-3 font-serif text-xl">{offer.title}</h4><p className="my-2 whitespace-pre-wrap break-words leading-7">{offer.briefing}</p><p className="my-3 text-sm text-stone-300">Confirming moves the whole party into the host-prepared scene. Current injuries and saved character profiles carry forward. This does not heal the party. Browsing this preview changes nothing.</p></> : <p className="my-3 text-sm text-stone-300">There is no current departure prepared by your host. Finish the mission, debrief and party choice; your host then prepares the next scene.</p>}
    {(offer || pending) && <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded border border-amber-200/30 px-4 py-2 disabled:opacity-40">{pending ? 'Retry saved departure confirmation' : 'Confirm party departure'}</button>}
    {notice && <p role="status" className="my-3 text-amber-100">{notice}</p>}
    {error && <p role="alert" className="my-3 text-amber-200">{error}</p>}
  </section>;
}
