import {randomBytes,createHash} from 'node:crypto';
import {raphaelRecall,discordScene} from './table-model.mjs';
import {renderSceneCard,renderTactical,renderEncounter} from './table-cards.mjs';
import {architectureIllustration} from './architecture-art/delivery.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status,public:true});};
const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
async function input(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))fail(415,'JSON is required.');
 const reader=request.body?.getReader();if(!reader)fail(400,'An action is required.');
 let size=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();fail(413,'That action is too long.');}chunks.push(value);}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'Invalid action.');}
}
// Reuses the host's authenticated session provider and the gateway's open store.
// It never starts a server, opens a second save writer, or creates a session.
export function createCoastActivity({store,auth,client,config,origin,now=Date.now,render={scene:renderSceneCard,tactical:renderTactical,combat:renderEncounter,architecture:architectureIllustration}}){
 if(![config?.guildId,config?.applicationId,config?.gmUserId].every(snowflake)||typeof auth?.authenticate!=='function'||typeof store?.view!=='function'||typeof store?.execute!=='function')throw Error('Explicit authenticated Coast host required.');
 const site=new URL(origin);if(site.origin!==origin||!['https:','http:'].includes(site.protocol)||site.protocol==='http:'&&!['127.0.0.1','localhost'].includes(site.hostname))throw Error('A secure origin is required.');
 const binding=structuredClone(config),members=binding.members;
 if(!Array.isArray(members)||members.some(m=>!snowflake(m.ownerId)||typeof m.actorId!=='string')||new Set(members.map(m=>m.ownerId)).size!==members.length||new Set(members.map(m=>m.actorId)).size!==members.length)throw Error('Explicit unique ownership required.');
 const owners=new Map(members.map(m=>[m.ownerId,m.actorId])),views=new Map();let closed=false;
 async function identity(request){
  if(closed||client.user?.id!==binding.applicationId)fail(503,'The campaign is unavailable.');
  const credentials=[request.headers.get('cookie')??'',request.headers.get('authorization')??''];if(!credentials.some(Boolean))fail(401,'Sign in to the campaign.');
  const session=await auth.authenticate(request);
  if(!session||session.campaign!=='the-unwritten-coast'||!snowflake(session.owner)||!session.role)fail(401,'Sign in to this campaign.');
  const guild=await client.guilds.fetch(binding.guildId),member=await guild.members.fetch({user:session.owner,force:true,cache:false});
  if(closed)fail(503,'The campaign is unavailable.');
  if(member?.id!==session.owner||member.user?.bot)fail(403,'Your campaign access is unavailable.');
  const actorId=owners.get(session.owner),gm=session.owner===binding.gmUserId;
  if(session.actorId&&session.actorId!==actorId)fail(403,'This session belongs to another character.');
  if(gm&&session.role!=='host')fail(403,'A DM session is required.');
  const scope=gm?{role:'gm'}:actorId?{role:'player',actorId}:{role:'shared'};
  return {scope,owner:session.owner,key:createHash('sha256').update(JSON.stringify([credentials,session.owner,scope])).digest('hex')};
 }
 async function recheck(request,before){const after=await identity(request);if(after.key!==before.key)fail(403,'Your access changed. Reopen the table.');}
 function bound(token,who){const entry=views.get(token);if(!entry||entry.expires<=now()||entry.key!==who.key)fail(409,'Refresh your campaign view.');return entry;}
 async function handle(operation,request){
  try{
   const url=new URL(request.url);
   if(url.origin!==origin||request.headers.get('origin')&&request.headers.get('origin')!==origin)fail(403,'Open the campaign from its own address.');
   if(request.method==='POST'&&request.headers.get('origin')!==origin)fail(403,'Open the campaign before acting.');
   const who=await identity(request);
   if(operation==='view'&&request.method==='GET'){
    const view=store.view(who.scope);await recheck(request,who);
    if(store.view().state.revision!==view.state.revision)fail(409,'The table changed. Refresh your view.');
    for(const [key,value]of views)if(value.expires<=now())views.delete(key);
    if(views.size>=256)views.delete(views.keys().next().value);
    const viewToken=randomBytes(24).toString('hex');views.set(viewToken,{key:who.key,revision:view.state.revision,expires:now()+900000});
    return json({...view,preview:false,viewToken});
   }
   if(operation==='action'&&request.method==='POST'){
    const data=await input(request);
    if(!data||Array.isArray(data)||Object.keys(data).some(k=>!['viewToken','commandId','action'].includes(k))||!/^[a-f0-9-]{36}$/.test(data.commandId??'')||!data.action||typeof data.action!=='object'||Array.isArray(data.action))fail(400,'Invalid action.');
    const entry=bound(data.viewToken,who);if(entry.revision!==data.action.revision)fail(409,'Use the original view revision.');
    if(who.scope.role==='shared')fail(403,'Choose an enrolled character before acting.');
    await recheck(request,who);
    const result=await store.execute(who.scope,data.action,{commandId:`coast-web:${who.owner}:${data.commandId}`});
    await recheck(request,who);return json(result);
   }
   if(request.method==='GET'&&['recall','card','architecture','discord'].includes(operation)){
    const entry=bound(url.searchParams.get('viewToken'),who),view=store.view(who.scope);
    if(view.state.revision!==entry.revision)fail(409,'The scene changed. Refresh your view.');
    let value,type='application/json';
    if(operation==='recall')value=JSON.stringify(raphaelRecall(view,url.searchParams.get('q')??'recent'));
    else{
     // Public scene imagery stays discovery-scoped even when the DM opens it.
     const visible=store.view(),roomId=url.searchParams.get('room')??visible.state.currentRoomId;
     if(!visible.catalog.rooms.some(r=>r.id===roomId))fail(404,'This location is not charted.');
     if(operation==='discord')value=JSON.stringify(discordScene(visible,roomId,{assetUrl:'attachment://scene.png'}));
     else if(operation==='architecture'){value=await render.architecture(visible,{roomId,layer:url.searchParams.get('layer')??`${roomId.toLowerCase()}-cutaway`});type='image/svg+xml';}
     else{const kind=url.searchParams.get('kind')??'scene';if(!['scene','tactical','combat'].includes(kind)||kind==='combat'&&visible.encounter?.roomId!==roomId)fail(404,'This illustration is unavailable.');value=await render[kind](visible,roomId);type='image/png';}
    }
    await recheck(request,who);if(store.view().state.revision!==entry.revision)fail(409,'The map changed. Refresh your view.');
    return new Response(value,{headers:{...headers,'Content-Type':type}});
   }
   return json({error:'Unavailable route.'},404);
  }catch(error){return json({error:error.public?error.message:'The request could not be completed. Refresh to check the current state.'},error.public?error.status:[401,403].includes(error.status)?error.status:503);}
 }
 return {handle,close(){closed=true;views.clear();}};
}
