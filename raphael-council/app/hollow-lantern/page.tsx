'use client';

import {Suspense,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';

import {apiFetch,apiPath} from '../../client/api.mjs';

import {pendingKey,validPending,persistBeforeSend,clearConfirmed,clearRejected,clearResolved} from './action-session.mjs';

import './table.css';
import {TableSheet} from './table-sheet';
import {DraftEditor,type DraftSelection} from './draft-editor';
import {reconcilePresentation,choosePresentation} from './presentation-mode.mjs';
import {isDraftEditorAction} from './draft-editor-state.mjs';

import {contextualActions,actionsForTab} from './context-actions.mjs';
import {journalEntries,choiceGuidance as originalChoiceGuidance,recoveryGuidance} from './table-guidance.mjs';
import {artworkIdentity,artworkLoaded,artworkFailed} from './artwork-lifecycle.mjs';
import {missionEquipment} from './mission-equipment.mjs';
import {HealingAllocation} from './healing-allocation';
import {validHealingAllocation} from '../../hollow-lantern/healing-allocation.mjs';

type ActionField={id:string;label:string;maxLength:number;kind?:string;pool?:number;choices?:{id:string;label:string}[]};
type Action={id:string;label:string;group:string;description?:string;fields:ActionField[]};

type Pending={commandId:string;campaignId:string;actor:string;level:string;expectedRevision:number};

type ApiError={error?:string};

type ActionResponse=ApiError&{rejection?:unknown;receipt:{revision:number;result?:{status?:string}}};

type View={draftEnabled?:boolean;mode:string;mapDetailAvailable?:boolean;illustrations?:{scene:boolean;portrait:boolean};campaignId:string;revision:number;viewToken:string;title:string;summary:string;selectedActor:string;map?:unknown;actions:Action[];dmStatus?:{decisionOpen:boolean;pendingRulings:{id:string;text:string}[]};controllableActors?:{id:string;name:string}[];journal?:string[];actor?:{name:string;hp:number;maxHp:number;details:string;skills?:Record<string,unknown>;sheet?:{features?:{id:string;name?:string;description?:string}[];[key:string]:unknown};inventory?:{id:string;name:string;quantity:number;description:string;value?:string;equipped?:boolean}[]}};

const label=(s:string)=>s.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

function choiceGuidance(view:View){const text=originalChoiceGuidance(view);return view.draftEnabled?text.replace('Nothing is submitted until you press Confirm.','For quick actions, press Confirm when ready. For written intentions, choose Save draft, review your words, then Try action. Saving does not attempt an action.'):text;}

function describe(v:unknown):string{if(v==null)return 'Not recorded';if(Array.isArray(v))return v.map(describe).join(' · ');if(typeof v==='object')return Object.entries(v).map(([k,x])=>`${label(k)}: ${describe(x)}`).join('\n');return String(v);}

export default function HollowTablePage(){
 return <Suspense fallback={<main className="hl-activity"><p role="status">Opening your private table…</p></main>}><HollowTable/></Suspense>;
}

function HollowTable(){
 const searchParams=useSearchParams();
 const campaignQuery=(searchParams?.getAll('campaignId')??[]).map(id=>`&campaignId=${encodeURIComponent(id)}`).join('');

 const [view,setView]=useState<View|null>(null),[actor,setActor]=useState(''),[actors,setActors]=useState<{id:string;name:string}[]>([]),[level,setLevel]=useState('tactical'),[tab,setTab]=useState('map'),[selected,setSelected]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[message,setMessage]=useState('Opening your private table…'),[busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[storageReady,setStorageReady]=useState(false);

 const [presentationState,setPresentationState]=useState<{context:string;mode:string;value:string}|null>(null);
 const presentation=reconcilePresentation(presentationState,view)?.value??'tactical';
 useEffect(()=>{
  const next=reconcilePresentation(presentationState,view);
  if(next!==presentationState){setPresentationState(next);if(next?.value==='tactical'&&level!=='tactical'){generation.current++;setView(null);setLevel('tactical');}}
 },[view,presentationState,level]);
 function openPresentation(value:string){
  if(!view)return;setPresentationState(choosePresentation(view,value));
  if((value==='tactical'||value==='dungeon')&&level!==value){generation.current++;setView(null);setLevel(value);}
 }
 const [draftSelection,setDraftSelection]=useState<DraftSelection|null>(null);
 const editorSeat=useRef('');if(view)editorSeat.current=JSON.stringify([view.campaignId,view.selectedActor]);
 function chooseAction(id:string,text?:string){const next=view?.actions.find(a=>a.id===id);if(tab==='map'&&(id==='inspect'||id.startsWith('inspect:')||isDraftEditorAction(next)))openPresentation('details');setSelected(id);setFields(text===undefined?{}:{text});if(view?.draftEnabled&&isDraftEditorAction(next))setDraftSelection({action:next!,view,level,text,nonce:Date.now()});}
 const [mapDetail,setMapDetail]=useState('nearby'); const [loadedMap,setLoadedMap]=useState(''),[failedMap,setFailedMap]=useState(''); const [expandedMap,setExpandedMap]=useState(false);const mapDialog=useRef<HTMLDialogElement>(null),mapTrigger=useRef<HTMLButtonElement>(null);
 const connectionFailed=useRef(false); const gate=useRef(false),generation=useRef(0),scope=useRef(''),revision=useRef<number|null>(null);const query=`?actorId=${encodeURIComponent(actor)}&level=${level}${campaignQuery}`;scope.current=query;

 useEffect(()=>{generation.current++;revision.current=null;connectionFailed.current=true;setView(null);setActor('');setActors([]);setDraftSelection(null);setSelected('');setFields({});setExpandedMap(false);setMessage('Opening your private table…');},[campaignQuery]);

 useEffect(()=>{try{const raw=sessionStorage.getItem(pendingKey);if(raw){const p=JSON.parse(raw);if(!validPending(p))throw Error('An older recovery record needs host review. New actions are disabled.');setPending(p);}setStorageReady(true);}catch(e){setMessage(e instanceof Error?e.message:'Recovery storage is unavailable.');}},[]);

 useEffect(()=>{setExpandedMap(false);mapDialog.current?.close();},[actor,level,view?.revision]);
 useEffect(()=>{if(expandedMap)mapDialog.current?.showModal();else mapDialog.current?.close();},[expandedMap]);
 useEffect(()=>{setMapDetail('nearby');},[actor,level,campaignQuery]);
 const detail=level==='tactical'&&view?.mapDetailAvailable?mapDetail:'full';
 const mapIdentity=JSON.stringify([view?.campaignId,view?.selectedActor,view?.revision,level,detail]);
 const mapReady=loadedMap===mapIdentity,mapFailed=failedMap===mapIdentity;
 function closeMap(){setExpandedMap(false);mapDialog.current?.close();mapTrigger.current?.focus();}
 function openTab(next:string){setSelected('');setFields({});setTab(next);}
 async function refresh(){const version=++generation.current,requested=query;try{const r=await apiFetch('/api/hollow-lantern/view'+requested,{signal:AbortSignal.timeout(15000)}),data=await r.json() as View&ApiError;if(version!==generation.current||requested!==scope.current)return;if(!r.ok){if(r.status===401||r.status===403){setView(null);setActors([]);setSelected('');setFields({});}throw Error(data.error||'Your table could not be loaded.');}revision.current=data.revision;setView(data);setActors(previous=>data.controllableActors?.length?data.controllableActors:previous);setSelected('');setFields({});connectionFailed.current=false;setMessage(choiceGuidance(data));}catch(error){if(version!==generation.current||requested!==scope.current)return;connectionFailed.current=true;throw error;}}

 useEffect(()=>{

  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController(),requested=query;

  revision.current=null;setView(null);setSelected('');setFields({});

  async function update(){

   if(gate.current||document.visibilityState==='hidden'){timer=setTimeout(()=>void update(),15000);return;}

   const version=++generation.current;

   try{

    const r=await apiFetch('/api/hollow-lantern/view'+requested,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),data=await r.json() as View&ApiError;

    if(stopped||version!==generation.current||requested!==scope.current)return;

    if(!r.ok){if(r.status===401||r.status===403){setView(null);setActors([]);setSelected('');setFields({});}throw Error(data.error||'Your table could not be loaded.');}

    if(revision.current!==data.revision||connectionFailed.current){connectionFailed.current=false;setSelected('');setFields({});setMessage(choiceGuidance(data));}

    revision.current=data.revision;setView(data);setActors(previous=>data.controllableActors?.length?data.controllableActors:previous);

   }catch(e){if(!stopped&&version===generation.current){connectionFailed.current=true;setMessage(e instanceof Error?e.message:'The connection is unavailable.');}}

   finally{if(!stopped)timer=setTimeout(()=>void update(),15000);}

  }

  void update();return()=>{stopped=true;controller.abort();clearTimeout(timer);generation.current++;};

 },[query]);

 const visibleActions:Action[]=tab==='camp'?(view?.actions??[]).filter(a=>a.id==='describe'):actionsForTab(view?.actions??[],tab);
 const wornEquipment=missionEquipment(view);

 const quickMoves=tab==='map'&&presentation==='tactical'?visibleActions.filter(a=>a.group==='move'&&a.id.startsWith('move:')&&a.fields.length===0).slice(0,8):[];
 const shortcuts=contextualActions(visibleActions,tab,view?.mode,Boolean(view?.dmStatus),selected);

 const illustration=(kind:string)=>apiPath('/api/hollow-lantern/illustration'+query+'&viewToken='+view!.viewToken+'&kind='+kind);

 const action=visibleActions.find(a=>a.id===selected),locked=busy||Boolean(pending)||!storageReady||connectionFailed.current;

 async function submit(recover=false){if(!recover&&view?.draftEnabled&&isDraftEditorAction(action))return;if(gate.current||(!recover&&(!view||locked||!action)))return;const request=recover?pending:view?{commandId:crypto.randomUUID(),campaignId:view.campaignId,actor:view.selectedActor,level,expectedRevision:view.revision}:null;if(!request)return;gate.current=true;setBusy(true);

  try{if(!recover){persistBeforeSend(sessionStorage,request);setPending(request);}const suffix=`?actorId=${encodeURIComponent(request.actor)}&level=${request.level}&campaignId=${encodeURIComponent(request.campaignId)}`;const r=await apiFetch(`/api/hollow-lantern/${recover?'receipt':'action'}${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recover?{commandId:request.commandId}:{commandId:request.commandId,viewToken:view!.viewToken,revision:request.expectedRevision,action:selected,payload:fields})});const data=await r.json() as ActionResponse;if(!r.ok){if(!recover&&data.rejection){clearRejected(sessionStorage,request,data.rejection);setPending(null);}throw Error(data.error||'The result is uncertain. Recover the original action.');}clearConfirmed(sessionStorage,request,data.receipt);setPending(null);setSelected('');setFields({});const confirmation=`${!recover&&tab==='camp'&&selected==='describe'?'Downtime request received; awaiting a ruling':data.receipt.result?.status==='pending-roll'?'Action waiting for a die choice; outcome not yet applied':'Action confirmed'} · revision ${data.receipt.revision}${recover?` · original receipt recovered${view&&request.campaignId!==view.campaignId?' from another campaign':''}`:''}`;try{await refresh();setMessage(confirmation);}catch{setMessage(`${confirmation}. The latest table could not be loaded. Use Refresh to reconnect.`);}}

  catch(e){setMessage(e instanceof Error?e.message:'The result is uncertain. Recover the original action.');}finally{gate.current=false;setBusy(false);}}

 async function resolvePending(){
  if(gate.current||!pending)return;
  const request=pending;gate.current=true;setBusy(true);
  try{
   const suffix=`?actorId=${encodeURIComponent(request.actor)}&level=${request.level}&campaignId=${encodeURIComponent(request.campaignId)}`;
   const response=await apiFetch('/api/hollow-lantern/resolve'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({commandId:request.commandId,expectedRevision:request.expectedRevision})});
   const data=await response.json() as ApiError&{resolution?:unknown};
   if(!response.ok)throw Error(data.error||'The result remains uncertain. Keep this saved action and try recovery again.');
   const resolved=clearResolved(sessionStorage,request,data.resolution);
   setPending(null);setSelected('');setFields({});
   const otherCampaign=view&&request.campaignId!==view.campaignId?' This resolved the saved action from another campaign.':'';
   const confirmation=resolved.resolution==='cancelled'?`Saved action cancelled. It cannot run later. You can choose a new action.${otherCampaign}`:`${resolved.receipt.result?.status==='pending-roll'?'Action waiting for a die choice; outcome not yet applied':'Action confirmed'} · revision ${resolved.receipt.revision} · original receipt recovered.${otherCampaign}`;
   try{await refresh();setMessage(confirmation);}catch{setMessage(`${confirmation} The latest table could not be loaded. Use Refresh to reconnect.`);}
  }catch(error){setMessage(error instanceof Error?error.message:'The result remains uncertain. Keep this saved action and try recovery again.');}
  finally{gate.current=false;setBusy(false);}
 }

 return <main className="hl-activity"><header><div><p className="hl-eyebrow">Davy Jones · Private campaign table</p><h1>Operation Hollow Lantern</h1></div><button disabled={busy} onClick={()=>void refresh().catch(e=>setMessage(e.message))}>Refresh</button></header><p className="hl-notice" role="status">{view&&tab==='camp'&&message===choiceGuidance(view)?(visibleActions.length?'Choose a downtime idea, edit your intention, then send the request for a ruling.':'Downtime requests are unavailable in this view. Check the current choice or return to Map.'):message}</p>

 {pending&&<section className="hl-recovery"><h2>Check your last action</h2><p>Confirm its original receipt before another action. Recovery does not repeat the action.{view&&pending.campaignId!==view.campaignId?' This action belongs to another campaign. Recovery checks its original receipt while this table stays open.':''}</p><button disabled={busy} onClick={()=>void submit(true)}>Recover original action</button><p>If no original result exists, permanently cancel this saved action so you can choose again. This never repeats the action.</p><button disabled={busy} onClick={()=>void resolvePending()}>Resolve missing action</button></section>}

 <nav>{actors.length>0&&<label>View as<select aria-label="View as" disabled={busy} value={actor} onChange={e=>{generation.current++;setView(null);setTab('map');setSelected('');setFields({});setDraftSelection(null);setActor(e.target.value);}}><option value="">DM overview</option>{actors.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}<label>Open<select aria-label="Open" disabled={busy} value={tab} onChange={e=>openTab(e.target.value)}>{['map','character','inventory','camp','journal','help',...(view?.dmStatus?['rulings']:[])].map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label></nav>

 {view&&<>{tab==='map'&&<nav className="hl-shortcuts" aria-label="Explore this location">{[{id:'scene',name:'Scene'},{id:'tactical',name:'Tactical'},{id:'dungeon',name:'Dungeon'},{id:'details',name:'Details'}].map(item=><button key={item.id} type="button" style={{minHeight:44,minWidth:72}} disabled={busy||(item.id==='scene'&&!view.illustrations?.scene)} aria-pressed={presentation===item.id&&(!['tactical','dungeon'].includes(item.id)||level===item.id)} onClick={()=>openPresentation(item.id)}>{item.name}</button>)}</nav>}<section className="hl-scene"><p className="hl-eyebrow">{view.actor?.name??'DM overview'} · Revision {view.revision}</p><div className="hl-scene-heading">{view.illustrations?.portrait&&<img key={artworkIdentity(view,level,'portrait')} className="hl-portrait" src={illustration("portrait")} alt={view.actor?.name??"Selected character"} onLoad={artworkLoaded} onError={artworkFailed}/>}<h2>{view.title}</h2></div>{view.illustrations?.scene&&tab==='map'&&presentation==='scene'&&<figure className="hl-illustration"><img key={artworkIdentity(view,level,'scene')} src={illustration("scene")} alt={`Scene illustration - ${view.title}`} onLoad={artworkLoaded} onError={artworkFailed}/><figcaption>Take in the scene. Open Tactical for exact positions or Details to investigate.</figcaption></figure>}<p className="hl-lines">{view.summary}</p>{view.actor&&<strong>{view.actor.hp} / {view.actor.maxHp} HP</strong>}</section><div className="hl-content" data-presentation={tab==='map'?presentation:undefined} data-table-sheet={tab==='map'&&view.actor&&['tactical','dungeon'].includes(presentation)?'true':undefined}>{tab==='map'&&view.actor&&['tactical','dungeon'].includes(presentation)&&<TableSheet actor={view.actor} open={openTab} disabled={busy}/>}<section>{tab==='map'&&presentation==='details'&&<section aria-labelledby="hl-location-details"><h2 id="hl-location-details">Clues and details</h2><p>Review what your character knows, then choose an object or write an intention. Opening this view does not perform an action.</p>{journalEntries(view).length?journalEntries(view).map((entry:string,index:number)=><article key={index}><p className="hl-lines">{entry}</p></article>):<p>No discoveries have been recorded yet. Use the available inspection actions to investigate.</p>}</section>}

 {view.dmStatus&&tab!=='rulings'&&<section className="hl-dm-status"><strong>Player decisions: {view.dmStatus.decisionOpen?'OPEN':'PAUSED'}</strong><p>Pending rulings: {view.dmStatus.pendingRulings.length}</p><button disabled={busy} onClick={()=>openTab('rulings')}>Review pending rulings</button></section>}

 {tab==='map'&&['tactical','dungeon'].includes(presentation)&&<><label>Map scale<select aria-label="Map scale" disabled={busy} value={level} onChange={e=>{setPresentationState(choosePresentation(view,e.target.value==='tactical'?'tactical':'dungeon'));generation.current++;setView(null);setLevel(e.target.value);}}>{['tactical','dungeon','regional'].map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>{view.mapDetailAvailable&&level==='tactical'&&<label>Map view<select aria-label="Map view" value={detail} onChange={e=>setMapDetail(e.target.value)}><option value="full">Full map</option><option value="nearby">Nearby · larger tokens</option></select></label>}{view.map&&<div className="hl-map" aria-busy={!mapReady&&!mapFailed}>{!mapReady&&<p role="status">{mapFailed?'The map could not be loaded. Use Refresh to try again.':`Loading ${detail==='nearby'?'nearby':level} map...`}</p>}<button disabled={!mapReady} ref={mapTrigger} type="button" className="hl-map-open" onClick={()=>setExpandedMap(true)} aria-haspopup="dialog"><img key={mapIdentity} onLoad={()=>{setLoadedMap(mapIdentity);setFailedMap('');}} onError={()=>{setLoadedMap('');setFailedMap(mapIdentity);}} alt="Your authorized tactical or overview map" src={apiPath('/api/hollow-lantern/map'+query+'&viewToken='+view.viewToken+'&detail='+detail)}/><span>Expand map - scroll to read exact coordinates</span></button></div>}</>}

 {tab==='character'&&<><h2>Character record</h2><p className="hl-lines">{view.actor?.details??'Choose a character to see their record.'}</p>{view.actor?.sheet?.features?.map(f=><article key={f.id}><h3>{f.name??label(f.id)}</h3><p>{f.description??'Ask the DM about this feature.'}</p></article>)}{view.actor?.skills&&<><h3>Skills</h3><p className="hl-lines">{describe(view.actor.skills)}</p></>}{Object.entries(view.actor?.sheet??{}).filter(([k])=>/spell|training|proficien|language/i.test(k)).map(([k,v])=><section key={k}><h3>{label(k)}</h3><p className="hl-lines">{describe(v)}</p></section>)}</>}

 {tab==='inventory'&&<><h2>Inventory</h2><p>Your equipment and purchase details stay private.</p>{wornEquipment&&<section aria-label="Worn mission equipment"><h3>{wornEquipment.owned?'Worn equipment':'Worn mission equipment'}</h3><p><strong>{wornEquipment.name}</strong></p>{wornEquipment.calculation&&<p>{wornEquipment.calculation}</p>}{wornEquipment.grant&&<p>{wornEquipment.grant}</p>}<p>{wornEquipment.guidance}</p></section>}<h3>{wornEquipment?.owned?'Owned items':'Carried items'}</h3>{view.actor?.inventory?.length?view.actor.inventory.map(i=><article key={i.id}><h3>{i.name} <small>× {i.quantity}</small></h3><p>{i.description}</p><small>{[i.value,i.equipped?'Equipped':'Carried'].filter(Boolean).join(' · ')}</small></article>):<p>No carried items are available in this view.</p>}</>}



 {tab==='rulings'&&view.dmStatus&&<><h2>Pending rulings</h2><button disabled={busy} onClick={()=>openTab('map')}>Back to map</button>{view.dmStatus.pendingRulings.length?view.dmStatus.pendingRulings.map(r=><article key={r.id}>{r.text}</article>):<p>No pending rulings. New requests appear here for your review.</p>}</>}

 {tab==='camp'&&<section aria-labelledby="hl-camp-title"><h2 id="hl-camp-title">Camp and downtime</h2><p>When the group has time to regroup, propose what you would like your character to do. Your DM confirms whether the place, time and rules allow it.</p><p>A request does not heal anyone, advance time, spend supplies or decide another character’s actions.</p>{view.actor?<><h3>What would you like to do?</h3><div className="hl-shortcuts" aria-label="Downtime ideas">{[{label:'Check on someone',text:'I would like to check on someone nearby. I will ask how they are doing and whether they want help.'},{label:'Talk with a teammate',text:'I would like to ask a teammate if they want to talk while we regroup.'},{label:'Ask for a rest',text:'I would like to rest here. Can the DM confirm whether this place is safe and which rest, time and supplies the rules require?'},{label:'My own plan',text:''}].map(idea=><button key={idea.label} type="button" disabled={locked||!visibleActions.some(a=>a.id==='describe')} onClick={()=>{chooseAction('describe',idea.text);}}>{idea.label}</button>)}</div>{!visibleActions.some(a=>a.id==='describe')&&<p>Downtime requests are not available in the current state. Return to Map to finish any pending choice, or wait for the DM to open decisions.</p>}<p>Choose an idea, edit the words in Your intention, then send the request when you are ready.</p></>:<p>Choose a character you control to propose their downtime. The DM can review requests under Pending rulings.</p>}<button type="button" disabled={busy} onClick={()=>openTab('journal')}>Review the journal</button><button type="button" disabled={busy} onClick={()=>openTab('map')}>Return to map</button></section>}

 {tab==='journal'&&<><h2>Journal</h2><p className="hl-lines">{journalEntries(view).join('\n\n')||'No discoveries recorded.'}</p></>}

 {tab==='help'&&<><h2>Your next choice</h2><p>{choiceGuidance(view)}</p><p>Use Open → Map, then Expand map to read exact coordinates. Other characters may see different things; share discoveries through the game. Describe uncertain actions for the human DM when decisions are open.</p><h3>If an action loses its response</h3><p>{recoveryGuidance}</p></>}

 </section>{!['journal','help'].includes(tab)&&(tab!=='rulings'||visibleActions.length>0)&&<aside><p className="hl-eyebrow">Actions and rolls</p>{tab==='map'&&<details className="hl-table-events"><summary>Recent results and notes</summary>{journalEntries(view).slice(-5).map((entry:string,index:number)=><p key={index} className="hl-lines">{entry}</p>)}</details>}{connectionFailed.current&&<p>Reconnect with Refresh before choosing another action.</p>}{view.dmStatus&&visibleActions.some(a=>a.id.startsWith('ruling:'))&&<section className="hl-ruling-options" aria-label="Available ruling responses"><h3>Choose your ruling</h3><p>Select a response in the menu below. Nothing changes until you confirm.</p><ul>{visibleActions.filter(a=>a.id.startsWith('ruling:')).map(a=><li key={a.id}><strong>{a.label}</strong><p>{a.description}</p></li>)}</ul></section>}{quickMoves.length>0&&<section aria-label="Nearby movement"><h3>Nearby moves</h3><p>Choose a destination, review its cost, then confirm.</p><div className="hl-shortcuts">{quickMoves.map(a=><button key={a.id} type="button" style={{minHeight:44}} disabled={locked} aria-pressed={selected===a.id} onClick={()=>chooseAction(a.id)}>{a.label}</button>)}</div></section>}<div className="hl-shortcuts" aria-label="Contextual actions">{shortcuts.primary.filter((a:Action)=>!quickMoves.some(m=>m.id===a.id)).map((a:Action)=><button key={a.id} type="button" disabled={locked} aria-pressed={selected===a.id} onClick={()=>{chooseAction(a.id);}}>{a.label}</button>)}</div><label>More actions<select aria-label="Choose an action" disabled={locked} value={selected} onChange={e=>{chooseAction(e.target.value);}}><option value="">{tab==='rulings'?'Choose a ruling response…':'Choose…'}</option>{[...new Set<string>(shortcuts.menu.map((a:Action)=>a.group))].map(g=><optgroup key={g} label={label(g)}>{shortcuts.menu.filter((a:Action)=>a.group===g).map((a:Action)=><option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>)}</select></label>{action&&view.draftEnabled&&isDraftEditorAction(action)?<p>Write and review this intention in the saved intention editor below. Saving does not attempt the action.</p>:action?<form onSubmit={e=>{e.preventDefault();void submit();}}><h3>{tab==='camp'?'Your downtime request':action.label}</h3><p className="hl-lines">{action.description}</p>{action.fields.map(f=>f.kind==='healing-allocation'&&f.pool&&f.choices?<HealingAllocation key={f.id} field={{id:f.id,label:f.label,pool:f.pool,choices:f.choices}} value={fields[f.id]??''} onChange={value=>setFields({...fields,[f.id]:value})} disabled={locked}/>:<label key={f.id}>{f.label}{/text|description|reason|message/i.test(f.id)?<textarea required rows={4} maxLength={f.maxLength} value={fields[f.id]??''} onChange={e=>setFields({...fields,[f.id]:e.target.value})}/>:<input required maxLength={f.maxLength} value={fields[f.id]??''} onChange={e=>setFields({...fields,[f.id]:e.target.value})}/>}</label>)}<button className="hl-primary" disabled={locked||action.fields.some(f=>f.kind==='healing-allocation'&&!validHealingAllocation(fields[f.id],f))}>{tab==='camp'?'Send downtime request':`Confirm ${action.label}`}</button></form>:<p>Actions follow your current character and scene. Select one to read its cost.</p>}</aside>}</div></>}

 <DraftEditor key={`${campaignQuery}:${actor}:${editorSeat.current}`} view={view} level={level} selection={draftSelection&&view&&draftSelection.view.campaignId===view.campaignId&&draftSelection.view.selectedActor===view.selectedActor?draftSelection:null} disabled={locked} onCommitted={refresh}/>
 {expandedMap&&view&&Boolean(view.map)&&<dialog ref={mapDialog} className="hl-map-dialog" aria-modal="true" aria-labelledby="hl-expanded-map-title" onCancel={e=>{e.preventDefault();closeMap();}} onClose={()=>{setExpandedMap(false);mapTrigger.current?.focus();}}><header><h2 id="hl-expanded-map-title">{view.title} - {detail==='nearby'?'Nearby':label(level)} map</h2><button autoFocus type="button" onClick={closeMap}>Close map</button></header><p>Scroll horizontally and vertically to inspect the full-resolution map.</p><div className="hl-map-scroll" tabIndex={0} aria-label="Full-resolution map; scroll in both directions"><img alt="Full-resolution authorized map" src={apiPath('/api/hollow-lantern/map'+query+'&viewToken='+view.viewToken+'&detail='+detail)}/></div></dialog>}
 <footer>Private character knowledge · The human DM controls decisions and disclosures</footer></main>;

}



