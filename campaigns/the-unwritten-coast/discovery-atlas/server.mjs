import http from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';
import {initialState,project,applyAction,discordPayload} from './model.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
export async function startServers({catalog,root=HERE,stateFile=process.env.UNWRITTEN_ATLAS_STATE||resolve(homedir(),'Projects','Unwritten-Coast-Data','discovery-atlas','state.json'),gmPort=51940,publicPort=51941,deliveryFetch=globalThis.fetch,renameFile=rename}={}) {
 if(!catalog)catalog=(await import('./catalog.mjs')).CATALOG;
 if(/(^|[\\/])OneDrive([\\/]|$)/i.test(resolve(stateFile)))throw new Error('State must remain outside OneDrive.');
 let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));if(state.version!==1||!Array.isArray(state.history)||!state.roomIds)throw new Error('Invalid state file.');}catch(e){if(e.code!=='ENOENT')throw e;state=initialState(catalog);}
 const capability=randomBytes(32).toString('hex');let queue=Promise.resolve();let webhookUrl=null;const deliveries=new Map();
 const discordStatus=()=>({configured:Boolean(webhookUrl)});
 const allowedThreads=new Set(['1548380866386858175','1548204446838689882']);
 const deliver=async action=>{
  if(!webhookUrl)throw new Error('Connect Discord first.');
  const threadId=action.threadId||'1548380866386858175';if(!allowedThreads.has(threadId))throw new Error('Thread is not approved.');
  if(typeof action.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(action.idempotencyKey))throw new Error('A unique request key is required.');
  const fingerprint=JSON.stringify([action.roomId,threadId]);const previous=deliveries.get(action.idempotencyKey);if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Request key already used for another message.');return previous.promise;}
  if(deliveries.size>=500)throw new Error('Delivery request limit reached. Restart before further delivery.');
  const payload=discordPayload(catalog,state,action.roomId);const room=catalog.rooms.find(r=>r.id===action.roomId);const key=room.publicArtKey||room.id;if(!/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Invalid art key.');
  if(threadId==='1548380866386858175')payload.content='Atlas presentation preview · no new player actions';
  const configuredUrl=webhookUrl;
  const promise=(async()=>{let bytes;try{bytes=await readFile(resolve(root,'art',key+'.png'));}catch{throw new Error('Room scene image is unavailable.');}
   const form=new FormData();form.set('payload_json',JSON.stringify(payload));form.set('files[0]',new Blob([bytes],{type:'image/png'}),room.id+'-scene.png');
   let response;try{response=await deliveryFetch(configuredUrl+'?wait=true&thread_id='+threadId,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Delivery outcome is unknown. Check Discord before sending another request.');}
   if(!response.ok)throw new Error('Discord rejected delivery. No automatic retry was made.');let message;try{message=await response.json();}catch{throw new Error('Delivery outcome is unknown. Check Discord before sending another request.');}
   if(typeof message.id!=='string'||!/^\d+$/.test(message.id))throw new Error('Delivery outcome is unknown. Check Discord before sending another request.');
   return {messageId:message.id,threadId,link:'https://discord.com/channels/1463393482306486387/'+threadId+'/'+message.id};
  })();deliveries.set(action.idempotencyKey,{fingerprint,promise});return promise;
 };
 const assets=new Map([['/','index.html'],['/index.html','index.html'],['/app.mjs','app.mjs'],['/render.mjs','render.mjs'],['/style.css','style.css']]);
 const send=(res,status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
 const makeServer=isGM=>http.createServer(async(req,res)=>{
  const expected=`127.0.0.1:${req.socket.localPort}`,origin=`http://${expected}`;
  if(req.headers.host!==expected)return send(res,403,{error:'Invalid host.'});
  if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'Invalid origin.'});
  try {
   const url=new URL(req.url,origin);if(url.origin!==origin)return send(res,403,{error:'Invalid request target.'});
   if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...project(catalog,state,isGM?'gm':'player'),...(isGM?{capability,discord:discordStatus()}:{})});
   if(req.method==='GET'&&url.pathname==='/api/player-state'&&isGM)return send(res,200,project(catalog,state));
   if(req.method==='GET'&&/^\/art\/room\/[A-Za-z0-9_-]+\.png$/.test(url.pathname)){
    const id=url.pathname.slice('/art/room/'.length,-4);const r=(isGM?catalog:project(catalog,state).catalog).rooms.find(r=>r.id===id);
    if(!r)return send(res,404,{error:'Not found.'});const key=r.publicArtKey||r.id;if(!/^[A-Za-z0-9_-]+$/.test(key))return send(res,404,{error:'Not found.'});
    try{return send(res,200,await readFile(resolve(root,'art',key+'.png')),'image/png');}catch{return send(res,404,{error:'Not found.'});}
   }
   if(req.method==='GET'&&url.pathname==='/api/discord')return send(res,200,discordPayload(catalog,state,url.searchParams.get('room')));
   if(req.method==='POST'&&['/api/action','/api/discord/connect','/api/discord/send'].includes(url.pathname)&&isGM){
    if(req.headers.origin!==origin)return send(res,403,{error:'Origin required.'});
    const supplied=req.headers['x-atlas-capability'];if(typeof supplied!=='string'||supplied.length!==capability.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(capability)))return send(res,403,{error:'Capability required.'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return send(res,415,{error:'JSON required.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(res,413,{error:'Action too large.'});}let action;try{action=JSON.parse(raw);}catch{return send(res,400,{error:'Invalid JSON.'});}
    if(url.pathname==='/api/discord/connect'){
     if(typeof action?.webhookUrl!=='string'||!/^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(action.webhookUrl))return send(res,400,{error:'Use a channel webhook URL from discord.com.'});
     webhookUrl=action.webhookUrl;return send(res,200,{configured:true});
    }
    if(url.pathname==='/api/discord/send')return send(res,200,await deliver(action));
    const job=queue.then(async()=>{const next=applyAction(catalog,state,action);try{await mkdir(dirname(stateFile),{recursive:true});const temp=stateFile+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify(next,null,2),'utf8');const delays=[50,100,200,400,800];for(let attempt=0;;attempt++){try{await renameFile(temp,stateFile);break;}catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code)||attempt>=delays.length)throw error;await pause(delays[attempt]);}}}catch{throw new Error('The atlas could not save because its data file is unavailable. Your action was not applied. Please try again shortly.');}state=next;return {...project(catalog,state,'gm'),capability,discord:discordStatus()};});queue=job.catch(()=>{});return send(res,200,await job);
   }
   if(req.method==='GET'&&assets.has(url.pathname)){const name=assets.get(url.pathname);const data=await readFile(resolve(root,name),'utf8');return send(res,200,data,name.endsWith('.css')?'text/css':name.endsWith('.mjs')?'text/javascript':'text/html');}
   return send(res,404,{error:'Not found.'});
  }catch(e){return send(res,400,{error:isGM?e.message:'Request unavailable.'});}
 });
 const gm=makeServer(true),pub=makeServer(false);
 const listen=(server,port)=>new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
 await listen(gm,gmPort);try{await listen(pub,publicPort);}catch(e){await new Promise(r=>gm.close(r));throw e;}
 return {gm,public:pub,close:async()=>{await queue;await Promise.all([gm,pub].map(s=>new Promise(r=>{s.close(r);s.closeAllConnections();})));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const servers=await startServers({});console.log(`GM atlas: http://127.0.0.1:${servers.gm.address().port}`);console.log(`Player atlas: http://127.0.0.1:${servers.public.address().port}`);
}
