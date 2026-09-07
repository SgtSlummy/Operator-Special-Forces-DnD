import Link from 'next/link';
import Play from './play/page';
import Activity from './activity/page';

/** The home page and /play are views of the same authenticated campaign.
 * Browser-local prototype outcomes and dice are no longer an engine authority. */
export default async function Home({ searchParams }: { searchParams: Promise<{ frame_id?: string }> }) {
  // Discord launches the root URL mapping with SDK frame parameters. This only
  // selects the shell; server-side OAuth and membership still authorize play.
  const params = await searchParams;
  if (typeof params.frame_id === 'string' && params.frame_id) return <Activity />;
  return <>
    <div className="border-b border-amber-100/15 bg-[#17131d] px-4 py-3 text-sm text-stone-300 md:px-8">
      <p>Play in Discord or use this companion. Both use your saved campaign.</p>
      <Link href="/illustrations" className="mt-1 inline-block text-amber-200 underline underline-offset-4">Standalone scene images</Link>
    </div>
    <Play />
  </>;
}
