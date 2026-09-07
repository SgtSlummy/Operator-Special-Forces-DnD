'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
type Job = { requestId: string; task: string; text: string; provider: string; status: string; durationMs: number; sourceRevision: number; sources: { ref: string; revision?: number }[] };
type Policy = { mode: 'local' | 'local-free'; codex: boolean; enabled: boolean; bootEpoch: string; generation: string | null; sessionPolicyRevision: number; leaseExpiresAtMs: number | null };
type State = { role: string; policy: Policy | null; jobs: Job[]; remoteAvailable: boolean; busy: boolean; ready: boolean; reason?: string };
export default function AiPanel({ revision }: { revision: number }) {
  const [state, setState] = useState<State | null>(null), [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [configuring, setConfiguring] = useState(false), [observedAt, setObservedAt] = useState(0);
  const active = useRef(true), lifetime = useRef(0), loading = useRef<Promise<void> | null>(null), policyWriting = useRef(false);
  const policy = state?.policy;
  const hasCurrentFence = (value: Policy | null | undefined, now: number) => !!value && now > 0 && typeof value.bootEpoch === 'string' && !!value.bootEpoch && typeof value.generation === 'string' && !!value.generation && Number.isSafeInteger(value.sessionPolicyRevision) && value.sessionPolicyRevision >= 0 && typeof value.leaseExpiresAtMs === 'number' && value.leaseExpiresAtMs > now;
  const settingsAvailable = state?.role === 'host' && hasCurrentFence(policy, observedAt);
  useEffect(() => {
    if (!policy?.leaseExpiresAtMs) return;
    const timer = setTimeout(() => setObservedAt(Date.now()), Math.max(0, Math.min(2147483647, policy.leaseExpiresAtMs - Date.now())));
    return () => clearTimeout(timer);
  }, [policy?.leaseExpiresAtMs]);
  const load = useCallback(() => {
    if (policyWriting.current) return Promise.resolve();
    if (loading.current) return loading.current;
    const epoch = lifetime.current;
    const work = async () => {
      try {
        const response = await fetch('/api/game/ai', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        const data = response.ok ? await response.json() as State : null;
        if (!active.current || lifetime.current !== epoch) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) { setState(null); setLoadError('Reconnect to your campaign to see your saved assistance.'); }
          else setLoadError('Saved assistance could not be refreshed. Try refreshing it again.');
          return;
        }
        setState(data); setObservedAt(Date.now()); setLoadError('');
      } catch {
        if (active.current && lifetime.current === epoch) setLoadError('Saved assistance could not be refreshed. Try refreshing it again.');
      }
    };
    const pending = work().finally(() => { if (loading.current === pending) loading.current = null; });
    loading.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    active.current = true;
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active.current = false; lifetime.current += 1; loading.current = null; clearInterval(timer); };
  }, [load]);
  async function configure(mode: string, codex: boolean, enabled?: boolean) {
    if (policyWriting.current || state?.role !== 'host' || !policy || !hasCurrentFence(policy, Date.now())) return;
    policyWriting.current = true; lifetime.current++; loading.current = null; setConfiguring(true); setError('');
    const epoch = lifetime.current;
    try {
      const r = await fetch('/api/game/ai', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, codex, ...(enabled === undefined ? {} : { enabled }), requestId: crypto.randomUUID(), expectedBootEpoch: policy.bootEpoch, expectedGeneration: policy.generation, expectedSessionPolicyRevision: policy.sessionPolicyRevision }) });
      if (!active.current || epoch !== lifetime.current) return;
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) setState(null);
        setError(r.status === 409 ? 'The host policy changed. Review the refreshed settings before choosing again.' : (await r.json() as { error: string }).error);
      }
    } catch { if (active.current && epoch === lifetime.current) setError('The settings response was interrupted. Refreshing the saved host policy; no change will be retried automatically.'); }
    finally { policyWriting.current = false; if (active.current && epoch === lifetime.current) { setConfiguring(false); await load(); } }
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (busy || configuring || !state?.ready || !state.policy?.enabled) return; setBusy(true); setError('');
    try { const r = await fetch('/api/game/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: revision, task: 'narration', query }) }); if (!r.ok) throw new Error((await r.json() as { error: string }).error); await load(); }
    catch(e) { if (active.current) setError(`${e instanceof Error ? e.message : 'AI unavailable.'} Refresh saved assistance before asking again: a completed response may already be saved.`); } finally { if (active.current) setBusy(false); }
  }
  return <section className="my-6 rounded-xl border border-amber-100/20 p-4"><h2 className="font-serif text-xl">Raphael · Obus assistance</h2><p className="my-2 text-sm">{state?.busy ? 'Working…' : state?.ready ? 'Obus manages all AI routing.' : 'Waiting for the Obus game agent.'}</p>
    {state?.role === 'host' && (policy ? <fieldset disabled={configuring || !settingsAvailable} className="flex flex-wrap gap-4 disabled:opacity-60"><legend className="mb-2 text-sm">Saved host settings</legend><label>AI mode <select className="bg-stone-900 p-2" value={policy.mode} onChange={e => void configure(e.target.value, policy.codex)}><option value="local">Local only</option><option value="local-free">Local + free providers</option></select></label><label><input type="checkbox" checked={policy.enabled} onChange={e => void configure(policy.mode, policy.codex, e.target.checked)} /> Enable assistance</label><label><input type="checkbox" checked={policy.codex} onChange={e => void configure(policy.mode, e.target.checked)} /> Allow Codex escalation</label></fieldset> : <p className="my-2 text-sm text-stone-300">Host settings are unavailable until Obus provides its current policy.</p>)}
    {state?.role === 'host' && policy && !settingsAvailable && <p className="my-2 text-sm text-stone-300">Host settings are read-only until an active host connection is available.</p>}
    {state && !state.remoteAvailable && <p className="my-2 text-sm text-amber-200">{state.reason || 'Obus has no verified external route available. Provider selection stays inside Obus.'}</p>}
    <form onSubmit={ask} className="my-3 flex gap-2"><input aria-label="Ask about the visible scene" className="min-w-0 flex-1 rounded bg-stone-900 p-2" value={query} onChange={e => setQuery(e.target.value)} maxLength={4000} placeholder="Describe the visible scene…" required /><button disabled={busy || configuring || !state?.ready || !state.policy?.enabled} className="rounded border px-3">Ask</button></form>
    {error && <p role="alert">{error}</p>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><h3 className="font-serif text-lg">Your saved assistance</h3><button type="button" onClick={() => void load()} className="rounded border border-amber-100/30 px-3 py-2">Refresh saved assistance</button></div>
    <p className="my-2 text-sm text-stone-300">Your latest 20 responses stay available after the scene changes or a reply is interrupted. Refreshing retrieves saved responses without asking Obus to generate again.</p>
    {loadError && <p role="alert">{loadError}</p>}
    {state?.jobs.length === 0 && <p className="my-3 text-sm text-stone-300">No saved responses yet. A request still being processed will appear when it finishes.</p>}
    {state?.jobs.map(j => <article key={j.requestId} className="my-3 border-t border-amber-100/20 pt-3"><p className="mb-2 text-sm text-amber-100">{j.task} · Scene revision {j.sourceRevision}{j.sourceRevision !== revision ? ' · Historical response; the scene has changed.' : ''}</p><p className="whitespace-pre-wrap">{j.text}</p>{j.sources?.length > 0 && <p className="mt-2 break-words text-sm text-stone-300">Sources: {j.sources.map(s => `${s.ref}${s.revision === undefined ? '' : ` · revision ${s.revision}`}`).join('; ')}</p>}<p className="mt-2 text-xs opacity-60">{j.provider} · {j.status} · {(j.durationMs / 1000).toFixed(1)}s</p></article>)}
  </section>;
}
