import {connectActivity,connectionProblem} from '../../../raphael-council/client/activity-connection.mjs';

export async function enterCoast({fetchImpl=fetch,createSDK,signal,onProgress,navigate}){
 const result=await connectActivity({fetchImpl,createSDK,signal,onProgress});
 if(result.scope.campaign!=='the-unwritten-coast')throw Error('Campaign mismatch');
 signal.throwIfAborted();
 navigate();
 return {owner:result.scope.owner,role:result.scope.role};
}

if(typeof document!=='undefined'){
 const button=document.querySelector('#connect'),status=document.querySelector('#status'),web=document.querySelector('#web-signin');
 const embedded=/^\d{17,20}\.discordsays\.com$/.test(location.hostname);
 let active;
 if(!embedded){button.hidden=true;web.hidden=false;status.textContent='Your journey continues at the campaign table.';}
 button.addEventListener('click',async()=>{
  if(active)return;
  active=new AbortController();button.disabled=true;
  try{
   await enterCoast({signal:active.signal,onProgress:message=>{status.textContent=message;},createSDK:async id=>{const {DiscordSDK}=await import('./discord-sdk.mjs');return new DiscordSDK(id);},navigate:()=>location.replace('/play'+location.search)});
  }catch(error){
   if(!active.signal.aborted){status.textContent=connectionProblem(error).message;button.textContent='Try connecting again';button.disabled=false;}
  }finally{active=null;}
 });
 addEventListener('pagehide',()=>active?.abort(),{once:true});
}
