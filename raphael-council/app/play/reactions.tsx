'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';

type Offer = { optionId: string; actorId: string; actorName: string; targetId: string; targetName: string; weapon: string | { name: string } };
type Choice = { optionId: string; label: string };
type Pending = { id: string; kind: 'opportunity_attack'; stage: 'declare' | 'order'; paused: boolean; canOrder: boolean; canRefresh: boolean; offers: Offer[]; orderChoices: Choice[] };
type Roll = { requestId: string; revision: number; result: { type: string; reaction?: boolean; dice?: number[]; modifiers?: { source: string; value: number }[]; total?: number; hit?: boolean; damage?: number } };
type Reactions = { revision: number; pending: Pending | null; recentResults: Roll[] };
type Decision = { requestId: string; expectedRevision: number; pendingId: string } & ({ decision: 'attack' | 'decline'; optionId: string } | { decision: 'order'; order: string[] } | { decision: 'refresh' });
class ReactionError extends Error { constructor(message: string, public status: number) { super(message); } }
const button = 'rounded-lg border border-amber-200/30 px-3 py-2 text-sm text-amber-50 hover:bg-amber-200/10 disabled:cursor-not-allowed disabled:opacity-40';

async function request<T>(options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/game/reactions', { ...options, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ReactionError(data.error || 'The reaction request could not be completed.', response.status);
  return data as T;
}

import ConcentrationPanel from './concentration';

export default function ReactionPanel({ revision, onChanged }: { revision: number; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Reactions | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedRequest, setSavedRequest] = useState<Decision | null>(null);
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const lifetime = useRef(0);
  const reading = useRef(false);
  const writing = useRef(false);
  const pendingRequest = useRef<Decision | null>(null);
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const accept = useCallback((next: Reactions) => {
    setData(current => !current || next.revision >= current.revision ? next : current);
  }, []);
  const report = useCallback((reason: unknown) => {
    if (reason instanceof ReactionError && [401, 403].includes(reason.status)) {
      lifetime.current++;
      setData(null); setSelection({ key: '', ids: [] }); setSavedRequest(null); setBusy(false); pendingRequest.current = null;
      void onChangedRef.current();
    }
    setError(reason instanceof ReactionError ? reason.message : 'The connection was interrupted. A sent choice may already be saved; retry the same choice to recover its result.');
  }, []);
  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    const epoch = lifetime.current;
    reading.current = true;
    try {
      const next = await request<{ reactions: Reactions }>();
      if (epoch !== lifetime.current) return;
      accept(next.reactions);
    } catch (reason) { if (epoch === lifetime.current) report(reason); }
    finally { reading.current = false; }
  }, [accept, report]);

  useEffect(() => {
    const epoch = lifetime.current + 1;
    lifetime.current = epoch;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden) await refresh();
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { stopped = true; lifetime.current = epoch + 1; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [revision, refresh]);
  const interruption = data?.pending;
  const choices = interruption?.orderChoices ?? [];
  const orderKey = `${interruption?.id ?? ''}:${choices.map(choice => choice.optionId).join(',')}`;
  const order = selection.key === orderKey ? selection.ids : [];

  async function send(decision: Decision) {
    if (writing.current) return;
    const epoch = lifetime.current;
    writing.current = true;
    pendingRequest.current = decision;
    setSavedRequest(decision); setBusy(true); setError(''); setNotice('');
    try {
      const next = await request<{ receipt: Roll; reactions: Reactions }>({ method: 'POST', body: JSON.stringify(decision) });
      if (epoch !== lifetime.current) return;
      accept(next.reactions);
      pendingRequest.current = null; setSavedRequest(null);
      setNotice(decision.decision === 'attack' ? 'Your attack is declared. Its saved roll appears after the reaction order is resolved.' : decision.decision === 'decline' ? 'You declined this opportunity attack.' : decision.decision === 'order' ? 'The chosen order has been saved.' : 'The interrupted movement has been checked. Eligible players still choose their own reactions.');
      await onChangedRef.current();
    } catch (reason) {
      if (epoch !== lifetime.current) return;
      if (reason instanceof ReactionError && reason.status < 500) { pendingRequest.current = null; setSavedRequest(null); }
      report(reason);
    } finally {
      writing.current = false;
      if (epoch === lifetime.current) { setBusy(false); void refresh(); }
    }
  }
  function choose(decision: 'attack' | 'decline' | 'refresh', optionId?: string) {
    if (!data || !interruption || busy || pendingRequest.current || interruption.paused) return;
    const common = { requestId: crypto.randomUUID(), expectedRevision: data.revision, pendingId: interruption.id };
    if (decision === 'refresh') { if (interruption.canRefresh) void send({ ...common, decision }); }
    else if (optionId && interruption.offers.some(offer => offer.optionId === optionId)) void send({ ...common, decision, optionId });
  }
  const ordered = order.map(id => choices.find(choice => choice.optionId === id)).filter((choice): choice is Choice => !!choice);
  const completeOrder = choices.length > 1 && ordered.length === choices.length && new Set(order).size === choices.length;
  const disabled = busy || !!savedRequest || !!interruption?.paused;
  function confirmOrder() {
    if (!data || !interruption?.canOrder || !completeOrder || disabled) return;
    void send({ requestId: crypto.randomUUID(), expectedRevision: data.revision, pendingId: interruption.id, decision: 'order', order: [...order] });
  }

  return <><ConcentrationPanel revision={revision} onChanged={onChanged} /><section className="rounded-xl border border-amber-100/20 bg-[#17131d] p-5" aria-label="Reactions">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Reactions</h2><button className={button} disabled={busy} onClick={() => void refresh()}>Refresh reactions</button></div>
    <p className="mb-3 text-sm text-stone-300">Reading this panel costs no action. An opportunity attack uses that character’s reaction when it resolves.</p>
    {error && <p role="alert" className="mb-3 text-amber-100">{error}</p>}
    {notice && <p role="status" className="mb-3 text-sm text-stone-200">{notice}</p>}
    {savedRequest && !busy && <div className="mb-3 rounded border border-amber-200/30 p-3"><p className="mb-2 text-sm">Recover the sent choice before making another decision.</p><button className={button} onClick={() => void send(savedRequest)}>Retry saved choice</button></div>}
    {!data && !error && <p className="text-stone-300">Loading your saved reaction choices…</p>}
    {data && !interruption && <p className="text-stone-300">No movement is waiting for a reaction.</p>}
    {interruption && <div className="space-y-4">
      <p className="text-sm text-amber-100">Movement is interrupted before leaving reach. Other actions wait until the reaction choices are resolved.</p>
      {interruption.paused && <p className="text-sm text-stone-300">Play is paused. Your choices remain saved; the host must resume play before anyone resolves them.</p>}
      {interruption.offers.map(offer => <div key={offer.optionId} className="rounded-lg border border-white/15 p-3"><p><strong>{offer.actorName}</strong> can make an opportunity attack against <strong>{offer.targetName}</strong>.</p><p className="my-2 text-sm text-stone-300">{typeof offer.weapon === 'string' ? offer.weapon : offer.weapon.name} · declaring an attack commits this choice; the roll waits for any required ordering.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={() => choose('attack', offer.optionId)}>Declare attack · use reaction</button><button className={button} disabled={disabled} onClick={() => choose('decline', offer.optionId)}>Decline attack</button></div></div>)}
      {interruption.stage === 'order' && interruption.canOrder && <div className="space-y-3"><p className="text-sm">Choose the order of the declared attacks. Select every listed reaction once, then confirm.</p>{ordered.length > 0 && <ol className="list-inside list-decimal space-y-2">{ordered.map(choice => <li key={choice.optionId}>{choice.label}</li>)}</ol>}{!completeOrder && <><label htmlFor="reaction-order" className="block text-sm">Reaction in position {ordered.length + 1}</label><select id="reaction-order" value="" disabled={disabled} onChange={event => { const value = event.target.value; if (choices.some(choice => choice.optionId === value) && !order.includes(value)) setSelection({ key: orderKey, ids: [...order, value] }); }} className="w-full rounded border border-white/30 bg-[#24212a] p-3"><option value="">Choose a declared reaction</option>{choices.filter(choice => !order.includes(choice.optionId)).map(choice => <option key={choice.optionId} value={choice.optionId}>{choice.label}</option>)}</select></>}<div className="flex flex-wrap gap-2"><button className={button} disabled={disabled || !order.length} onClick={() => setSelection({ key: orderKey, ids: [] })}>Start order again</button><button className={button} disabled={disabled || !completeOrder} onClick={confirmOrder}>Confirm this order</button></div></div>}
      {!interruption.offers.length && !(interruption.stage === 'order' && interruption.canOrder) && <p className="text-sm text-stone-300">Waiting for the required player decisions.</p>}
      {interruption.canRefresh && <div><button className={button} disabled={disabled} onClick={() => choose('refresh')}>Check interrupted movement</button><p className="mt-2 text-xs text-stone-300">Checks whether a responder has become ineligible. It does not decline a valid player’s reaction.</p></div>}
    </div>}
    {!!data?.recentResults.length && <div className="mt-5 border-t border-white/15 pt-4"><h3 className="mb-2 font-medium">Your saved reaction rolls</h3><ul className="space-y-3">{data.recentResults.map(roll => <li key={roll.requestId}><p className="text-sm">d20 {roll.result.dice?.join(', ')}{roll.result.modifiers?.map(modifier => ` ${modifier.value < 0 ? '−' : '+'} ${Math.abs(modifier.value)} ${modifier.source}`).join('')} = <strong>{roll.result.total}</strong></p><p className="text-sm text-stone-300">{roll.result.hit ? `Hit · ${roll.result.damage} damage` : 'Miss'} · revision {roll.revision}</p></li>)}</ul></div>}
  </section></>;
}
