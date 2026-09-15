type Character={name:string;hp:number;maxHp:number;details:string;inventory?:{id:string;name:string;quantity:number;equipped?:boolean}[]};

export function TableSheet({actor,open,disabled}:{actor:Character;open:(tab:string)=>void;disabled:boolean}){
 return <aside className="hl-player-sheet" aria-label="Your character at the table">
  <p className="hl-eyebrow">Your character</p><h2>{actor.name}</h2>
  <p className="hl-sheet-health"><strong>{actor.hp}</strong> / {actor.maxHp} HP</p>
  <progress aria-label="Hit points" max={Math.max(1,actor.maxHp)} value={Math.max(0,actor.hp)}/>
  <p className="hl-lines">{actor.details}</p>
  <button type="button" disabled={disabled} onClick={()=>open('character')}>Open character sheet</button>
  <h3>Equipped items</h3>
  {actor.inventory?.some(item=>item.equipped)?<ul>{actor.inventory.filter(item=>item.equipped).map(item=><li key={item.id}>{item.name} <small>× {item.quantity}</small></li>)}</ul>:<p>No equipped items recorded.</p>}
  <button type="button" disabled={disabled} onClick={()=>open('inventory')}>Open inventory</button>
 </aside>;
}
