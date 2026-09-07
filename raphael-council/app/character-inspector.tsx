'use client';
import { apiFetch as fetch } from '../client/api.mjs';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

type CharacterOption = { id: string; label: string; controlled: boolean; defeated: boolean };
type CharacterOptions = { revision: number; mapTitle: string; actors: CharacterOption[] };
type FieldValue = string | number | boolean | null;
type FieldGroup = { title: string; fields: { key: string; label: string; value: FieldValue }[] };
type CharacterInfo = {
  revision: number; mapTitle: string; phase: string; round: number; turn: number;
  actor: {
    id: string; name: string; position: { x: number; y: number; coordinate: string; size: number };
    controlled: boolean; defeated: boolean; hp?: number; maxHp?: number; armorClass?: number; speed?: number;
  };
  sheet: { status: 'matched' | 'updated' | 'unavailable' | 'private'; revision?: number; edition?: string; groups: FieldGroup[] };
  groups: FieldGroup[]; notes: string[];
};
class CharacterError extends Error { constructor(message: string, public status: number) { super(message); } }
async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/game/characters${path}`, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new CharacterError(data.error || 'Character information could not be loaded.', response.status);
  return data;
}
function errorMessage(reason: unknown) {
  return reason instanceof CharacterError
    ? reason.status === 401 ? 'Connect to your tactical table to view character information.' : reason.message
    : 'The connection was interrupted. Refresh the character information to try again.';
}
function valueText(value: FieldValue | undefined) {
  if (value === null || value === undefined || value === '') return 'Not supplied';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return `${words[0]?.[0] || '?'}${words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] || ''}`.toUpperCase();
}
const button = 'rounded-md border border-amber-200/30 px-3 py-2 text-sm text-amber-50 hover:bg-amber-200/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200';

/** A private, read-only companion to the same character information available in Discord. */
export default function CharacterInspector({ revision }: { revision: number }) {
  const id = useId();
  const [refreshId, setRefreshId] = useState(0);
  const requestKey = `${revision}:${refreshId}`;
  const [directory, setDirectory] = useState<{ key: string; options: CharacterOptions } | null>(null);
  const [directoryError, setDirectoryError] = useState<{ key: string; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ key: string; actorId: string; info: CharacterInfo } | null>(null);
  const [detailError, setDetailError] = useState<{ key: string; actorId: string; message: string } | null>(null);
  const [tabTitle, setTabTitle] = useState('');
  const origin = useRef<HTMLElement | null>(null);
  const directoryHeading = useRef<HTMLHeadingElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const options = directory?.key === requestKey ? directory.options : null;
  const selected = options?.actors.find(actor => actor.id === selectedId);
  const info = detail?.key === requestKey && detail.actorId === selectedId && selected ? detail.info : null;
  const listError = directoryError?.key === requestKey ? directoryError.message : '';
  const sheetError = detailError?.key === requestKey && detailError.actorId === selectedId ? detailError.message : '';

  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    void get<{ options: CharacterOptions }>('', controller.signal).then(data => {
      if (cancelled) return;
      setDirectory({ key: requestKey, options: data.options }); setDirectoryError(null);
    }).catch(reason => {
      if (cancelled) return;
      setDirectory(null); setDetail(null); setDirectoryError({ key: requestKey, message: errorMessage(reason) });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [requestKey]);

  useEffect(() => {
    if (!selectedId || directory?.key !== requestKey || !directory.options.actors.some(actor => actor.id === selectedId)) return;
    const controller = new AbortController(); let cancelled = false;
    void get<{ info: CharacterInfo }>(`/${encodeURIComponent(selectedId)}?revision=${directory.options.revision}`, controller.signal).then(data => {
      if (cancelled) return;
      setDetail({ key: requestKey, actorId: selectedId, info: data.info }); setDetailError(null);
    }).catch(reason => {
      if (cancelled) return;
      setDetail(null); setDetailError({ key: requestKey, actorId: selectedId, message: errorMessage(reason) });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [directory, requestKey, selectedId]);

  const close = useCallback(() => {
    setSelectedId(null); setDetail(null); setDetailError(null);
    requestAnimationFrame(() => (origin.current?.isConnected ? origin.current : directoryHeading.current)?.focus());
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    dialog.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selectedId, close]);

  function openCharacter(actorId: string, source: HTMLButtonElement) {
    origin.current = source;
    if (selectedId === actorId) setRefreshId(current => current + 1);
    else { setSelectedId(actorId); setDetail(null); setDetailError(null); setTabTitle(''); }
    requestAnimationFrame(() => dialog.current?.focus());
  }
  function refresh() { setRefreshId(current => current + 1); }
  const groups = info?.groups ?? [];
  const tabIndex = Math.max(0, groups.findIndex(group => group.title === tabTitle));
  const group = groups[tabIndex];
  const sourceInitiative = info?.sheet.status === 'matched' ? groups.flatMap(group => group.fields).find(field => field.key === 'sheet.initiative')?.value : null;
  const sheetStatus = info?.sheet.status === 'matched' ? `Approved sheet revision ${info.sheet.revision} matches the encounter profile`
    : info?.sheet.status === 'updated' ? 'Approved sheet changed · host must link the reviewed version'
    : info?.sheet.status === 'private' ? 'Visible information only · private sheet is not shared'
    : 'Approved sheet unavailable · showing the saved encounter profile';

  return <section className="rounded-xl border border-amber-100/20 bg-[#17131d] p-5" aria-labelledby={`${id}-directory`}>
    <p className="text-xs uppercase tracking-widest text-amber-300">Discord companion</p>
    <div className="mt-1 flex flex-wrap items-center justify-between gap-3"><h2 ref={directoryHeading} tabIndex={-1} id={`${id}-directory`} className="text-xl">Characters</h2><button type="button" className={button} onClick={refresh}>Refresh</button></div>
    <p className="mt-2 text-sm leading-6 text-stone-300">Open a character to inspect the information shared with you. The same information is available in Discord.</p>
    {listError ? <p role="alert" className="mt-4 text-sm leading-6 text-amber-100">{listError}</p> : !options ? <p role="status" className="mt-4 text-sm text-stone-300">Updating visible characters…</p> : <>
      <p className="mt-3 text-xs text-stone-400">{options.mapTitle} · Revision {options.revision}</p>
      <ul className="mt-3 space-y-2">{options.actors.map(actor => <li key={actor.id}>
        <button type="button" onClick={event => openCharacter(actor.id, event.currentTarget)} aria-label={`Open ${actor.label} character details`} aria-haspopup="dialog" className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-amber-200/40 hover:bg-amber-200/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">
          <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border font-serif text-lg ${actor.controlled ? 'border-amber-200/50 bg-[#4a3823] text-amber-100' : 'border-stone-400/40 bg-[#302d35] text-stone-200'}`}>{initials(actor.label)}</span>
          <span className="min-w-0 flex-1"><span className="block break-words font-medium text-stone-100">{actor.label}</span><span className="mt-0.5 block text-xs text-stone-400">{actor.controlled ? 'Your character' : 'Visible character'}{actor.defeated ? ' · defeated' : ''}</span></span>
          <span aria-hidden="true" className="text-lg text-amber-200">›</span>
        </button>
      </li>)}</ul>
      {!options.actors.length && <p className="mt-3 text-sm text-stone-300">No characters are visible in the current scene.</p>}
    </>}

    {selectedId && <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby={`${id}-sheet-title`} aria-describedby={`${id}-sheet-context`} className="fixed inset-x-3 top-3 z-50 flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-xl border border-[#aa8957] bg-[#19151b] shadow-[0_18px_80px_#000b] outline-none sm:inset-x-auto sm:right-5 sm:top-16 sm:h-[min(680px,calc(100dvh-5rem))] sm:w-[min(720px,calc(100vw-2.5rem))]">
      <div className="flex items-center justify-between gap-3 border-b border-amber-200/20 px-4 py-3"><p className="text-xs uppercase tracking-widest text-amber-200">Character sheet · Discord companion</p><button type="button" className={button} onClick={close} aria-label="Close character sheet">Close <span aria-hidden="true">×</span></button></div>
      <div className="min-h-0 overflow-y-auto">
        <header className="p-4 sm:p-5">
          <div className="flex items-center gap-4"><div aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-amber-200/40 bg-[radial-gradient(ellipse_at_top,#59442d,#29212a)] font-serif text-3xl text-amber-100 sm:h-24 sm:w-24">{initials(info?.actor.name || selected?.label || 'Character')}</div><div className="min-w-0"><h2 id={`${id}-sheet-title`} className="break-words font-serif text-2xl text-[#f5ead6] sm:text-3xl">{info?.actor.name || selected?.label || 'Character information'}</h2><p id={`${id}-sheet-context`} className="mt-1 text-sm leading-6 text-stone-300">{info ? `${info.mapTitle} · ${info.actor.position.coordinate} · ${info.actor.defeated ? 'Defeated' : info.actor.controlled ? 'Your character' : 'Visible character'}` : 'Loading current authorized information'}</p>{info && <p className="mt-1 text-xs text-stone-400">Map revision {info.revision} · Round {info.round} · Turn {info.turn} · {info.phase}</p>}</div></div>
          {info?.actor.controlled && <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Current / maximum HP', `${valueText(info.actor.hp)} / ${valueText(info.actor.maxHp)}`],
              ['Armor class', valueText(info.actor.armorClass)],
              ['Normal speed (feet)', valueText(info.actor.speed)],
              ['Initiative · approved sheet', valueText(sourceInitiative)],
            ].map(([label, value]) => <div key={label} className="rounded-md border border-amber-200/20 bg-black/20 px-3 py-2"><dt className="text-xs leading-5 text-stone-400">{label}</dt><dd className="mt-1 break-words font-serif text-xl text-amber-100">{value}</dd></div>)}
          </dl>}
        </header>
        {!info ? <div className="border-t border-amber-200/20 bg-[#e9ddc5] p-5 text-[#34291e]">
          {listError || sheetError || (options && !selected) ? <p role="alert" className="text-sm leading-6">{listError || sheetError || 'This character is no longer in your current visible scene.'}</p> : <p role="status" className="text-sm leading-6">Updating the character from your current map…</p>}
          <button type="button" onClick={refresh} className="mt-4 rounded-md border border-[#725b3e] px-3 py-2 text-sm font-medium hover:bg-[#dacaab]">Refresh character information</button>
        </div> : <>
          <div className="border-t border-[#af966d] bg-[#e9ddc5] px-4 pt-3 text-[#34291e] sm:px-5">
            <p className="mb-3 text-xs font-medium leading-5">{sheetStatus}</p>
            <div role="tablist" aria-label="Character information sections" className="flex gap-1 overflow-x-auto pb-2">{groups.map((item, index) => <button key={item.title} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={tabIndex === index} aria-controls={`${id}-content-${index}`} tabIndex={tabIndex === index ? 0 : -1} onClick={() => setTabTitle(item.title)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length;
              setTabTitle(groups[next].title);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }} className={`max-w-56 shrink-0 rounded-t-md border px-3 py-2 text-left text-xs leading-5 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#6b4b20] ${tabIndex === index ? 'border-[#a38554] bg-[#fbf2df] font-semibold text-[#382817]' : 'border-transparent bg-[#d4c4a7] text-[#594934] hover:bg-[#ddd0b7]'}`}>{item.title}</button>)}</div>
          </div>
          {group && <section role="tabpanel" id={`${id}-content-${tabIndex}`} aria-labelledby={`${id}-tab-${tabIndex}`} tabIndex={0} className="bg-[#fbf2df] p-4 text-[#34291e] outline-offset-[-3px] sm:p-5">
            <h3 className="mb-3 font-serif text-xl">{group.title}</h3>
            <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{group.fields.map(field => <div key={field.key} className={`${typeof field.value === 'string' && (field.value.length > 100 || field.value.includes('\n')) ? 'sm:col-span-2' : ''} min-w-0 border-b border-[#b8a078]/30 pb-3`}><dt className="text-xs font-medium leading-5 text-[#746148]">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{valueText(field.value)}</dd></div>)}</dl>
          </section>}
          <footer className="border-t border-[#b8a078]/50 bg-[#e9ddc5] p-4 text-[#51422f] sm:p-5"><div className="space-y-2 text-xs leading-5">{info.notes.map((note, index) => <p key={index}>{note}</p>)}</div><button type="button" onClick={refresh} className="mt-4 rounded-md border border-[#725b3e] px-3 py-2 text-sm font-medium hover:bg-[#dacaab]">Refresh character information</button></footer>
        </>}
      </div>
    </section>}
  </section>;
}
