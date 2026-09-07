'use client';
import { apiFetch as fetch, apiPath } from '../client/api.mjs';

import { useCallback, useEffect, useState } from 'react';
import SceneReach from './scene-reach';

type Scene = {
  id: string; revision: number | string; title: string; description: string;
  subjects: { id: string; label: string }[]; sourceEventId: string;
};
type ImageJob = {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed'; title: string;
  focusLabel: string; sceneRevision: number | string; sourceEventId: string;
  message?: string; stale: boolean;
};
class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function fetchApi<T>(base: string, path = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options, credentials: 'same-origin', cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new RequestError(data.error || 'The image request could not be completed.', response.status);
  return data as T;
}

const button = 'rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-stone-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-50';

/** A view request never changes campaign state and is available during every phase. */
export default function SceneImages({ apiBase = '/api/scene-images', sharedSession = false, reachApiBase = '/api/scene-images', reachSessionKey = 'image-access' }: { apiBase?: string; sharedSession?: boolean; reachApiBase?: string; reachSessionKey?: string }) {
  const api = useCallback(<T,>(path = '', options: RequestInit = {}) => fetchApi<T>(apiBase, path, options), [apiBase]);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [scene, setScene] = useState<Scene | null>(null);
  const [focusId, setFocusId] = useState('scene');
  const [job, setJob] = useState<ImageJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollPaused, setPollPaused] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<{ requestId: string; focusId: string } | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);

  const showError = useCallback((reason: unknown) => {
    if (reason instanceof RequestError && [401, 403].includes(reason.status)) {
      setConnected(false); setScene(null); setJob(null); setPendingRequest(null);
      setAccessRevision(current => current + 1);
    }
    setError(reason instanceof RequestError ? reason.message : 'The connection was interrupted. You can retry safely.');
  }, []);

  const loadScene = useCallback(async () => {
    try {
      const data = await api<{ scene: Scene }>();
      setConnected(true); setScene(data.scene); setError('');
      setFocusId(current => current === 'scene' || data.scene.subjects.some(subject => subject.id === current) ? current : 'scene');
      return data.scene;
    } catch (reason) {
      if (reason instanceof RequestError && reason.status === 409) { setConnected(true); setScene(null); }
      showError(reason);
      return null;
    }
  }, [showError, api]);

  const jobId = job?.id;
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || !['queued', 'running'].includes(jobStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 180000;
    const id = jobId;
    async function poll() {
      try {
        const data = await api<{ job: ImageJob }>(`/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setJob(data.job);
        if (!['queued', 'running'].includes(data.job.status)) return;
        if (Date.now() >= deadline) { setPollPaused(true); return; }
        timer = setTimeout(poll, 4000);
      } catch (reason) {
        if (cancelled) return;
        showError(reason); setPollPaused(true);
      }
    }
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, jobStatus, showError, api]);

  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/access', { method: 'POST', body: JSON.stringify({ token: token.trim() }) });
      setToken(''); setConnected(true); setAccessRevision(current => current + 1); await loadScene();
    } catch (reason) { setToken(''); showError(reason); }
    finally { setBusy(false); }
  }

  async function requestImage(focus = focusId, retry = false) {
    if (busy) return;
    setBusy(true); setError(''); setPollPaused(false);
    const request = retry && pendingRequest
      ? pendingRequest : { requestId: crypto.randomUUID(), focusId: focus };
    setPendingRequest(request);
    try {
      const data = await api<{ job: ImageJob }>('', { method: 'POST', body: JSON.stringify(request) });
      setJob(data.job); setPendingRequest(null);
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  async function showView() {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    const currentScene = await loadScene();
    setBusy(false);
    if (currentScene && (!job || job.sceneRevision !== currentScene.revision)) await requestImage('scene');
  }

  async function refreshJob() {
    if (!job) return;
    setBusy(true); setError('');
    try {
      const data = await api<{ job: ImageJob }>(`/${encodeURIComponent(job.id)}`);
      setJob(data.job);
      setPollPaused(['queued', 'running'].includes(data.job.status));
      await loadScene();
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api('/access', { method: 'DELETE' });
      setConnected(false); setToken(''); setScene(null); setJob(null); setError(''); setPendingRequest(null);
      setAccessRevision(current => current + 1);
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  const waiting = job?.status === 'queued' || job?.status === 'running';
  const stale = job && (job.stale || (scene !== null && job.sceneRevision !== scene.revision));
  const imageUrl = job ? apiPath(`${apiBase}/${encodeURIComponent(job.id)}/image`) : '';

  return <section aria-label="Your view" className="relative mx-auto max-w-7xl px-6 pb-6">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void showView()} disabled={busy} aria-expanded={open} aria-controls="scene-image-panel" className="rounded-lg bg-amber-300 px-5 py-3 text-sm font-semibold text-stone-950 hover:bg-amber-200 disabled:cursor-wait disabled:opacity-60">Show what I see</button>
      <p className="text-xs leading-5 text-stone-400">Ask any time, including outside your turn. No action or roll required.</p>
    </div>
    <SceneReach key={`${reachApiBase}:${reachSessionKey}:${reachApiBase === '/api/scene-images' ? accessRevision : 0}`} apiBase={reachApiBase} />
    {open && <div id="scene-image-panel" className="mt-4 rounded-xl border border-amber-300/25 bg-[#11110f] p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="font-serif text-2xl text-stone-100">Through your eyes</h2><p className="mt-1 text-sm leading-6 text-stone-400">Witnesslight art of the view your host has shared with your character.</p></div>
        <button type="button" className={button} onClick={() => setOpen(false)} aria-label="Close image panel">Close</button>
      </div>
      {connected !== true && sharedSession && <p className="mt-5 text-sm text-stone-300">Connect to the tactical table to use your current player view. Maps and illustrations share that login.</p>}
      {connected !== true && !sharedSession && <form onSubmit={connect} className="mt-5 max-w-lg space-y-3">
        <p className="text-sm leading-6 text-stone-300">Use the private player access code from your host, or choose “Show what I see” then “Browser access” in Discord.</p>
        <label htmlFor="scene-access" className="block text-sm font-medium text-stone-200">Player access code</label>
        <input id="scene-access" type="password" name="player-access" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} required maxLength={1024} className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-3 text-sm text-stone-100 focus:outline-2 focus:outline-amber-300" />
        <button type="submit" disabled={busy || !token.trim()} className={button}>{busy ? 'Connecting…' : 'Connect my view'}</button>
      </form>}
      {connected === true && <div className="mt-5 space-y-4">
        {scene ? <div className="rounded-lg bg-white/5 p-4">
          <p className="text-xs uppercase tracking-wider text-amber-200">Current shared view</p>
          <h3 className="mt-1 font-serif text-xl">{scene.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">{scene.description}</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm text-stone-300">Focus
              <select value={focusId} onChange={event => setFocusId(event.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-white/20 bg-[#191815] px-3 py-2.5 text-stone-100">
                <option value="scene">The whole view</option>{scene.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void requestImage()} disabled={busy} className="rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-stone-950 hover:bg-amber-200 disabled:opacity-50">{busy ? 'Requesting…' : 'Make an image'}</button>
          </div>
        </div> : <p className="text-sm leading-6 text-stone-300">Your host has not shared a current view yet. You can request an image as soon as that view is available.</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { setBusy(true); void loadScene().finally(() => setBusy(false)); }}>Refresh current view</button>{!sharedSession && <button type="button" className={button} disabled={busy} onClick={() => void disconnect()}>Disconnect player</button>}</div>
      </div>}
      {error && <div role="alert" className="mt-4 rounded-lg border border-rose-300/30 bg-rose-300/5 p-3 text-sm leading-6 text-rose-100"><p>{error}</p>{pendingRequest && connected === true && <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void requestImage(undefined, true)}>Retry the same request</button>}</div>}
      {job && <article className="mt-6 border-t border-white/10 pt-5">
        <h3 className="font-serif text-xl text-stone-100">{job.title} · {job.focusLabel}</h3>
        <p className="mt-1 text-xs text-stone-400">View revision {job.sceneRevision}{stale ? ' · Earlier view — the scene has changed' : ''}</p>
        {stale && <p className="mt-2 text-sm text-amber-200">This is a snapshot from an earlier moment. Refresh your current view to make a new image.</p>}
        <div role="status" aria-live="polite" className="mt-3 text-sm leading-6 text-stone-300">
          {waiting && <p>{pollPaused ? 'Still processing. Automatic checks have paused; use Check image status when you are ready.' : 'Your image is being prepared. You can keep playing while it renders.'}</p>}
          {job.status === 'failed' && <p>{job.message || 'The image could not be completed. You can try a new request.'}</p>}
          {job.status === 'ready' && <p>Your image is ready.</p>}
        </div>
        {job.status === 'ready' && <figure className="mt-4">
          {/* Authenticated media endpoint; image bytes never enter the public asset directory. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`${job.focusLabel} in ${job.title}, view revision ${job.sceneRevision}`} onError={() => setError('The image could not be loaded. Check its status or reconnect your player.')} className="max-h-[70vh] w-full rounded-lg border border-white/10 bg-black/30 object-contain" />
          <figcaption className="mt-2 text-xs text-stone-500">Dramatic realism, with detail where your attention rests.</figcaption>
        </figure>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void refreshJob()}>Check image status</button>{job.status === 'ready' && <a href={imageUrl} download={`witnesslight-${job.id}.png`} className={button}>Save image</a>}{job.status === 'failed' && <button type="button" className={button} disabled={busy || !scene} onClick={() => void requestImage()}>Try a new image</button>}</div>
      </article>}
    </div>}
  </section>;
}
