import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,link,symlink} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquireCommitFollowerLock} from './commit-follower-lock.mjs';
import {createCommitFollower} from './commit-events.mjs';

const moduleUrl=new URL('./commit-events.mjs',import.meta.url).href;
const journal={audience:'gm',campaignId:'lock-test',revision:1,committedEvents:{version:1,latestRevision:1,retainedFromRevision:1,entries:[{revision:1,commandId:'one',receipt:{revision:1,commandId:'one',replayed:false},publicProjection:{revision:1,audience:'public',campaignId:'lock-test'}}]}};
const options=(cursorFile,onEvent=async()=>{})=>({client:{campaignId:'lock-test',project:async()=>structuredClone(journal)},gmUserId:'gm',cursorFile,onEvent,authorize:async()=>true});
async function fixture(t){
 const root=resolve('.runtime','commit-follower-tests');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-'));
 t.after(async()=>{assert.ok(dir.startsWith(root+sep));await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:25});});
 return {dir,file:join(dir,'cursor.json')};
}
async function worker(t,file,pending=false){
 const script=`import {createCommitFollower} from ${JSON.stringify(moduleUrl)};
 const journal=${JSON.stringify(journal)};
 setInterval(()=>{},1000);
 try { const f=await createCommitFollower({client:{campaignId:'lock-test',project:async()=>journal},gmUserId:'gm',cursorFile:process.argv[1],authorize:async()=>true,onEvent:async()=>{if(process.argv[2]==='pending'){process.send({status:'pending'});await new Promise(()=>{});}}});
 await f.poll();process.send({status:'ready'});
 }catch(error){process.send({status:'failed',code:error.code});}`;
 const child=spawn(process.execPath,['--input-type=module','--eval',script,file,pending?'pending':'normal'],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}});
 const outcome=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(()=>{throw new Error('worker exited before ready');})]);
 return {child,outcome,async kill(){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}};
}

test('exclusive ownership lasts until normal close',{timeout:10000},async t=>{
 const {file}=await fixture(t),first=await acquireCommitFollowerLock(file);t.after(()=>first.close());
 await assert.rejects(acquireCommitFollowerLock(file),{code:'COMMIT_FOLLOWER_LOCKED'});
 await first.close();const next=await acquireCommitFollowerLock(file);await next.close();
});

test('a crashed process leaves a recoverable record and the committed cursor is not replayed',{timeout:15000},async t=>{
 const {file,dir}=await fixture(t),owner=await worker(t,file);assert.equal(owner.outcome.status,'ready');
 const before=await readFile(file,'utf8'),oldLock=await readFile(file+'.lock','utf8');await owner.kill();
 let deliveries=0;const next=await createCommitFollower(options(file,async()=>deliveries++));t.after(()=>next.close());
 assert.deepEqual(await next.poll(),{status:'caught-up',count:0,revision:1});assert.equal(deliveries,0);assert.equal(await readFile(file,'utf8'),before);
 const archives=(await readdir(dir)).filter(x=>x.includes('.abandoned-'));assert.equal(archives.length,1);assert.equal(await readFile(join(dir,archives[0]),'utf8'),oldLock);
});

test('two processes racing to recover a dead owner produce only one active follower',{timeout:15000},async t=>{
 const {file}=await fixture(t),owner=await worker(t,file);assert.equal(owner.outcome.status,'ready');await owner.kill();
 const contenders=await Promise.all([worker(t,file),worker(t,file)]);
 assert.deepEqual(contenders.map(x=>x.outcome.status).sort(),['failed','ready']);
 assert.equal(contenders.find(x=>x.outcome.status==='failed').outcome.code,'COMMIT_FOLLOWER_LOCKED');
});

test('crash during delivery preserves uncertainty and never resends automatically',{timeout:15000},async t=>{
 const {file}=await fixture(t),owner=await worker(t,file,true);assert.equal(owner.outcome.status,'pending');
 const before=await readFile(file,'utf8');await owner.kill();let deliveries=0;
 const next=await createCommitFollower(options(file,async()=>deliveries++));t.after(()=>next.close());
 await assert.rejects(next.poll(),{code:'COMMIT_DELIVERY_UNCERTAIN'});assert.equal(deliveries,0);assert.equal(await readFile(file,'utf8'),before);
});

test('legacy, malformed, foreign, invalid and live owners remain untouched',{timeout:10000},async t=>{
 const {file}=await fixture(t),lease=await acquireCommitFollowerLock(file);const record=JSON.parse(await readFile(file+'.lock','utf8'));await lease.close();
 for(const value of ['{',JSON.stringify({pid:record.pid,instance:record.instance}),JSON.stringify({...record,hostname:'another-host'}),JSON.stringify({...record,identity:'wrong'}),JSON.stringify({...record,pid:0}),JSON.stringify({...record,instance:'bad'}),JSON.stringify(record)]){
  await writeFile(file+'.lock',value);await assert.rejects(acquireCommitFollowerLock(file),{code:'COMMIT_FOLLOWER_LOCKED'});assert.equal(await readFile(file+'.lock','utf8'),value);
 }
});

test('close preserves a replacement record while releasing its own mutex',{timeout:10000},async t=>{
 const {file}=await fixture(t),lease=await acquireCommitFollowerLock(file);
 const replacement=JSON.stringify({...JSON.parse(await readFile(file+'.lock','utf8')),instance:randomUUID()});await writeFile(file+'.lock',replacement);
 await lease.close();assert.equal(await readFile(file+'.lock','utf8'),replacement);
 await assert.rejects(acquireCommitFollowerLock(file),{code:'COMMIT_FOLLOWER_LOCKED'});
});

test('shutdown holds ownership until in-flight delivery and cursor persistence finish',{timeout:10000},async t=>{
 const {file}=await fixture(t);let entered,release;const begun=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);
 const follower=await createCommitFollower(options(file,async()=>{entered();await barrier;}));t.after(async()=>{release();await follower.close();});
 const poll=follower.poll();await begun;const closing=follower.close();assert.equal(follower.close(),closing);
 await assert.rejects(createCommitFollower(options(file)),{code:'COMMIT_FOLLOWER_LOCKED'});
 release();await poll;await closing;
 let deliveries=0;const next=await createCommitFollower(options(file,async()=>deliveries++));t.after(()=>next.close());await next.poll();assert.equal(deliveries,0);assert.equal(next.status().revision,1);
});

test('acknowledgements cannot write after close starts or from an earlier queued callback',{timeout:10000},async t=>{
 const {file}=await fixture(t),pending={revision:1,commandId:'one'};
 const body=JSON.stringify({version:1,campaignId:'lock-test',gmUserId:'gm',revision:0,pending});await writeFile(file,body);
 const follower=await createCommitFollower(options(file));
 const queued=follower.acknowledgeDelivered(pending),closing=follower.close();
 const late=follower.acknowledgeDelivered(pending);
 await Promise.all([assert.rejects(queued,{code:'COMMIT_FOLLOWER_CLOSED'}),assert.rejects(late,{code:'COMMIT_FOLLOWER_CLOSED'}),closing]);
 assert.equal(await readFile(file,'utf8'),body);
 const next=await createCommitFollower(options(file));t.after(()=>next.close());
 await assert.rejects(next.poll(),{code:'COMMIT_DELIVERY_UNCERTAIN'});
});

test('canonical parent aliases share the same mutex',{timeout:10000},async t=>{
 const {file,dir}=await fixture(t),alias=join(dir,'alias'),target=join(dir,'target');await mkdir(target);await symlink(target,alias,process.platform==='win32'?'junction':'dir');
 const first=await acquireCommitFollowerLock(join(target,'cursor.json'));t.after(()=>first.close());
 await assert.rejects(acquireCommitFollowerLock(join(alias,'cursor.json')),{code:'COMMIT_FOLLOWER_LOCKED'});
});

test('hard-linked cursor files are rejected before acquiring ownership',{timeout:10000},async t=>{
 const {file,dir}=await fixture(t);await writeFile(file,'{}');await link(file,join(dir,'other.json'));
 await assert.rejects(acquireCommitFollowerLock(file),{code:'COMMIT_FOLLOWER_LOCK_UNSAFE'});
});

test('bad cursor scope releases the mutex and fresh record without changing cursor bytes',{timeout:10000},async t=>{
 const {file}=await fixture(t),body=JSON.stringify({version:1,campaignId:'other',gmUserId:'gm',revision:1,pending:null});await writeFile(file,body);
 await assert.rejects(createCommitFollower(options(file)),{code:'COMMIT_CURSOR_SCOPE'});assert.equal(await readFile(file,'utf8'),body);
 const lease=await acquireCommitFollowerLock(file);await lease.close();
});
