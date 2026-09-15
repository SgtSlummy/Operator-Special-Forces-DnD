import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG} from './catalog.mjs';
import {createTable,tableAction,tableProject,discordScene} from './table-model.mjs';
const gm={role:'gm'};
const action=(s,a,c=CATALOG)=>tableAction(c,s,gm,{...a,revision:s.revision});
const setup=()=>{const s=createTable(CATALOG);s.roomIds.R05={learned:true,visited:true};s.currentRoomId='R05';return s;};
const encounter={type:'encounter',roomId:'R05',terrain:'room',enemies:Array.from({length:12},(_,i)=>({name:`Opponent ${i}`,hp:17,maxHp:23,visible:i===0,healthKnown:false}))};
test('all twelve combatants are inside the measured L floor',()=>{
 const s=setup(),before=structuredClone(s),next=action(s,encounter);
 assert.deepEqual(s,before);assert.equal(next.table.encounter.enemies.length,12);
 for(const e of next.table.encounter.enemies){const x=e.x*11,y=e.y*17;assert.ok(x>=0&&x<=11&&y>=0&&y<=17);assert.ok(x<=7||y>=5,`${e.id} lies in the missing corner`);}
});
test('rounds and individual reveals disclose neither hidden opponents nor unknown health',()=>{
 let s=action(setup(),encounter);
 const check=(count)=>{for(const identity of [{role:'shared'},{role:'player',actorId:CATALOG.party[0].id}]){
  const view=tableProject(CATALOG,s,identity);assert.equal(view.encounter.enemies.length,count);
  for(const e of view.encounter.enemies){assert.equal(e.healthUnknown,true);assert.equal(Object.hasOwn(e,'hp'),false);assert.equal(Object.hasOwn(e,'maxHp'),false);}
  assert.equal(JSON.stringify(discordScene(view,'R05')).includes('Opponent 11'),false);
 }};
 check(1);s=action(s,{type:'round'});check(1);assert.equal(tableProject(CATALOG,s).encounter.round,2);
 s=action(s,{type:'enemy',enemyId:'enemy-1',visible:true});check(2);
 s=action(s,{type:'enemy',enemyId:'enemy-1',healthKnown:true});
 const visible=tableProject(CATALOG,s).encounter.enemies;assert.equal(visible[0].healthUnknown,true);assert.equal(visible[1].hp,17);assert.equal(visible[1].maxHp,23);
 assert.equal(tableProject(CATALOG,s,gm).encounter.enemies.length,12);
});
test('rectangular placements remain unchanged and invalid geometry cannot start combat',()=>{
 const s=setup();s.roomIds.R01={learned:true};
 const next=action(s,{...encounter,roomId:'R01'});assert.equal(next.table.encounter.enemies[0].x,.7);assert.equal(next.table.encounter.enemies[0].y,.25);
 const c=structuredClone(CATALOG);c.rooms.find(r=>r.id==='R05').depth=18;const before=structuredClone(s);
 assert.throws(()=>action(s,encounter,c),/geometry does not match/);assert.deepEqual(s,before);
});
