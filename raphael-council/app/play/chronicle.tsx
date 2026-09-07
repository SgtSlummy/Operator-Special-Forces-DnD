'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../client/api.mjs';

type SessionId = string | number;
type Consent = { capture: boolean; external: boolean };
type Entry = {
  seq: number; kind: string; text: string; user?: string; speaker?: string;
  at?: string | number; target?: number; deleted?: boolean; corrected?: boolean;
  canCorrect?: boolean;
};
type BotCommand = {
  requestId: string; type: string; status: 'queued' | 'running' | 'done' | 'failed';
  result?: unknown; error?: { code: string; message: string; status: number }; 
};
type Snapshot = {
  role: 'host' | 'player'; owner: string;
  session: null | { id: SessionId; title: string; status: string; revision: number };
  entries: Entry[]; consent: Consent; commands: BotCommand[]; next: number;
  delivery?: { pending: number; failed: number; retrying: number; uncertain?: number; nextAttemptAt: number | null };
};
type Command = {
  requestId: string; sessionId: SessionId | null; expectedRevision: number; type: string;
  capture?: boolean; external?: boolean; title?: string; mode?: string; minutes?: number;
  text?: string; entry?: number;
};
type Channel = 'work' | 'consent';
type Pending = Partial<Record<Channel, Command>>;
type Reply = { error?: string; command?: BotCommand };

const endpoint = '/api/game/chronicle';
const button = 'rounded border border-amber-100/30 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const input = 'w-full rounded border border-white/20 bg-stone-900 p-2 disabled:opacity-50';
const commandNames: Record<string, string> = {
  start: 'Start session', pause: 'Pause capture', resume: 'Resume capture',
  voice: 'Join voice channel', leave: 'Leave voice channel', summary: 'Session summary',
  end: 'End session and recap', note: 'Session note', correct: 'Transcript correction',
  consent: 'Consent update', 'retry-delivery': 'Retry delivery',
};

function timestamp(value: Entry['at']) {
  if (value === undefined) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function resultText(result: unknown) {
  if (typeof result === 'string') return result.slice(0, 4000);
  if (result && typeof result === 'object') {
    const visible = result as { text?: unknown; message?: unknown };
    if (typeof visible.text === 'string') return visible.text.slice(0, 4000);
    if (typeof visible.message === 'string') return visible.message.slice(0, 4000);
  }
  return 'The bot completed this request. Any saved text appears in the chronicle.';
}

export default function ChroniclePanel() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [running, setRunning] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState<{ entry: number; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<Snapshot | null>(null);
  const requests = useRef<Pending>({});
  const controllers = useRef(new Set<AbortController>());
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(false);
  const epoch = useRef(0);
  const readSequence = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const readPromise = useRef<Promise<Snapshot | null> | null>(null);
  const retiredSessions = useRef(new Set<SessionId>());

  const replacePending = useCallback((channel: Channel, command?: Command, expectedId?: string) => {
    if (expectedId && requests.current[channel]?.requestId !== expectedId) return;
    requests.current = { ...requests.current, [channel]: command };
    setPending(requests.current);
  }, []);

  const revoke = useCallback(() => {
    epoch.current += 1;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    readController.current = null; readPromise.current = null;
    inFlight.current.clear(); requests.current = {}; current.current = null;
    retiredSessions.current.clear();
    setState(null); setPending({}); setRunning([]); setNote(''); setTitle('');
    setCorrection(null); setNotice(''); setError(''); setRefreshing(false);
    setLoadError('Reconnect to your campaign to see its chronicle.');
  }, []);

  const load = useCallback((force = false): Promise<Snapshot | null> => {
    if (!force && readPromise.current) return readPromise.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller; controllers.current.add(controller);
    const version = epoch.current, sequence = ++readSequence.current;
    setRefreshing(true);
    const work = async () => {
      try {
        const response = await apiFetch(`${endpoint}?after=0`, {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!mounted.current || version !== epoch.current || sequence !== readSequence.current) return null;
        if (response.status === 401 || response.status === 403) { revoke(); return null; }
        if (!response.ok) throw new Error('The chronicle could not be refreshed.');
        const snapshot = await response.json() as Snapshot;
        if (!mounted.current || version !== epoch.current || sequence !== readSequence.current) return null;
        if (!snapshot || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.commands) || !snapshot.consent || !snapshot.owner) {
          throw new Error('The chronicle response was incomplete.');
        }
        const previous = current.current;
        if (previous && previous.owner !== snapshot.owner) { revoke(); return null; }
        if (snapshot.session && retiredSessions.current.has(snapshot.session.id)) return previous;
        if (previous?.session && snapshot.session?.id === previous.session.id &&
          (snapshot.session.revision < previous.session.revision || snapshot.next < previous.next)) return previous;
        if (previous?.session && snapshot.session?.id !== previous.session.id) {
          retiredSessions.current.add(previous.session.id);
          setCorrection(null); setNote('');
        }
        current.current = snapshot; setState(snapshot); setLoadError('');
        return snapshot;
      } catch {
        if (mounted.current && version === epoch.current && sequence === readSequence.current && !controller.signal.aborted) {
          setLoadError('The chronicle could not be refreshed. Your saved session is unchanged.');
        }
        return null;
      } finally {
        controllers.current.delete(controller);
        if (readController.current === controller) readController.current = null;
        if (sequence === readSequence.current && version === epoch.current) {
          readPromise.current = null;
          if (mounted.current) setRefreshing(false);
        }
      }
    };
    const promise = work(); readPromise.current = promise;
    return promise;
  }, [revoke]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), 5000);
    const activeControllers = controllers.current, activeRequests = inFlight.current;
    return () => {
      mounted.current = false; epoch.current += 1;
      clearInterval(timer);
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear(); readController.current = null; readPromise.current = null;
      activeRequests.clear();
    };
  }, [load]);

  async function execute(command: Command, channel: Channel, repaired = false): Promise<void> {
    if (!mounted.current || inFlight.current.has(command.requestId)) return;
    const version = epoch.current;
    const controller = new AbortController(); controllers.current.add(controller);
    inFlight.current.add(command.requestId); setRunning([...inFlight.current]);
    const isCurrent = () => mounted.current && version === epoch.current;
    const isLatest = () => isCurrent() && requests.current[channel]?.requestId === command.requestId;
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) { revoke(); return; }
      const reply = await response.json().catch(() => ({})) as Reply;
      if (!isCurrent()) return;
      if (!response.ok) {
        if (channel === 'consent' && response.status === 409 && !repaired && isLatest()) {
          const fresh = await load(true);
          if (!isLatest() || !fresh || (fresh.session?.id ?? null) !== command.sessionId) return;
          if (fresh.consent.capture === command.capture && fresh.consent.external === command.external) {
            replacePending(channel, undefined, command.requestId); setNotice('Your consent is saved.'); return;
          }
          const retry = { ...command, requestId: crypto.randomUUID(), expectedRevision: fresh.session?.revision ?? 0 };
          replacePending(channel, retry);
          await execute(retry, channel, true); return;
        }
        if (isLatest()) {
          const message = typeof reply.error === 'string' ? reply.error.slice(0, 500) : 'The request could not be completed.';
          if (response.status >= 400 && response.status < 500) {
            replacePending(channel, undefined, command.requestId);
            setError(response.status === 409 ? 'The session changed. Review the refreshed chronicle and try again.' : message);
          } else {
            setError('The result is not confirmed. Retry the saved request to check it without submitting twice.');
          }
        }
        await load(true); return;
      }
      const fresh = await load(true);
      if (!isLatest()) return;
      if (channel === 'consent' && !fresh) {
        setError('The consent request was accepted, but its saved status could not be refreshed. Retry the saved request to check it.');
        return;
      }
      replacePending(channel, undefined, command.requestId); setError('');
      if (channel === 'consent') setNotice('Your consent is saved.');
      else {
        if (command.type === 'note') setNote('');
        if (command.type === 'correct') setCorrection(null);
        if (command.type === 'start') setTitle('');
        setNotice(reply.command?.status === 'queued' || reply.command?.status === 'running'
          ? 'Request saved for the bot. Check pending bot work for completion.'
          : 'Request saved.');
      }
    } catch {
      if (isLatest() && !controller.signal.aborted) {
        setError('The result is not confirmed. Retry the saved request with the same ID; it may already be saved.');
      }
    } finally {
      controllers.current.delete(controller); inFlight.current.delete(command.requestId);
      if (isCurrent()) setRunning([...inFlight.current]);
    }
  }

  function submit(type: string, fields: Partial<Command> = {}, channel: Channel = 'work') {
    const snapshot = current.current;
    if (!snapshot || (channel === 'work' && requests.current.work)) return;
    if (type === 'start' && snapshot.session && snapshot.session.status !== 'ended') return;
    if (type === 'note' && snapshot.session?.status !== 'active') return;
    if (type === 'retry-delivery' && (snapshot.role !== 'host' || !snapshot.session)) return;
    const command: Command = {
      ...fields, requestId: crypto.randomUUID(), sessionId: type === 'start' ? null : snapshot.session?.id ?? null,
      expectedRevision: type === 'start' ? 0 : snapshot.session?.revision ?? 0, type,
    };
    replacePending(channel, command); setError(''); setNotice('');
    void execute(command, channel);
  }

  function changeConsent(field: keyof Consent, value: boolean) {
    if (!state) return;
    const previous = requests.current.consent;
    const desired = previous
      ? { capture: previous.capture === true, external: previous.external === true }
      : state.consent;
    submit('consent', { ...desired, [field]: value }, 'consent');
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    if (note.trim()) submit('note', { text: note.trim() });
  }

  function saveCorrection(event: FormEvent) {
    event.preventDefault();
    if (correction?.text.trim()) submit('correct', { entry: correction.entry, text: correction.text.trim() });
  }

  const consent = pending.consent
    ? { capture: pending.consent.capture === true, external: pending.consent.external === true }
    : state?.consent ?? { capture: false, external: false };
  const sessionActive = state?.session?.status === 'active' || state?.session?.status === 'paused';
  const canStart = !state?.session || state.session.status === 'ended';
  const notesEnabled = state?.session?.status === 'active';
  const waiting = state?.commands.filter(command => command.status === 'queued' || command.status === 'running') ?? [];
  const completed = state?.commands.filter(command => command.status === 'done' || command.status === 'failed') ?? [];
  const workDisabled = Boolean(pending.work);

  return <section aria-labelledby="chronicle-title" className="my-6 rounded-xl border border-amber-100/20 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="chronicle-title" className="font-serif text-xl">Session chronicle</h2>
      <button type="button" disabled={refreshing} onClick={() => void load(true)} className={button}>{refreshing ? 'Refreshing…' : 'Refresh chronicle'}</button>
    </div>
    <p className="my-2 text-sm text-stone-300">The same saved transcript and controls are available here and in Discord. Opening this page does not start recording.</p>
    {loadError && <p role="alert" className="my-2 text-amber-200">{loadError}</p>}
    {error && <p role="alert" className="my-2 text-amber-200">{error}</p>}
    {notice && <p role="status" className="my-2 text-sm text-amber-100">{notice}</p>}
    {!state && !loadError && <p className="my-3 text-sm">Loading your chronicle…</p>}
    {state && <>
      <p className="my-3">{state.session ? <><strong>{state.session.title}</strong> · {state.session.status}<span className="ml-2 text-sm text-stone-400">Revision {state.session.revision}</span></> : 'No session is open.'}</p>
      <fieldset className="my-4 space-y-3 rounded-lg border border-white/15 p-3">
        <legend className="px-1 font-medium">Your consent</legend>
        {!sessionActive && <p className="text-sm text-stone-300">Consent is set for each session. Start or join an active session to change it.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={!sessionActive} checked={consent.capture} onChange={event => changeConsent('capture', event.target.checked)} /><span>Allow my voice and Discord messages to be captured for this session<span className="mt-1 block text-sm text-stone-300">Turning this off sends a withdrawal immediately. Capture also requires the bot and session to be running.</span></span></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={!sessionActive} checked={consent.external} onChange={event => changeConsent('external', event.target.checked)} /><span>Allow relevant excerpts from my transcript to be processed by external AI<span className="mt-1 block text-sm text-stone-300">This permission is separate from capture. It is off by default and only applies when the host allows external processing.</span></span></label>
        {pending.consent && <div role="status" className="text-sm text-amber-200"><p>Consent change awaiting confirmation. Your last confirmed consent remains in effect until the request is saved.</p><button type="button" disabled={running.includes(pending.consent.requestId)} onClick={() => void execute(pending.consent!, 'consent')} className={`${button} mt-2`}>{running.includes(pending.consent.requestId) ? 'Saving consent…' : 'Retry saved consent request'}</button></div>}
      </fieldset>
      {state.role === 'host' && <div className="my-4 rounded-lg border border-white/15 p-3">
        <h3 className="font-serif text-lg">Host session controls</h3>
        <p className="my-2 text-sm text-stone-300">Voice controls send work to Davy Jones. A saved join request does not mean the bot is connected; check its completed result and Discord voice channel.</p>
        {canStart ? <form className="my-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (title.trim()) submit('start', { title: title.trim(), mode: 'human', minutes: 10 }); }}>
          <label className="min-w-0 flex-1">Session title<input className={`${input} mt-1`} value={title} onChange={event => setTitle(event.target.value)} required maxLength={100} disabled={workDisabled} /></label>
          <button type="submit" className={`${button} self-end`} disabled={workDisabled}>Start session</button>
        </form> : sessionActive ? <div className="my-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={workDisabled} onClick={() => submit(state.session?.status === 'paused' ? 'resume' : 'pause')}>{state.session?.status === 'paused' ? 'Resume capture' : 'Pause capture'}</button>
          <button type="button" className={button} disabled={workDisabled} onClick={() => submit('voice')}>Request bot to join voice</button>
          <button type="button" className={button} disabled={workDisabled} onClick={() => submit('leave')}>Request bot to leave voice</button>
          <button type="button" className={button} disabled={workDisabled} onClick={() => submit('summary')}>Request summary</button>
          <button type="button" className={button} disabled={workDisabled} onClick={() => submit('end')}>End session and request recap</button>
        </div> : <p className="my-3 text-sm text-stone-300">The session is closing. Its recap must finish before another session starts.</p>}
      </div>}
      {pending.work && <div className="my-3 rounded-lg border border-amber-100/30 p-3"><p className="text-sm">{commandNames[pending.work.type] ?? 'Request'} awaiting confirmation. Retry this saved request before submitting another.</p><button type="button" className={`${button} mt-2`} disabled={running.includes(pending.work.requestId)} onClick={() => void execute(pending.work!, 'work')}>{running.includes(pending.work.requestId) ? 'Submitting…' : 'Retry saved request'}</button></div>}
      {state.delivery && <div className="my-5 rounded-lg border border-white/15 p-3">
        <h3 className="font-serif text-lg">Discord delivery</h3>
        <p className="my-2 text-sm text-stone-300">Pending: {state.delivery.pending} · Waiting to retry: {state.delivery.retrying} · Needs attention: {state.delivery.failed}</p>
        {state.delivery.nextAttemptAt !== null && <p className="my-2 text-sm text-stone-300">Next automatic attempt: <time>{timestamp(state.delivery.nextAttemptAt)}</time></p>}
        {(state.delivery.uncertain ?? 0) > 0 && <p className="my-2 text-sm text-amber-200">{state.delivery.uncertain} deliveries need review in Discord; retries for those deliveries are paused.</p>}
        {state.delivery.failed > 0 && <p className="my-2 text-sm text-amber-200">Some saved chronicle items could not be delivered to Discord. The host can request another delivery attempt.</p>}
        {state.role === 'host' && state.session && state.delivery.failed > 0 && <button type="button" className={button} disabled={workDisabled || waiting.some(command => command.type === 'retry-delivery')} onClick={() => submit('retry-delivery')}>Retry delivery</button>}
      </div>}
      <div className="my-5">
        <h3 className="font-serif text-lg">Pending bot work</h3>
        {waiting.length === 0 ? <p className="my-2 text-sm text-stone-300">No queued bot work.</p> : <ul className="my-2 space-y-2">{waiting.map(command => <li key={command.requestId} className="rounded border border-white/15 p-2"><strong>{commandNames[command.type] ?? 'Session request'}</strong> · {command.status === 'running' ? 'Bot is processing' : 'Waiting for bot'}<p className="mt-1 text-sm text-stone-300">Completion will appear below. You can keep playing while this is pending.</p></li>)}</ul>}
        {completed.length > 0 && <details className="my-3"><summary className="cursor-pointer">Completed bot requests ({completed.length})</summary><ul className="mt-2 space-y-3">{completed.map(command => <li key={command.requestId} className="rounded border border-white/15 p-2"><p><strong>{commandNames[command.type] ?? 'Session request'}</strong> · {command.status === 'failed' ? 'Failed' : 'Completed'}</p><p className="mt-1 whitespace-pre-wrap text-sm text-stone-300">{command.status === 'failed' ? (command.error?.message?.slice(0, 500) || 'The bot could not complete this request.') : resultText(command.result)}</p></li>)}</ul></details>}
      </div>
      <div className="my-5">
        <h3 className="font-serif text-lg">Transcript and session notes</h3>
        <p className="my-2 text-sm text-stone-300">Showing the latest 100 entries you may read. References such as E12 identify saved evidence. Corrections keep that evidence traceable.</p>
        {state.entries.length === 0 ? <p className="my-3 text-sm">No transcript entries yet.</p> : <ol className="max-h-[32rem] space-y-3 overflow-y-auto pr-1" aria-label="Chronicle entries">{state.entries.map(entry => <li key={entry.seq} className="rounded-lg border border-white/15 p-3">
          <p className="flex flex-wrap gap-x-2 text-sm text-amber-100"><strong>E{entry.seq}</strong><span>{entry.speaker || 'Session'}</span><span>{entry.kind}</span>{entry.at !== undefined && <time>{timestamp(entry.at)}</time>}</p>
          {entry.target !== undefined && <p className="mt-1 text-xs text-stone-300">{entry.kind === 'correction' ? 'Correction to' : 'Related to'} E{entry.target}</p>}
          {entry.deleted ? <p className="mt-2 italic text-stone-400">Entry deleted.</p> : <p className="mt-2 whitespace-pre-wrap break-words">{entry.text}</p>}
          {entry.corrected && <p className="mt-1 text-xs text-amber-200">Corrected entry</p>}
          {entry.canCorrect && !entry.deleted && sessionActive && <button type="button" disabled={workDisabled} onClick={() => setCorrection({ entry: entry.seq, text: entry.text })} className={`${button} mt-2`}>Correct E{entry.seq}</button>}
        </li>)}</ol>}
      </div>
      {correction && sessionActive && <form onSubmit={saveCorrection} className="my-4 space-y-2 rounded-lg border border-amber-100/30 p-3">
        <label className="block">Correction for E{correction.entry}<textarea className={`${input} mt-1`} rows={3} required maxLength={4000} value={correction.text} disabled={workDisabled} onChange={event => setCorrection({ ...correction, text: event.target.value })} /></label>
        <p className="text-sm text-stone-300">The correction is saved with a reference to the original entry.</p>
        <div className="flex gap-2"><button type="submit" className={button} disabled={workDisabled}>Save correction</button><button type="button" className={button} disabled={workDisabled} onClick={() => setCorrection(null)}>Cancel correction</button></div>
      </form>}
      {sessionActive && <form onSubmit={addNote} className="my-4 space-y-2">
        <label className="block">Add a session note<textarea className={`${input} mt-1`} rows={2} maxLength={4000} required value={note} disabled={workDisabled || !notesEnabled} onChange={event => setNote(event.target.value)} /></label>
        <button type="submit" className={button} disabled={workDisabled || !notesEnabled || !note.trim()}>Save note</button>
      </form>}
    </>}
  </section>;
}
