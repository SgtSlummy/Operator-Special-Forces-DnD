import test from 'node:test';import assert from 'node:assert/strict';import {contextualActions,actionsForTab} from './context-actions.mjs';
const actions=[{id:'move',group:'move'},{id:'attack:a',group:'attack'},{id:'attack:b',group:'attack'},{id:'equip:a',group:'equip'},{id:'decision',group:'pause'}];
test('a waiting die choice is reachable from inventory and DM rulings without offering unrelated actions',()=>{
 const die=[{id:'inspiration:keep',group:'reaction',type:'inspiration_choice'},{id:'inspiration:reroll',group:'reaction',type:'inspiration_choice'}];
 for(const tab of ['inventory','rulings','map','character'])assert.deepEqual(actionsForTab([...actions,...die],tab),die);
 for(const tab of ['help','journal'])assert.deepEqual(actionsForTab(die,tab),[]);
});
test('shortcuts contain only offered contextual actions and never discard alternatives',()=>{for(const [tab,mode,gm]of [['map','combat',false],['inventory','exploration',false],['map','exploration',true],['rulings','exploration',true]]){const result=contextualActions(actions,tab,mode,gm);assert.deepEqual(new Set([...result.primary,...result.remaining]),new Set(actions));assert(result.primary.length<=4);}assert.equal(contextualActions(actions,'inventory','combat').primary[0].id,'equip:a');assert.equal(contextualActions(actions,'rulings','combat',true).primary.length,0);assert.deepEqual(contextualActions([],'map','combat').primary,[]);});

test('selected shortcut stays a real menu option and tab scope cannot execute a previous action',()=>{
 const chosen=contextualActions(actions,'map','combat',false,'attack:a');assert.equal(chosen.menu.filter(a=>a.id==='attack:a').length,1);assert(chosen.menu.some(a=>a.id==='attack:b'));
 const inventory=actionsForTab(actions,'inventory');assert(!inventory.some(a=>a.id==='attack:a'));assert(inventory.some(a=>a.id==='equip:a'));
 const rulings=actionsForTab([...actions,{id:'ruling:one:true',group:'rulings'},{id:'check:strength',group:'rulings'}],'rulings');assert.deepEqual(rulings.map(a=>a.id),['ruling:one:true']);assert.deepEqual(actionsForTab(actions,'help'),[]);
});
