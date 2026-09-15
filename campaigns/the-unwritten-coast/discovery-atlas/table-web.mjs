import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {authHttp} from '../../../raphael-council/auth/http.mjs';
import {createCoastActivity} from './table-activity.mjs';
import {discordSdkBundle} from './table-sdk.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const base={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const error=(status,message)=>Response.json({error:message},{status,headers:base});
// The gateway owns the store and OAuth database. This handler owns neither.
export function createCoastWeb({store,auth,client,config}){
 if(auth?.config?.campaign!=='the-unwritten-coast'||auth.config.guild!==config.guildId||auth.config.clientId!==config.applicationId)throw Error('Coast OAuth and gateway bindings must match.');
 const origins=[auth.config.publicOrigin,auth.config.activityOrigin].filter(Boolean);
 const runtimes=new Map(origins.map(origin=>[origin,createCoastActivity({store,auth,client,config,origin})]));
 const provider=()=>({auth,experience:'legacy'});
 const authRoutes=new Map([
  ['/api/auth/discord/start',['GET',authHttp('start',provider)]],
  ['/api/auth/discord/callback',['GET',authHttp('callback',provider)]],
  ['/api/auth/session',['GET',authHttp('session',provider)]],
  ['/api/auth/config',['GET',authHttp('config',provider)]],
  ['/api/auth/activity',['POST',authHttp('activity',provider)]],
  ['/api/auth/logout',['POST',authHttp('logout',provider)]]
 ]);
 const files=new Map([['/activity',['coast-activity.html','text/html']],['/coast-connect.mjs',['coast-connect.mjs','text/javascript']],['/raphael-council/client/activity-connection.mjs',['../../../raphael-council/client/activity-connection.mjs','text/javascript']],['/play',['table.html','text/html']],['/table-app.mjs',['table-app.mjs','text/javascript']],['/table.css',['table.css','text/css']],['/render.mjs',['render.mjs','text/javascript']],['/art/table/coast-serif.ttf',['art/table/coast-serif.ttf','font/ttf']]]);
 let closed=false;
 async function handle(request){
  try{
   const url=new URL(request.url),runtime=runtimes.get(url.origin);
   if(closed)return error(503,'The campaign is unavailable.');
   if(!runtime||request.headers.get('origin')&&!origins.includes(request.headers.get('origin')))return error(403,'Use the campaign address.');
   if(url.pathname==='/'&&request.method==='GET')return new Response(null,{status:302,headers:{...base,Location:url.origin===auth.config.activityOrigin?'/activity'+url.search:'/api/auth/discord/start'}});
   if(url.pathname==='/discord-sdk.mjs'&&request.method==='GET')return new Response(await discordSdkBundle(),{headers:{...base,'Content-Type':'text/javascript'}});
   if(authRoutes.has(url.pathname)){
    const [method,handler]=authRoutes.get(url.pathname);if(request.method!==method)return error(405,'Unsupported method.');
    return handler(request);
   }
   const operation=/^\/api\/(view|action|recall|card|architecture|discord)$/.exec(url.pathname)?.[1];
   if(operation)return runtime.handle(operation,request);
   const art=/^\/api\/art\/(room|table|preparation)\/([A-Za-z0-9_-]+)\.png$/.exec(url.pathname);
   if(art&&request.method==='GET'){
    const before=await runtime.handle('view',request);if(!before.ok)return before;const view=await before.json();
    let file;
    const preparation=art[1]==='preparation';
    if(preparation&&view.identity.role!=='gm')return error(403,'DM preparation is private.');
    if(art[1]==='room'||preparation){
     const room=(preparation?view.preparation.catalog:view.catalog).rooms.find(r=>r.id===art[2]);if(!room||!/^[A-Za-z0-9_-]+$/.test(room.publicArtKey))return error(404,'This location is not charted.');
     file=join(root,'art',room.publicArtKey+'.png');
    }else{
     const available=art[2]==='raphael'||view.party.some(p=>p.id===art[2])||view.encounter?.enemies?.some(enemy=>(enemy.art??'sentinel')===art[2]);
     if(!available||!['mara','ivo','sable','tern','raphael','sentinel','harbor-lookout'].includes(art[2]))return error(404,'This portrait is unavailable.');
     file=join(root,'art','table',art[2]+'.png');
    }
    const bytes=await readFile(file),after=await runtime.handle('view',request);if(!after.ok)return after;
    const finalView=await after.json();
    if(preparation&&finalView.identity.role!=='gm')return error(403,'DM preparation is private.');
    if(art[1]==='table'&&art[2]!=='raphael'&&!finalView.party.some(p=>p.id===art[2])&&!finalView.encounter?.enemies?.some(enemy=>(enemy.art??'sentinel')===art[2]))return error(404,'This portrait is unavailable.');
    if(finalView.state.revision!==view.state.revision)return error(409,'The scene changed. Refresh the table.');
    return new Response(bytes,{headers:{...base,'Content-Type':'image/png'}});
   }
   if(files.has(url.pathname)&&request.method==='GET'){
    const [file,type]=files.get(url.pathname),content=await readFile(join(root,file));
    const csp=`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'self' https://discord.com https://ptb.discord.com https://${config.applicationId}.discordsays.com`;
    return new Response(content,{headers:{...base,'Content-Type':type,'Content-Security-Policy':csp}});
   }
   return error(404,'That page is unavailable.');
  }catch{return error(503,'The campaign could not complete this request.');}
 }
 return {handle,close(){closed=true;for(const runtime of runtimes.values())runtime.close();}};
}
