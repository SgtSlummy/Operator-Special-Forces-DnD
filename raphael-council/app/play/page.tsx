'use client';
import { apiFetch as fetch, apiPath } from '../../client/api.mjs';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { coordinate, octagonPoints } from '../../maps/grid.mjs';
import { tacticalControls, movementPreview, MAX_MOVE_STEPS } from '../../client/tactical-controls.mjs';
import SceneImages from '../scene-images';
import Journal from './journal';
import CharacterInspector from '../character-inspector';
import Mission from './mission';
import AiPanel from './ai';
import ChroniclePanel from './chronicle';
import ReactionPanel from './reactions';
import { CheckRequestPanel } from './check-request-panel';

type Point = { x: number; y: number };
type Actor = Point & { id: string; name: string; size: number; controlled: boolean; defeated: boolean; hp?: number; maxHp?: number; speed?: number };
type View = { campaign: string; title: string; revision: number; phase: string; resumePhase?: string; canResume?: boolean; pendingReaction?: { kind: 'opportunity_attack' }; pendingConcentration?: { waiting: true }; round: number; turn: number; activeActorId: string | null; movementRemaining: number | null; actionAvailable: boolean | null; map: { title: string; width: number; height: number; cells: Point[]; blocked: Point[]; difficult: Point[] }; actors: Actor[]; effects: { id: string; name: string; trigger: string; expiresAtTurn: number; cells: Point[] }[] };
type Command = { requestId: string; actorId: string; expectedRevision: number; type: string; path?: Point[]; targetId?: string };
type Receipt = { requestId: string; revision: number; result: { type: string; dice?: number[]; modifiers?: { source: string; value: number }[]; total?: number; hit?: boolean; damage?: number } };
type UpdatePage = { views: View[]; next: number; current: number; hasMore: boolean };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(path = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/game${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || 'The game could not complete this request.', response.status);
  return data;
}
const button = 'rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10 disabled:opacity-40 disabled:cursor-not-allowed';
const cellKey = (p: Point) => `${p.x},${p.y}`;

export default function Play({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = useState<View | null>(null), [receipts, setReceipts] = useState<Receipt[]>([]);
  const [connected, setConnected] = useState(false), [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [destination, setDestination] = useState(''), [target, setTarget] = useState(''), [selectedActor, setSelectedActor] = useState('');
  const [pending, setPending] = useState<Command | null>(null);
  const pendingRef = useRef<Command | null>(null);
  const sessionEpoch = useRef(0);
  const revisionCursor = useRef<number | null>(null);
  const refreshing = useRef(false);
  const [history, setHistory] = useState<View[]>([]);
  const acceptView = useCallback((next: View) => setView(current => !current || next.campaign !== current.campaign || next.revision >= current.revision ? next : current), []);
  const report = useCallback((reason: unknown) => {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) { sessionEpoch.current++; setBusy(false); setConnected(false); setView(null); setReceipts([]); setHistory([]); revisionCursor.current = null; pendingRef.current = null; setPending(null); }
    setError(reason instanceof ApiError ? reason.message : 'The connection was interrupted. Refresh, or retry the saved action.');
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const epoch = sessionEpoch.current;
    try {
      const data = await api<{ view: View; receipts: Receipt[] }>();
      if (epoch !== sessionEpoch.current) return;
      acceptView(data.view); setReceipts(data.receipts); setConnected(true);
      if (pendingRef.current && data.receipts.some(r => r.requestId === pendingRef.current?.requestId)) { pendingRef.current = null; setPending(null); setError(''); }
      if (revisionCursor.current === null) { revisionCursor.current = data.view.revision; setHistory([data.view]); }
      else {
        // Fetch a bounded page. A disconnected tab resumes from its last received
        // revision; reading updates never consumes another player's delivery.
        const page = await api<UpdatePage>(`/updates?after=${revisionCursor.current}`);
        if (epoch !== sessionEpoch.current) return;
        setHistory(current => [...current, ...page.views.filter(v => !current.some(p => p.revision === v.revision))].slice(-100));
        revisionCursor.current = page.next;
      }
    } catch (reason) { if (epoch === sessionEpoch.current) report(reason); }
    finally { refreshing.current = false; }
  }, [acceptView, report]);
  const refreshForCheckReview = useCallback(async () => {
    const epoch = sessionEpoch.current, campaign = view?.campaign;
    try {
      const data = await api<{ view: View; receipts: Receipt[] }>();
      if (epoch !== sessionEpoch.current || data.view.campaign !== campaign) throw new Error('The campaign session changed during refresh.');
      acceptView(data.view); setReceipts(data.receipts); setConnected(true);
    } catch (reason) {
      if (epoch === sessionEpoch.current) report(reason);
      throw reason;
    }
  }, [acceptView, report, view?.campaign]);
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() { if (!document.hidden) await refresh(); if (!cancelled) timer = setTimeout(poll, 2000); }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh]);
  const controls = tacticalControls(view, selectedActor);
  const interrupted = Boolean(view?.pendingReaction || view?.pendingConcentration);
  const active = controls.active as Actor | undefined;
  const actor = controls.actor as Actor | undefined;
  const preview = useMemo(() => movementPreview(view, tacticalControls(view, selectedActor).actor, destination), [view, selectedActor, destination]);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    sessionEpoch.current++; setView(null); setReceipts([]); setHistory([]); revisionCursor.current = null; pendingRef.current = null; setPending(null);
    try { await api('/access', { method: 'POST', body: JSON.stringify({ token: token.trim() }) }); setConnected(true); await refresh(); }
    catch (reason) { report(reason); } finally { setToken(''); setBusy(false); }
  }
  async function send(command: Command) {
    const epoch = sessionEpoch.current;
    setBusy(true); setError(''); pendingRef.current = command; setPending(command);
    try {
      const data = await api<{ receipt: Receipt; view: View }>('', { method: 'POST', body: JSON.stringify(command) });
      if (epoch !== sessionEpoch.current) return;
      acceptView(data.view); setReceipts(current => [data.receipt, ...current.filter(r => r.requestId !== data.receipt.requestId)].slice(0, 20));
      pendingRef.current = null; setPending(null); setDestination('');
    } catch (reason) {
      if (epoch !== sessionEpoch.current) return;
      if (reason instanceof ApiError && reason.status < 500) { pendingRef.current = null; setPending(null); }
      report(reason);
    } finally { setBusy(false); }
  }
  function act(type: string) {
    if (!view || busy || pending || (interrupted && !['pause', 'resume'].includes(type))) return;
    const commandActor = ['pause', 'resume'].includes(type) ? controls.transitionActor : actor;
    const allowed = { move: controls.canMove, attack: controls.canAttack, end_turn: controls.canEnd, pause: controls.canPause, resume: controls.canResume }[type];
    if (!commandActor || !allowed) return;
    const command: Command = { type, actorId: commandActor.id, expectedRevision: view.revision, requestId: crypto.randomUUID() };
    if (type === 'move') { if (!preview?.path.length) return; command.path = preview.path; }
    if (type === 'attack') command.targetId = target;
    void send(command);
  }
  const visible = new Set(view?.map.cells.map(cellKey)), blocked = new Set(view?.map.blocked.map(cellKey));
  const pathKeys = new Set(preview?.path.map(cellKey));
  async function disconnect() {
    sessionEpoch.current++; pendingRef.current = null; setPending(null); setConnected(false); setView(null); setReceipts([]); setHistory([]); revisionCursor.current = null;
    try { await api('/access', { method: 'DELETE' }); await fetch('/api/auth/logout', { method: 'POST' }); } catch (reason) { report(reason); }
  }
  return <main className="min-h-screen bg-[#0b0a13] p-4 text-[#f7f3e8] md:p-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm tracking-widest text-amber-300">{embedded ? 'DAVY JONES · RAPHAEL' : 'RAPHAEL'}</p><h1 className="font-serif text-3xl">{view?.map.title || 'Tactical table'}</h1></div><nav className="flex flex-wrap items-center gap-3">{!embedded && <Link href="/" className={button}>Campaign council</Link>}<SceneImages key={connected ? view?.campaign || 'joining' : 'disconnected'} apiBase="/api/game/scene-images" sharedSession reachApiBase="/api/game" reachSessionKey={`${connected}:${view?.campaign || ''}`} />{connected && <button className={button} disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}</nav></header>
    {!connected && !embedded && <p className="mb-4 text-center"><a href="/api/auth/discord/start" className={button}>Sign in with Discord</a></p>}
    {!connected && <form onSubmit={connect} className="mx-auto max-w-lg rounded-xl border border-amber-100/20 bg-[#24212a] p-6"><h2 className="mb-3 text-xl">Join your campaign</h2><p className="mb-5 text-base text-stone-300">Use the private player access code from your host. Your character, current turn and visible map will load from the saved campaign.</p><label htmlFor="access" className="mb-2 block">Player access code</label><input id="access" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="mb-4 w-full rounded border border-white/30 bg-black/30 p-3" required /><button className={button} disabled={busy}>Connect to the table</button></form>}
    {error && <div role="alert" className="my-4 rounded border border-amber-400/30 p-4 text-amber-100">{error}{pending && <button className={`${button} ml-4`} disabled={busy} onClick={() => void send(pending)}>Retry saved action</button>}</div>}
    {connected && view && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 rounded-xl border border-amber-100/20 bg-[#17131d] p-4" aria-label="Visible scene map">
        <div className="mb-3 flex flex-wrap justify-between gap-3 text-sm"><span>{controls.status}</span><span>Revision {view.revision}{view.phase === 'combat' ? ` · ${active?.name || 'Another actor'} acting` : ''}</span></div>
        <div className="max-h-[72vh] overflow-auto"><svg viewBox={`0 0 ${view.map.width * 64} ${view.map.height * 64}`} className="w-full min-w-[480px]" role="img" aria-label="Octagonal map. Use the destination field for keyboard movement.">
          {Array.from({ length: view.map.width * view.map.height }, (_, i) => {
            const x = i % view.map.width, y = Math.floor(i / view.map.width), k = `${x},${y}`, seen = visible.has(k);
            return <g key={k} onClick={() => seen && setDestination(coordinate(x, y))} style={{ cursor: seen ? 'pointer' : 'default' }}><polygon points={octagonPoints(x, y, 64).map((p: number[]) => p.join(',')).join(' ')} fill={!seen ? '#111019' : pathKeys.has(k) ? '#49626b' : blocked.has(k) ? '#534957' : '#24212a'} stroke={seen ? '#776653' : '#24212a'} /><text x={x * 64 + 10} y={y * 64 + 15} fontSize="11" fill="#d0b8a3">{seen ? coordinate(x, y) : ''}</text></g>;
          })}
          {view.effects.flatMap(effect => effect.cells.map(p => <g key={`${effect.id}-${cellKey(p)}`} pointerEvents="none"><polygon points={octagonPoints(p.x, p.y, 64).map((v: number[]) => v.join(',')).join(' ')} fill="#ee9b3a44" stroke="#ee9b3a" strokeDasharray="4 3" /><text x={p.x * 64 + 25} y={p.y * 64 + 43} fill="#fff3cf" fontSize="22">!</text></g>))}
          {view.actors.map(actor => <g key={actor.id} onClick={() => controls.exploration && actor.controlled && !actor.defeated ? setSelectedActor(actor.id) : setTarget(actor.id)}><circle cx={(actor.x + actor.size / 2) * 64} cy={(actor.y + actor.size / 2) * 64} r={19 * actor.size} fill={actor.defeated ? '#57505a' : actor.controlled ? '#5c8da1' : '#945550'} stroke={actor.id === view.activeActorId ? '#ee9b3a' : '#e7d1b1'} strokeWidth={actor.id === view.activeActorId ? 4 : 1} /><text x={(actor.x + actor.size / 2) * 64} y={(actor.y + actor.size / 2) * 64 + 5} textAnchor="middle" fontSize="14" fill="white">{actor.name.slice(0, 2).toUpperCase()}</text><title>{actor.name} · {coordinate(actor.x, actor.y)}</title></g>)}
        </svg></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-stone-300">5 feet per octagon, including diagonals. Marked cells have lingering effects.</p><div className="flex gap-2"><button className={button} onClick={() => void refresh()}>Refresh map</button><a href={apiPath(`/api/game/map?revision=${view.revision}`)} target="_blank" rel="noreferrer" className={button}>Map image</a></div></div>
      </section>
      <aside className="space-y-5"><section className="rounded-xl border border-amber-100/20 p-5">
        <h2 className="mb-3 text-xl">{controls.exploration ? 'Explore the scene' : view.phase === 'complete' ? 'Scene complete' : 'Your turn'}</h2>
        <p className="mb-4 text-stone-300">{controls.exploration ? controls.resources : controls.canMove ? `${actor?.name} · ${view.movementRemaining} feet remaining` : 'You can inspect the saved map while play is paused or another character acts.'}</p>
        {controls.exploration && <><label htmlFor="movement-character" className="block text-sm">Character to move</label><select id="movement-character" value={actor?.id ?? ''} disabled={busy || !!pending} onChange={e => setSelectedActor(e.target.value)} className="my-2 w-full rounded border border-white/30 bg-[#24212a] p-3">{!controls.owned.length && <option value="">No living character you control</option>}{controls.owned.map((a: Actor) => <option key={a.id} value={a.id}>{a.name} · {coordinate(a.x, a.y)}</option>)}</select></>}
        <label htmlFor="destination" className="block text-sm">Move to coordinate</label><input id="destination" value={destination} onChange={e => setDestination(e.target.value)} placeholder="For example, C4" className="my-2 w-full rounded border border-white/30 bg-black/20 p-3" />
        <p className="mb-3 text-sm text-stone-300">{destination ? preview ? `Route ${controls.exploration ? 'distance' : 'cost'}: ${controls.exploration ? preview.path.length * 5 : preview.cost} feet` : controls.canMove ? `No legal visible route in one move (up to ${MAX_MOVE_STEPS} steps${controls.exploration ? '' : ' within remaining movement'}). Choose a closer visible cell.` : 'Movement is unavailable in the current state.' : 'Select a visible cell or enter its coordinate.'}</p>
        {interrupted && <p role="status" className="mb-3 text-sm text-amber-100">{view.pendingConcentration ? 'Actions are waiting for a concentration save. Use the Concentration panel below.' : 'Actions are waiting for reaction choices. Use the Reactions panel below.'}</p>}
        <button className={button} disabled={interrupted || !controls.canMove || !preview?.path.length || busy || !!pending} onClick={() => act('move')}>Move along preview</button>
        {!controls.exploration && <><label htmlFor="target" className="mt-5 block text-sm">Attack target</label><select id="target" value={target} onChange={e => setTarget(e.target.value)} className="my-2 w-full rounded border border-white/30 bg-[#24212a] p-3"><option value="">Choose a visible character</option>{view.actors.filter(a => a.id !== active?.id && !a.defeated).map(a => <option key={a.id} value={a.id}>{a.name} · {coordinate(a.x, a.y)}</option>)}</select><div className="flex flex-wrap gap-2"><button className={button} disabled={interrupted || !controls.canAttack || !target || busy || !!pending} onClick={() => act('attack')}>Attack · spend action</button><button className={button} disabled={interrupted || !controls.canEnd || busy || !!pending} onClick={() => act('end_turn')}>End turn</button></div></>}
        <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={!controls.canPause || busy || !!pending} onClick={() => act('pause')}>Pause play</button>{view.phase === 'paused' && <button className={button} disabled={!controls.canResume || busy || !!pending} onClick={() => act('resume')}>Resume · host only</button>}</div>
        {view.phase === 'paused' && <p className="mt-2 text-sm text-stone-300">Play is paused. The host can resume {controls.exploration ? 'exploration' : 'combat'}. Images and distance questions remain available.</p>}
      </section>
        <ReactionPanel key={`reactions:${view.campaign}`} revision={view.revision} onChanged={refresh} />
        <CharacterInspector key={view.campaign} revision={view.revision} />
        <section className="rounded-xl border border-amber-100/20 p-5"><h2 className="mb-3 text-xl">Lingering effects</h2>{view.effects.length ? <ul className="space-y-3">{view.effects.map(e => <li key={e.id}><strong>{e.name}</strong><p className="text-sm text-stone-300">{e.cells.map(p => coordinate(p.x, p.y)).join(', ')} · expires before turn {e.expiresAtTurn}</p></li>)}</ul> : <p className="text-stone-300">No visible lingering effects.</p>}</section>
        <section className="rounded-xl border border-amber-100/20 p-5"><h2 className="mb-3 text-xl">Your saved rolls</h2>{receipts.filter(r => r.result.type === 'attack').length ? <ul className="space-y-3">{receipts.filter(r => r.result.type === 'attack').map(r => <li key={r.requestId}><p>d20 {r.result.dice?.join(', ')}{r.result.modifiers?.map(m => ` + ${m.value} ${m.source}`).join('')} = <strong>{r.result.total}</strong></p><p className="text-sm text-stone-300">{r.result.hit ? `Hit · ${r.result.damage} damage` : 'Miss'} · revision {r.revision}</p></li>)}</ul> : <p className="text-stone-300">Resolved attacks will appear here.</p>}</section>
      </aside>
    </div>}
    {connected && history.length > 0 && <RevisionHistory frames={history} currentRevision={view?.revision ?? 0} />}
    {connected && view && <CheckRequestPanel campaign={view.campaign} gameRevision={view.revision} onRefreshGame={refreshForCheckReview} onRequested={() => void refresh()} />}
    {connected && view && <Journal key={`journal:${view.campaign}`} />}
    {connected && view && <Mission key={`mission:${view.campaign}`} gameRevision={view.revision} />}
    {connected && view && <AiPanel key={`assistance:${view.campaign}`} revision={view.revision} />}
    {connected && view && <ChroniclePanel key={`chronicle:${view.campaign}`} />}
  </main>;
}

function RevisionHistory({ frames, currentRevision }: { frames: View[]; currentRevision: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const frame = frames.find(v => v.revision === selected) ?? frames[frames.length - 1];
  const blocked = new Set(frame.map.blocked.map(cellKey));
  return <section className="mt-5 rounded-xl border border-amber-100/20 bg-[#17131d] p-5" aria-label="Saved map updates">
    <h2 className="text-xl">Saved map updates</h2>
    <p className="my-2 text-sm text-stone-300">Read-only snapshots received since joining this table, including individual movement steps and effect changes. The latest 100 are retained here. Actions use the live board above.</p>
    <label htmlFor="history-revision" className="mr-3">Inspect revision</label>
    <select id="history-revision" value={selected !== null && frames.some(v => v.revision === selected) ? selected : ''} onChange={event => setSelected(event.target.value ? Number(event.target.value) : null)} className="my-2 rounded border border-white/30 bg-[#24212a] p-2">
      <option value="">Latest received</option>
      {frames.map(v => <option key={v.revision} value={v.revision}>Revision {v.revision} · round {v.round} · turn {v.turn}</option>)}
    </select>
    <p className="mb-3 text-sm">Showing saved revision {frame.revision} · live revision {currentRevision}{frames[frames.length - 1].revision < currentRevision ? ' · catching up' : ''}</p>
    <div className="grid gap-4 md:grid-cols-2">
      <svg viewBox={`0 0 ${frame.map.width * 64} ${frame.map.height * 64}`} className="max-h-96 w-full bg-[#111019]" role="img" aria-label={`Read-only map at revision ${frame.revision}`}>
        {frame.map.cells.map(p => <polygon key={cellKey(p)} points={octagonPoints(p.x, p.y, 64).map((v: number[]) => v.join(',')).join(' ')} fill={blocked.has(cellKey(p)) ? '#534957' : '#24212a'} stroke="#776653" />)}
        {frame.effects.flatMap(e => e.cells.map(p => <polygon key={`${e.id}-${cellKey(p)}`} points={octagonPoints(p.x, p.y, 64).map((v: number[]) => v.join(',')).join(' ')} fill="#ee9b3a44" stroke="#ee9b3a" strokeDasharray="4 3" />))}
        {frame.actors.map(a => <g key={a.id}><circle cx={(a.x + a.size / 2) * 64} cy={(a.y + a.size / 2) * 64} r={19 * a.size} fill={a.defeated ? '#57505a' : a.controlled ? '#5c8da1' : '#945550'} stroke="#e7d1b1" /><text x={(a.x + a.size / 2) * 64} y={(a.y + a.size / 2) * 64 + 5} textAnchor="middle" fill="white" fontSize="14">{a.name.slice(0, 2).toUpperCase()}</text></g>)}
      </svg>
      <div><ul className="space-y-1">{frame.actors.map(a => <li key={a.id}>{a.name} · {coordinate(a.x, a.y)}{a.hp !== undefined ? ` · HP ${a.hp}/${a.maxHp}` : ''}</li>)}</ul><p className="mt-3">Effects: {frame.effects.map(e => e.name).join(', ') || 'none visible'}</p></div>
    </div>
  </section>;
}
