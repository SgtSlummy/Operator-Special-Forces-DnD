import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startTable,previewState} from './table-server.mjs';
import {createCoastWeb} from './table-web.mjs';
import {tableAction,tableProject} from './table-model.mjs';
import {renderEncounter,renderTactical} from './table-cards.mjs';
import {CATALOG} from './catalog.mjs';
const encounter=state=>({type:'encounter',revision:state.revision,roomId:state.currentRoomId,terrain:'room',surprise:'No surprise',enemies:[{name:'Harbor lookout',art:'harbor-lookout',hp:13,maxHp:13,visible:false,healthKnown:false}]});

test('opponent art is allowlisted and legacy encounters keep the sentinel',()=>{
 const state=previewState(),action=encounter(state);
 assert.throws(()=>tableAction(CATALOG,state,{role:'gm'},{...action,enemies:[{...action.enemies[0],art:'../../private'}]}),/illustration/);
 const next=tableAction(CATALOG,state,{role:'gm'},action);
 assert.equal(tableProject(CATALOG,next).encounter.enemies.length,0);
 next.table.encounter.enemies[0].visible=true;
 assert.equal(tableProject(CATALOG,next).encounter.enemies[0].art,'harbor-lookout');
 delete next.table.encounter.enemies[0].art;
 assert.equal(tableProject(CATALOG,next).encounter.enemies[0].art,'sentinel');
});

test('hidden opponent artwork is unavailable in web and preview until revealed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'coast-opponent-art-'));
 const table=await startTable({gmPort:0,playerPort:0,stateFile:join(dir,'state.json')});
 const origin='https://coast.test',config={guildId:'111111111111111111',applicationId:'333333333333333333',gmUserId:'444444444444444444',members:[{ownerId:'555555555555555555',actorId:'mara'}]};
 const auth={config:{campaign:'the-unwritten-coast',guild:config.guildId,clientId:config.applicationId,publicOrigin:origin},authenticate:async request=>({campaign:'the-unwritten-coast',owner:request.headers.get('cookie')==='gm'?config.gmUserId:config.members[0].ownerId,role:request.headers.get('cookie')==='gm'?'host':'player'})};
 const web=createCoastWeb({store:table.store,auth,config,client:{user:{id:config.applicationId},guilds:{fetch:async()=>({members:{fetch:async({user})=>({id:user,user:{bot:false}})}})}}});
 t.after(async()=>{web.close();await table.close();await rm(dir,{recursive:true,force:true});});
 const path='/api/art/table/harbor-lookout.png',request=owner=>new Request(origin+path,{headers:{cookie:owner}});
 await table.store.execute({role:'gm'},encounter(table.store.view().state));
 assert.equal((await web.handle(request('player'))).status,404);
 assert.equal((await web.handle(request('gm'))).status,200);
 const originalAuth=auth.authenticate;let authCalls=0;
 auth.authenticate=async request=>originalAuth(++authCalls<=2?request:new Request(origin+path,{headers:{cookie:'player'}}));
 assert.equal((await web.handle(request('gm'))).status,404);
 auth.authenticate=originalAuth;
 const preview='http://127.0.0.1:'+table.player.address().port+'/art/table/harbor-lookout.png';
 assert.equal((await fetch(preview)).status,404);
 await table.store.execute({role:'gm'},{type:'enemy',enemyId:'enemy-0',visible:true,revision:table.store.view().state.revision});
 const response=await web.handle(request('player'));assert.equal(response.status,200);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL('./art/table/harbor-lookout.png',import.meta.url)));
 assert.equal((await fetch(preview)).status,200);
 const view=table.store.view();assert.equal(view.encounter.enemies[0].hp,undefined);
 const legacy=structuredClone(view);legacy.encounter.enemies[0].art='sentinel';
 for(const render of [renderEncounter,renderTactical]){
  const png=await render(view,view.state.currentRoomId),other=await render(legacy,view.state.currentRoomId);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.notDeepEqual(png,other);
 }
 await table.store.execute({role:'gm'},{type:'enemy',enemyId:'enemy-0',visible:false,revision:view.state.revision});
 assert.equal((await web.handle(request('player'))).status,404);
 assert.equal((await fetch(preview)).status,404);
});
