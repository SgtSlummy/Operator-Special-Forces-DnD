'use client';

type AllocationField={id:string;label:string;pool:number;choices:{id:string;label:string}[]};
type Row={targetId:string;amount:number};
export function HealingAllocation({field,value,onChange,disabled}:{field:AllocationField;value:string;onChange:(value:string)=>void;disabled:boolean}){
 let rows:Row[]=[];try{const parsed=JSON.parse(value||'[]');if(Array.isArray(parsed))rows=parsed.filter(r=>r&&field.choices.some(c=>c.id===r.targetId)&&Number.isFinite(r.amount));}catch{}
 const total=rows.reduce((sum,r)=>sum+r.amount,0),remaining=field.pool-total;
 const update=(next:Row[])=>onChange(JSON.stringify(next));
 return <fieldset disabled={disabled}><legend>{field.label}</legend>
  <p aria-live="polite">{total} of {field.pool} HP assigned · {remaining>=0?`${remaining} remaining`:`${-remaining} over the limit`}</p>
  {rows.map((row,index)=><div key={row.targetId}>
   <label>{field.choices.find(c=>c.id===row.targetId)?.label}<input aria-label={`Healing for ${field.choices.find(c=>c.id===row.targetId)?.label}`} type="number" min={1} max={field.pool} step={1} required value={row.amount||''} onChange={e=>update(rows.map((r,i)=>i===index?{...r,amount:Number(e.target.value)}:r))}/></label>
   <button type="button" onClick={()=>update(rows.filter((_,i)=>i!==index))}>Remove {field.choices.find(c=>c.id===row.targetId)?.label}</button>
  </div>)}
  <label>Add recipient<select aria-label="Add healing recipient" value="" onChange={e=>{if(e.target.value)update([...rows,{targetId:e.target.value,amount:0}]);}}><option value="">Choose a recipient…</option>{field.choices.filter(c=>!rows.some(r=>r.targetId===c.id)).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
  <p>No healing is spent until you confirm. Only Bloodied creatures can receive it; healing stops at half maximum HP.</p>
 </fieldset>;
}
