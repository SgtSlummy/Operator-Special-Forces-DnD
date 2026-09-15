'use client';
import {Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {apiFetch} from '../../../client/api.mjs';
import '../table.css';

type AdmissionResponse={status:string,error?:string};
function Admission(){
 const query=useSearchParams();const campaign=query?.get('campaignId');const suffix=campaign?'?campaignId='+encodeURIComponent(campaign):'';
 const [name,setName]=useState(''),[preset,setPreset]=useState('fighter'),[status,setStatus]=useState('loading'),[message,setMessage]=useState('Checking your campaign membership…'),[busy,setBusy]=useState(false);
 async function check(){try{const r=await apiFetch('/api/hollow-lantern/admission'+suffix);const data=await r.json() as AdmissionResponse;if(!r.ok)throw Error(data.error);setStatus(data.status);setMessage(data.status==='available'?'Choose a supported level-three 2024 character.':data.status==='enrolled'?'Your character is ready.':data.status==='full'?'All seats for this release stage are reserved.':data.status==='needs_gm'?'Your reserved character needs a GM correction.':'Your seat is reserved. We will admit your character at the next safe pause.');}catch(e){setMessage(e instanceof Error?e.message:'Admission is unavailable.');}}
 useEffect(()=>{void check();const timer=setInterval(()=>void check(),10000);return()=>clearInterval(timer);},[campaign]);
 async function join(){setBusy(true);try{const r=await apiFetch('/api/hollow-lantern/admission'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presetId:preset,name,edition:'2024'})});const data=await r.json() as AdmissionResponse;if(!r.ok)throw Error(data.error);await check();}catch(e){setMessage(e instanceof Error?e.message:'Check your reservation before trying again.');}finally{setBusy(false);}}
 return <main className="hl-activity hl-admission"><p className="hl-eyebrow">Operation Hollow Lantern</p><h1>Join the campaign</h1><p className="hl-notice" role="status">{message}</p>{status==='available'&&<form onSubmit={e=>{e.preventDefault();void join();}}><label>Character name<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} disabled={busy} required autoComplete="off"/></label><label>2024 character preset<select value={preset} disabled={busy} onChange={e=>setPreset(e.target.value)}>{['fighter','rogue','cleric'].map(p=><option key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</option>)}</select></label><p>Your Discord account owns one character. Choices use the validated 2024 rules.</p><button disabled={busy||!name.trim()}>{busy?'Reserving your character…':'Reserve my character'}</button></form>}{status==='enrolled'&&<a className="hl-admission-enter" href={'/hollow-lantern'+suffix}>Open my player table</a>}</main>;
}
export default function Page(){return <Suspense fallback={<p>Opening admission…</p>}><Admission/></Suspense>;}
