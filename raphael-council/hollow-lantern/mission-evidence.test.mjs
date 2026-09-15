import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRehearsalError} from './mission-evidence.mjs';
test('unexpected controller errors cannot become expected rejections through missing codes',()=>{
 assert.equal(classifyRehearsalError(new Error('not offered'),undefined),'FAIL');
 assert.equal(classifyRehearsalError({code:'ENGINE_FAILURE'},undefined),'FAIL');
 assert.equal(classifyRehearsalError({code:'LOOT_EMPTY'},'LOOT_EMPTY'),'EXPECTED_REJECTION');
 assert.equal(classifyRehearsalError({code:'WRONG_CHARACTER'},'LOOT_EMPTY'),'FAIL');
});
