'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Enter and leave the authenticated table with a full document navigation; the production Vinext Link transition fails in the browser fixture. */
import {useEffect, useState} from 'react';
import {apiFetch, apiPath} from '../../client/api.mjs';
import {entryProblem, inspectCampaign, campaignPath} from './connection.mjs';
import './welcome.css';

const messages = {
  checking: {title:'Opening your campaign', text:'Checking sign-in and the game connection…'},
  ready: {title:'Your table is available', text:'Open your private map, character record, inventory, and journal.'},
  sign_in: {title:'Sign in to take your seat', text:'Use the Discord account enrolled by your DM. Your character and campaign access are checked before the table opens.'},
  account_access: {title:'Your account needs a campaign seat', text:'Ask your DM to check this account’s enrollment, or sign out and use your enrolled Discord account.'},
  host_configuration: {title:'The connection needs a host repair', text:'The host needs to check the Discord sign-in settings and campaign connection. Repeated sign-in attempts will not repair these settings.'},
  relaunch: {title:'Start a fresh sign-in', text:'The previous authorization has expired or was cancelled. Sign in again to request a fresh authorization.'},
  retry: {title:'The campaign could not be reached', text:'The game host may be starting or temporarily offline. Retry the connection before opening your table.'},
};
type Status = keyof typeof messages;
type Connection = {status:Status; signedIn:boolean; revision?:number};

export default function Welcome({campaignId, discordUrl, connectionError}: {campaignId:string; discordUrl?:string; connectionError?:string}) {
  const [connection, setConnection] = useState<Connection>({status:'checking', signedIn:false});
  const [attempt, setAttempt] = useState(0), [leaving, setLeaving] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void inspectCampaign({fetchImpl:apiFetch, campaignId, signal:controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      // A browser OAuth failure carries only a fixed recovery category, never
      // the provider response. A working session takes precedence over old URLs.
      const status = connectionError && attempt === 0 && result.status !== 'ready' ? entryProblem(connectionError) : result.status;
      setConnection({...result, status:status as Status});
    }).catch(() => {if (!controller.signal.aborted) setConnection({status:'retry', signedIn:false});});
    return () => controller.abort();
  }, [campaignId, connectionError, attempt]);
  async function signOut() {
    if (leaving) return;
    setLeaving(true); setNotice('');
    try {
      const response = await apiFetch(campaignPath('/api/auth/logout',campaignId), {method:'POST', signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error();
      setConnection({status:'sign_in', signedIn:false});
      setNotice('Signed out. Your campaign progress has not been changed.');
    } catch {setNotice('Sign-out could not be confirmed. Retry while the host is available.');}
    finally {setLeaving(false);}
  }
  const copy = messages[connection.status];
  return <main className="campaign-welcome">
    <header><a className="campaign-brand" href={campaignPath('/',campaignId)} aria-label="Davy Jones home"><span aria-hidden="true">◈</span> Davy Jones</a><span className="campaign-tag">Campaign table</span></header>
    <div className="campaign-intro"><p className="campaign-eyebrow">Operation Hollow Lantern</p><h1>The next chapter<br/>starts at your table.</h1><p>A missing convoy. A silent coast. One party to bring the light back.</p></div>
    <div className="campaign-entry-grid">
      <section className="campaign-connect" aria-labelledby="connection-title" aria-busy={connection.status === 'checking'}>
        <p className="campaign-eyebrow">{connection.status === 'ready' ? 'Connected' : 'Your seat'}</p>
        <h2 id="connection-title">{copy.title}</h2><p role="status" aria-live="polite">{copy.text}</p>
        {connection.status === 'ready' && <p className="campaign-checkpoint">Campaign revision {connection.revision} · Access verified</p>}
        <div className="campaign-entry-actions">
          {connection.status === 'ready' && <a className="campaign-primary" href={campaignPath('/hollow-lantern',campaignId)}>Open my table <span aria-hidden="true">→</span></a>}
          {['sign_in','relaunch'].includes(connection.status) && <a className="campaign-primary" href={apiPath(campaignPath('/api/auth/discord/start',campaignId))}>Sign in with Discord <span aria-hidden="true">→</span></a>}
          {connection.status !== 'checking' && <button disabled={leaving} onClick={() => {setNotice('');setConnection({status:'checking',signedIn:false});setAttempt(value => value + 1);}}>Check connection</button>}
          {(connection.signedIn || connection.status === 'account_access') && <button disabled={leaving} onClick={() => void signOut()}>{leaving ? 'Signing out…' : 'Sign out'}</button>}
        </div>
        {notice && <p role="status">{notice}</p>}
        {discordUrl && <a className="campaign-channel" href={discordUrl}>Open the adventure in Discord <span aria-hidden="true">↗</span></a>}
      </section>
      <aside className="campaign-table-guide" aria-label="What is at your table"><p className="campaign-eyebrow">At your table</p>
        <dl><div><dt>Map & exploration</dt><dd>See where you are and choose your next move.</dd></div><div><dt>Character & equipment</dt><dd>Review your abilities, resources, and carried items.</dd></div><div><dt>Journal & decisions</dt><dd>Revisit your discoveries and act on the current scene.</dd></div></dl>
        <p className="campaign-privacy">Your private table shows only information your account is allowed to see.</p>
      </aside>
    </div><footer>Sign in · Open your table · Choose your next action</footer>
  </main>;
}
