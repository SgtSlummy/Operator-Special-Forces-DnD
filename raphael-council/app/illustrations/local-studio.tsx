'use client';
import {useEffect,useState} from 'react';

/** The local DM workbench is distinct from the authenticated player image API. */
export default function LocalStudio(){
 const [local,setLocal]=useState(false),[opened,setOpened]=useState(false);
 useEffect(()=>setLocal(['127.0.0.1','localhost','[::1]'].includes(location.hostname)),[]);
 if(!local)return null;
 return <section aria-label="Local campaign art studio" className="mb-10 border-b border-[#516064] pb-8">
  <h2 className="font-serif text-3xl text-[#eee6d5]">Campaign art studio</h2>
  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#bdc7c3]">Create characters, locations, items, and map illustrations with your local ComfyUI renderer. Keep every version, refine the node workflow, and preview artwork at your local DM table.</p>
  <div className="mt-4 flex flex-wrap gap-3">
   <a href="http://127.0.0.1:51960/" target="coast-art-studio" rel="noopener" className="rounded border border-[#c5a371] bg-[#c5a371] px-4 py-3 text-sm font-semibold text-[#132327]">Open art studio</a>
   {location.hostname==='127.0.0.1'&&<button type="button" onClick={()=>setOpened(value=>!value)} aria-expanded={opened} className="rounded border border-[#516064] px-4 py-3 text-sm text-[#eee6d5]">{opened?'Close embedded studio':'Use studio here'}</button>}
  </div>
  {opened&&<><iframe src="http://127.0.0.1:51960/" title="Local ComfyUI campaign art studio" className="mt-5 h-[850px] w-full rounded border border-[#516064]"/><p className="mt-2 text-xs text-[#bdc7c3]">If the studio is offline, start it with the project’s Start-ArtStudio.ps1 launcher.</p></>}
 </section>;
}
