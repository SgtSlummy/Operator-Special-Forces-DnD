'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
// @ts-ignore The game module is intentionally shared by the Node host and this browser lab.
import { applyCampaignAction, createCampaignFlow, projectThreads } from '../../game/campaign-flow.mjs';

type ProjectedCell = {coord:string; terrain?:string; cover?:string; concealment?:string; blocked?:boolean; difficult?:boolean};
const SIZE = 25;
const columns = Array.from({ length: SIZE }, (_, index) => String.fromCharCode(65 + index));
const owners = [
  { id: 'player-1', name: 'Branna Stonewake' },
  { id: 'player-2', name: 'Pip Underbough' },
  { id: 'player-3', name: 'Kael Ashstep' },
];

function coord(x: number, y: number) { return `${columns[x]}${y + 1}`; }
function labelForPhase(phase: string) { return phase.replaceAll('_', ' '); }
function terrainTone(terrain: string, blocked: boolean, difficult: boolean) {
  if (terrain === 'unread terrain') return 'bg-[#1d2029]/45';
  if (blocked) return 'bg-stone-600/75';
  if (terrain.toLowerCase().includes('grass')) return 'bg-emerald-950/55';
  if (terrain.toLowerCase().includes('water') || terrain.toLowerCase().includes('tide') || terrain.toLowerCase().includes('flood')) return 'bg-sky-950/55';
  if (difficult) return 'bg-amber-900/35';
  if (terrain.toLowerCase().includes('outcropping') || terrain.toLowerCase().includes('arch')) return 'bg-violet-950/45';
  return 'bg-[#4e4438]/25';
}

export default function GameLab() {
  const [state, setState] = useState<any>(() => createCampaignFlow());
  const [owner, setOwner] = useState('player-1');
  const [thread, setThread] = useState<'general' | 'store' | 'player'>('general');
  const [coordTarget, setCoordTarget] = useState('H15');
  const [roll, setRoll] = useState(10);
  const [message, setMessage] = useState('');
  const threads = useMemo(() => projectThreads(state, { owner, role: 'player' }), [state, owner]);
  const player = threads.player;
  if (!player) return <main><h1>Private projection unavailable</h1><p>This player has no enrolled campaign view.</p></main>;
  const active = thread === 'general' ? threads.general : thread === 'store' ? threads.store : player;
  // The store thread contains stock and chat; its map remains the shared projection.
  const mapView = thread === 'player' ? player : threads.general;
  const map = mapView.map;
  const cells = new Map<string, ProjectedCell>(map.cells.map((cell: ProjectedCell): [string, ProjectedCell] => [cell.coord, cell]));
  const selectedCell = cells.get(coordTarget);
  const actors = new Map(mapView.actors.map((actor: any) => [coord(actor.x, actor.y), actor]));
  const phaseAction = state.phase === 'combat'
    ? { type: 'finish_combat', label: 'Finish combat' }
    : state.phase === 'aftermath'
      ? { type: 'record_debrief', label: 'Record debrief' }
      : state.phase === 'travel'
        ? { type: 'open_store', label: 'Open store' }
        : state.phase === 'store'
          ? { type: 'ready_next_scene', label: 'Ready next scene' }
          : state.phase === 'ready'
            ? { type: 'start_next_scene', label: 'Start next scene' }
            : null;

  function run(action: any) {
    try {
      setState((current: any) => applyCampaignAction(current, { ...action, owner: action.owner ?? 'dm', role: action.role ?? 'host' }));
      setMessage('');
    } catch (error: any) {
      setMessage(error?.message ?? 'That action is not available.');
    }
  }

  const chat = (thread === 'general' ? threads.general.messages : thread === 'store' ? threads.store.messages : player.messages).slice(-8);

  return <main className="min-h-screen bg-[#0b0a13] p-4 text-[#f7f3e8] md:p-8">
    <header className="mx-auto mb-6 flex max-w-[1540px] flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm tracking-[.22em] text-amber-300">DMD ARCADE · THREAD PLAYTEST</p>
        <h1 className="font-serif text-4xl tracking-tight md:text-5xl">The interval is playable</h1>
        <p className="mt-2 max-w-3xl text-stone-300">A local rehearsal of the Discord experience: one shared map, private perception discoveries, a persistent store, and a host-controlled branch between encounters.</p>
      </div>
      <nav className="flex flex-wrap gap-2"><Link href="/layout-lab" className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10">Layout lab</Link><Link href="/play" className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10">Protected table</Link></nav>
    </header>

    <div className="mx-auto grid max-w-[1540px] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 rounded-2xl border border-amber-100/15 bg-[#17131d] p-4 shadow-[0_20px_70px_rgba(0,0,0,.3)] md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{mapView.scene.title}</h2><span className="rounded-full bg-amber-300/15 px-3 py-1 text-xs font-semibold uppercase tracking-[.12em] text-amber-200">{labelForPhase(state.phase)}</span></div><p className="mt-1 text-sm text-stone-400">25 × 25 · shared thread: public terrain · private thread: discovered cover and concealment</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setThread('general')} className={`rounded-lg px-3 py-2 text-sm ${thread === 'general' ? 'bg-amber-300 text-[#20170d]' : 'border border-amber-200/30 text-amber-50'}`}>General</button><button type="button" onClick={() => setThread('store')} className={`rounded-lg px-3 py-2 text-sm ${thread === 'store' ? 'bg-amber-300 text-[#20170d]' : 'border border-amber-200/30 text-amber-50'}`}>Store</button><button type="button" onClick={() => setThread('player')} className={`rounded-lg px-3 py-2 text-sm ${thread === 'player' ? 'bg-amber-300 text-[#20170d]' : 'border border-amber-200/30 text-amber-50'}`}>Private: {owner === 'player-1' ? 'Branna' : owner === 'player-2' ? 'Pip' : 'Kael'}</button></div>
        </div>

        <div className="overflow-auto rounded-xl border border-white/10 bg-[#10151b] p-3" aria-label="25 by 25 campaign map">
          <div className="relative min-w-[760px] overflow-hidden rounded-lg" style={{ backgroundImage: `linear-gradient(rgba(10,16,20,.60), rgba(10,16,20,.82)), url('${mapView.scene.art}')`, backgroundPosition: 'center', backgroundSize: 'cover' }}>
            <div className="grid grid-cols-[24px_repeat(25,1fr)] grid-rows-[24px_repeat(25,28px)] p-2">
              <div />{columns.map(column => <div key={column} className="flex items-center justify-center text-[10px] font-semibold text-amber-100/70">{column}</div>)}
              {Array.from({ length: SIZE }, (_, y) => [<div key={`row-${y}`} className="flex items-center justify-center text-[10px] font-semibold text-amber-100/70">{y + 1}</div>, ...Array.from({ length: SIZE }, (_, x) => {
                const key = coord(x, y), cell = cells.get(key), actor: any = actors.get(key);
                const terrain = cell?.terrain ?? 'sand';
                return <button type="button" key={key} onClick={() => setCoordTarget(key)} title={`${key} · ${terrain}`} className={`relative border border-white/[.12] text-left ${terrainTone(terrain, Boolean(cell?.blocked), Boolean(cell?.difficult))} ${coordTarget === key ? 'shadow-[inset_0_0_0_2px_rgba(251,191,36,.95)]' : ''}`}>
                  {cell?.cover && <span className="absolute bottom-0.5 left-0.5 text-[10px] text-amber-200" aria-label={`${cell.cover} cover`}>{cell.cover === 'full' ? '▰' : '◧'}</span>}
                  {cell?.concealment && <span className="absolute right-0.5 top-0.5 text-[10px] text-emerald-200" aria-label={`${cell.concealment} concealment`}>≋</span>}
                  {cell?.difficult && <span className="absolute right-0.5 bottom-0.5 text-[9px] text-sky-200">⌁</span>}
                  {actor && <span className={`absolute left-1/2 top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[8px] font-bold shadow-[0_4px_0_rgba(0,0,0,.45)] ${actor.team === 'party' ? 'border-amber-200 bg-[#211b26] text-amber-100' : 'border-rose-300 bg-[#2b171b] text-rose-100'}`}>{actor.name.split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</span>}
                </button>;
              })])}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_45%_55%,transparent_0%,rgba(8,10,14,.08)_38%,rgba(8,10,14,.38)_100%)]" />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_330px]">
          <div><h3 className="text-sm font-semibold uppercase tracking-[.16em] text-amber-200/80">Map language</h3><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-300"><span>▰ full cover</span><span>◧ half cover</span><span className="text-emerald-200">≋ concealment</span><span className="text-sky-200">⌁ difficult terrain</span><span className="text-stone-400">unread terrain = not yet discovered</span></div><p className="mt-3 text-xs leading-5 text-stone-400">The general thread never receives hidden cover, concealment, or clues. A successful check changes only that owner’s private projection; the player must communicate it to the party.</p></div>
          <div className="rounded-lg border border-amber-100/10 bg-black/15 p-3 text-sm"><p className="font-semibold text-amber-100">Selected square · {coordTarget}</p><p className="mt-1 text-stone-300">{selectedCell?.terrain ?? 'Open sand'}{selectedCell?.cover ? ` · ${selectedCell.cover} cover` : ''}{selectedCell?.concealment ? ` · ${selectedCell.concealment} concealment` : ''}</p><button type="button" onClick={() => run({ type: 'spot', owner, role: 'player', ability: 'perception', roll: Number(roll), coord: coordTarget })} className="mt-3 rounded-lg border border-amber-200/30 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-200/10">Roll perception here</button><div className="mt-2 flex items-center gap-2"><label htmlFor="d20" className="text-xs text-stone-400">d20</label><input id="d20" type="number" min="1" max="20" value={roll} onChange={event => setRoll(Number(event.target.value))} className="w-16 rounded border border-white/15 bg-black/20 px-2 py-1 text-sm" /></div></div>
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-amber-100/15 bg-[#17131d] p-5"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Campaign control</h2><span className="text-xs text-stone-400">rev {state.revision}</span></div><p className="mt-2 text-sm leading-6 text-stone-300">{state.alwaysBranch.promise}</p>{phaseAction && <button type="button" onClick={() => run({ type: phaseAction.type, notes: 'The party records the battlefield, survivors, and the next route.' })} className="mt-4 w-full rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-[#20170d] hover:bg-amber-200">{phaseAction.label}</button>}{message && <p className="mt-3 rounded-lg border border-rose-300/30 bg-rose-950/25 p-3 text-sm text-rose-100">{message}</p>}<div className="mt-4 grid grid-cols-5 gap-1 text-center text-[10px] uppercase tracking-[.08em] text-stone-500">{['combat', 'aftermath', 'travel', 'store', 'ready'].map(value => <span key={value} className={state.phase === value ? 'font-bold text-amber-200' : ''}>{value}</span>)}</div></section>

        <section className="rounded-2xl border border-[#5865f2]/45 bg-[#313338] shadow-[0_18px_50px_rgba(0,0,0,.28)]"><div className="border-b border-white/10 bg-[#2b2d31] px-4 py-3"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#b5bac1]">Discord thread preview</p><div className="mt-1 flex items-center justify-between"><p className="text-sm font-semibold text-white">{active.name}</p><span className="text-xs text-[#b5bac1]">{chat.length} messages</span></div></div><div className="max-h-64 space-y-3 overflow-auto p-4">{chat.length ? chat.map((entry: any, index: number) => <div key={`${entry.kind}-${index}`} className="text-sm"><p className="font-semibold text-white">{entry.actor === 'system' || entry.actor === 'store' ? 'Davy Jones' : entry.actor}<span className="ml-2 text-[10px] font-normal uppercase tracking-[.12em] text-[#949ba4]">{entry.kind}</span></p><p className="mt-1 leading-5 text-[#dbdee1]">{entry.summary}</p></div>) : <p className="text-sm text-[#b5bac1]">No messages in this thread yet.</p>}</div></section>

        <section className="rounded-2xl border border-amber-100/15 bg-[#17131d] p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Player projection</h2><select value={owner} onChange={event => setOwner(event.target.value)} className="rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-sm text-white">{owners.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div><p className="mt-2 text-sm text-stone-300">Private gold: <strong className="text-amber-200">{player.wallet.gold} gp</strong> · discoveries: <strong className="text-amber-200">{player.discoveries.length}</strong></p>{state.phase === 'store' && <div className="mt-4 space-y-2">{threads.store.store.items.map((item: any) => <div key={item.id} className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs text-stone-400">{item.price} gp · stock {item.stock}</p></div><button type="button" disabled={!item.stock} onClick={() => run({ type: 'buy_item', owner, role: 'player', itemId: item.id, quantity: 1 })} className="rounded bg-[#5865f2] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Buy</button></div><p className="mt-2 text-xs leading-5 text-stone-400">{item.summary}</p></div>)}</div>}{player.wallet.inventory.length > 0 && <p className="mt-4 text-xs text-stone-400">Private inventory: {player.wallet.inventory.map((item: any) => `${item.name} ×${item.quantity}`).join(', ')}</p>}</section>
      </aside>
    </div>
  </main>;
}
