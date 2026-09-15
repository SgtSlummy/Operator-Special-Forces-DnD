import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {createVisualParticipant} from './isolated-interactive-rehearsal.mjs';

function relay({echo=true}={}) {
 const stdout=new PassThrough(),stderr=new PassThrough();let killed=false;
 const stdin=new Writable({write(chunk,_encoding,done){if(echo)stdout.write(chunk);done();}});
 return {stdout,stderr,stdin,kill(){killed=true;stdout.end();stderr.end();},get killed(){return killed;}};
}
const input={task:'Describe the visible screen.',screenshot:Buffer.from('fixture'),width:1280,height:1000};
test('closing a visual participant aborts its in-flight model request at the trial boundary',async()=>{
 const child=relay();let started,signal,calls=0;const ready=new Promise(resolve=>started=resolve),removed=[];
 const participant=createVisualParticipant({spawnImpl:()=>child,execImpl:(_command,args)=>removed.push(args),fetchImpl:async(_url,options)=>{calls++;signal=options.signal;started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const decision=participant.decide(input),rejected=assert.rejects(decision,{name:'AbortError'});await ready;await participant.close();await rejected;
 assert.equal(signal.aborted,true);assert.equal(child.killed,true);assert.equal(removed.length,1);
 await assert.rejects(participant.decide(input),{name:'AbortError'});assert.equal(calls,1);
});
test('closing before the isolated relay answers cannot start a late model request',async()=>{
 const child=relay({echo:false});let calls=0;
 const participant=createVisualParticipant({spawnImpl:()=>child,execImpl:()=>{},fetchImpl:async()=>{calls++;throw Error('Unexpected request');}});
 const decision=participant.decide(input),rejected=assert.rejects(decision,{name:'AbortError'});await participant.close();await rejected;assert.equal(calls,0);
});
