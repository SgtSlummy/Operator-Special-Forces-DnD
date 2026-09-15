import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

const source='http://127.0.0.1:18796';
const staticFile=/^\/_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|png|svg|webp)$/;
const apiMethods=new Map([
 ['/api/auth/config','GET'],['/api/auth/activity','POST'],
 ['/api/auth/session','GET'],['/api/auth/discord/start','GET'],['/api/auth/discord/callback','GET'],['/api/auth/logout','POST'],
 ['/api/hollow-lantern/view','GET'],['/api/hollow-lantern/map','GET'],['/api/hollow-lantern/illustration','GET'],
 ['/api/hollow-lantern/action','POST'],['/api/hollow-lantern/receipt','POST'],['/api/hollow-lantern/resolve','POST'],
 ['/api/hollow-lantern/draft','GET'],['/api/hollow-lantern/draft/save','POST'],['/api/hollow-lantern/draft/try','POST']
]);

export function activityRoute(method,raw){
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//'))return null;
 const pathname=raw.split('?')[0];
 if(pathname.includes('%')||pathname.includes('\\')||pathname.split('/').some(p=>p==='.'||p==='..'))return null;
 const url=new URL(raw,source);
 if(['GET','HEAD'].includes(method)&&['/','/activity','/hollow-lantern'].includes(pathname))return pathname+url.search;
 if(['GET','HEAD'].includes(method)&&staticFile.test(pathname))return pathname+url.search;
 if(apiMethods.get(pathname)===method)return pathname+url.search;
 return null;
}

export function allowedAuthRedirect({route,status,location,publicOrigin,clientId}){
 if(!publicOrigin||![302,303].includes(status)||typeof location!=='string'||/[\r\n]/.test(location))return false;
 const path=route.split('?')[0];if(!['/api/auth/discord/start','/api/auth/discord/callback'].includes(path))return false;
 let target,request;try{target=new URL(location,publicOrigin);request=new URL(route,publicOrigin);}catch{return false;}
 let campaign=request.searchParams.get('campaignId');
 if(campaign!==null&&(request.searchParams.getAll('campaignId').length!==1||!/^[A-Za-z0-9_-]{1,64}$/.test(campaign)))return false;
 if(path==='/api/auth/discord/callback'){
  const state=request.searchParams.get('state');
  if(state?.startsWith('hl.')){
   const parts=/^hl\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(state);
   if(!parts||request.searchParams.getAll('state').length!==1)return false;
   const decoded=Buffer.from(parts[1],'base64url').toString('utf8');
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(decoded)||Buffer.from(decoded).toString('base64url')!==parts[1]||(campaign!==null&&campaign!==decoded))return false;
   campaign=decoded;
  }else if(campaign!==null)return false;
 }
 const expectedState=campaign===null?/^[a-f0-9]{64}$/:new RegExp('^hl\\.'+Buffer.from(campaign).toString('base64url')+'\\.[a-f0-9]{64}$');
 const campaignQueryMatches=()=>campaign===null?!target.search:target.searchParams.size===1&&target.searchParams.get('campaignId')===campaign;
 if(target.username||target.password||target.hash)return false;
 if(path==='/api/auth/discord/start'&&target.origin==='https://discord.com'&&target.pathname==='/oauth2/authorize'){
  const expected={client_id:clientId,response_type:'code',redirect_uri:publicOrigin+'/api/auth/discord/callback',scope:'identify'};
  return /^\d{17,20}$/.test(clientId??'')&&[...target.searchParams.keys()].every(k=>Object.hasOwn(expected,k)||k==='state')&&Object.entries(expected).every(([key,value])=>target.searchParams.getAll(key).length===1&&target.searchParams.get(key)===value)&&target.searchParams.getAll('state').length===1&&(expectedState.test(target.searchParams.get('state')??'')||/^[a-f0-9]{64}$/.test(target.searchParams.get('state')??''));
 }
 if(target.origin!==publicOrigin)return false;
 if(path==='/api/auth/discord/callback'&&target.pathname==='/hollow-lantern'&&campaignQueryMatches())return true;
 return target.pathname==='/'&&target.searchParams.size===(campaign===null?1:2)&&target.searchParams.getAll('connection').length===1&&(campaign===null?!target.searchParams.has('campaignId'):target.searchParams.getAll('campaignId').length===1&&target.searchParams.get('campaignId')===campaign)&&['host_configuration','account_access','relaunch','retry','recovery'].includes(target.searchParams.get('connection'));
}

// Publish only the entry/Activity shells, static assets and scoped OAuth/game
// boundary. Other Raphael routes and local management services stay unreachable.
export function createActivityEdge({port=18805,fetchImpl=fetch,publicOrigin=process.env.RAPHAEL_PUBLIC_ORIGIN,clientId=process.env.DISCORD_CLIENT_ID}={}){
 if(publicOrigin){const origin=new URL(publicOrigin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Configure one public HTTPS origin.');publicOrigin=origin.origin;}
 const server=createServer(async(req,res)=>{
  const route=activityRoute(req.method,req.url);
  const imageOperation=route?.split('?')[0];let imageFailure,forwardingFailure,responseFormat='other';
  if(process.env.HOLLOW_ACTIVITY_DIAGNOSTICS==='1'&&imageOperation?.startsWith('/api/')){
   const started=Date.now();res.once('finish',()=>console.log(JSON.stringify({event:'activity-response',operation:imageOperation,status:res.statusCode,durationMs:Date.now()-started,responseFormat,...(forwardingFailure?{forwardingFailure}:{})})));
  }
  if(process.env.HOLLOW_IMAGE_DIAGNOSTICS==='1'&&['/api/hollow-lantern/map','/api/hollow-lantern/illustration'].includes(imageOperation)){
   const started=Date.now();res.once('finish',()=>console.log(JSON.stringify({event:'image-response',operation:imageOperation.endsWith('/map')?'map':'illustration',status:res.statusCode,durationMs:Date.now()-started,failure:imageFailure})));
  }
  const reject=(status,text)=>{const api=req.url?.startsWith('/api/');responseFormat=api?'json':'other';res.writeHead(status,{'Content-Type':api?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(api?JSON.stringify({error:text}):text);};
  if(!route){reject(404,'This address serves only the Hollow Lantern Activity.');return;}
  try{
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>32768){reject(413,'Request too large.');return;}chunks.push(chunk);}
   const headers=new Headers();
   for(const key of ['accept','accept-language','content-type','origin','cookie','user-agent','rsc','next-router-state-tree','next-router-prefetch','next-url'])if(typeof req.headers[key]==='string')headers.set(key,req.headers[key]);
   const response=await fetchImpl(source+route,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)});
   const mediaType=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
   responseFormat=mediaType==='application/json'||mediaType.endsWith('+json')?'json':mediaType==='text/html'?'html':mediaType==='image/png'?'png':'other';
   const redirect=response.status>=300&&response.status<400;
   if(redirect&&!allowedAuthRedirect({route,status:response.status,location:response.headers.get('location'),publicOrigin,clientId})){forwardingFailure='redirect';await response.body?.cancel();reject(502,'The game connection returned an unexpected redirect.');return;}
   const bytes=[];let length=0;
   for await(const chunk of response.body??[]){length+=chunk.length;if(length>20*1024*1024)throw Error('Response limit');bytes.push(Buffer.from(chunk));}
   if([403,409].includes(response.status)&&length<2048&&['/api/hollow-lantern/map','/api/hollow-lantern/illustration'].includes(imageOperation)){
    try{const error=JSON.parse(Buffer.concat(bytes).toString()).error;imageFailure=({'This character is not available to you.':'scope-authorization','Your access changed.':'reauthorization','Refresh the current character view.':'view-binding','The scene changed. Refresh your view.':'scene-revision','The map changed. Refresh your view.':'map-revision','Your view changed. Refresh the table.':'post-render-view'})[error]??'other';}catch{imageFailure='unclassified';}
   }
   const outgoing={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'};
   for(const key of ['content-type','vary'])if(response.headers.has(key))outgoing[key]=response.headers.get(key);
   if(redirect)outgoing.Location=response.headers.get('location');
   const cookies=response.headers.getSetCookie();if(cookies.length)outgoing['Set-Cookie']=cookies;
   res.writeHead(response.status,outgoing);res.end(req.method==='HEAD'?undefined:Buffer.concat(bytes));
  }catch{forwardingFailure='upstream';if(!res.headersSent)reject(503,'The game connection is unavailable. Your action was not automatically retried.');else res.destroy();}
 });
 server.headersTimeout=10000;server.requestTimeout=30000;
 return {server,start:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});}),close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const edge=createActivityEdge();await edge.start();console.log('Activity-only edge ready on 127.0.0.1:18805.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await edge.close();process.exit(0);});
}
