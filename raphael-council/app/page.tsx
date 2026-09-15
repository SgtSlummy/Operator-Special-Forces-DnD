import Link from 'next/link';
import Play from './play/page';
import Activity from './activity/page';
import Welcome from './entry/Welcome';
import {usesHollowAuthority,getActivityCampaignRegistry} from '../hollow-lantern/activity-runtime.mjs';
import {selectEntryCampaign} from './entry/connection.mjs';

export const dynamic = 'force-dynamic';

/** Choose the configured campaign shell at request time. A page choice grants
 * no access: OAuth, membership, and the engine authorize every private view. */
export default async function Home({ searchParams }: { searchParams: Promise<{ frame_id?: string; connection?: string; campaignId?: string | string[] }> }) {
  // Discord launches the root URL mapping with SDK frame parameters. This only
  // selects the shell; server-side OAuth and membership still authorize play.
  const params = await searchParams;
  if (typeof params.frame_id === 'string' && params.frame_id) return <Activity />;
  if (usesHollowAuthority()) {
    const legacy={campaignId:process.env.HOLLOW_LANTERN_CAMPAIGN_ID??'operation-hollow-lantern',guildId:process.env.HOLLOW_LANTERN_GUILD_ID??'',channelId:process.env.HOLLOW_LANTERN_CHANNEL_ID??''};
    let descriptor;
    try {
      // Catalog metadata only: rendering the entry page never opens an auth DB or engine runtime.
      const catalog=process.env.HOLLOW_LANTERN_CAMPAIGNS_FILE?getActivityCampaignRegistry().catalog:{defaultCampaignId:legacy.campaignId,get:(id:string)=>id===legacy.campaignId?legacy:undefined};
      descriptor=selectEntryCampaign(params.campaignId,catalog);
    } catch {
      return <main><h1>Campaign unavailable</h1><p>Open a current campaign invitation or ask your DM for the correct link.</p></main>;
    }
    const campaignId=descriptor.campaignId,guild=descriptor.guildId,channel=descriptor.channelId;
    const discordUrl = [guild, channel].every(value => /^\d{17,20}$/.test(value)) ? `https://discord.com/channels/${guild}/${channel}` : undefined;
    const connectionError = typeof params.connection === 'string' ? params.connection : undefined;
    return <Welcome key={`${campaignId}:${connectionError ?? ''}`} campaignId={campaignId} discordUrl={discordUrl} connectionError={connectionError}/>;
  }
  return <>
    <div className="border-b border-amber-100/15 bg-[#17131d] px-4 py-3 text-sm text-stone-300 md:px-8">
      <p>Play in Discord or use this companion. Both use your saved campaign.</p>
      <Link href="/illustrations" className="mt-1 inline-block text-amber-200 underline underline-offset-4">Standalone scene images</Link>
    </div>
    <Play />
  </>;
}
