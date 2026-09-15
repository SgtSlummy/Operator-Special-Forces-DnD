export const pendingKey='hollow-pending-command';
/** Explicit engine resolution is the only proof that an uncertain ID cannot execute later. */
export function clearResolved(storage,p,r){
 const contract='rpg-core-runtime-bridge-v1',object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const keys=(v,allowed)=>object(v)&&Object.keys(v).length===allowed.length&&allowed.every(k=>Object.hasOwn(v,k));
 const fail=()=>{throw Error('The result remains uncertain. Keep this saved action and try recovery again.');};
 const common=['contract','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision','success','replayed','resolution'];
 if(!validPending(p)||!object(r)||r.contract!==contract||r.campaignId!==p.campaignId||r.commandId!==p.commandId||r.actorId!==p.actor||typeof r.ownerId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(r.ownerId)||r.originalExpectedRevision!==p.expectedRevision||!Number.isSafeInteger(r.revision)||r.revision<0||r.success!==true||typeof r.replayed!=='boolean')fail();
 if(r.resolution==='committed'){
  if(!keys(r,[...common,'receipt'])||r.replayed!==true||!keys(r.receipt,['contract','campaignId','commandId','revision','success','replayed','result'])||r.receipt.replayed!==true||!object(r.receipt.result)||r.revision!==p.expectedRevision+1||r.receipt.revision!==r.revision)fail();
  confirmReceipt(r.receipt,p);
 }else if(r.resolution==='cancelled'){
  const proof=r.rejection;
  if(!keys(r,[...common,'rejection'])||r.revision<=p.expectedRevision||!keys(proof,['contract','code','terminal','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision'])||proof.contract!==contract||proof.code!=='COMMAND_CANCELLED'||proof.terminal!==true||proof.campaignId!==p.campaignId||proof.commandId!==p.commandId||proof.ownerId!==r.ownerId||proof.actorId!==p.actor||proof.originalExpectedRevision!==p.expectedRevision||proof.revision!==r.revision)fail();
 }else fail();
 if(storage.getItem(pendingKey)!==JSON.stringify(p))throw Error('The recovery record changed. Reopen the table.');
 storage.removeItem(pendingKey);
 return r;
}
export function validPending(p){return Boolean(p&&/^[a-f0-9-]{36}$/.test(p.commandId)&&typeof p.campaignId==='string'&&p.campaignId&&typeof p.actor==='string'&&['tactical','dungeon','regional'].includes(p.level)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0);}
export function persistBeforeSend(storage,p){if(!validPending(p))throw Error('Invalid recovery record.');storage.setItem(pendingKey,JSON.stringify(p));if(storage.getItem(pendingKey)!==JSON.stringify(p))throw Error('Recovery storage failed. No action was sent.');}
export function confirmReceipt(r,p){if(!validPending(p)||r?.contract!=='rpg-core-runtime-bridge-v1'||r.campaignId!==p.campaignId||r.commandId!==p.commandId||r.success!==true||r.revision!==p.expectedRevision+1)throw Error('This response did not confirm your action. Recover its original result.');return r;}
export function clearConfirmed(storage,p,r){confirmReceipt(r,p);if(storage.getItem(pendingKey)!==JSON.stringify(p))throw Error('The recovery record changed. Reopen the table.');storage.removeItem(pendingKey);}

/** Only a server-attested absence of submission permits abandoning this ID. */
export function clearRejected(storage,p,r){
 if(!validPending(p)||r?.contract!=='hollow-action-rejection-v1'||r.submitted!==false||r.campaignId!==p.campaignId||r.commandId!==p.commandId||r.actorId!==p.actor||r.expectedRevision!==p.expectedRevision)throw Error('The result remains uncertain. Recover the original action.');
 if(storage.getItem(pendingKey)!==JSON.stringify(p))throw Error('The recovery record changed. Reopen the table.');storage.removeItem(pendingKey);
}
