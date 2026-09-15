import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryAction,validateIsolation,runInteractiveRehearsal,evaluateTokenObservation,runPanelInspection} from './isolated-interactive-rehearsal.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('participant cannot request DOM, arbitrary code, URLs or out-of-screen controls',()=>{
 assert.deepEqual(ordinaryAction({kind:'click',x:42,y:30},100,100),{kind:'click',x:42,y:30});
 for(const action of [{kind:'evaluate',code:'source'},{kind:'click',x:100,y:20},{kind:'click',x:1,y:1,selector:'#hidden'},{kind:'type',text:'x'.repeat(301)}])assert.throws(()=>ordinaryAction(action,100,100));
});
test('reading a move receipt or identifying a companion is not own-token visual understanding',()=>{
 const before={revision:4,x:3,y:2},after={revision:5,x:3,y:1};
 assert.equal(evaluateTokenObservation({before,after,observation:'Moved one square. Revision 5.'}).passed,false);
 assert.equal(evaluateTokenObservation({before,after,observation:'The character is at column 5, row 4.'}).passed,false);
 assert.equal(evaluateTokenObservation({before,after,observation:'Mara moved to column 4, row 2.'}).passed,true);
});
test('three identical ineffective choices stop without pretending success',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-interactive-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));let acts=0;
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit-fixture',profileId:'fresh'};
 const result=await runInteractiveRehearsal({outputRoot:dir,browser:{proof:async()=>proof,screenshot:async()=>({png:Buffer.from('89504e470d0a1a0a','hex'),width:100,height:100}),act:async()=>acts++,close:async()=>{}},participant:{decide:async()=>({kind:'click',x:20,y:20}),close:async()=>{}},audit:{snapshot:async()=>({}),guard:async()=>({}),evaluate:async()=>{throw Error('should not evaluate');}}});
 assert.equal(result.outcome,'stopped-repeated-no-change');assert.equal(acts,2);
});
test('shared profiles, host mounts, live fixtures and unbounded network are rejected',()=>{
 const p={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'fixture',profileId:'fresh'};
 validateIsolation(p);for(const changes of [{production:true},{hostMounts:1},{sharedCookies:true},{freshProfile:false},{participantNetwork:'bridge'}])assert.throws(()=>validateIsolation({...p,...changes}));
});

test('panel browser failure reports its stage without persisting raw private errors',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-panel-diagnostic-'));t.after(()=>rm(dir,{recursive:true,force:true}));let browserClosed=false,participantClosed=false;
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit',profileId:'fresh'};
 const result=await runPanelInspection({outputRoot:dir,identity:'unit',tasks:['Read the screen'],browser:{proof:async()=>proof,screenshot:async()=>({png:Buffer.from('89504e470d0a1a0a','hex'),width:100,height:100}),act:async()=>{throw Object.assign(Error('secret-token-in-private-url'),{name:'TimeoutError',code:'secret-token-private-code'});},close:async()=>{browserClosed=true;}},participant:{proof:async()=>({}),decide:async()=>({kind:'click',x:20,y:20}),close:async()=>{participantClosed=true;}},audit:async()=>{throw Error('should not audit');}});
 const raw=await readFile(join(result.directory,'report.json'),'utf8'),report=JSON.parse(raw);
 assert.equal(result.outcome,'transport-failed');assert.deepEqual(report.failure,{stage:'browser-action',type:'TimeoutError',code:'unclassified',step:1});assert.equal(raw.includes('secret-token'),false);assert.equal(browserClosed&&participantClosed,true);
});
test('panel audit errors are distinguished from screenshot participant failures',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-panel-audit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit',profileId:'fresh'};
 const result=await runPanelInspection({outputRoot:dir,identity:'unit',tasks:['Read'],browser:{proof:async()=>proof,screenshot:async()=>({png:Buffer.from('89504e470d0a1a0a','hex'),width:100,height:100}),close:async()=>{}},participant:{proof:async()=>({}),decide:async()=>({kind:'done',observation:'Read'}),close:async()=>{}},audit:async()=>{throw Object.assign(Error('hidden evaluation data'),{name:'private-name'});}});
 const report=JSON.parse(await readFile(join(result.directory,'report.json'),'utf8'));assert.deepEqual(report.failure,{stage:'controller-audit',type:'UnknownError',code:'unclassified',step:1});
});
test('a stalled controller audit cannot escape the panel time bound',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-panel-time-'));t.after(()=>rm(dir,{recursive:true,force:true}));let entered;
 const enteredAudit=new Promise(resolve=>{entered=resolve;});t.mock.timers.enable({apis:['setTimeout']});
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit',profileId:'fresh'};
 const running=runPanelInspection({outputRoot:dir,identity:'unit',tasks:['Read'],browser:{proof:async()=>proof,screenshot:async()=>({png:Buffer.from('89504e470d0a1a0a','hex'),width:100,height:100}),close:async()=>{}},participant:{proof:async()=>({}),decide:async()=>({kind:'done',observation:'Read'}),close:async()=>{}},audit:()=>{entered();return new Promise(()=>{});}});
 await enteredAudit;t.mock.timers.tick(90000);const result=await running;
 const report=JSON.parse(await readFile(join(result.directory,'report.json'),'utf8'));assert.equal(result.outcome,'TIME_LIMIT');assert.equal(report.failure.stage,'controller-audit');
});
test('allowlisted browser timeout detail is retained without exposing raw diagnostic data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-panel-font-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit',profileId:'fresh'};
 const result=await runPanelInspection({outputRoot:dir,identity:'unit',tasks:['Read'],browser:{proof:async()=>proof,screenshot:async()=>{throw Object.assign(Error('browser-operation-failed'),{name:'TimeoutError',code:'font-wait'});},close:async()=>{}},participant:{proof:async()=>({}),close:async()=>{}},audit:async()=>({passed:false})});
 const report=JSON.parse(await readFile(join(result.directory,'report.json'),'utf8'));assert.deepEqual(report.failure,{stage:'browser-screenshot',type:'TimeoutError',code:'browser-operation-failed',detail:'font-wait',step:0});
});

for(const panel of [false,true])for(const cycling of [false,true])test(`${panel?'panel':'movement'} rehearsal ${cycling?'stops alternating caret frames':'allows repeated clicks through changing screens'}`,async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hl-loop-'));t.after(()=>rm(dir,{recursive:true,force:true}));let acts=0,captures=0,decisions=0,closed=0;
 const proof={production:false,disposable:true,freshProfile:true,sharedCookies:false,sharedMemory:false,participantNetwork:'none',hostMounts:0,browserAccess:'fixture-only',containerId:'unit',profileId:'fresh'};
 const browser={proof:async()=>proof,screenshot:async()=>({png:Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from([cycling?captures++%2:captures++])]),width:100,height:100}),act:async()=>acts++,close:async()=>closed++};
 const participant={proof:async()=>({}),decide:async()=>++decisions<=3?{kind:'click',x:20,y:20}:{kind:'done',observation:'The screen changed.'},close:async()=>closed++};
 const result=panel?await runPanelInspection({outputRoot:dir,identity:'unit',tasks:['Use controls'],browser,participant,audit:async()=>({passed:true})}):await runInteractiveRehearsal({outputRoot:dir,browser,participant,audit:{snapshot:async()=>({}),guard:async()=>({}),evaluate:async()=>({passed:true})}});
 assert.equal(result.outcome,cycling?(panel?'REPEATED_NO_CHANGE':'stopped-repeated-no-change'):(panel?'passed-panels':'passed-small-slice'));
 assert.equal(acts,cycling?2:3);assert.equal(closed,2);
});
