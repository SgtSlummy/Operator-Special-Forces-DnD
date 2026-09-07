'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../client/api.mjs';

type Calendar = { label: string; unitLabel: string; ticksPerDay: number; tick: number; day: number; tickWithinDay: number };
type Change = { type: string; id: string; field?: string; label: string; before: unknown; after: unknown };
type Event = { id: string; tick: number; kind: string; summary: string; changes?: Change[]; reviewReason?: string };
type Decision = { id: string; label: string; summary: string; available: boolean; unavailableReason?: string; consequences: Change[]; evidence: unknown };
type Fence = { gameRevision: number; worldRevision: number; timeRevision: number };
type TimeView = Fence & {
  configured: boolean; campaign: string; owner: string; role: string; phase: string; canAdvance: boolean; blockedReason?: string; calendar?: Calendar;
  entities?: { id: string; label: string; kind: string }[];
  facts?: { id: string; entityId: string; kind: string; label: string; value: unknown }[];
  knowledge?: { id: string; subjectId: string; factId: string; status: string }[];
  opportunities?: { id: string; title: string; status: string }[];
  deadlines?: { id: string; label: string; opportunityId: string; atTick: number; status: string }[];
  clocks?: { id: string; label: string; value: number; maximum: number; status: string }[];
  events?: Event[]; decisionOptions?: Decision[];
};
type Preview = Fence & { previewId: string; fromTick: number; targetTick: number; reason: string; calendar: Calendar; events: Event[] };
type Receipt = Fence & { requestId: string; operation: string; calendar: Calendar; events: Event[]; fromTick?: number; targetTick?: number };
type Packet = { action: 'preview' | 'advance' | 'decision'; requestId: string; expectedGameRevision: number; expectedWorldRevision: number; expectedTimeRevision: number; reviewed: true; targetTick?: number; reason?: string; previewId?: string; decisionId?: string };
type Reply = { time: TimeView; preview?: Preview; receipt?: Receipt; error?: string };
const identity = (value: TimeView) => `${value.campaign}:${value.owner}:${value.role}`;
const sameFence = (a: Fence, b: Fence) => a.gameRevision === b.gameRevision && a.worldRevision === b.worldRevision && a.timeRevision === b.timeRevision;
const words = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ');
function readable(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readable).join('; ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${words(key)}: ${readable(item)}`).join('; ');
  return '';
}
function calendarPoint(calendar: Calendar, tick = calendar.tick) {
  const offset = tick - calendar.tick + calendar.tickWithinDay;
  const day = calendar.day + Math.floor(offset / calendar.ticksPerDay);
  const part = ((offset % calendar.ticksPerDay) + calendar.ticksPerDay) % calendar.ticksPerDay;
  return `Day ${day}${calendar.ticksPerDay > 1 ? ` · ${part} ${calendar.unitLabel} into the day` : ''}`;
}
class RequestFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function send(packet?: Packet): Promise<Reply> {
  const response = await apiFetch('/api/game/world-time', packet ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet), signal: AbortSignal.timeout(15000) } : { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  let data: Reply;
  try { data = await response.json(); } catch { throw new RequestFailure(response.status >= 400 ? response.status : 503, 'The world timeline response was interrupted.'); }
  if (!response.ok) throw new RequestFailure(response.status, data.error ?? 'The world timeline request could not finish.');
  if (!data.time || typeof data.time.campaign !== 'string' || typeof data.time.owner !== 'string' || typeof data.time.role !== 'string') throw new RequestFailure(503, 'The world timeline response is incomplete.');
  return data;
}
function Events({ events, calendar }: { events: Event[]; calendar: Calendar }) {
  return events.length ? <ol className="space-y-3">{events.map((event, index) => <li key={`${event.id}:${index}`} className="border-l border-amber-200/30 pl-3"><p className="text-xs text-stone-400">{calendarPoint(calendar, event.tick)}</p><p>{event.summary}</p>{event.changes?.length ? <ul className="mt-1 text-sm text-stone-300">{event.changes.map((change, i) => <li key={i}>{change.label}: {readable(change.before)} → {readable(change.after)}</li>)}</ul> : null}{event.reviewReason && <p className="mt-1 text-sm">Host reason: {event.reviewReason}</p>}</li>)}</ol> : <p className="text-sm text-stone-400">No events in this view.</p>;
}

export default function WorldTimePanel({ gameRevision }: { gameRevision: number }) {
  const [time, setTime] = useState<TimeView | null>(null), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), mounted = useRef(false);
  const invalidate = useCallback(() => { epoch.current++; }, []);
  const apply = useCallback((next: TimeView) => {
    if (!mounted.current) return;
    epoch.current++;
    setTime(current => !current || identity(current) !== identity(next) || (next.gameRevision >= current.gameRevision && next.worldRevision >= current.worldRevision && next.timeRevision >= current.timeRevision) ? next : current);
    setConnected(true); setError('');
  }, []);
  const disconnect = useCallback(() => { epoch.current++; setTime(null); setConnected(false); setError('Reconnect to view your world timeline.'); }, []);
  const refresh = useCallback(async () => {
    const requestEpoch = ++epoch.current;
    try {
      const data = await send();
      if (mounted.current && requestEpoch === epoch.current) apply(data.time);
    } catch (failure) {
      if (!mounted.current || requestEpoch !== epoch.current) return;
      if (failure instanceof RequestFailure && [401, 403].includes(failure.status)) disconnect();
      else { setConnected(false); setError('The world timeline connection was interrupted. Retrying automatically.'); }
    }
  }, [apply, disconnect]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); }
    void poll();
    return () => { stopped = true; mounted.current = false; invalidate(); clearTimeout(timer); };
  }, [gameRevision, invalidate, refresh]);
  return <details className="my-4 rounded-lg border border-amber-100/20 p-4"><summary className="cursor-pointer text-lg">World timeline</summary>
    {error && <p role="status" className="my-2 text-amber-200">{error}</p>}
    {!time ? <p className="mt-2 text-sm">Loading your world timeline…</p> : <WorldTimeView key={identity(time)} time={time} current={connected && time.gameRevision >= gameRevision} onResult={apply} onUnauthorized={disconnect} onRefresh={refresh} />}
  </details>;
}
function WorldTimeView({ time, current, onResult, onUnauthorized, onRefresh }: { time: TimeView; current: boolean; onResult: (time: TimeView) => void; onUnauthorized: () => void; onRefresh: () => Promise<void> }) {
  const [elapsed, setElapsed] = useState(''), [reason, setReason] = useState(''), [decisionId, setDecisionId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null), [decision, setDecision] = useState<{ option: Decision; packet: Packet } | null>(null);
  const [pending, setPending] = useState<Packet | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fence = (value: Fence) => ({ expectedGameRevision: value.gameRevision, expectedWorldRevision: value.worldRevision, expectedTimeRevision: value.timeRevision });
  const canAct = current && time.role === 'host' && time.canAdvance;
  const reviewCurrent = preview ? sameFence(preview, time) : decision ? decision.packet.expectedGameRevision === time.gameRevision && decision.packet.expectedWorldRevision === time.worldRevision && decision.packet.expectedTimeRevision === time.timeRevision : false;
  async function execute(packet: Packet) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setPending(packet); setError('');
    try {
      const data = await send(packet);
      if (!mounted.current) return;
      if (packet.action === 'preview' ? !data.preview : !data.receipt) throw new RequestFailure(503, 'The saved world response was incomplete. Retry the same request.');
      onResult(data.time); setPending(null); setReviewed(false);
      if (packet.action === 'preview') {
        setPreview(data.preview!); setDecision(null);
      } else { setReceipt(data.receipt ?? null); setPreview(null); setDecision(null); setReason(''); setElapsed(''); }
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof RequestFailure && failure.status < 500) {
        setPending(null); setPreview(null); setDecision(null); setReviewed(false);
        if ([401, 403].includes(failure.status)) { onUnauthorized(); return; }
        void onRefresh();
      } else setPending(packet);
      setError(failure instanceof Error ? failure.message : 'Retry the same saved request after reconnecting.');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  function previewInterval() {
    if (!canAct || pending || !time.calendar || !reason.trim()) return;
    const amount = Number(elapsed), targetTick = time.calendar.tick + amount;
    if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(targetTick)) { setError('Enter a positive whole amount of fictional time.'); return; }
    void execute({ action: 'preview', requestId: crypto.randomUUID(), ...fence(time), reviewed: true, targetTick, reason: reason.trim() });
  }
  function reviewDecision() {
    if (!canAct || pending || !reason.trim()) return;
    const option = time.decisionOptions?.find(value => value.id === decisionId && value.available);
    if (!option) return;
    setDecision({ option: structuredClone(option), packet: { action: 'decision', requestId: crypto.randomUUID(), ...fence(time), reviewed: true, decisionId: option.id, reason: reason.trim() } }); setPreview(null); setReviewed(false); setError('');
  }
  if (!time.configured || !time.calendar) return <p className="mt-3 text-sm">The host has not attached a reviewed calendar and world events to this campaign. Fictional time has not been inferred from your play history.</p>;
  const calendar = time.calendar, entities = new Map(time.entities?.map(entity => [entity.id, entity.label])), facts = new Map(time.facts?.map(fact => [fact.id, fact.label]));
  return <div className="mt-3 space-y-4">
    <div><p className="text-sm text-stone-400">{calendar.label}</p><p className="text-xl">{calendarPoint(calendar)}</p><p className="mt-1 text-sm text-stone-300">Time advances when the host confirms that time passed in the story.</p>{time.role === 'host' && <p className="mt-1 text-xs text-amber-200">Host view includes private world information.</p>}</div>
    <details><summary className="cursor-pointer">Opportunities and deadlines</summary><ul className="mt-2 space-y-2">{time.opportunities?.map(item => <li key={item.id}><strong>{item.title}</strong> · {words(item.status)}</li>)}{time.deadlines?.map(item => <li key={item.id}>{item.label} · {calendarPoint(calendar, item.atTick)} · {words(item.status)}</li>)}</ul></details>
    <details><summary className="cursor-pointer">World pressures</summary><ul className="mt-2 space-y-2">{time.clocks?.map(item => <li key={item.id}>{item.label}: {item.value}/{item.maximum} · {words(item.status)}</li>)}</ul></details>
    <details><summary className="cursor-pointer">Places, people and lasting facts</summary><ul className="mt-2 space-y-2">{time.entities?.map(item => <li key={item.id}>{item.label} · {words(item.kind)}</li>)}</ul><ul className="mt-3 space-y-2">{time.facts?.map(item => <li key={item.id}><strong>{item.label}</strong>: {readable(item.value)}{entities.has(item.entityId) ? ` · ${entities.get(item.entityId)}` : ''}</li>)}</ul>{!!time.knowledge?.length && <ul className="mt-3 space-y-2">{time.knowledge.map(item => <li key={item.id}>{entities.get(item.subjectId) ?? 'Unidentified subject'} · {facts.get(item.factId) ?? 'Undisclosed fact'} · {words(item.status)}</li>)}</ul>}</details>
    <details><summary className="cursor-pointer">Recorded events</summary><div className="mt-3"><Events events={time.events ?? []} calendar={calendar} /></div></details>
    {time.role === 'host' && <div className="rounded-lg border border-amber-200/20 p-3">
      <h4 className="font-semibold">Host world decisions</h4>
      {!canAct && <p role="status" className="mt-2 text-sm">{!current ? 'Refresh the current world and scene before reviewing a change.' : time.blockedReason || 'World changes are unavailable in this phase.'}</p>}
      {error && <p role="alert" className="my-2 text-amber-200">{error}</p>}
      {pending ? <div className="mt-3"><p className="text-sm">This request may already be saved. Retry it to retrieve its exact result.</p><button type="button" disabled={busy} onClick={() => void execute(pending)} className="mt-2 rounded border border-amber-200/40 px-3 py-2">{busy ? 'Checking saved request…' : 'Retry the same request'}</button></div> : preview || decision ? <div className="mt-3 space-y-3">
        {preview ? <><p>{calendarPoint(calendar, preview.fromTick)} → {calendarPoint(calendar, preview.targetTick)}</p><p>Reason: {preview.reason}</p><Events events={preview.events} calendar={calendar} /></> : decision && <><h5>{decision.option.label}</h5><p>{decision.option.summary}</p><p>Reason: {decision.packet.reason}</p><ul className="space-y-1 text-sm" aria-label="Reviewed consequences">{decision.option.consequences.map((change, index) => <li key={index}>{change.label}: {readable(change.before)} → {readable(change.after)}</li>)}</ul><p className="text-sm">Evidence: {readable(decision.option.evidence)}</p></>}
        {!reviewCurrent && <p role="status" className="text-amber-200">The world or scene changed. Discard this review and prepare a current one.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={!canAct || !reviewCurrent} onChange={event => setReviewed(event.target.checked)} />I reviewed these consequences and confirm this change in the story.</label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={!canAct || !reviewCurrent || !reviewed || busy} onClick={() => { if (preview) void execute({ action: 'advance', requestId: crypto.randomUUID(), ...fence(preview), reviewed: true, previewId: preview.previewId }); else if (decision) void execute(decision.packet); }} className="rounded border border-amber-200/40 px-3 py-2">Confirm world change</button><button type="button" onClick={() => { setPreview(null); setDecision(null); setReviewed(false); }} className="rounded border border-white/20 px-3 py-2">Discard review</button></div>
      </div> : <fieldset disabled={!canAct || busy} className="mt-3 space-y-3">
        <label className="block">Why did time pass or the world change?<textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border border-white/30 bg-black/20 p-2" /></label>
        <div className="flex flex-wrap items-end gap-2"><label>Elapsed {calendar.unitLabel}<input type="number" min="1" step="1" value={elapsed} onChange={event => setElapsed(event.target.value)} className="mt-1 block w-32 rounded border border-white/30 bg-black/20 p-2" /></label><button type="button" disabled={!reason.trim() || !elapsed} onClick={previewInterval} className="rounded border border-amber-200/40 px-3 py-2">Preview time advance</button></div>
        {!!time.decisionOptions?.length && <div className="flex flex-wrap items-end gap-2"><label>Reviewed story decision<select aria-label="Reviewed story decision" value={decisionId} onChange={event => setDecisionId(event.target.value)} className="mt-1 block max-w-full rounded border border-white/30 bg-stone-900 p-2"><option value="">Choose a decision</option>{time.decisionOptions.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.label}{option.available ? '' : ` — ${option.unavailableReason || 'Unavailable'}`}</option>)}</select></label><button type="button" disabled={!reason.trim() || !time.decisionOptions.some(option => option.id === decisionId && option.available)} onClick={reviewDecision} className="rounded border border-amber-200/40 px-3 py-2">Review story decision</button></div>}
      </fieldset>}
    </div>}
    {receipt && <details open className="rounded-lg border border-emerald-200/20 p-3"><summary className="cursor-pointer">Saved world change · {calendarPoint(receipt.calendar)}</summary><div className="mt-3"><Events events={receipt.events} calendar={receipt.calendar} /></div></details>}
  </div>;
}
