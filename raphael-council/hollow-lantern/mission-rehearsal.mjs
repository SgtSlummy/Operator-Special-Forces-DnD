import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createEngineClient} from './engine-client.mjs';
import {presentProjection,presentReceipt,createGameService} from './service.mjs';
import {buildPanel} from '../discord/hollow-lantern/components.mjs';
import {renderTacticalMap,renderPublicCombatCard} from '../discord/hollow-lantern/renderers.mjs';
import {classifyRehearsalError} from './mission-evidence.mjs';

// Development controller with synthetic DM authority. NOT a blind tester or Discord client.
const root=resolve(process.env.HOLLOW_MISSION_OUTPUT??'C:/Users/Hermes/LocalFiles/HollowLanternMission-20260909');
const persistent=process.argv.includes('--persistent-mission');
const buildName=process.env.HOLLOW_MISSION_BUILD??(persistent?'HollowLanternUnity-TurnHistory':'HollowLanternUnity-Prepared');
const campaignId='fixture-hollow-mission',channelId='fixture-mission',gm='fixture-dm';
const client=createEngineClient({baseUrl:`http://127.0.0.1:${process.env.HOLLOW_MISSION_PORT??18797}`,campaignId,channelId,secret:(await readFile(join(root,'bridge-secret.txt'),'utf8')).trim()});
const art=fileURLToPath(new URL('../../campaign-art/hollow-lantern/',import.meta.url)),portraits={'lantern-fighter':join(art,'mara.png'),'lantern-rogue':join(art,'kestrel.png'),'lantern-cleric':join(art,'ash.png'),'lantern-sentinel':join(art,'sentinel-sd.png')};
const seats=['fighter','rogue','cleric'];
const scopes=[{name:'public',ownerId:gm,audience:'public'},...seats.map(name=>({name,ownerId:`ai-${name}`,actorId:`lantern-${name}`,audience:'private'})),{name:'dm',ownerId:gm,audience:'gm'}];
const records=[],snapshots=new Map();let sequence=0;
const resumeCombat=process.argv.includes('--resume-combat');
await mkdir(join(root,'evidence'),{recursive:true});
if(resumeCombat){const prior=await readFile(join(root,'walkthrough.json'),'utf8');await writeFile(join(root,'failed-controller-walkthrough.json'),prior);records.push(...JSON.parse(prior).records);sequence=records.length;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owner=actor=>actor==='lantern-sentinel'?gm:`ai-${actor.replace('lantern-','')}`;
const game=createGameService({client,authorize:async scope=>scope.campaignId===campaignId&&(scope.userId===gm||scope.actorId&&scope.userId===owner(scope.actorId))});
const gmView=()=>client.project({ownerId:gm,audience:'gm'});
const ownView=actor=>client.project({ownerId:owner(actor),actorId:actor,audience:'private'});
function wrap(ctx,text,width){const lines=[];for(const paragraph of String(text).split('\n')){let line='';for(const word of paragraph.split(' ')){if(ctx.measureText(`${line} ${word}`).width>width&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);}return lines;}
async function compose(view,mapBytes,scope){
 const panel=buildPanel(view,()=> 'local-record-only');
 const canvas=createCanvas(980,1500),ctx=canvas.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,980,1500);ctx.fillStyle='#d7b54a';ctx.fillRect(24,24,5,1452);
 let y=54;ctx.fillStyle='#d7b54a';ctx.font='bold 24px sans-serif';ctx.fillText(`${scope.name.toUpperCase()} · REVISION ${view.revision}`,48,y);y+=28;ctx.font='14px sans-serif';ctx.fillStyle='#bdc8d8';ctx.fillText('Local Unity rendered interface record · not a Discord screenshot',48,y);y+=40;
 ctx.font='bold 28px sans-serif';ctx.fillStyle='#f4e6c9';for(const line of wrap(ctx,view.title??'Operation Hollow Lantern',880)){ctx.fillText(line,48,y);y+=34;}
 if(mapBytes){const image=await loadImage(mapBytes);const h=Math.min(800,880*image.height/image.width);ctx.drawImage(image,48,y,880,h);y+=h+28;}
 const summary=scope.name==='public'?view.publicSummary:view.summary;ctx.font='17px sans-serif';ctx.fillStyle='#e1e7ef';for(const line of wrap(ctx,summary??'',875).slice(0,5)){ctx.fillText(line,48,y);y+=23;}
 if(view.actor){ctx.fillStyle='#d7b54a';ctx.font='bold 20px sans-serif';ctx.fillText(`${view.actor.name} · ${view.actor.hp}/${view.actor.maxHp} HP`,48,y+12);y+=42;ctx.font='16px sans-serif';ctx.fillStyle='#d8e1ed';for(const line of wrap(ctx,view.actor.details??'',875).slice(0,4)){ctx.fillText(line,48,y);y+=21;}}
 const groups=scope.name==='public'?['Join','My Character','Session Recap']:scope.name==='dm'?['Rulings','Reveal','Scene','Pause','Checkpoint','Enroll','Control character / NPC']:['Map','Character','Inventory','Journal','Help',...(view.mode==='combat'?['Move','Attack','Magic / Abilities','Item','More Actions','Describe Action','End Turn']:['Move','Inspect','Interact','Talk','Describe Action'])];
 let x=48;for(const label of groups){ctx.font='bold 15px sans-serif';const w=Math.max(105,ctx.measureText(label).width+28);if(x+w>930){x=48;y+=46;}ctx.fillStyle='#293342';ctx.fillRect(x,y,w,34);ctx.strokeStyle='#5e6978';ctx.strokeRect(x,y,w,34);ctx.fillStyle='#f1f3f7';ctx.fillText(label,x+14,y+23);x+=w+10;}
 y+=64;ctx.font='15px sans-serif';ctx.fillStyle='#d3dce7';for(const action of (view.actions??[]).slice(0,3)){for(const line of wrap(ctx,`${action.label}: ${action.description??''}`,880).slice(0,2)){if(y<1470)ctx.fillText(line,48,y);y+=20;}}
 return {image:canvas.toBuffer('image/png'),panel};
}
async function capture(){
 const current=await gmView(),key=current.revision;if(snapshots.has(key))return snapshots.get(key);
 const journalPath=join(root,'public-event-archive.json');let prior=[];try{prior=JSON.parse(await readFile(journalPath,'utf8')).entries;}catch(error){if(error.code!=='ENOENT')throw error;}
 const journal=new Map(prior.map(e=>[e.receipt.revision,e]));for(const e of current.committedEvents?.entries??[]){const next={receipt:e.receipt,publicProjection:e.publicProjection};if(next.publicProjection?.audience!=='public'||next.publicProjection.revision!==e.revision)throw new Error('Invalid committed public archive entry');if(journal.has(e.revision)&&JSON.stringify(journal.get(e.revision))!==JSON.stringify(next))throw new Error('Committed archive changed');journal.set(e.revision,next);}
 const archive={kind:'controller-recorded-public-journal',campaignId,entries:[...journal.values()].sort((a,b)=>a.receipt.revision-b.receipt.revision)};await writeFile(journalPath,JSON.stringify(archive,null,2));if(key===30)await writeFile(join(root,'public-event-archive-r30.json'),JSON.stringify(archive,null,2));
 const files={};
 for(const scope of scopes){
  const p=await client.project(scope);if(p.revision!==key)throw new Error('Revision changed during evidence capture.');
  const view=presentProjection(p);const bytes=scope.name==='public'?await renderPublicCombatCard({title:view.publicTitle,summary:view.publicSummary,participants:view.publicParticipants},{portraits,sceneArt:join(art,view.sceneId==='briefing'?'briefing-sd.png':'cover.png')}):await renderTacticalMap(view.map,{title:view.title,portraits,terrainTextures:{floor:join(art,'stone-floor-sd.png')}});
  const rendered=await compose(view,bytes,scope),stem=`evidence/r${String(key).padStart(4,'0')}-${scope.name}`;
  await writeFile(join(root,`${stem}.png`),rendered.image);await writeFile(join(root,`${stem}.json`),JSON.stringify({scope,projection:p,panel:rendered.panel},null,2));files[scope.name]={image:`${stem}.png`,data:`${stem}.json`,sha256:createHash('sha256').update(rendered.image).digest('hex')};
 }
 snapshots.set(key,files);return files;
}
async function command(label,type,payload={},actorId='',expectedFailure){
 if(sequence>=160)throw new Error('Rehearsal action bound reached.');
 const before=await capture(),p=await gmView(),request={ownerId:actorId?owner(actorId):gm,actorId,commandId:`mission-${String(++sequence).padStart(3,'0')}`,expectedRevision:p.revision,type,payload};
 const record={step:sequence,label,build:buildName,campaignId,scope:{ownerId:request.ownerId,actorId},request,beforeRevision:p.revision,before};records.push(record);
 try{
  if(persistent&&!expectedFailure){
   const scoped=await client.project({ownerId:request.ownerId,actorId,audience:actorId?'private':'gm'});
   const offered=presentProjection(scoped).actions.find(a=>a.type===type&&Object.entries(a.payload).every(([k,v])=>request.payload[k]===undefined||JSON.stringify(request.payload[k])===JSON.stringify(v))&&Object.keys(request.payload).every(k=>Object.hasOwn(a.payload,k)||a.fields.some(f=>f.id===k)));
   if(!offered)throw new Error('This ordinary scoped interface does not offer the intended action.');
   record.offeredActionId=offered.id;const input={...request.payload};for(const field of offered.fields)input[field.id]=String(input[field.id]);
   record.receipt=await game.command({campaignId,userId:request.ownerId,actorId,audience:actorId?'player':'gm',commandId:request.commandId,expectedRevision:request.expectedRevision,action:offered.id,payload:input});
   record.request.payload={...offered.payload,...request.payload};
  }else record.receipt=await client.command(request);if(expectedFailure)throw new Error(`Expected ${expectedFailure} but action committed`);record.result='PASS';}
 catch(error){record.error={code:error.code??'CONTROLLER_FAILURE',message:error.message};record.result=classifyRehearsalError(error,expectedFailure);}
 record.afterRevision=(await gmView()).revision;record.after=await capture();await persist();console.log(`${record.step} ${record.result} r${record.afterRevision} ${label}`);
 if(record.result==='FAIL')throw new Error(`${label}: ${record.error.message}`);return record;
}
async function persist(){
 await writeFile(join(root,'walkthrough.json'),JSON.stringify({kind:'development-rehearsal',backend:'actual Unity signed HTTP / main-thread authority',discord:false,blindTest:false,records},null,2));
 const cards=records.map(r=>`<section><h2>${r.step}. ${esc(r.label)} · ${r.result}</h2><p>Revision ${r.beforeRevision} → ${r.afterRevision} · ${esc(r.scope.actorId||'DM')}</p><p>${esc(r.receipt?presentReceipt(r.receipt):r.error?.message??'')}</p><details><summary>Submitted intention and committed receipt</summary><pre>${esc(JSON.stringify({request:r.request,receipt:r.receipt,error:r.error},null,2))}</pre></details><div class="grid">${Object.entries(r.after??{}).map(([scope,f])=>`<figure><a href="${f.image}"><img loading="lazy" src="${f.image}"></a><figcaption>${scope} · <a href="${f.data}">scoped projection and panel</a></figcaption></figure>`).join('')}</div><details><summary>Before action</summary>${Object.entries(r.before??{}).map(([scope,f])=>`<a href="${f.image}">${scope} r${r.beforeRevision}</a> `).join('')}</details></section>`).join('');
 await writeFile(join(root,'index.html'),`<!doctype html><meta charset="utf-8"><title>Hollow Lantern — local Unity mission record</title><style>body{background:#111820;color:#e3e8ef;font:17px system-ui;margin:40px}h1,h2{color:#e9c97f}section{border-top:1px solid #465264;margin:36px 0;padding-top:20px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%}a{color:#8bbcf2}pre{white-space:pre-wrap}details{margin:12px 0}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}}</style><h1>Operation Hollow Lantern</h1><p>Actual Unity authority, signed local bridge, disposable synthetic-DM rehearsal. Images are rendered interface records, not Discord screenshots. This controller has GM/source knowledge and is not an isolated player tester.</p>${cards}`);
}
async function ruling(actor,type,text,decision){const r=await command(text,type,{text},actor);const pending=(await gmView()).pendingActions.find(p=>p.id===r.receipt?.result?.pendingId)??(await gmView()).pendingActions.find(p=>p.actorId===actor);if(!pending)throw new Error('Ruling was not persisted.');await command(decision,'gm_resolve',{pendingId:pending.id,approved:true,text:decision});}
async function scene(id){
 if(persistent){const request=await command(`Request travel to ${id}`,'travel',{destinationId:id},'lantern-fighter');await command(`DM approves the authored route to ${id}`,'gm_resolve',{pendingId:request.receipt.result.pendingId,approved:true});}
 else await command(`DM opens ${id}`,'gm_scene',{sceneId:id});
 await command('DM opens party decisions','gm_decision',{open:true});
}
async function milestone(actionId){const request=await command(`Request ${actionId}`,'mission_action',{actionId},'lantern-fighter');await command(`DM approves ${actionId}`,'gm_resolve',{pendingId:request.receipt.result.pendingId,approved:true});if(actionId!=='complete-debrief')await command('DM reopens party decisions','gm_decision',{open:true});}

async function moveTo(actor,x,y){for(let i=0;i<25;i++){const p=await ownView(actor),self=p.characters.find(c=>c.characterId===actor),pos=self.position;if(pos.x===x&&pos.y===y)return;const choices=p.availableMovement??[];const target=choices.sort((a,b)=>Math.max(Math.abs(a.x-x),Math.abs(a.y-y))-Math.max(Math.abs(b.x-x),Math.abs(b.y-y)))[0];if(!target)throw new Error(`No legal route for ${actor}`);await command(`${self.displayName} moves toward (${x+1}, ${y+1})`,'move',{x:target.x,y:target.y},actor);}throw new Error('Movement bound reached');}
if(process.argv.includes('--verify-restart')) {
 const saved=JSON.parse(await readFile(join(root,'restart-check.json'),'utf8'));
 const current=await gmView();if(current.revision!==saved.revision)throw new Error('Campaign revision changed across the supervised restart.');
 const receipt=await client.command(saved.request),lookup=await client.receipt({ownerId:gm,actorId:'',commandId:saved.request.commandId});
 if(!receipt.replayed||!lookup.replayed||JSON.stringify(receipt.result)!==JSON.stringify(saved.receipt.result)||receipt.revision!==saved.revision||(await gmView()).revision!==saved.revision)throw new Error('Restart/replay verification failed.');
 const images=await capture();const proof={kind:'supervised-external-process-restart-verification',revision:saved.revision,receipt,lookup,images,checkedAt:new Date().toISOString()};
 await writeFile(join(root,'restart-verified.json'),JSON.stringify(proof,null,2));
 const result=JSON.parse(await readFile(join(root,'result.json'),'utf8'));result.restart='Original checkpoint and all five scoped views verified after externally supervised Unity process restart.';await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
 console.log(`PASS restart and original receipt at revision ${saved.revision}`);process.exit(0);
}
try {
 const initial=await gmView();if(!resumeCombat){if(initial.revision!==0)throw new Error('A fresh disposable campaign is required; this controller refuses to overwrite or replay a partial run.');
 for(const seat of seats)await command(`Enroll prepared ${seat}`,'gm_enroll_preset',{presetId:seat,ownerId:`ai-${seat}`});
 await command('DM opens the Vesper Quay briefing','gm_decision',{open:true});
 await ruling('lantern-fighter','talk','Ask the harbor courier about the missing convoy.','The courier reports that the last signal came from Lantern Road. The party accepts the investigation.');
 if(persistent)await milestone('accept-briefing');
 await scene('coastal-road');await command('Kestrel scouts the broken signal route','inspect',{targetId:'surroundings'},'lantern-rogue');
 await command('DM requests a scouting Perception check','gm_check',{actorId:'lantern-rogue',ability:'wisdom',skill:'perception',dc:10,kind:'check'});
 await ruling('lantern-cleric','talk','Speak gently to the stranded convoy witness.','The witness identifies the signal house and asks the party to rescue the trapped technician. This disclosure is a synthetic DM narrative ruling.');
 if(persistent){
  for(let attempt=0;attempt<5&&!(await ownView('lantern-rogue')).discoveries.includes('route:signal-dungeon');attempt++)await command('Kestrel traces the convoy route','scout_route',{},'lantern-rogue');
  for(const discoveryId of ['route:signal-dungeon','convoy-proof'])await command(`Kestrel explicitly shares ${discoveryId}`,'share',{targetId:'lantern-fighter',discoveryId},'lantern-rogue');
 }
 await scene('signal-dungeon');await moveTo('lantern-fighter',6,5);await moveTo('lantern-rogue',5,4);
 await command('DM starts the sentinel encounter','gm_combat');if(!(await gmView()).decisionOpen)await command('DM opens combat decisions','gm_decision',{open:true});
 }
 for(let turns=0;turns<16;turns++){
  const p=await gmView();if(p.phase!=='combat')break;const id=p.activeActorId,view=await ownView(id),self=view.characters.find(c=>c.characterId===id),enemy=view.characters.filter(c=>c.factionId!==self.factionId&&!c.defeated).sort((a,b)=>Math.max(Math.abs(a.position.x-self.position.x),Math.abs(a.position.y-self.position.y))-Math.max(Math.abs(b.position.x-self.position.x),Math.abs(b.position.y-self.position.y)))[0];
  if(self.primaryHealth>0&&enemy){const distance=Math.max(Math.abs(enemy.position.x-self.position.x),Math.abs(enemy.position.y-self.position.y));if(id==='lantern-cleric')await command('Brother Ash casts Sacred Flame','ability',{abilityId:'sacred-flame',targetId:enemy.characterId},id);else if(id==='lantern-rogue'||distance<=1)await command(`${self.displayName} attacks`,'attack',{targetId:enemy.characterId},id);else{const move=view.availableMovement.sort((a,b)=>Math.max(Math.abs(a.x-enemy.position.x),Math.abs(a.y-enemy.position.y))-Math.max(Math.abs(b.x-enemy.position.x),Math.abs(b.y-enemy.position.y)))[0];if(move)await command(`${self.displayName} closes distance`,'move',{x:move.x,y:move.y},id);}}
  await command(`${self.displayName} ends turn`,'end_turn',{},id);
 }
 if((await gmView()).phase==='combat')throw new Error('Combat exceeded the turn bound.');
 await command('DM opens post-combat exploration','gm_decision',{open:true});await moveTo('lantern-rogue',7,7);
 for(let attempt=0;attempt<3&&!((await ownView('lantern-rogue')).discoveries??[]).includes('signal-cache');attempt++)await command('Kestrel inspects the damaged console','inspect',{targetId:'surroundings'},'lantern-rogue');
 if(!(await ownView('lantern-rogue')).discoveries.includes('signal-cache'))throw new Error('Cache not found within bounded search.');
 await command('Kestrel explicitly shares the cache discovery','share',{targetId:'lantern-fighter',discoveryId:'signal-cache'},'lantern-rogue');
 const loot=await command('Take the two finite healing potions','loot',{sourceId:'signal-cache',itemId:'healing-potion',quantity:2},'lantern-rogue');
 const replay=await client.command(loot.request);if(!replay.replayed)throw new Error('Duplicate loot did not replay.');loot.duplicateReceipt=replay;
 await command('Empty cache rejects additional potion','loot',{sourceId:'signal-cache',itemId:'healing-potion',quantity:1},'lantern-rogue','LOOT_EMPTY');
 await scene('rescue');if(persistent){await moveTo('lantern-fighter',7,5);await milestone('rescue-technician');await moveTo('lantern-fighter',9,5);await milestone('repair-signal');}else await ruling('lantern-fighter','interact','Free the trapped signal technician and escort them to safety.','The technician is rescued in this synthetic DM ruling. No persisted rescue-objective mechanic exists yet.');
 await scene('harbor-shop');await command('Sell one recovered healing potion','sell',{itemId:'healing-potion',quantity:1},'lantern-rogue');const buy=await command('Purchase one quartermaster healing potion','buy',{itemId:'healing-potion',quantity:1},'lantern-rogue');buy.duplicateReceipt=await client.command(buy.request);
 await command('Transfer one ration to the adjacent fighter','transfer',{itemId:'rations',quantity:1,targetId:'lantern-fighter'},'lantern-rogue');
 await command('Kestrel equips the owned dagger','equip',{itemId:'dagger'},'lantern-rogue');
 await command('Mara requests a short rest','rest',{kind:'short'},'lantern-fighter');let pending=(await gmView()).pendingActions.find(p=>p.kind==='rest:short');await command('DM confirms one uninterrupted hour','gm_resolve',{pendingId:pending.id,approved:true,text:'One uninterrupted hour at the quartermaster shelter.'});
 await command('Brother Ash requests a long rest','rest',{kind:'long'},'lantern-cleric');pending=(await gmView()).pendingActions.find(p=>p.kind==='rest:long');await command('DM confirms the overnight rest','gm_resolve',{pendingId:pending.id,approved:true,text:'Eight uninterrupted hours; consume one ration and restore the prepared resources.'});
 await scene('debrief');if(persistent)await milestone('complete-debrief');else await ruling('lantern-cleric','talk','Record what the party learned and the technician rescue.','The missing convoy investigation concludes with a rescued technician and repaired signal instructions. Narrative record only: no authored outcome flags are available.');
 if(persistent&&!(await gmView()).mission.complete)throw new Error('Persistent mission completion was not committed.');
 const checkpoint=await command('Commit the final campaign checkpoint','checkpoint');await writeFile(join(root,'restart-check.json'),JSON.stringify({request:checkpoint.request,receipt:checkpoint.receipt,revision:checkpoint.afterRevision},null,2));
 const recovered=await client.receipt({ownerId:gm,actorId:'',commandId:checkpoint.request.commandId});if(recovered.revision!==checkpoint.receipt.revision)throw new Error('Receipt lookup mismatch');
 await writeFile(join(root,'result.json'),JSON.stringify({status:persistent?'CLEAN_PERSISTENT_MISSION_COMMANDS_PASS':resumeCombat?'RESUMED_LOCAL_MISSION_WITH_RETAINED_CONTROLLER_FAILURE':'LOCAL_MISSION_COMMANDS_PASS_WITH_GAPS',mission:(await gmView()).mission,revision:(await gmView()).revision,commands:records.length,restart:'pending separate supervised process restart',gaps:[...(!persistent?['Rescue/social/debrief are explicit synthetic-DM narrative rulings, not persistent mission objective mechanics.','Regional travel is a DM scene transition; route mechanics are not authored.']:[]),'Rendered local interface records are not Discord desktop/mobile screenshots.','Controller has GM knowledge; this is not isolated simulated-human validation.','Full class feature automation and manual/import enrollment remain incomplete.']},null,2));
 await persist();console.log(`Evidence: ${join(root,'index.html')}`);
} catch(error){await persist();await writeFile(join(root,'failure.json'),JSON.stringify({message:error.message,step:sequence,records:records.length},null,2));console.error(error.message);process.exitCode=1;}
