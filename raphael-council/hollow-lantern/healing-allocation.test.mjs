import test from 'node:test';import assert from 'node:assert/strict';
import {parseHealingAllocation,validHealingAllocation} from './healing-allocation.mjs';
const field={pool:15,choices:[{id:'mara'},{id:'ash'},{id:'guard'}]};
test('allocation preserves intended distribution without inventing healing results',()=>{
 const rows=[{targetId:'mara',amount:8},{targetId:'ash',amount:5},{targetId:'guard',amount:2}];
 assert.deepEqual(parseHealingAllocation(JSON.stringify(rows),field),rows);
});
test('allocation rejects unknown recipients, duplicates, derived results and invalid amounts',()=>{
 for(const rows of [[],[{targetId:'secret',amount:1}],[{targetId:'mara',amount:8},{targetId:'mara',amount:1}],[{targetId:'mara',amount:10},{targetId:'ash',amount:6}],...[0,-1,1.5,'3',16].map(amount=>[{targetId:'mara',amount}]),[{targetId:'mara',amount:2,healing:100}]])assert.equal(validHealingAllocation(JSON.stringify(rows),field),false);
 assert.equal(validHealingAllocation('broken',field),false);
});
