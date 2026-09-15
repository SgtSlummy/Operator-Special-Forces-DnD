'use client';
import { apiFetch } from '../../client/api.mjs';
import { connectActivity, connectionProblem } from '../../client/activity-connection.mjs';
import { useEffect, useState } from 'react';
import Play from '../play/page';
import HollowTable from '../hollow-lantern/page';
import Admission from '../hollow-lantern/join/page';

// Keep one SDK transport for this iframe. React cleanup must not call sdk.close:
// closing the transport also sends a close frame to Discord's Activity host.
let transport: {clientId:string; sdk:Promise<InstanceType<typeof import('@discord/embedded-app-sdk').DiscordSDK>>} | undefined;
async function createSDK(clientId:string) {
  if (transport?.clientId !== clientId) {
    const sdk = import('@discord/embedded-app-sdk').then(({DiscordSDK}) => new DiscordSDK(clientId));
    transport = {clientId, sdk};
    void sdk.catch(() => { if (transport?.sdk === sdk) transport = undefined; });
  }
  return transport.sdk;
}

const guidance = {
  host_configuration: {title:'The host needs to repair this connection',text:'Share the connection code below with the host. Reopening the Activity will not fix the application settings.'},
  account_access: {title:'Check your campaign account',text:'Launch Davy using the Discord account enrolled by your DM. Your DM can check your seat from the private campaign controls.'},
  relaunch: {title:'Open a fresh Activity',text:'Close this Activity using Discord’s controls. Return to the game channel, open Apps, and launch Davy Jones again.'},
  retry: {title:'Try connecting again',text:'The campaign remains saved. Retry the connection when Discord and the game host are available.'},
};
type Problem = ReturnType<typeof connectionProblem>;

export default function Activity() {
  const [experience, setExperience] = useState(''), [problem, setProblem] = useState<Problem|null>(null);
  const [attempt, setAttempt] = useState(0), [progress, setProgress] = useState('Checking the game connection…');
  useEffect(() => {
    const controller = new AbortController();
    void connectActivity({fetchImpl:apiFetch,createSDK,signal:controller.signal,onProgress:setProgress})
      .then(result => {if (!controller.signal.aborted) setExperience(result.scope.role==='prospective'?'hollow-admission':result.experience);})
      .catch(error => {if (!controller.signal.aborted) setProblem(connectionProblem(error));});
    return () => controller.abort();
  }, [attempt]);
  if (experience) return experience==='hollow-admission'?<Admission/>:experience === 'hollow-lantern' ? <HollowTable/> : <Play embedded/>;
  const recovery = problem ? guidance[problem.recovery as keyof typeof guidance] : null;
  return <main style={{minHeight:'100vh',background:'#11171b',color:'#ebe5d6',padding:'clamp(24px,5vw,56px)',fontFamily:'system-ui,sans-serif'}}>
    <p style={{color:'#d7b54a',fontSize:12,letterSpacing:'.13em',textTransform:'uppercase'}}>Davy Jones · Campaign table</p>
    <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(26px,5vw,42px)'}}>Your adventure awaits</h1>
    <p role="status" aria-live="polite" style={{maxWidth:620,lineHeight:1.7}}>{problem?.message || progress}</p>
    {recovery && <section aria-label="Connection help" style={{maxWidth:620,borderLeft:'3px solid #d7b54a',paddingLeft:18,marginTop:24,lineHeight:1.7}}>
      <h2 style={{fontSize:20}}>{recovery.title}</h2><p>{recovery.text}</p>
      {problem?.recovery === 'retry' && <button style={{minHeight:44,padding:'10px 18px',background:'#d7b54a',color:'#11171b',border:0,borderRadius:6,font:'inherit',cursor:'pointer'}} onClick={() => {setProblem(null);setProgress('Checking the game connection…');setAttempt(value => value + 1);}}>Retry connection</button>}
      <p style={{color:'#aab8bc',fontSize:13}}>Connection code: {problem?.code}</p>
    </section>}
  </main>;
}
