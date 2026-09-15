import {createServer} from 'node:http';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderTacticalMap,renderIllustratedOverview} from '../discord/hollow-lantern/renderers.mjs';

import {EngineError} from './engine-client.mjs';
import {presentReceipt} from './service.mjs';
import {createDraftStoreRpcHandler} from './draft-store-rpc.mjs';

const written=action=>['interact','talk','describe'].includes(action?.type)&&typeof action.id==='string'&&Array.isArray(action.fields)&&action.fields.length===1&&action.fields[0].id==='text'&&action.fields[0].kind===undefined&&action.fields[0].multiline===true&&Number.isSafeInteger(action.fields[0].maxLength)&&action.fields[0].maxLength>0&&action.fields[0].maxLength<=1500;
const validText=(action,input)=>written(action)&&input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===1&&typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=action.fields[0].maxLength;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const draftView=draft=>draft?Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='scope')):null;
const rejectDraft=(message,status=409)=>{throw new EngineError('DRAFT_UNAVAILABLE',message,status);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
const cookie=request=>(request.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hollow_session='))?.slice(15);
async function body(request){let size=0,chunks=[];for await(const chunk of request){size+=chunk.length;if(size>8192)throw new Error('Request is too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}

/** Local DM/player table. No identity is accepted from a browser request. */
export function createWebTable({getHost,port=18792,now=Date.now,renderAssets,draftStore,draftRpc,getAdmission}={}){
  if(typeof getHost!=='function'||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local table configuration.');
  if(draftStore&&!['get','save','prepare','complete'].every(key=>typeof draftStore[key]==='function'))throw new Error('Invalid draft storage.');
  if(draftRpc&&(!draftStore||typeof draftRpc!=='object'||Array.isArray(draftRpc)||Object.keys(draftRpc).some(key=>!['secret','campaignId','gmUserId'].includes(key))))throw new Error('Invalid shared draft configuration.');
  const rpcHandler=draftRpc?createDraftStoreRpcHandler({...draftRpc,draftStore,getAdmission,now,authorize:async scope=>{
    const host=getHost();return Boolean(host&&host.gmUserId===draftRpc.gmUserId&&scope.userId!==host.gmUserId&&await host.authorize(scope));
  }}):null;
  const origin=`http://127.0.0.1:${port}`,codes=new Map(),sessions=new Map(),draftFlights=new Map();let server;
  const purge=()=>{for(const map of [codes,sessions])for(const [key,value]of map)if(value.expires<=now())map.delete(key);};
  async function webLink(scope){
    const host=getHost();if(!host||!await host.authorize(scope))throw new Error('Current game access is required.');
    purge();if(codes.size>=64)throw new Error('Too many unused table links.');
    const code=randomBytes(32).toString('hex');codes.set(hash(code),{scope:structuredClone(scope),expires:now()+60000});
    return `${origin}/#code=${code}`;
  }
  async function authenticate(request){
    purge();const token=cookie(request),session=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?sessions.get(hash(token)):null;
    if(!session||!await getHost().authorize(session.scope))return null;
    return session;
  }
  async function handler(request,response){
    try{
      const url=new URL(request.url,origin);
      // Bound local Host headers; no CORS or arbitrary forwarded host is trusted.
      if(request.headers.host!==new URL(origin).host){json(response,403,{error:'Open the configured local table.'});return;}
      if(url.pathname==='/_internal/draft-store'){
        if(!rpcHandler){json(response,404,{error:'This table route is unavailable.'});return;}
        await rpcHandler(request,response);return;
      }
      const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
      if(request.method==='GET'&&['/','/table.css','/draft.css','/table.js'].includes(url.pathname)){
        const name=url.pathname==='/'?'table.html':url.pathname.slice(1);
        response.writeHead(200,{...headers,'Content-Type':name.endsWith('html')?'text/html; charset=utf-8':name.endsWith('css')?'text/css':'text/javascript'});
        response.end(await readFile(fileURLToPath(new URL(`./web/${name}`,import.meta.url))));return;
      }
      if(request.method==='POST'&&request.headers.origin!==origin){json(response,403,{error:'Open the game table before changing it.'});return;}
      if(request.method==='POST'&&url.pathname==='/api/session'){
        const input=await body(request),code=input?.code;
        const entry=typeof code==='string'&&/^[a-f0-9]{64}$/.test(code)?codes.get(hash(code)):null;
        if(entry)codes.delete(hash(code));
        if(!entry||entry.expires<=now()||!await getHost().authorize(entry.scope)){json(response,401,{error:'This sign-in link expired. Open a new table link from Davy.'});return;}
        purge();if(sessions.size>=64){json(response,429,{error:'Too many open table sessions.'});return;}
        const token=randomBytes(32).toString('hex');sessions.set(hash(token),{scope:entry.scope,dm:entry.scope.audience==='gm'||entry.scope.gmController===true||entry.scope.userId===getHost().gmUserId,controls:new Map(),expires:now()+12*60*60*1000});
        response.setHeader('Set-Cookie',`hollow_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);json(response,200,{signedIn:true});return;
      }
      const session=await authenticate(request);if(!session){json(response,401,{error:'Open a table link from your private Davy panel to sign in.'});return;}
      if(request.method==='POST'&&url.pathname==='/api/actor'){
        const input=await body(request),base={...session.scope,audience:'gm',actorId:undefined};
        if(!session.dm||!await getHost().authorize(base)){json(response,403,{error:'Only the DM can select another actor.'});return;}
        if(!input||Object.keys(input).some(k=>k!=='actorId')||typeof input.actorId!=='string'){json(response,400,{error:'Choose an actor from the DM list.'});return;}
        if(input.actorId){
          const dmView=await getHost().service.project(base);
          if(!dmView.controllableActors?.some(a=>a.id===input.actorId)){json(response,403,{error:'That actor is unavailable.'});return;}
        }
        const next=input.actorId?{...base,audience:'player',actorId:input.actorId}:base;
        if(!await getHost().authorize(next)){json(response,403,{error:'Your access changed.'});return;}
        session.scope=next;session.controls.clear();json(response,200,{selected:true});return;
      }
      const level=url.searchParams.get('level')??'tactical';if(!['tactical','dungeon','regional'].includes(level)){json(response,400,{error:'Choose a supported map.'});return;}
      const scope={...session.scope,mapLevel:level};
      const stillCurrent=async()=>await getHost().authorize(scope)&&sessions.get(hash(cookie(request)))===session&&session.expires>now()&&session.scope.actorId===scope.actorId&&session.scope.audience===scope.audience;
      const draftEnabled=Boolean(draftStore&&!session.dm&&scope.audience==='player'&&scope.actorId);
      const privateDraftScope={campaignId:scope.campaignId,userId:scope.userId,actorId:scope.actorId,role:'player',visibility:'private'};
      const ensureDraftAccess=async()=>{if(!draftEnabled||!await stillCurrent())rejectDraft('Open your own private character table to use saved intentions.',403);};
      if(url.pathname==='/api/draft'||url.pathname.startsWith('/api/draft/')){
        await ensureDraftAccess();
        if(request.method==='GET'&&url.pathname==='/api/draft'){
          const draft=await draftStore.get(privateDraftScope);await ensureDraftAccess();json(response,200,{draft:draftView(draft)});return;
        }
        if(request.method==='POST'&&url.pathname==='/api/draft/save'){
          const input=await body(request);
          if(!input||Object.keys(input).some(k=>!['viewToken','actionId','input','expectedDraftVersion'].includes(k))||!Object.hasOwn(input,'expectedDraftVersion')||!(input.expectedDraftVersion===null||Number.isSafeInteger(input.expectedDraftVersion)&&input.expectedDraftVersion>=0))rejectDraft('Choose a written intention from this view.',400);
          const bound=session.controls.get(input.viewToken);
          if(!bound||bound.actorId!==scope.actorId||bound.audience!==scope.audience)rejectDraft('Refresh your own character view before saving.');
          const action=bound.actions?.find(a=>a.id===input.actionId);
          if(!validText(action,input.input))rejectDraft('Enter a supported written intention.',400);
          await ensureDraftAccess();
          let draft;try{draft=await draftStore.save(privateDraftScope,{actionId:action.id,actionPayload:action.payload??{},input:input.input,expectedRevision:bound.revision},input.expectedDraftVersion);}catch{rejectDraft('The saved intention could not be updated. Reload its saved version; keep your edited text.');}
          await ensureDraftAccess();json(response,200,{draft:draftView(draft)});return;
        }
        if(request.method==='POST'&&url.pathname==='/api/draft/try'){
          const input=await body(request);
          if(!input||Object.keys(input).some(k=>!['draftId','version'].includes(k))||typeof input.draftId!=='string'||!Number.isSafeInteger(input.version)||input.version<0)rejectDraft('Choose the saved intention to submit.',400);
          const key=JSON.stringify([privateDraftScope,input.draftId,input.version]);
          let flight=draftFlights.get(key);
          if(!flight){
            flight=(async()=>{
              let draft=await draftStore.get(privateDraftScope);await ensureDraftAccess();
              if(!draft||draft.draftId!==input.draftId||draft.version!==input.version)rejectDraft('The saved intention changed. Reopen it before submitting.');
              if(draft.status==='completed')return draft;
              if(draft.status==='editing'){
                const view=await getHost().service.project(scope);await ensureDraftAccess();
                const action=view.actions?.find(a=>a.id===draft.actionId);
                if(view.revision!==draft.expectedRevision||!validText(action,draft.input)||JSON.stringify(stable(action.payload??{}))!==JSON.stringify(stable(draft.actionPayload)))rejectDraft('The scene or action changed. Review your text and explicitly save it against a fresh view before trying.');
                draft=await draftStore.prepare(privateDraftScope,{draftId:draft.draftId,version:draft.version,currentRevision:view.revision,availableActionIds:[action.id]});
              }
              if(draft.status==='completed')return draft;
              if(draft.status!=='prepared'||!draft.intent)rejectDraft('Reopen the saved intention before submitting.');
              await ensureDraftAccess();const intent=draft.intent;
              const receipt=await getHost().service.command({...scope,action:intent.actionId,payload:{...intent.actionPayload,...intent.input},expectedRevision:intent.expectedRevision,commandId:intent.commandId});
              await ensureDraftAccess();
              if(!receipt||receipt.commandId!==intent.commandId||!Number.isSafeInteger(receipt.revision)||receipt.revision<0)rejectDraft('The action result is unconfirmed. Recover this same saved intention.');
              const result=String(presentReceipt(receipt)??'').trim()||'Result recorded.';
              return draftStore.complete(privateDraftScope,{draftId:draft.draftId,commandId:intent.commandId,receipt:{result}});
            })();
            draftFlights.set(key,flight);void flight.then(()=>draftFlights.delete(key),()=>draftFlights.delete(key));
          }
          const draft=await flight;await ensureDraftAccess();json(response,200,{draft:draftView(draft)});return;
        }
        json(response,404,{error:'This draft route is unavailable.'});return;
      }
      if(request.method==='GET'&&url.pathname==='/api/view'){
        const view=await getHost().service.project(scope);
        let actors=view.controllableActors??[];
        if(session.dm&&scope.audience!=='gm'){
          const dmScope={...scope,audience:'gm',actorId:undefined};
          if(!await getHost().authorize(dmScope)){json(response,403,{error:'Your DM access changed.'});return;}
          actors=(await getHost().service.project(dmScope)).controllableActors??[];
        }
        if(!await stillCurrent()){json(response,403,{error:'Your selected character or access changed.'});return;}
        const viewToken=randomBytes(24).toString('hex');if(session.controls.size>=32)session.controls.delete(session.controls.keys().next().value);
        session.controls.set(viewToken,{actorId:scope.actorId??'',audience:scope.audience,mapLevel:level,revision:view.revision,actions:structuredClone(view.actions??[])});
        json(response,200,{...view,viewToken,draftEnabled,viewer:scope.audience,dmController:session.dm,selectedActor:scope.actorId??'',controllableActors:actors});return;
      }
      if(request.method==='GET'&&url.pathname==='/api/map'){
        const bound=session.controls.get(url.searchParams.get('viewToken'));
        if(!bound||bound.actorId!==(scope.actorId??'')||bound.audience!==scope.audience||bound.mapLevel!==level){json(response,409,{error:'The selected character changed. Refresh this table.'});return;}
        const view=await getHost().service.project(scope);
        if(view.revision!==bound.revision){json(response,409,{error:'The scene changed. Refresh the table to see the current map.'});return;}
        if(!view.map||scope.audience==='public'){json(response,404,{error:'No private map in this view.'});return;}
        const image=level==='tactical'?await renderTacticalMap(view.map,{title:view.title,portraits:renderAssets?.portraits,background:renderAssets?.tacticalBackgrounds?.[view.map.id],terrainTextures:renderAssets?.terrainTextures,terrainTexturesByScene:renderAssets?.terrainTexturesByScene}):await renderIllustratedOverview({...view.map,title:view.title},{roomVignettes:renderAssets?.dungeonVignettes});
        // Membership is checked again after asynchronous image rendering.
        if(!await getHost().authorize(scope)){json(response,403,{error:'Your access changed.'});return;}
        if(session.controls.get(url.searchParams.get('viewToken'))!==bound||session.scope.actorId!==scope.actorId||session.scope.audience!==scope.audience){json(response,409,{error:'The selected character changed. Refresh this table.'});return;}
        response.writeHead(200,{...headers,'Content-Type':'image/png'});response.end(image);return;
      }
      if(request.method==='GET'&&url.pathname==='/api/portrait'){
        const bound=session.controls.get(url.searchParams.get('viewToken'));
        if(!bound||bound.actorId!==(scope.actorId??'')||bound.audience!==scope.audience||scope.audience==='public'){json(response,409,{error:'Refresh the selected character.'});return;}
        const view=await getHost().service.project(scope),path=renderAssets?.portraits?.[view.actor?.id];
        if(!path){json(response,404,{error:'No approved portrait is available.'});return;}
        const bytes=await readFile(path);
        if(!await getHost().authorize(scope)||!session.controls.has(url.searchParams.get('viewToken'))){json(response,403,{error:'Your access changed.'});return;}
        response.writeHead(200,{...headers,'Content-Type':'image/png'});response.end(bytes);return;
      }
      if(request.method==='POST'&&url.pathname==='/api/action'){
        const input=await body(request);
        if(!input||Object.keys(input).some(k=>!['action','payload','revision','commandId','viewToken'].includes(k))||typeof input.action!=='string'||typeof input.commandId!=='string'||!/^[0-9a-f-]{36}$/.test(input.commandId)){json(response,400,{error:'Invalid action. Refresh the table.'});return;}
        const bound=session.controls.get(input.viewToken);
        if(!bound||bound.actorId!==(scope.actorId??'')||bound.audience!==scope.audience||bound.revision!==input.revision){json(response,409,{error:'The selected character changed. Refresh this table before acting.'});return;}
        if(draftEnabled&&(written(bound.actions?.find(a=>a.id===input.action))||written((await getHost().service.project(scope)).actions?.find(a=>a.id===input.action))))rejectDraft('Save and review this written intention before trying it.');
        if(!await stillCurrent())rejectDraft('Your selected character or access changed.',403);
        const receipt=await getHost().service.command({...scope,action:input.action,payload:input.payload,expectedRevision:input.revision,commandId:input.commandId});
        if(!await stillCurrent()){json(response,403,{error:'Your selected character or access changed. Recover the original receipt after signing in again.'});return;}
        json(response,200,{receipt});return;
      }
      if(request.method==='POST'&&url.pathname==='/api/receipt'){
        const input=await body(request);
        if(!input||Object.keys(input).some(k=>k!=='commandId')||typeof input.commandId!=='string'||!/^[0-9a-f-]{36}$/.test(input.commandId)){json(response,400,{error:'Choose the saved pending action.'});return;}
        const receipt=await getHost().service.receipt({...scope,commandId:input.commandId});
        if(!await stillCurrent()){json(response,403,{error:'Your selected character or access changed.'});return;}
        json(response,200,{receipt});return;
      }
      if(request.method==='POST'&&url.pathname==='/api/logout'){sessions.delete(hash(cookie(request)));response.setHeader('Set-Cookie','hollow_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(response,200,{signedIn:false});return;}
      json(response,404,{error:'This table route is unavailable.'});
    }catch(error){json(response,error.name==='EngineError'?error.status:400,{error:error.name==='EngineError'?error.message:'The table could not complete this request. Refresh to check the current state.'});}
  }
  return Object.freeze({origin,webLink,handler,async start(){if(server)throw new Error('Table already started.');server=createServer((req,res)=>{void handler(req,res);});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return origin;},async close(){codes.clear();sessions.clear();if(server)await new Promise(resolve=>server.close(resolve));server=null;}});
}
