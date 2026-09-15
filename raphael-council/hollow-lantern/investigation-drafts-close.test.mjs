import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,unlink,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInvestigationDraftStore} from './investigation-drafts.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'draft-owned-close-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50}));return join(dir,'drafts.json');}
const error=code=>Object.assign(new Error('injected '+code),{code});
test('busy then permitted removal retains exclusivity and shares close promise',async t=>{
 const file=await fixture(t);let attempts=0;
 const store=await createInvestigationDraftStore({file,removeOwnedLock:async path=>{assert.equal(path,file+'.lock');attempts++;await assert.rejects(()=>createInvestigationDraftStore({file}),e=>e.code==='DRAFT_STORE_LOCKED');if(attempts<3)throw error(attempts===1?'EBUSY':'EPERM');await unlink(path);}});
 const first=store.close();assert.equal(store.close(),first);await first;assert.equal(attempts,3);assert.equal(store.close(),first);
 const reopened=await createInvestigationDraftStore({file});await reopened.close();
});
test('exhausted busy removal preserves lock and repeated close failure',async t=>{
 const file=await fixture(t),busy=error('EBUSY');let attempts=0;
 const store=await createInvestigationDraftStore({file,removeOwnedLock:async()=>{attempts++;throw busy;}}),closing=store.close();
 await assert.rejects(closing,e=>e===busy);assert.equal(attempts,6);assert.equal(store.close(),closing);await assert.rejects(store.close(),e=>e===busy);
 await assert.rejects(()=>createInvestigationDraftStore({file}),e=>e.code==='DRAFT_STORE_LOCKED');assert.equal(typeof JSON.parse(await readFile(file+'.lock','utf8')).token,'string');
});
test('nonretryable unlink error propagates immediately',async t=>{
 const file=await fixture(t),problem=error('EIO');let attempts=0;
 const store=await createInvestigationDraftStore({file,removeOwnedLock:async()=>{attempts++;throw problem;}});await assert.rejects(store.close(),e=>e===problem);assert.equal(attempts,1);
});
test('replacement token is never removed during a retry',async t=>{
 const file=await fixture(t);let attempts=0;const replacement=JSON.stringify({pid:999999,token:'different-owner'});
 const store=await createInvestigationDraftStore({file,removeOwnedLock:async path=>{attempts++;await writeFile(path,replacement);throw error('EBUSY');}});
 await assert.rejects(store.close(),e=>e.code==='DRAFT_LOCK_OWNERSHIP_LOST');assert.equal(attempts,1);assert.equal(await readFile(file+'.lock','utf8'),replacement);
});
test('real filesystem repeated open and close removes only each owned marker',async t=>{
 const file=await fixture(t);for(let i=0;i<20;i++){const store=await createInvestigationDraftStore({file});await store.close();await assert.rejects(()=>readFile(file+'.lock'),e=>e.code==='ENOENT');}
});
