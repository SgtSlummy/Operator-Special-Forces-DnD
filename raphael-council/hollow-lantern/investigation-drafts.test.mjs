import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { createInvestigationDraftStore } from './investigation-drafts.mjs';
const scope = { campaignId:'campaign', userId:'player', actorId:'fighter', role:'player', visibility:'private' };
const input = { actionId:'inspect', actionPayload:{ target:'door' }, input:{text:'Check the hinges'}, expectedRevision:4 };
async function fixture(t) {
 const dir = await mkdtemp(join(tmpdir(),'investigation-drafts-'));
 const file=join(dir,'drafts.json'), stores=[];
 t.after(async()=>{for(const store of stores) await store.close(); await rm(dir,{recursive:true,force:true});});
 const open=async()=>{const store=await createInvestigationDraftStore({file}); stores.push(store);return store;};
 return {file,open};
}
const request = draft => ({draftId:draft.draftId,version:draft.version,currentRevision:4,availableActionIds:['inspect']});
test('save and navigation reads persist privately without issuing engine commands',async t=>{
 const f=await fixture(t), store=await f.open();
 const draft=await store.save(scope,input);
 assert.equal(draft.status,'editing'); assert.equal(draft.intent,null);
 assert.equal(await store.get({...scope,userId:'other'}),null);
 assert.equal(await store.get({...scope,campaignId:'other'}),null);
 assert.equal(await store.get({...scope,actorId:'other'}),null);
 await assert.rejects(store.get({...scope,visibility:'public'}),{code:'DRAFT_SCOPE_INVALID'});
 await assert.rejects(store.get({...scope,role:'gm'}),{code:'DRAFT_SCOPE_INVALID'});
 assert.deepEqual(await store.get(scope),draft);
 draft.actionPayload.target='mutated'; assert.equal((await store.get(scope)).actionPayload.target,'door');
 await store.close(); assert.deepEqual((await (await f.open()).get(scope)).input,input.input);
});
test('versions reject old controls and stale or unavailable actions cost nothing',async t=>{
 const store=await (await fixture(t)).open(); const first=await store.save(scope,input);
 const second=await store.save(scope,{...input,input:{text:'Look again'}},first.version);
 await assert.rejects(store.save(scope,input,first.version),{code:'DRAFT_VERSION_MISMATCH'});
 await assert.rejects(store.prepare(scope,request(first)),{code:'DRAFT_VERSION_MISMATCH'});
 await assert.rejects(store.prepare(scope,{...request(second),currentRevision:5}),{code:'DRAFT_REVISION_MISMATCH'});
 await assert.rejects(store.prepare(scope,{...request(second),availableActionIds:[]}),{code:'DRAFT_ACTION_UNAVAILABLE'});
 assert.equal((await store.get(scope)).intent,null);
});
test('concurrent prepare and restart retain one immutable command intent until receipt',async t=>{
 const f=await fixture(t), store=await f.open(), draft=await store.save(scope,input);
 const [a,b]=await Promise.all([store.prepare(scope,request(draft)),store.prepare(scope,request(draft))]);
 assert.deepEqual(a,b); assert.ok(a.intent.commandId);
 await assert.rejects(store.save(scope,input,draft.version),{code:'DRAFT_PREPARED'});
 await store.close(); const resumed=await f.open();
 const retry=await resumed.prepare(scope,{...request(draft),currentRevision:99,availableActionIds:[]});
 assert.deepEqual(retry.intent,a.intent);
 await assert.rejects(resumed.complete(scope,{draftId:draft.draftId,commandId:'wrong',receipt:{ok:true}}),{code:'DRAFT_COMMAND_MISMATCH'});
 const completed=await resumed.complete(scope,{draftId:draft.draftId,commandId:a.intent.commandId,receipt:{ok:true}});
 assert.equal(completed.status,'completed');
 await assert.rejects(resumed.complete(scope,{draftId:draft.draftId,commandId:a.intent.commandId,receipt:{ok:false}}),{code:'DRAFT_RECEIPT_MISMATCH'});
 assert.equal((await resumed.get(scope)).receipt.ok,true);
 assert.deepEqual(a.intent.input,input.input);
 assert.deepEqual(await resumed.complete(scope,{draftId:draft.draftId,commandId:a.intent.commandId,receipt:{ok:true}}),completed);
 const next=await resumed.save(scope,input,completed.version); assert.notEqual(next.draftId,draft.draftId); assert.ok(next.version>completed.version);
});
test('writer lock is exclusive, released on close, and orphan locks fail closed',async t=>{
 const f=await fixture(t), store=await f.open();
 await assert.rejects(f.open(),{code:'DRAFT_STORE_LOCKED'});
 await store.close(); const second=await f.open(); await second.close();
 await writeFile(`${f.file}.lock`,'orphan',{flag:'wx'});
 await assert.rejects(f.open(),{code:'DRAFT_STORE_LOCKED'});
 await assert.rejects(second.get(scope),{code:'DRAFT_STORE_CLOSED'});
});
test('corrupt or oversized state is never replaced and failed open releases own lock',async t=>{
 const f=await fixture(t); await writeFile(f.file,'{broken');
 await assert.rejects(f.open(),{code:'DRAFT_STATE_INVALID'}); assert.equal(await readFile(f.file,'utf8'),'{broken');
 await assert.rejects(readFile(`${f.file}.lock`),{code:'ENOENT'});
 await writeFile(f.file,JSON.stringify({version:1,drafts:[{scope}]}));
 await assert.rejects(f.open(),{code:'DRAFT_STATE_INVALID'});
});
test('abrupt writer exit preserves prepared intent and requires explicit verified lock recovery',async t=>{
 const f=await fixture(t), moduleUrl=new URL('./investigation-drafts.mjs',import.meta.url).href;
 const script=`import {createInvestigationDraftStore} from ${JSON.stringify(moduleUrl)}; const s=await createInvestigationDraftStore({file:process.env.DRAFT_TEST_FILE}); const scope=${JSON.stringify(scope)}; const d=await s.save(scope,${JSON.stringify(input)}); await s.prepare(scope,{draftId:d.draftId,version:d.version,currentRevision:4,availableActionIds:['inspect']}); process.exit(23);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,DRAFT_TEST_FILE:f.file},stdio:'ignore',windowsHide:true});
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.equal(exit,23);
 const disk=JSON.parse(await readFile(f.file,'utf8')).drafts[0]; assert.equal(disk.status,'prepared');
 await assert.rejects(f.open(),{code:'DRAFT_STORE_LOCKED'});
 // This test owns the exited process and has observed its terminal exit status.
 await unlink(`${f.file}.lock`);
 const resumed=await f.open(), retried=await resumed.prepare(scope,{...request(disk),currentRevision:8});
 assert.deepEqual(retried.intent,disk.intent);
});
test('engine-valid 1500-character CJK intention survives save and restart',async t=>{
 const f=await fixture(t), store=await f.open(), text='界'.repeat(1500);
 const draft=await store.save(scope,{...input,input:{text}});
 assert.equal(draft.input.text,text); await store.close();
 assert.equal((await (await f.open()).get(scope)).input.text,text);
});
test('bounds and JSON-only input reject unsafe values without changing saved draft',async t=>{
 const store=await (await fixture(t)).open(), draft=await store.save(scope,input);
 await assert.rejects(store.save(scope,{...input,input:{text:'界'.repeat(3000)}},draft.version),{code:'DRAFT_INPUT_INVALID'});
 await assert.rejects(store.save(scope,{...input,actionPayload:{target:undefined}},draft.version),{code:'DRAFT_INPUT_INVALID'});
 await assert.rejects(store.save(scope,{...input,expectedRevision:-1},draft.version),{code:'DRAFT_INPUT_INVALID'});
 assert.deepEqual(await store.get(scope),draft);
});
