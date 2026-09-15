import {readFile} from 'node:fs/promises';
import {renderArchitecture} from './projection.mjs';

const assets=new URL('../art/',import.meta.url);
const rooms=new Set(['R01','R02','R05','R07']);
const variants=new Set(['cutaway','floor-slice','low-cutaway']);
const portraits=new Set(['mara','ivo','sable','tern']);
const png=async path=>'data:image/png;base64,'+(await readFile(new URL(path,assets))).toString('base64');

// Input must be a recipient projection, never the raw campaign state.
export async function architectureIllustration(view,{roomId,layer=`${roomId?.toLowerCase()}-cutaway`,grid=true}={}){
 if(!rooms.has(roomId)||!view.catalog.rooms.some(r=>r.id===roomId))throw Error('Not discovered or no architectural illustration available.');
 const prefix=roomId.toLowerCase()+'-';
 if(!layer.startsWith(prefix)||!variants.has(layer.slice(prefix.length)))throw Error('Unknown architectural view.');
 const geometry=JSON.parse(await readFile(new URL(`architecture/${roomId.toLowerCase()}-projection.json`,assets),'utf8'));
 const party=(view.party??view.state.party).filter(p=>p.roomId===roomId);
 for(const person of party)if(!portraits.has(person.id))throw Error('This character needs an illustrated portrait.');
 const [background,entries]=await Promise.all([png(`architecture/${layer}.png`),Promise.all(party.map(async p=>[p.id,await png(`table/${p.id}.png`)]))]);
 return renderArchitecture(view,{geometry,layer,grid,images:{background,portraits:Object.fromEntries(entries)}});
}
