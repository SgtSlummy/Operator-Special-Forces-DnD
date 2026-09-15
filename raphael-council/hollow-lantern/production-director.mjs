import {presentProjection} from './service.mjs';

const narratives=new Set(['describe','talk','interact','npc-conversation']);
export const isNarrativePending=p=>narratives.has(p?.kind);
export const isAuthoredPending=p=>/^(mission|travel|rest|feature|equipment):[a-z0-9-]+$/.test(p?.kind??'');
/** Round-robin by acting character, retaining FIFO within each character. */
export function chooseProductionPending(pending,lastActor){
 const items=(pending??[]).filter(p=>(isNarrativePending(p)||isAuthoredPending(p))&&typeof p.actorId==='string'&&typeof p.id==='string');
 const owners=[...new Set(items.map(p=>p.actorId))],previous=owners.indexOf(lastActor);
 const next=owners[previous<0?0:(previous+1)%owners.length];return items.find(p=>p.actorId===next);
}
export function productionCanRun(p){return p?.productionVersion===1&&p.runRequested===true&&p.directorMode==='ai_dm'&&/^ai-director:/.test(p.aiDirectorId??'')&&!p.rollPending&&!p.pendingActions?.some(p=>['reaction','inspiration'].includes(p.kind));}
/** Chooses only commands already supported by deterministic authority; never chooses a human action. */
export async function chooseProductionMechanical(p,{pending,privateView}={}){
 if(!productionCanRun(p))return null;
 if(!p.decisionOpen)return {type:'gm_decision',actorId:'',payload:{open:true}};
 if(pending&&isAuthoredPending(pending))return {type:'gm_resolve',actorId:'',payload:{pendingId:pending.id,approved:true,text:'Apply the requested authored procedure only if its current prerequisites and costs remain valid.'}};
 if(pending||p.pendingActions?.length)return null;
 const npc=p.phase==='combat'&&p.characters?.find(c=>c.characterId===p.activeActorId&&c.characterType==='npc');
 if(!npc)return null;
 const view=await privateView(npc.characterId);
 if(view?.campaignId!==p.campaignId||view.revision!==p.revision||view.audience!=='private'||view.characterId!==npc.characterId)throw Error('PRODUCTION_NPC_CONTEXT_CHANGED');
 const own=view.characters?.find(c=>c.characterId===npc.characterId),actions=presentProjection(view).actions;
 const targets=view.characters?.filter(c=>c.characterId!==npc.characterId&&c.factionId!=='neutral'&&c.factionId!==own?.factionId&&!c.defeated&&c.position)??[];
 const attack=actions.find(a=>a.type==='attack'&&a.payload.weaponId==='mace'&&own?.position&&targets.some(t=>t.characterId===a.payload.targetId&&Math.max(Math.abs(own.position.x-t.position.x),Math.abs(own.position.y-t.position.y))<=1));
 if(attack)return {type:attack.type,actorId:npc.characterId,payload:attack.payload};
 const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
 const nearest=position=>Math.min(...targets.map(t=>distance(position,t.position)));
 const moves=actions.filter(a=>a.type==='move'&&own?.position&&nearest(a.payload)<nearest(own.position)).sort((a,b)=>nearest(a.payload)-nearest(b.payload));
 const choice=moves[0]??actions.find(a=>a.type==='end_turn');
 return choice?{type:choice.type,actorId:npc.characterId,payload:choice.payload}:null;
}
