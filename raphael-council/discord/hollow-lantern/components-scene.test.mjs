import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPanel} from './components.mjs';
const view={audience:'player',title:'Saltglass',mode:'combat',actions:[{id:'end_turn',group:'end-turn',label:'End Turn'},{id:'step',group:'move',label:'Move here'}]};
const build=(v,options)=>buildPanel(v,JSON.stringify,options).components[0].components;
const selects=parts=>parts.flatMap(part=>part.components??[]).filter(part=>part.type===3);
const allText=parts=>JSON.stringify(parts);
test('Scene is reachable and retains map combat and grouped action controls',()=>{
 const map=build(view,{tab:'map'}),scene=build(view,{tab:'scene'});
 assert.ok(selects(map).find(s=>s.placeholder==='Open your character menu').options.some(option=>JSON.parse(option.value).navigation==='scene'));
 assert.deepEqual(selects(scene).find(s=>s.placeholder==='Choose your next action'),selects(map).find(s=>s.placeholder==='Choose your next action'));
 assert.match(allText(scene),/End Turn/);assert.equal(selects(scene).some(s=>s.placeholder==='Map scale'),false);
 assert.match(allText(build(view,{tab:'scene',group:'move'})),/Move here/);
});
test('Saltglass summary uses strict known progress and never main mission defaults or public mission',()=>{
 const mission={packId:'saltglass',courierFreed:false,courierExtracted:false,complete:false};
 const before=allText(build({...view,mission},{tab:'scene'}));assert.match(before,/Courier awaiting rescue/);assert.doesNotMatch(before,/Iona|briefing|Signal failing/);
 assert.match(allText(build({...view,mission:{...mission,courierFreed:true,courierExtracted:true,complete:true}},{tab:'scene'})),/Courier extracted/);
 assert.doesNotMatch(allText(build({...view,mission:{packId:'saltglass',courierFreed:'false'}},{tab:'scene'})),/awaiting rescue|Iona|briefing/);
 assert.doesNotMatch(allText(build({...view,audience:'public',mission},{tab:'scene'})),/Courier|Mission:/);
});
