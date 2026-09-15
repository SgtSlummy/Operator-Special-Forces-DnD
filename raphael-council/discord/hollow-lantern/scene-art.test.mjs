import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHollowLanternAdapter} from './adapter.mjs';
import {renderSceneIllustration} from './renderers.mjs';
const arrival=fileURLToPath(new URL('../../hollow-lantern/art/saltglass-shore-arrival-v1.png',import.meta.url));
const rescued=fileURLToPath(new URL('../../hollow-lantern/art/saltglass-shore-rescued-v1.png',import.meta.url));
const assets={saltglassShoreArrival:arrival,saltglassShoreRescued:rescued};
function fixture({project,authorize=async()=>true,renderAssets=assets}={}){
 let freed=false,revision=1;
 const view=()=>({audience:'player',sceneId:'saltglass-shore',title:'Saltglass',summary:'A courier is trapped beneath a cart.',revision,actions:[],mission:{packId:'saltglass',courierFreed:freed}});
 const adapter=createHollowLanternAdapter({campaignId:'campaign',authorize,resolveActor:async()=> 'hero',renderAssets,engine:{project:project??(async()=>view()),command:async()=>{throw new Error('Scene viewing must not command');}}});
 return {adapter,view,free(){freed=true;revision++;},panel:(options={})=>adapter.panel({userId:'player',actorId:'hero',tab:'scene',...options})};
}
test('private native Scene panel embeds distinct arrival and rescued PNGs',async()=>{
 const f=fixture(); const before=await f.panel();
 assert.equal(before.files?.length,1);assert.equal(before.files[0].name,'character-scene.png');
 assert.ok(Buffer.isBuffer(before.files[0].attachment));assert.equal(before.files[0].attachment.subarray(1,4).toString(),'PNG');
 assert.ok(JSON.stringify(before.components).includes('attachment://character-scene.png'));
 f.free();const after=await f.panel();assert.notDeepEqual(before.files[0].attachment,after.files[0].attachment);
});
test('native new artwork excludes public, unknown mission, wrong pack and ordinary map views',async()=>{
 const unknown=fixture({project:async()=>({audience:'player',sceneId:'saltglass-shore',revision:1,title:'Shore',actions:[]})});
 assert.equal((await unknown.panel()).files,undefined);
 const wrong=fixture({project:async()=>({audience:'player',sceneId:'saltglass-shore',revision:1,title:'Shore',actions:[],mission:{packId:'hollow-lantern',courierFreed:false}})});
 assert.equal((await wrong.panel()).files,undefined);
 assert.equal((await fixture().panel({audience:'public'})).files,undefined);
 assert.equal((await fixture().panel({tab:'map'})).files,undefined);
});
test('native scene rendering rejects changed stage or revision before private delivery',async()=>{
 for(const change of ['stage','revision']){
  let calls=0;const f=fixture({project:async()=>({audience:'player',sceneId:'saltglass-shore',title:'Shore',actions:[],revision:change==='revision'?++calls:1,mission:{packId:'saltglass',courierFreed:change==='stage'?++calls>1:false}})});
  await assert.rejects(f.panel(),/changed/i);
 }
});
test('native missing variant preserves approved old scene fallback',async()=>{
 const f=fixture({renderAssets:{saltglassShoreArrival:arrival+'.missing',sceneArts:{'saltglass-shore':rescued}}});
 const panel=await f.panel();assert.deepEqual(panel.files[0].attachment,await renderSceneIllustration(rescued));
});
test('scene renderer rejects remote and relative artwork sources',async()=>{
 for(const source of ['https://example.com/scene.png','data:image/png;base64,AAAA','file:///C:/scene.png','scene.png','//server/share/scene.png'])await assert.rejects(renderSceneIllustration(source),/approved local/);
});
test('native scene rendering reauthorizes before returning attachment',async()=>{
 let calls=0;const f=fixture({authorize:async()=>++calls===1});
 await assert.rejects(f.panel(),/Access changed/);
});
