import test from 'node:test';
import assert from 'node:assert/strict';
import {missionEquipment,armorLimitation} from './mission-equipment.mjs';

test('worn equipment uses only the selected authorized sheet and does not mint inventory',()=>{
  const view={actor:{sheet:{armor:'chain-mail-and-shield',armorCalculation:'16 chain mail + 2 shield + 1 Defense',equipmentGrant:'Fixed mission equipment'},inventory:[{id:'longsword',quantity:1}]}};
  const before=structuredClone(view);
  assert.deepEqual(missionEquipment(view),{owned:false,guidance:armorLimitation,name:'Chain mail and shield',calculation:'16 chain mail + 2 shield + 1 Defense',grant:'Fixed mission equipment'});
  assert.deepEqual(view,before);
});
test('missing or other-character data never supplies worn equipment',()=>{
  for(const view of [null,{}, {actor:{classId:'fighter'}},{characters:[{sheet:{armor:'secret'}}]},{actor:{sheet:{armor:[]}}}])assert.equal(missionEquipment(view),null);
  assert.deepEqual(missionEquipment({actor:{sheet:{armor:'studded-leather'}}}),{owned:false,guidance:armorLimitation,name:'Studded leather',calculation:'',grant:''});
});

test('only explicit authoritative equipment version enables owned armor guidance',()=>{
 const view={actor:{sheet:{armor:'chain-mail'},equipment:{version:1}}};
 assert.equal(missionEquipment(view).owned,true);assert.match(missionEquipment(view).guidance,/removed before trading/);
 for(const version of [undefined,0,2,'1']){view.actor.equipment.version=version;assert.equal(missionEquipment(view).owned,false);assert.equal(missionEquipment(view).guidance,armorLimitation);}
});
