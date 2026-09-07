'use client';
import { apiFetch as fetch } from '../client/api.mjs';

import { useEffect, useId, useRef, useState } from 'react';

type Choice = { id: string; label: string };
type ReachOptions = { revision: number; actors: Choice[]; targets: Choice[]; mapTitle: string };
type ReachResult = {
  revision: number; actorId: string; targetLabel: string; distanceFeet: number;
  movement: { costFeet: number | null; budgetFeet: number; budgetLabel: string; canReach: boolean; message: string };
  weapon: { name: string; rangeFeet: number; inRange: boolean; canAttackNow: boolean; message: string };
  summary: string[];
};
class ReachError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(apiBase: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(`${apiBase}/reach`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ReachError(data.error || 'The distance could not be checked.', response.status);
  return data;
}

const button = 'rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-stone-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-50';
const field = 'mt-1 block w-full rounded-lg border border-white/20 bg-[#191815] px-3 py-2.5 text-stone-100 focus:outline-2 focus:outline-amber-300';

/** Uses saved map and character data; checking never issues a game command. */
export default function SceneReach({ apiBase = '/api/scene-images' }: { apiBase?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ReachOptions | null>(null);
  const [actorId, setActorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetMode, setTargetMode] = useState<'target' | 'coordinate'>('target');
  const [coordinate, setCoordinate] = useState('');
  const [result, setResult] = useState<ReachResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => { sequence.current++; pending.current?.abort(); }, [apiBase]);

  function invalidate() {
    sequence.current++; pending.current?.abort(); pending.current = null;
    setBusy(false); setResult(null); setError('');
  }
  function startRequest() {
    invalidate(); setBusy(true);
    const controller = new AbortController(); pending.current = controller;
    return { version: sequence.current, signal: controller.signal };
  }
  function report(reason: unknown) {
    if (reason instanceof ReachError && [401, 403].includes(reason.status)) {
      setOptions(null); setActorId(''); setTargetId('');
      setError(reason.status === 403 ? reason.message : apiBase === '/api/game'
        ? 'Connect to your tactical table with your player access code, then refresh the choices here.'
        : 'Choose “Show what I see” and connect with your player access code, then refresh the choices here.');
      return;
    }
    setError(reason instanceof ReachError ? reason.message : 'The connection was interrupted. You can check again safely.');
  }
  async function refreshChoices() {
    const { version, signal } = startRequest();
    try {
      const data = await request<{ options: ReachOptions }>(apiBase, signal);
      if (version !== sequence.current) return;
      setOptions(data.options);
      setActorId(current => data.options.actors.some(actor => actor.id === current) ? current : data.options.actors.length === 1 ? data.options.actors[0].id : '');
      setTargetId(current => data.options.targets.some(target => target.id === current) ? current : '');
    } catch (reason) { if (version === sequence.current) report(reason); }
    finally { if (version === sequence.current) { setBusy(false); pending.current = null; } }
  }
  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !actorId || (targetMode === 'target' ? !targetId : !coordinate.trim())) return;
    const selected = { actorId, targetId, targetMode, coordinate: coordinate.trim().toUpperCase() };
    const { version, signal } = startRequest();
    try {
      // Refresh immediately before measuring so an old illustration does not select an old map revision.
      const latest = await request<{ options: ReachOptions }>(apiBase, signal);
      if (version !== sequence.current) return;
      setOptions(latest.options);
      if (!latest.options.actors.some(actor => actor.id === selected.actorId)) {
        setActorId(''); setError('Your available characters changed. Choose your character again.'); return;
      }
      if (selected.targetMode === 'target' && !latest.options.targets.some(target => target.id === selected.targetId)) {
        setTargetId(''); setError('That target is no longer visible. Choose a current visible target.'); return;
      }
      const data = await request<{ result: ReachResult }>(apiBase, signal, {
        expectedRevision: latest.options.revision, actorId: selected.actorId,
        ...(selected.targetMode === 'target' ? { targetId: selected.targetId } : { coordinate: selected.coordinate }),
      });
      if (version === sequence.current) setResult(data.result);
    } catch (reason) { if (version === sequence.current) report(reason); }
    finally { if (version === sequence.current) { setBusy(false); pending.current = null; } }
  }
  function toggle() {
    if (open) { invalidate(); setOpen(false); }
    else { setOpen(true); void refreshChoices(); }
  }

  return <div className="mt-3 w-full text-left">
    <button type="button" className={button} onClick={toggle} aria-expanded={open} aria-controls={`${id}-panel`}>How far? Can I reach it?</button>
    {open && <section id={`${id}-panel`} aria-labelledby={`${id}-heading`} className="mt-3 rounded-xl border border-amber-300/25 bg-[#11110f] p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id={`${id}-heading`} className="font-serif text-2xl text-stone-100">Distance and reach</h2><p className="mt-1 text-sm leading-6 text-stone-300">Check any time, even during a pause or another character’s turn. This spends no action, roll or movement.</p></div>
        <button type="button" className={button} onClick={toggle} aria-label="Close distance and reach panel">Close</button>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-400">Measurements use your current tactical map and saved character abilities. The artwork itself is not a scale map.</p>
      {options && <>
        <p className="mt-4 text-xs text-amber-200">{options.mapTitle} · Map revision {options.revision}</p>
        {options.actors.length ? <form onSubmit={event => void check(event)} className="mt-4 space-y-4">
          <label htmlFor={`${id}-actor`} className="block text-sm text-stone-300">Your character
            <select id={`${id}-actor`} value={actorId} onChange={event => { invalidate(); setActorId(event.target.value); }} className={field} required>
              <option value="">Choose your character</option>{options.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.label}</option>)}
            </select>
          </label>
          <fieldset><legend className="mb-2 text-sm text-stone-300">Measure to</legend><div className="flex flex-wrap gap-4 text-sm text-stone-200">
            <label className="flex items-center gap-2"><input type="radio" name={`${id}-mode`} checked={targetMode === 'target'} onChange={() => { invalidate(); setTargetMode('target'); }} />Visible target</label>
            <label className="flex items-center gap-2"><input type="radio" name={`${id}-mode`} checked={targetMode === 'coordinate'} onChange={() => { invalidate(); setTargetMode('coordinate'); }} />Map coordinate</label>
          </div></fieldset>
          {targetMode === 'target' ? <label htmlFor={`${id}-target`} className="block text-sm text-stone-300">Visible target
            <select id={`${id}-target`} value={targetId} onChange={event => { invalidate(); setTargetId(event.target.value); }} className={field} required>
              <option value="">{options.targets.length ? 'Choose a visible target' : 'No visible targets — use a map coordinate'}</option>{options.targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select>
          </label> : <label htmlFor={`${id}-coordinate`} className="block text-sm text-stone-300">Visible map coordinate
            <input id={`${id}-coordinate`} value={coordinate} onChange={event => { invalidate(); setCoordinate(event.target.value); }} className={field} required maxLength={16} pattern="[A-Za-z]+[1-9][0-9]*" placeholder="For example, C4" autoComplete="off" spellCheck={false} />
          </label>}
          <button type="submit" className="rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-stone-950 hover:bg-amber-200 disabled:cursor-wait disabled:opacity-50" disabled={busy || !actorId || (targetMode === 'target' ? !targetId : !coordinate.trim())}>{busy ? 'Checking current map…' : result ? 'Check again on current map' : 'Check distance and reach'}</button>
        </form> : <p className="mt-4 text-sm leading-6 text-stone-300">Your host needs to assign your character to the tactical map before distances can be checked.</p>}
      </>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3 text-sm leading-6 text-amber-100">{error}</p>}
      <div role="status" aria-live="polite" aria-atomic="true">
        {busy && <p className="mt-4 text-sm text-stone-300">Checking your current visible map…</p>}
        {result && <article className="mt-5 border-t border-white/10 pt-4">
          <h3 className="font-serif text-xl text-stone-100">{result.targetLabel} · {result.distanceFeet} feet away</h3>
          <p className="mt-1 text-xs text-stone-400">Map revision {result.revision} · A snapshot at the time you checked</p>
          <div className="mt-3 space-y-2 text-sm leading-6 text-stone-200">{result.summary.map((line, index) => <p key={index}>{line}</p>)}</div>
        </article>}
      </div>
      <p className="mt-4 text-xs leading-5 text-stone-400">Walking and your configured weapon are checked here. Ask your host about spells, jumps or other abilities that are not configured. Checking reach does not move or attack.</p>
      <button type="button" className={`${button} mt-4`} onClick={() => void refreshChoices()} disabled={busy}>Refresh choices</button>
    </section>}
  </div>;
}
