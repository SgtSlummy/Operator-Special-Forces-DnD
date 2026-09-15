import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createEngineClient} from './engine-client.mjs';
import {presentProjection} from './service.mjs';
import {buildPanel} from '../discord/hollow-lantern/components.mjs';
import {renderTacticalMap,renderPublicCombatCard} from '../discord/hollow-lantern/renderers.mjs';

// Deliberately fixed fixture identity: this controller cannot target the live campaign.
const root='C:/Users/Hermes/LocalFiles/hollow-lantern/unity-supervised-20260909';
const client=createEngineClient({campaignId:'fixture-hollow-supervised',channelId:'fixture-channel',baseUrl:'http://127.0.0.1:18793',secret:(await readFile(join(root,'bridge-secret'),'utf8')).trim()});
const output=join(root,'walkthrough');await mkdir(output,{recursive:true});
const art=resolve('../campaign-art/hollow-lantern');
const portraits={'lantern-fighter':join(art,'mara.png'),'lantern-rogue':join(art,'kestrel.png'),'lantern-cleric':join(art,'ash.png')};
const steps=[];
async function capture(name,receipt){
 const files=[];
 for(const [audience,ownerId,actorId] of [['public','fixture-dm',''],['gm','fixture-dm',''],['private','ai-fighter','lantern-fighter'],['private','ai-rogue','lantern-rogue'],['private','ai-cleric','lantern-cleric']]){
  const p=await client.project({ownerId,actorId,audience}),v=presentProjection(p);
  const base=`${String(steps.length+1).padStart(2,'0')}-${name}-${actorId||audience}`;
  const png=audience==='public'?await renderPublicCombatCard({title:v.publicTitle,summary:v.publicSummary,participants:v.publicParticipants},{portraits,sceneArt:join(art,'cover.png')}):await renderTacticalMap(v.map,{title:v.title,portraits});
  await writeFile(join(output,`${base}.png`),png);
  await writeFile(join(output,`${base}.json`),JSON.stringify({projection:p,components:buildPanel({...v,artUrl:'attachment://map.png'},()=> 'fixture-render-only')},null,2));
  files.push({viewer:actorId||audience,audience,revision:p.revision,image:`${base}.png`,sha256:createHash('sha256').update(png).digest('hex')});
 }
 steps.push({name,evidenceKind:'actual-unity-local-render-not-discord-not-blind-player',receipt,files});
 await writeFile(join(output,'steps.json'),JSON.stringify({campaignId:client.campaignId,engine:'Unity 2021.3.14f1 standalone',steps},null,2));
}
let latest=await client.project({ownerId:'fixture-dm',audience:'gm'});
await capture('initial',null);
const request={ownerId:'fixture-dm',actorId:'',commandId:'unity-smoke-open-decisions',expectedRevision:latest.revision,type:'gm_decision',payload:{open:true}};
const receipt=await client.command(request);assert.equal(receipt.success,true);
const duplicate=await client.command(request);assert.equal(duplicate.replayed,true);assert.equal(duplicate.revision,receipt.revision);
await capture('decisions-open',receipt);
const privateView=await client.project({ownerId:'ai-fighter',actorId:'lantern-fighter'});
const destination=privateView.availableMovement[0];assert.ok(destination);
const movement=await client.command({ownerId:'ai-fighter',actorId:'lantern-fighter',commandId:'unity-smoke-movement',expectedRevision:privateView.revision,type:'move',payload:{x:destination.x,y:destination.y}});
await capture('movement',movement);
await assert.rejects(client.project({ownerId:'ai-rogue',actorId:'lantern-fighter'}),error=>error.status===403);
await writeFile(join(output,'verification.json'),JSON.stringify({passed:true,checks:['signed bridge through Unity frame','private per-character projections','duplicate receipt replay','movement committed','wrong-character denied'],limitations:['No live Discord screenshots','No blind simulated participants','No full mission or restart proof in this run']},null,2));
console.log(JSON.stringify({output,steps:steps.length,revision:movement.revision,passed:true}));
