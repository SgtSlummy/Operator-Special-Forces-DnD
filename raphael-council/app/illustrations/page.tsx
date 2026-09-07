import Link from 'next/link';
import SceneImages from '../scene-images';

export default function Illustrations() {
  return <main className="min-h-screen bg-[#0b0a13] p-6 text-[#f7f3e8] md:p-10">
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-amber-200 underline underline-offset-4">Your campaign</Link>
      <p className="mt-8 text-xs uppercase tracking-widest text-amber-300">Witnesslight</p>
      <h1 className="mt-2 font-serif text-4xl">Your view of the world</h1>
      <p className="my-5 max-w-xl leading-7 text-stone-300">Ask for what your character can see at any time. Use the private image access code from your host. If you are already connected to the tactical table, its image control uses that campaign connection.</p>
      <SceneImages />
    </div>
  </main>;
}
