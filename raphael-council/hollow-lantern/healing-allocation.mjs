/** Allocation is an intention; only Unity determines eligible targets and healing. */
export function parseHealingAllocation(value,field){
 if(typeof value!=='string'||value.length>4000||!Number.isSafeInteger(field?.pool)||field.pool<1||!Array.isArray(field.choices))throw Error('Invalid healing allocation');
 const rows=JSON.parse(value),ids=new Set(field.choices.map(c=>c.id)),seen=new Set();let total=0;
 if(!Array.isArray(rows)||!rows.length||rows.length>Math.min(field.pool,ids.size))throw Error('Choose at least one recipient');
 for(const row of rows){
  if(!row||Object.keys(row).length!==2||!ids.has(row.targetId)||seen.has(row.targetId)||!Number.isSafeInteger(row.amount)||row.amount<1||row.amount>field.pool)throw Error('Check each recipient and healing amount');
  seen.add(row.targetId);total+=row.amount;
 }
 if(total>field.pool)throw Error('The assigned healing exceeds the available pool');
 return rows.map(({targetId,amount})=>({targetId,amount}));
}
export function validHealingAllocation(value,field){try{parseHealingAllocation(value,field);return true;}catch{return false;}}
