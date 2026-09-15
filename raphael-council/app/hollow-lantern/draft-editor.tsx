'use client';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from '../../client/api.mjs';
import {guardedDraftRead,emptyDraftEditor,selectDraftAction,receiveDraft,editDraftText,useSavedDraft,reviewDraft,acceptSavedDraft,draftDirty,draftRequestQuery,isDraftEditorAction} from './draft-editor-state.mjs';
import './draft-editor.css';

export type DraftAction={id:string;label:string;type?:string;fields:{id:string;kind?:string;multiline?:boolean;maxLength:number}[]};
type DraftView={campaignId:string;selectedActor:string;viewToken:string;revision:number;draftEnabled?:boolean;actions:DraftAction[]};
export type DraftSelection={action:DraftAction;view:DraftView;level:string;text?:string;nonce:number};
type Context={campaignId:string;selectedActor:string;viewToken:string;revision:number;level:string};
type Draft={draftId:string;version:number;status:string;actionId:string;input:{text:string};expectedRevision:number;receipt?:{result?:string}};
type Editor={saved:Draft|null;buffer:{actionId:string;label:string;text:string;maxLength:number;context:Context|null}|null;pending:DraftSelection|null;conflict:boolean;loaded:boolean};

/** Kept mounted outside changing views. Private unsaved text exists only in this component's memory. */
export function DraftEditor({view,level,selection,disabled,onCommitted}:{view:DraftView|null;level:string;selection:DraftSelection|null;disabled:boolean;onCommitted:()=>Promise<void>}){
 const [state,setState]=useState<Editor>(emptyDraftEditor),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const active=useRef(true),flight=useRef(false),current=useRef(view),sequence=useRef(0),textarea=useRef<HTMLTextAreaElement>(null);current.current=view;
 const enabled=Boolean(view?.draftEnabled),seat=view?`${view.campaignId}:${view.selectedActor}`:'';
 useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current++;};},[]);
 const lastSelection=useRef<number|null>(null);
 useEffect(()=>{if(selection&&selection.nonce!==lastSelection.current){lastSelection.current=selection.nonce;setState(s=>selectDraftAction(s,selection));setNotice('');textarea.current?.focus();}},[selection]);
 async function load(v:DraftView,requestedLevel:string){
  const seq=++sequence.current;
  const data=await guardedDraftRead(async()=>{
   const r=await apiFetch('/api/hollow-lantern/draft'+draftRequestQuery({...v,level:requestedLevel}),{signal:AbortSignal.timeout(15000)}),result=await r.json() as {error?:string;draft?:Draft};
   if(!r.ok)throw Error(result.error||'The saved intention could not be loaded. Keep your text and retry.');
   return result;
  },()=>active.current&&seq===sequence.current&&Boolean(current.current?.draftEnabled)&&current.current?.campaignId===v.campaignId&&current.current?.selectedActor===v.selectedActor);
  if(data)setState(s=>receiveDraft(s,data.draft??null,current.current));
 }
 useEffect(()=>{if(enabled&&view&&!flight.current)void load(view,level).catch(e=>{if(active.current)setNotice(e.message);});},[enabled,seat,view?.viewToken]);
 async function run(kind:'save'|'try'){
  if(flight.current||disabled||!view?.draftEnabled)return;
  const selectedState=state,buffer=state.buffer,saved=state.saved,requestView=view;
  if(kind==='save'&&(!buffer?.context||state.conflict||!state.loaded)||kind==='try'&&(!saved||draftDirty(state)||state.conflict))return;
  const c=kind==='save'?buffer!.context!:{...view,level};
  flight.current=true;sequence.current++;setBusy(true);setNotice('');
  try{
   const body=kind==='save'?{viewToken:c.viewToken,actionId:buffer!.actionId,input:{text:buffer!.text},expectedDraftVersion:saved?.version??null}:{draftId:saved!.draftId,version:saved!.version};
   const response=await apiFetch(`/api/hollow-lantern/draft/${kind}`+draftRequestQuery(c),{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify(body)}),data=await response.json() as {error?:string;draft?:Draft};
   if(!active.current)return;
   if(!response.ok){
    if(response.status===409)setState(s=>({...s,conflict:kind==='save'||s.conflict}));
    throw Error(data.error||'The request could not be confirmed. Keep this intention and check its saved state.');
   }
   if(!data.draft)throw Error('The saved state was not returned. Reload the saved intention.');
   setState(s=>kind==='save'?acceptSavedDraft(s,data.draft):receiveDraft({...s,buffer:null,conflict:false},data.draft,requestView));
   setNotice(kind==='save'?'Draft saved. No action attempted.':data.draft.receipt?.result||'Action confirmed.');
   if(kind==='try'){try{await onCommitted();}catch{setNotice('Action confirmed. Refresh to load the latest scene.');}}
  }catch(error){
   if(active.current){setNotice(error instanceof Error?error.message:'Keep your intention and retry.');try{await load(requestView,level);}catch{/* Keep the original recovery state visible. */}}
  }finally{if(active.current)setBusy(false);flight.current=false;}
 }
 if(!enabled)return null;
 const buffer=state.buffer,saved=state.saved,dirty=draftDirty(state),prepared=saved?.status==='prepared',completed=saved?.status==='completed',locked=busy||disabled;
 const currentAction=view?.actions.find(a=>a.id===buffer?.actionId),canReview=isDraftEditorAction(currentAction)&&!prepared;
 return <section className="hl-draft-editor" aria-label="Saved intention"><p className="hl-eyebrow">Private written intention</p><h2>{buffer?.label??'Save your next intention'}</h2><p>Write at your own pace. Reading maps and known details does not submit an action. Save first, then choose Try action.</p>
 {!state.loaded&&<p role="status">Loading your saved intention…</p>}
 {notice&&<p role="status">{notice}</p>}
 {!buffer&&<p>Choose a written action from the action menu to begin.</p>}
 {buffer&&<><label htmlFor="hl-draft-text">Your written intention</label><textarea ref={textarea} id="hl-draft-text" rows={5} value={buffer.text} maxLength={buffer.maxLength} readOnly={prepared} disabled={locked} onChange={e=>setState(s=>editDraftText(s,e.target.value))}/><p>{prepared?'This intention is waiting for its original result. Recover it before writing another.':completed?'This saved intention has been completed.':dirty?'Unsaved changes stay on this page until you save. Closing or reloading loses unsaved text.':'Your saved words are ready for review.'}</p>
 {state.conflict&&<p role="alert">The saved intention changed elsewhere. Your words are still here. Use the saved version, or review the current scene before explicitly replacing it.</p>}
 {buffer.context&&<p>Written against revision {buffer.context.revision} · {buffer.context.level} view.</p>}
 <div className="hl-draft-controls"><button type="button" disabled={locked||prepared||state.conflict||!state.loaded||!buffer.context||!buffer.text.trim()||buffer.text.length>buffer.maxLength} onClick={()=>void run('save')}>Save draft</button><button type="button" disabled={locked||!saved||completed||dirty||state.conflict} onClick={()=>void run('try')}>{prepared?'Recover original intention':'Try action'}</button><button type="button" disabled={locked||!canReview} onClick={()=>{setState(s=>reviewDraft(s,view,level));setNotice('Current scene selected. Review your words, then Save draft to use this context.');}}>Review current scene</button>{saved&&(dirty||state.conflict||state.pending)&&<button type="button" disabled={locked} onClick={()=>{setState(s=>useSavedDraft(s,view));setNotice('Saved version loaded.');}}>Use saved draft</button>}</div>
 {saved?.receipt?.result&&<p className="hl-draft-result">{saved.receipt.result}</p>}</>}
 {state.pending&&<div className="hl-draft-replace" role="group" aria-label="Replace written intention"><p>You selected {state.pending.action.label}. Replace the current editor text and action? Your saved draft remains unchanged until Save draft.</p><button type="button" disabled={locked||prepared} onClick={()=>{setState(s=>selectDraftAction({...s,buffer:null,pending:null},s.pending));setNotice('New intention selected. Save it when ready.');}}>Replace intention</button><button type="button" disabled={locked} onClick={()=>setState(s=>({...s,pending:null}))}>Keep current intention</button></div>}
 <details><summary>Saved intention options</summary><p>Check for a newer saved version without discarding your unsaved words.</p><button type="button" disabled={locked} onClick={()=>{if(view)void load(view,level).catch(e=>setNotice(e.message));}}>Reload saved intention</button></details></section>;
}
