'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

type Team = 'party' | 'enemy';
type Point = { x: number; y: number };
type Unit = Point & {
  id: string;
  name: string;
  short: string;
  team: Team;
  hp: number;
  maxHp: number;
  initiative: number;
  color: string;
  portrait: string;
};
type Turn = {
  active: string;
  title: string;
  detail: string;
  positions?: Record<string, Point>;
  effects?: Point[];
};

const SIZE = 25;
const columns = Array.from({ length: SIZE }, (_, index) => String.fromCharCode(65 + index));
const rows = Array.from({ length: SIZE }, (_, index) => index + 1);

const units: Unit[] = [
  { id: 'branna', name: 'Branna Stonewake', short: 'BS', team: 'party', hp: 12, maxHp: 12, initiative: 18, color: '#c9854e', portrait: '/art/portrait-branna.png', x: 5, y: 18 },
  { id: 'pip', name: 'Pip Underbough', short: 'PU', team: 'party', hp: 8, maxHp: 8, initiative: 15, color: '#6f9fbc', portrait: '/art/portrait-pip.png', x: 6, y: 20 },
  { id: 'kael', name: 'Kael Ashstep', short: 'KA', team: 'party', hp: 10, maxHp: 10, initiative: 14, color: '#9b7b53', portrait: '/art/portrait-kael.png', x: 5, y: 22 },
  { id: 'wight-a', name: 'Brine Wight A', short: 'WA', team: 'enemy', hp: 9, maxHp: 9, initiative: 10, color: '#9e6260', portrait: '/art/portrait-brine.png', x: 19, y: 8 },
  { id: 'wight-b', name: 'Brine Wight B', short: 'WB', team: 'enemy', hp: 9, maxHp: 9, initiative: 9, color: '#9e6260', portrait: '/art/portrait-brine.png', x: 19, y: 12 },
  { id: 'wight-c', name: 'Brine Wight C', short: 'WC', team: 'enemy', hp: 9, maxHp: 9, initiative: 8, color: '#9e6260', portrait: '/art/portrait-brine.png', x: 19, y: 16 },
];

const turns: Turn[] = [
  {
    active: 'branna',
    title: 'Branna takes the seawall',
    detail: 'The fighter advances to the broken seawall, claiming half cover before the wights close the gap.',
    positions: { branna: { x: 8, y: 17 } },
    effects: [{ x: 8, y: 17 }, { x: 9, y: 17 }],
  },
  {
    active: 'pip',
    title: 'Pip casts Fire Bolt',
    detail: 'A blue-white bolt crosses the open sand. The attack lane remains visible on the map, but the rules engine owns the result.',
    positions: { pip: { x: 8, y: 20 } },
    effects: [{ x: 13, y: 20 }, { x: 14, y: 19 }, { x: 14, y: 20 }],
  },
  {
    active: 'kael',
    title: 'Kael slips through the grass',
    detail: 'The rogue uses the concealed salt grass to change angle without crossing the blocked ruin.',
    positions: { kael: { x: 10, y: 22 } },
    effects: [{ x: 10, y: 22 }, { x: 11, y: 22 }, { x: 12, y: 22 }],
  },
  {
    active: 'wight-a',
    title: 'The tide answers',
    detail: 'Brine Wight A presses around the western ruin. Water is difficult terrain; the broken walls still block the shortest path.',
    positions: { 'wight-a': { x: 16, y: 9 }, 'wight-b': { x: 18, y: 13 } },
    effects: [{ x: 16, y: 10 }, { x: 17, y: 10 }, { x: 18, y: 10 }],
  },
];

const cellId = (x: number, y: number) => `${x},${y}`;
const terrainAt = (x: number, y: number) => {
  if ((x < 3 && y > 11) || (x > 21 && y < 13)) return 'water';
  if ((x === 3 || x === 4) && y > 5 && y < 19) return 'wall';
  if ((x === 14 || x === 15) && y > 8 && y < 18) return 'ruin';
  if (y === 4 && x > 7 && x < 21) return 'high';
  if ((x > 7 && x < 12 && y > 18) || (x > 18 && y > 18)) return 'grass';
  if ((x === 12 && y > 5 && y < 9) || (x === 13 && y > 5 && y < 9)) return 'stairs';
  return 'sand';
};

function Icon({ kind }: { kind: 'wall' | 'ruin' | 'water' | 'high' | 'stairs' | 'grass' | 'objective' }) {
  if (kind === 'wall' || kind === 'ruin') return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M2 15.5 5 10l3 3 3-6 3 4 4-5v9.5H2Z" fill="currentColor" opacity=".72"/><path d="M3 16h14M5 11l2 2m4-6 2 3m3-4 2 2" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>;
  if (kind === 'water') return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M2 7c2.4-2 4.8 2 7.2 0s4.8-2 7.2 0M2 12c2.4-2 4.8 2 7.2 0s4.8-2 7.2 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
  if (kind === 'high') return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="m3 15 5-6 3 3 4-7 2 10H3Z" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M4 16h13" stroke="currentColor" strokeWidth="1.4"/></svg>;
  if (kind === 'stairs') return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M3 16h4v-3h3v-3h3V7h4" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M14 4h3v3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>;
  if (kind === 'grass') return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M4 16c0-4 2-6 4-8m0 8c0-5 3-7 5-10m-1 10c0-3 2-5 4-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="1.2"/></svg>;
}

function Token({ unit, active, position }: { unit: Unit; active: boolean; position: Point }) {
  return <div className="absolute inset-0 flex items-end justify-center" title={`${unit.name} · ${columns[position.x]}${position.y + 1}`}>
    <div className={`relative mb-[2px] h-7 w-7 rounded-full border-2 shadow-[0_5px_0_rgba(0,0,0,.42)] ${active ? 'ring-2 ring-amber-200 ring-offset-1 ring-offset-[#17131d]' : ''}`} style={{ borderColor: unit.color, backgroundColor: '#111019' }}>
      <Image src={unit.portrait} alt="" fill sizes="28px" className="rounded-full object-cover object-top opacity-95" />
      <span className="absolute -bottom-3 left-1/2 h-2 w-5 -translate-x-1/2 skew-x-[-18deg] rounded-sm" style={{ backgroundColor: unit.color }} />
      <span className="absolute -right-2 -top-2 rounded bg-[#111019]/90 px-1 text-[8px] font-bold text-white">{unit.short}</span>
    </div>
  </div>;
}

export default function LayoutLab() {
  const [turnIndex, setTurnIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const turn = turns[turnIndex];
  const positions = useMemo(() => Object.fromEntries(units.map(unit => [unit.id, turn.positions?.[unit.id] ?? { x: unit.x, y: unit.y }])), [turn]);
  const occupied = new Map(units.map(unit => [cellId(positions[unit.id].x, positions[unit.id].y), unit]));
  const effects = new Set((turn.effects ?? []).map(point => cellId(point.x, point.y)));

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setTurnIndex(index => (index + 1) % turns.length), 2400);
    return () => window.clearInterval(timer);
  }, [playing]);

  return <main className="min-h-screen bg-[#0b0a13] p-4 text-[#f7f3e8] md:p-8">
    <header className="mx-auto mb-6 flex max-w-[1500px] flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm tracking-[.22em] text-amber-300">RAPHAEL · COMBAT LAYOUTS</p><h1 className="font-serif text-4xl tracking-tight md:text-5xl">Saltglass Shore, played live</h1><p className="mt-2 max-w-2xl text-stone-300">A 25 × 25 tactical board that keeps the scene art visible, gives terrain rules a visual language, and leaves enough room for characters, obstacles, and readable combat state.</p></div>
      <nav className="flex flex-wrap gap-2"><Link href="/play" className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10">Open live table</Link><Link href="/" className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10">Campaign council</Link></nav>
    </header>

    <div className="mx-auto grid max-w-[1500px] gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <section className="min-w-0 rounded-2xl border border-amber-100/15 bg-[#17131d] p-4 shadow-[0_20px_70px_rgba(0,0,0,.3)] md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Tactical map · 25 × 25</h2><p className="mt-1 text-sm text-stone-400">Five-foot squares · art layer is illustrative · movement and line of sight remain rules-authoritative</p></div><div className="flex gap-2"><button type="button" onClick={() => setPlaying(value => !value)} className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-[#20170d] hover:bg-amber-200">{playing ? 'Pause play test' : 'Play encounter'}</button><button type="button" onClick={() => setTurnIndex(index => (index + 1) % turns.length)} className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-50 hover:bg-amber-200/10">Next turn</button></div></div>
        <div className="overflow-auto rounded-xl border border-white/10 bg-[#10151b] p-3" aria-label="25 by 25 tactical battle map">
          <div className="relative min-w-[880px] overflow-hidden rounded-lg" style={{ backgroundImage: "linear-gradient(rgba(10,16,20,.58), rgba(10,16,20,.78)), url('/art/saltglass-shore-sd.png')", backgroundPosition: 'center', backgroundSize: 'cover' }}>
            <div className="grid grid-cols-[24px_repeat(25,32px)] grid-rows-[24px_repeat(25,32px)] p-2">
              <div />{columns.map(column => <div key={column} className="flex items-center justify-center text-[10px] font-semibold text-amber-100/70">{column}</div>)}
              {rows.flatMap((row, y) => [<div key={`row-${row}`} className="flex items-center justify-center text-[10px] font-semibold text-amber-100/70">{row}</div>, ...columns.map((_, x) => {
                const terrain = terrainAt(x, y);
                const key = cellId(x, y);
                const unit = occupied.get(key);
                const active = unit?.id === turn.active;
                const effect = effects.has(key);
                const tint = terrain === 'water' ? 'bg-sky-950/60' : terrain === 'wall' || terrain === 'ruin' ? 'bg-stone-700/75' : terrain === 'high' ? 'bg-violet-950/45' : terrain === 'stairs' ? 'bg-amber-800/35' : terrain === 'grass' ? 'bg-emerald-950/45' : 'bg-[#4e4438]/25';
                return <div key={key} className={`relative border border-white/[.12] ${tint} ${effect ? 'shadow-[inset_0_0_0_2px_rgba(251,191,36,.75)]' : ''}`} title={`${columns[x]}${row} · ${terrain}`}>
                  <span className="absolute bottom-0.5 left-0.5 text-[8px] text-white/35">{terrain === 'sand' ? '' : <Icon kind={terrain === 'wall' ? 'wall' : terrain === 'ruin' ? 'ruin' : terrain === 'water' ? 'water' : terrain === 'high' ? 'high' : terrain === 'stairs' ? 'stairs' : 'grass'} />}</span>
                  {unit && <Token unit={unit} active={active} position={positions[unit.id]} />}
                </div>;
              })])}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_45%_55%,transparent_0%,rgba(8,10,14,.08)_38%,rgba(8,10,14,.38)_100%)]" />
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
          <div><h3 className="text-sm font-semibold uppercase tracking-[.16em] text-amber-200/80">Map key</h3><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-300"><span className="inline-flex items-center gap-2"><Icon kind="wall" /> Full cover / blocked structure</span><span className="inline-flex items-center gap-2"><Icon kind="ruin" /> Broken ruin / cover</span><span className="inline-flex items-center gap-2"><Icon kind="water" /> Difficult water</span><span className="inline-flex items-center gap-2"><Icon kind="high" /> Elevated ground</span><span className="inline-flex items-center gap-2"><Icon kind="stairs" /> Stairs / elevation route</span><span className="inline-flex items-center gap-2"><Icon kind="grass" /> Concealment</span></div></div>
          <div className="rounded-lg border border-amber-100/10 bg-black/15 p-3 text-sm"><p className="font-semibold text-amber-100">Current event</p><p className="mt-1 text-lg">{turn.title}</p><p className="mt-1 text-stone-300">{turn.detail}</p></div>
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-amber-100/15 bg-[#17131d] p-5"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Initiative</h2><span className="rounded-full bg-amber-300/15 px-3 py-1 text-xs font-semibold text-amber-200">Round 1</span></div><ol className="mt-4 space-y-2">{[...units].sort((a, b) => b.initiative - a.initiative).map(unit => <li key={unit.id} className={`flex items-center gap-3 rounded-lg border p-2 ${unit.id === turn.active ? 'border-amber-300/60 bg-amber-300/10' : 'border-white/10 bg-black/10'}`}><Image src={unit.portrait} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover object-top" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{unit.name}</span><span className="block text-xs text-stone-400">{unit.team === 'party' ? 'Party' : 'Enemy'} · HP {unit.hp}/{unit.maxHp}</span></span><span className="text-sm font-semibold text-amber-200">{unit.initiative}</span></li>)}</ol></section>

        <section className="overflow-hidden rounded-2xl border border-[#5865f2]/45 bg-[#313338] shadow-[0_18px_50px_rgba(0,0,0,.28)]"><div className="border-b border-white/10 bg-[#2b2d31] px-4 py-3"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#b5bac1]">Discord embed preview</p><p className="mt-1 text-sm font-semibold text-white">Davy Jones · Raphael</p></div><div className="border-l-4 border-[#5865f2] p-4"><h2 className="text-lg font-semibold text-white">{turn.title}</h2><p className="mt-2 text-sm leading-6 text-[#dbdee1]">{turn.detail}</p><Image src="/art/saltglass-shore-sd.png" alt="Saltglass Shore tactical artwork" width={640} height={360} className="mt-4 h-32 w-full rounded-md object-cover object-center" /><div className="mt-3 flex items-center justify-between text-xs text-[#b5bac1]"><span>Map revision {turnIndex + 1}</span><span>6 combatants</span></div></div><div className="flex gap-2 border-t border-white/10 bg-[#2b2d31] px-4 py-3"><button type="button" onClick={() => setTurnIndex(index => (index + 1) % turns.length)} className="rounded bg-[#5865f2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752c4]">Next turn</button><button type="button" onClick={() => setPlaying(value => !value)} className="rounded border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#dbdee1] hover:bg-white/5">{playing ? 'Pause' : 'Play'}</button></div></section>

        <section className="rounded-2xl border border-amber-100/15 bg-[#17131d] p-5"><h2 className="text-xl font-semibold">Layout decisions</h2><ul className="mt-3 space-y-3 text-sm leading-6 text-stone-300"><li><strong className="text-amber-100">25 × 25:</strong> enough tactical context for flanks, cover lanes, and water without turning the board into a tiny 10 × 10 postage stamp.</li><li><strong className="text-amber-100">Compact tokens:</strong> character portraits sit on a raised base, keeping the bottom-middle marker readable while preserving the art underneath.</li><li><strong className="text-amber-100">Discord-ready:</strong> the embed carries the current event and scene art; the full map remains available in the Activity/browser view.</li></ul></section>
      </aside>
    </div>
  </main>;
}
